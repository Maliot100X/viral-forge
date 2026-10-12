import { chatJSON, brainAvailable, brainModel, type BrainMessage } from "./brain";
import { forge } from "./forge";
import type { ForgeSource, LogoStyle } from "./types";

/**
 * The conversational launch agent.
 *
 * The user types natural language or a slash command; the River brain decides
 * what to do. Crucially the brain only *proposes* — it never signs. A launch
 * intent comes back as a `launch` action that the API refuses to execute until
 * the caller echoes it back with `confirm: true`, so the existing single gate in
 * `src/app/api/launch/route.ts` stays the only path to a signature (Solana
 * skill guardrail W009).
 *
 * This module is deliberately pure-ish: no network beyond `chatJSON`/`forge`,
 * so it is cheap to unit test with the brain stubbed.
 */

export type AgentAction =
  | { type: "chat"; reply: string }
  | {
      type: "forge";
      reply: string;
      source: ForgeSource;
      input: string;
      style: LogoStyle;
    }
  | {
      type: "launch";
      reply: string;
      /** Text handed to the forge step once the user approves. */
      input: string;
      source: ForgeSource;
      style: LogoStyle;
      /** Dev buy in SOL the user asked for, if any. */
      buySol: number;
    };

/** Commands advertised in the chat UI, so the syntax is discoverable. */
export const AGENT_COMMANDS = [
  {
    command: "/launch <idea>",
    description: "Forge a coin from an idea and launch it on devnet",
  },
  {
    command: "/forge <idea>",
    description: "Generate name, lore and logo without launching",
  },
  {
    command: "/x <url>",
    description: "Forge from an X/Twitter post",
  },
  {
    command: "/trend",
    description: "Forge from what is trending right now",
  },
] as const;

export const SOURCES: readonly ForgeSource[] = [
  "prompt",
  "x",
  "hashtag",
  "image",
  "tiktok",
  "trend",
];

export const STYLES: readonly LogoStyle[] = [
  "auto",
  "meme",
  "cartoon",
  "3d",
  "realistic",
  "anime",
];

export function agentAvailable(): boolean {
  return brainAvailable();
}

export function agentModel(): string {
  return brainModel();
}

/**
 * Parse a leading slash command. Returns `null` when the message is plain chat,
 * so the brain handles it conversationally instead.
 *
 * Kept separate from the brain call so command syntax is exact and testable
 * rather than depending on model interpretation.
 */
export function parseCommand(
  raw: string,
): { cmd: string; arg: string; buySol: number } | null {
  const text = raw.trim();
  if (!text.startsWith("/")) return null;

  const match = /^\/([a-z]+)\s*([\s\S]*)$/i.exec(text);
  if (!match) return null;

  const cmd = match[1].toLowerCase();
  let arg = match[2].trim();

  // "/launch 0.01 sol <idea>" — pull an explicit dev buy out of the argument.
  let buySol = 0;
  const buy = /^([0-9]*\.?[0-9]+)\s*(?:sol)?\s+([\s\S]+)$/i.exec(arg);
  if (buy && cmd === "launch") {
    const parsed = Number(buy[1]);
    // Anything above 1 SOL in one command is treated as part of the idea text,
    // not a spend instruction — a typo should not move a large amount.
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
      buySol = parsed;
      arg = buy[2].trim();
    }
  }

  return { cmd, arg, buySol };
}

/** Clamp whatever the model returns into something safe to hand downstream. */
function coerceSource(value: unknown): ForgeSource {
  return SOURCES.includes(value as ForgeSource) ? (value as ForgeSource) : "prompt";
}

function coerceStyle(value: unknown): LogoStyle {
  return STYLES.includes(value as LogoStyle) ? (value as LogoStyle) : "auto";
}

const SYSTEM = `You are FORGE, the in-app launch agent for a Solana memecoin launchpad.

Decide what the user wants and reply with JSON only:

{"action":"chat"|"forge"|"launch","reply":"...","source":"prompt","input":"...","style":"auto"}

- "chat"   — answer a question or respond to small talk. No coin.
- "forge"  — the user wants a coin generated (name, lore, logo) but not sent.
- "launch" — the user wants the coin actually launched on-chain.

For "forge" and "launch":
- "input" is the raw idea, cleaned of slash commands and spend amounts.
- "source" is one of: ${SOURCES.join(", ")}. Use "x" for a tweet URL,
  "hashtag" for a bare #tag, "trend" when they say "what's trending".
- "style" is one of: ${STYLES.join(", ")}.

"reply" is one or two sentences shown in chat. For forge/launch, say what you
are about to make. Never claim a coin is already on-chain — the launch is
confirmed by the user afterwards, in a separate step.
Keep replies under 240 characters. Never invent a transaction signature.`;

