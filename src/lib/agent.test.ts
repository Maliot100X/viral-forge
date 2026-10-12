import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_COMMANDS,
  agentAvailable,
  agentTurn,
  parseCommand,
} from "./agent";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
  delete process.env.RIVER_API_KEY;
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseCommand", () => {
  it("returns null for plain chat, so the brain handles it", () => {
    expect(parseCommand("make me a coin about frogs")).toBeNull();
    expect(parseCommand("  hello there  ")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });

  it("parses a bare command with no argument", () => {
    expect(parseCommand("/trend")).toEqual({ cmd: "trend", arg: "", buySol: 0 });
  });

  it("parses a command and its argument", () => {
    expect(parseCommand("/launch a frog that only trades at 3am")).toEqual({
      cmd: "launch",
      arg: "a frog that only trades at 3am",
      buySol: 0,
    });
  });

  it("is case-insensitive on the command and tolerates extra space", () => {
    expect(parseCommand("/LAUNCH    spaced out idea")).toEqual({
      cmd: "launch",
      arg: "spaced out idea",
      buySol: 0,
    });
  });

  it("pulls an explicit dev buy out of a launch argument", () => {
    expect(parseCommand("/launch 0.05 sol a polite goose")).toEqual({
      cmd: "launch",
      arg: "a polite goose",
      buySol: 0.05,
    });
  });

  it("accepts the amount without the sol suffix", () => {
    expect(parseCommand("/launch 0.25 angry toaster")).toEqual({
      cmd: "launch",
      arg: "angry toaster",
      buySol: 0.25,
    });
  });

  it("treats an amount above 1 SOL as part of the idea, not a spend", () => {
    // A typo must not move a large amount. The text keeps the number.
    const parsed = parseCommand("/launch 50 a whale that votes");
    expect(parsed).toEqual({
      cmd: "launch",
      arg: "50 a whale that votes",
      buySol: 0,
    });
  });

  it("does not read a dev buy out of a forge, that never spends", () => {
    expect(parseCommand("/forge 0.5 some idea")).toEqual({
      cmd: "forge",
      arg: "0.5 some idea",
      buySol: 0,
    });
  });

  it("keeps an idea that merely starts with a number", () => {
    // "3am" is not a leading bare number, so it stays in the text.
    expect(parseCommand("/launch 3am frog")).toEqual({
      cmd: "launch",
      arg: "3am frog",
      buySol: 0,
    });
  });

  it("keeps a URL intact as an argument", () => {
    const url = "https://x.com/user/status/1800000000000000000";
    expect(parseCommand(`/x ${url}`)).toEqual({ cmd: "x", arg: url, buySol: 0 });
  });

  it("returns null for a lone slash", () => {
    expect(parseCommand("/")).toBeNull();
  });
});

describe("AGENT_COMMANDS", () => {
  it("advertises only commands the parser understands", () => {
    for (const c of AGENT_COMMANDS) {
      const name = c.command.split(" ")[0].slice(1);
      const parsed = parseCommand(`/${name} something`);
      expect(parsed, `${c.command} should parse`).not.toBeNull();
      expect(parsed!.cmd).toBe(name);
    }
  });
});

