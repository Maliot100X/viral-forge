import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brainAvailable, brainModel, chatSafe, chat, extractJSON, MODEL_CHAIN_LENGTH } from "./brain";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore the env in place. Reassigning `process.env` wholesale would break
  // the module's captured reference to it.
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
});

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((url: unknown, init?: RequestInit) =>
    Promise.resolve(impl(String(url), init)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function completion(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("brain availability", () => {
  it("reports unavailable without a key", () => {
    delete process.env.RIVER_API_KEY;
    expect(brainAvailable()).toBe(false);
  });

  it("reports available with a key", () => {
    process.env.RIVER_API_KEY = "test-key";
    expect(brainAvailable()).toBe(true);
  });

  it("defaults the model and honours an override", () => {
    delete process.env.RIVER_MODEL;
    expect(brainModel()).toBe("deepseek-ai/DeepSeek-V4.1-Flash");
    process.env.RIVER_MODEL = "zai-org/GLM-5.3-Flash";
    expect(brainModel()).toBe("zai-org/GLM-5.3-Flash");
  });
});

describe("extractJSON", () => {
  it("parses a bare object", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses through a markdown fence", () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores prose around the object", () => {
    expect(extractJSON('Sure! Here you go: {"a":1} Hope that helps.')).toEqual({
      a: 1,
    });
  });

  it("returns undefined when there is no object", () => {
    expect(extractJSON("no json here")).toBeUndefined();
  });

  it("returns undefined on malformed json", () => {
    expect(extractJSON('{"a": }')).toBeUndefined();
  });
});

describe("chatSafe", () => {
  it("returns null when no key is configured and never calls the network", async () => {
    delete process.env.RIVER_API_KEY;
    const spy = mockFetch(() => completion("hi"));
    expect(await chatSafe([{ role: "user", content: "x" }])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the model text on success", async () => {
    process.env.RIVER_API_KEY = "k";
    mockFetch(() => completion("hello"));
    expect(await chatSafe([{ role: "user", content: "x" }])).toBe("hello");
  });

  it("treats a zero-length completion as failure, not success", async () => {
    process.env.RIVER_API_KEY = "k";
    mockFetch(() => completion(""));
    expect(await chatSafe([{ role: "user", content: "x" }])).toBeNull();
  });

  it("does not retry a 4xx on the same model, but does try the next model", async () => {
    process.env.RIVER_API_KEY = "k";
    const spy = mockFetch(() => new Response("bad request", { status: 400 }));
    expect(await chatSafe([{ role: "user", content: "x" }])).toBeNull();
    // A 400 will not fix itself on retry, so each model is attempted exactly
    // once — one attempt per model across the two-model chain.
    expect(spy).toHaveBeenCalledTimes(MODEL_CHAIN_LENGTH);
  });

  it("falls back to the secondary model when the primary 4xxes", async () => {
    process.env.RIVER_API_KEY = "k";
    let call = 0;
    const spy = mockFetch(() => {
      call++;
      return call === 1 ? new Response("nope", { status: 400 }) : completion("ok");
    });
    const out = await chatSafe([{ role: "user", content: "x" }], { retries: 0 });
    expect(out).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("surfaces a network failure as null rather than throwing", async () => {
    process.env.RIVER_API_KEY = "k";
    mockFetch(() => {
      throw new Error("socket hangup");
    });
    expect(await chatSafe([{ role: "user", content: "x" }])).toBeNull();
  });
});

describe("chat", () => {
  it("throws when every attempt fails", async () => {
    process.env.RIVER_API_KEY = "k";
    mockFetch(() => new Response("boom", { status: 500 }));
    await expect(
      chat([{ role: "user", content: "x" }], { retries: 0 }),
    ).rejects.toThrow(/river_http_500/);
  });
});