/**
 * One turn of the agent. Never throws: if the brain is unavailable or returns
 * junk, it degrades to a plain chat reply so the UI always has something real
 * to render.
 */
export async function agentTurn(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<AgentAction> {
  const text = message.trim();
  if (!text) {
    return { type: "chat", reply: "Give me something to work with." };
  }

  // Deterministic command path — exact syntax, no model guesswork.
  const parsed = parseCommand(text);
  if (parsed) {
    const { cmd, arg, buySol } = parsed;
    if (cmd === "help") {
      return {
        type: "chat",
        reply:
          "Commands: " +
          AGENT_COMMANDS.map((c) => c.command).join(" · ") +
          ". Or just describe a coin in plain English.",
      };
    }
    if (cmd === "forge" || cmd === "launch") {
      if (!arg) {
        return {
          type: "chat",
          reply: `/${cmd} needs an idea, e.g. /${cmd} a frog that only trades at 3am`,
        };
      }
      const source: ForgeSource =
        cmd === "forge" && /^https?:\/\/(x|twitter)\.com/i.test(arg) ? "x" : "prompt";
      if (cmd === "forge") {
        return { type: "forge", reply: `Forging "${arg}".`, source, input: arg, style: "auto" };
      }
      return {
        type: "launch",
        reply: `Ready to launch "${arg}". Confirm the transaction to send it.`,
        source,
        input: arg,
        style: "auto",
        buySol,
      };
    }
    if (cmd === "trend") {
      return {
        type: "forge",
        reply: "Forging from what is trending right now.",
        source: "trend",
        input: arg || "current trends",
        style: "auto",
      };
    }
    if (cmd === "x") {
      if (!arg) return { type: "chat", reply: "/x needs a post URL." };
      return { type: "forge", reply: "Forging from that post.", source: "x", input: arg, style: "auto" };
    }
    // Unknown slash command: fall through to the brain rather than dead-ending.
  }

  if (!brainAvailable()) {
    return {
      type: "chat",
      reply: "Brain offline — no RIVER_API_KEY configured, so I can only echo commands.",
    };
  }

  try {
    const messages: BrainMessage[] = [
      { role: "system", content: SYSTEM },
      ...history.map((m) => ({ role: m.role, content: m.content }) as BrainMessage),
      { role: "user", content: text },
    ];

    const result = await chatJSON<Record<string, unknown>>(
      messages,
      (raw) =>
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null,
      { maxTokens: 400, temperature: 0.8, timeoutMs: 25_000, retries: 2 },
    );

    if (!result) {
      return { type: "chat", reply: "I did not catch that. Try /launch <idea>." };
    }

    const action = typeof result.action === "string" ? result.action : "chat";
    const reply =
      typeof result.reply === "string" && result.reply.trim()
        ? result.reply.trim().slice(0, 600)
        : "Done.";

    if (action === "forge" || action === "launch") {
      const input =
        typeof result.input === "string" && result.input.trim()
          ? result.input.trim()
          : text;
      const style = coerceStyle(result.style);
      const source = coerceSource(result.source);
      if (action === "forge") return { type: "forge", reply, source, input, style };
      return { type: "launch", reply, source, input, style, buySol: parsed?.buySol ?? 0 };
    }

    return { type: "chat", reply };
  } catch {
    return {
      type: "chat",
      reply: "Brain unreachable right now. You can still use /forge and /launch.",
    };
  }
}

export interface AgentForgeResult {
  action: "forge";
  reply: string;
  coin: Awaited<ReturnType<typeof forge>>;
}

/**
 * Run the generation half of an approved intent. Split from `agentTurn` so the
 * UI can show the agent's reply immediately and stream the art in after.
 */
export async function runAgentForge(
  input: string,
  source: ForgeSource,
  style: LogoStyle,
): Promise<AgentForgeResult> {
  const coin = await forge(source, input, style);
  return {
    action: "forge",
    reply: `Made ${coin.name} ($${coin.symbol}).`,
    coin,
  };
}