describe("agentTurn — deterministic command path", () => {
  it("routes /launch to a launch action", async () => {
    const action = await agentTurn("/launch a frog that only trades at 3am");
    expect(action.type).toBe("launch");
    if (action.type !== "launch") throw new Error("wrong branch");
    expect(action.input).toBe("a frog that only trades at 3am");
    expect(action.source).toBe("prompt");
    expect(action.buySol).toBe(0);
  });

  it("carries the dev buy through a launch command", async () => {
    const action = await agentTurn("/launch 0.01 polite goose");
    if (action.type !== "launch") throw new Error("wrong branch");
    expect(action.buySol).toBe(0.01);
    expect(action.input).toBe("polite goose");
  });

  it("routes /forge to a forge action, never a launch", async () => {
    const action = await agentTurn("/forge a sad robot");
    expect(action.type).toBe("forge");
  });

  it("routes an X URL in a forge command to the x source", async () => {
    const action = await agentTurn("/forge https://x.com/u/status/123");
    expect(action.type).toBe("forge");
    if (action.type !== "forge") throw new Error("wrong branch");
    expect(action.source).toBe("x");
  });

  it("routes /trend to the trend source", async () => {
    const action = await agentTurn("/trend");
    expect(action.type).toBe("forge");
    if (action.type !== "forge") throw new Error("wrong branch");
    expect(action.source).toBe("trend");
  });

  it("answers a bare command with usage instead of failing", async () => {
    const action = await agentTurn("/launch");
    expect(action.type).toBe("chat");
    if (action.type !== "chat") throw new Error("wrong branch");
    expect(action.reply).toContain("/launch");
  });

  it("lists the real commands for /help", async () => {
    const action = await agentTurn("/help");
    expect(action.type).toBe("chat");
    if (action.type !== "chat") throw new Error("wrong branch");
    expect(action.reply).toContain("/launch");
    expect(action.reply).toContain("/forge");
  });

  it("asks for a URL when /x has no argument", async () => {
    const action = await agentTurn("/x");
    expect(action.type).toBe("chat");
  });

  it("handles an empty message without throwing", async () => {
    const action = await agentTurn("   ");
    expect(action.type).toBe("chat");
  });
});

describe("agentTurn — no brain configured", () => {
  it("reports the brain is offline rather than guessing", async () => {
    expect(agentAvailable()).toBe(false);
    const action = await agentTurn("make me a coin about a brave pigeon");
    expect(action.type).toBe("chat");
    if (action.type !== "chat") throw new Error("wrong branch");
    expect(action.reply.toLowerCase()).toContain("brain offline");
  });
});

describe("agentTurn — with the brain available", () => {
  beforeEach(() => {
    process.env.RIVER_API_KEY = "test-key";
  });

  /** Shape the brain's HTTP response the way the River client expects. */
  function stubBrain(content: string) {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("routes a model-chosen launch intent to a launch action", async () => {
    stubBrain(
      JSON.stringify({
        action: "launch",
        reply: "Spinning up a frog coin.",
        source: "prompt",
        input: "an amphibian that day-trades",
        style: "meme",
      }),
    );
    const action = await agentTurn("launch me something about a trading frog");
    expect(action.type).toBe("launch");
    if (action.type !== "launch") throw new Error("wrong branch");
    expect(action.input).toBe("an amphibian that day-trades");
    expect(action.style).toBe("meme");
  });

  it("keeps a plain conversational answer as chat", async () => {
    stubBrain(JSON.stringify({ action: "chat", reply: "Solana is a blockchain." }));
    const action = await agentTurn("what is solana?");
    expect(action.type).toBe("chat");
    if (action.type !== "chat") throw new Error("wrong branch");
    expect(action.reply).toBe("Solana is a blockchain.");
  });

  it("clamps an invented source and style to safe defaults", async () => {
    stubBrain(
      JSON.stringify({
        action: "forge",
        reply: "ok",
        source: "telepathy",
        input: "a weird idea",
        style: "carved-marble",
      }),
    );
    const action = await agentTurn("forge a weird idea");
    if (action.type !== "forge") throw new Error("wrong branch");
    expect(action.source).toBe("prompt");
    expect(action.style).toBe("auto");
  });

  it("degrades to chat when the model returns unparseable text", async () => {
    stubBrain("this is not json at all");
    const action = await agentTurn("hello");
    expect(action.type).toBe("chat");
  });

  it("never throws when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    // `chatSafe` swallows the transport error and yields null, so the agent
    // falls back to the "did not catch that" reply. The contract that matters
    // is that it resolves to a chat action instead of rejecting.
    const action = await agentTurn("launch a coin about outage");
    expect(action.type).toBe("chat");
    if (action.type !== "chat") throw new Error("wrong branch");
    expect(action.reply.length).toBeGreaterThan(0);
  });

  it("prefers the deterministic command over the model", async () => {
    const fetchMock = stubBrain(
      JSON.stringify({ action: "chat", reply: "I would rather chat." }),
    );
    const action = await agentTurn("/launch a deterministic frog");
    // The slash command must win: the model is never consulted.
    expect(action.type).toBe("launch");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
