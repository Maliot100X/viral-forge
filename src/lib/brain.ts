// ---------------------------------------------------------------------------
// River AI brain client.
//
// Server-side only. The key never reaches the browser — every call goes through
// a Next.js route handler.
//
// Design notes that matter:
//   - Every call has a hard timeout and bounded retries with backoff. A slow
//     brain must never hang a forge request.
//   - Malformed model output is treated as failure, not as data. Callers get
//     `null` and fall back to the deterministic local generator, so a bad model
//     response degrades the copy instead of shipping garbage to the UI.
//   - `brainAvailable()` lets the UI tell the truth about which path ran rather
//     than claiming AI when templates produced the result.
// ---------------------------------------------------------------------------

const RIVER_BASE = "https://api.river.ai/v1";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

/** Fallback models, tried in order if the primary errors. */
const MODEL_CHAIN = [DEFAULT_MODEL, "zai-org/GLM-5.3-Flash"];

/** How many distinct models a single `chat()` call can attempt. */
export const MODEL_CHAIN_LENGTH = new Set(MODEL_CHAIN).size;

export interface BrainMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BrainOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
}

export function brainAvailable(): boolean {
  return Boolean(process.env.RIVER_API_KEY);
}

export function brainModel(): string {
  return process.env.RIVER_MODEL ?? DEFAULT_MODEL;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
}

/**
 * Single chat completion. Throws only on exhausted retries — callers that need
 * a non-throwing contract should use `chatSafe`.
 */
async function chatOnce(
  messages: BrainMessage[],
  opts: Required<Pick<BrainOptions, "maxTokens" | "temperature" | "timeoutMs">> & {
    model: string;
  },
): Promise<string> {
  const res = await fetch(`${RIVER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.RIVER_API_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`river_http_${res.status}: ${body.slice(0, 180)}`);
  }

  const data = (await res.json()) as ChatResponse;
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("river_empty_completion");
  }
  return text;
}

export async function chat(
  messages: BrainMessage[],
  opts: BrainOptions = {},
): Promise<string> {
  const {
    maxTokens = 700,
    temperature = 0.9,
    timeoutMs = 25_000,
    retries = 2,
  } = opts;

  const chain = opts.model ? [opts.model, ...MODEL_CHAIN] : MODEL_CHAIN;
  const unique = [...new Set(chain)];
  let lastErr: unknown;

  for (const model of unique) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await chatOnce(messages, { model, maxTokens, temperature, timeoutMs });
      } catch (err) {
        lastErr = err;
        // A 4xx (other than 429) will not fix itself on retry of the same model.
        const msg = err instanceof Error ? err.message : "";
        const is4xx = /river_http_4\d\d/.test(msg) && !/river_http_429/.test(msg);
        if (is4xx) break;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 350 * 2 ** attempt));
        }
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("river_unavailable");
}

/** Never throws. Returns null when the brain is unavailable or misbehaving. */
export async function chatSafe(
  messages: BrainMessage[],
  opts: BrainOptions = {},
): Promise<string | null> {
  if (!brainAvailable()) return null;
  try {
    return await chat(messages, opts);
  } catch {
    return null;
  }
}

/**
 * Ask the brain for a JSON object and validate it with the supplied guard.
 *
 * Models wrap JSON in prose or fences often enough that a strict `JSON.parse`
 * on the raw reply is unreliable. We extract the outermost brace span and
 * validate the parsed result; anything that fails validation is a retry, not a
 * silent pass-through.
 */
export async function chatJSON<T>(
  messages: BrainMessage[],
  validate: (value: unknown) => T | null,
  opts: BrainOptions = {},
): Promise<T | null> {
  if (!brainAvailable()) return null;

  const attempts = opts.retries ?? 2;
  for (let i = 0; i <= attempts; i++) {
    const raw = await chatSafe(messages, { ...opts, retries: 0 });
    if (raw === null) return null;

    const parsed = extractJSON(raw);
    if (parsed !== undefined) {
      const valid = validate(parsed);
      if (valid !== null) return valid;
    }
    // Invalid shape is worth exactly one more try; further retries on a model
    // that keeps emitting bad JSON just burn latency.
    if (i === attempts) return null;
  }
  return null;
}

/** Pull the outermost JSON object out of a model reply. */
export function extractJSON(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
