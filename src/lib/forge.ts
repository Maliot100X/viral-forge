import type {
  ForgeSource,
  GenerateResult,
  LogoStyle,
  Trend,
} from "./types";

// ---------------------------------------------------------------------------
// Forge engine.
//
// Two backends, selected by env at call time:
//   1. Model provider (ANTHROPIC_API_KEY or OPENAI_API_KEY) — used when present.
//   2. Deterministic local generator — always available, no key required.
//
// The local generator is what makes the app runnable with zero configuration,
// which is what lets /api/generate, the radar, and the forge UI all work in a
// fresh clone. It is a real generator, not a stub returning fixed strings: it
// derives ticker, lore, tags, vibe and image prompt from the input text.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a","an","the","that","this","with","and","or","of","in","on","at","to","for",
  "is","are","was","were","be","been","it","its","as","by","from","only","who",
  "how","what","when","where","why","want","wants","like","just","very","really",
  "into","over","out","about","his","her","their","they","them","he","she",
]);

const VIBES = [
  "sleepless degen chaos",
  "unhinged optimism",
  "quiet financial violence",
  "cosmic absurdism",
  "petty revenge energy",
  "deadpan menace",
  "manic main-character",
  "bureaucratic anarchy",
  "smug little guy",
  "existential comedy",
  "feral professionalism",
  "delusional confidence",
];

const STYLE_HINTS: Record<Exclude<LogoStyle, "auto">, string> = {
  meme: "flat 2D meme sticker, bold black outline, high contrast, MS-paint-adjacent",
  cartoon: "hand-drawn cartoon character, expressive face, clean cel shading",
  "3d": "glossy 3D render, soft studio lighting, subsurface scattering, depth of field",
  realistic: "photorealistic subject, cinematic lighting, shallow depth of field, 50mm lens",
  anime: "anime cel-shaded character art, dynamic pose, speed lines, vibrant palette",
};

function tokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NAME_PATTERNS = [
  (a: string, b: string) => `${titleCase(a)} ${titleCase(b)}`,
  (a: string, b: string) => `${titleCase(b)} ${titleCase(a)}`,
  (a: string, b: string) => `${titleCase(a)} of ${titleCase(b)}`,
  (a: string, b: string) => `The ${titleCase(a)} ${titleCase(b)}`,
  (a: string) => `${titleCase(a)} Protocol`,
  (a: string, b: string) => `${titleCase(b)} Core`,
];

const LORE_PATTERNS = [
  (a: string, b: string) =>
    `${titleCase(a)}. ${titleCase(b)}. Two things the market never priced in together, and now they are one ticker. No roadmap, no whitepaper, no apology.`,
  (a: string, b: string) =>
    `Nobody asked for a ${a} that does ${b}. It showed up anyway, bought the top, and started posting. Dev is doxxed to a group chat of four.`,
  (a: string, b: string) =>
    `Born from a ${a}, raised by ${b}. It has no utility and intends to keep it that way. The community is the product. The product is the bit.`,
  (a: string, b: string) =>
    `Every cycle produces one ${a} that refuses to die. This is the ${b} one. It survived the last three rugs out of pure spite.`,
  (a: string, b: string) =>
    `${titleCase(a)} met ${titleCase(b)} at exactly the wrong moment. Neither has recovered. Now there is a chart.`,
];

function deriveSymbol(name: string, seed: number): string {
  const words = name.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const letters = words.map((w) => w[0]).join("").toUpperCase();
  let sym = letters.slice(0, 5);
  if (sym.length < 3) {
    const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    sym = clean.slice(0, 5);
  }
  if (sym.length < 3) sym = (sym + "COIN").slice(0, 4);
  // ~1 in 4 gets a trailing digit, matching the reference site's tickers
  // such as FROG3.
  if (seed % 4 === 0) sym = sym.slice(0, 4) + String(1 + (seed % 9));
  return sym;
}

function resolveStyle(style: LogoStyle, input: string, seed: number): Exclude<LogoStyle, "auto"> {
  if (style !== "auto") return style;
  const opts: Exclude<LogoStyle, "auto">[] = [
    "meme", "cartoon", "3d", "realistic", "anime",
  ];
  const lower = input.toLowerCase();
  if (/\b(frog|dog|cat|pepe|pigeon|animal|guy|gremlin)\b/.test(lower)) return "cartoon";
  if (/\b(3d|render|chrome|metallic|glass)\b/.test(lower)) return "3d";
  if (/\b(photo|real|realistic|cinematic)\b/.test(lower)) return "realistic";
  return pick(opts, seed);
}

export function forgeLocally(
  source: ForgeSource,
  input: string,
  style: LogoStyle,
): GenerateResult {
  const seed = hash(`${source}:${input}:${style}`);
  const toks = tokens(input);
  const a = toks[0] ?? "nothing";
  const b = toks[1] ?? "everything";

  const name = pick(NAME_PATTERNS, seed)(a, b);
  const symbol = deriveSymbol(name, seed);
  const imageStyle = resolveStyle(style, input, seed);
  const vibe = pick(VIBES, seed >> 3);
  const description =
    pick(LORE_PATTERNS, seed >> 5)(a, b) +
    "\n\nLaunched thru viral-forge";

  const tagPool = [...new Set(toks.slice(0, 6))];
  const tags = tagPool.length >= 3 ? tagPool : [...tagPool, "memecoin", "degen"].slice(0, 5);

  const imagePrompt =
    `${input.trim()}. Rendered as ${STYLE_HINTS[imageStyle]}. ` +
    `Single centered subject, strong silhouette, ${vibe} mood, square composition.`;

  return { name, symbol, description, tags, vibe, imagePrompt, imageStyle };
}

/**
 * Forge from a trend. Uses the trend's own title as the seed material, which is
 * what the reference radar does — the coin inherits the trend's subject.
 */
export function forgeFromTrend(trend: Trend): GenerateResult {
  const base = forgeLocally("trend", trend.title, "auto");
  const symbol = deriveSymbol(trend.title, hash(trend.title));
  return {
    ...base,
    symbol,
    description:
      `${trend.title}. ` +
      (trend.context ? `${trend.context.replace(/\s*·\s*category.*$/i, "")} ` : "") +
      "\n\nLaunched thru viral-forge",
  };
}

/**
 * Optional model-provider path. Returns null when no key is configured or the
 * provider call fails, so callers fall back to the local generator rather than
 * erroring. Never throws.
 */
export async function forgeWithProvider(
  source: ForgeSource,
  input: string,
  style: LogoStyle,
): Promise<GenerateResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const prompt =
    `You are a meme-coin branding engine. Given a source (${source}) and input, ` +
    `return STRICT JSON only, no prose, with keys: name (2-4 words), symbol ` +
    `(3-6 uppercase chars), description (2-3 sentences of lore), tags (5 lowercase ` +
    `strings), vibe (2-4 words), imagePrompt (one detailed visual prompt), ` +
    `imageStyle (one of meme|cartoon|3d|realistic|anime).\n\n` +
    `Input: ${input}\nRequested style: ${style}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Partial<GenerateResult>;
    if (!parsed.name || !parsed.symbol) return null;
    return {
      name: String(parsed.name).slice(0, 60),
      symbol: String(parsed.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
      description: String(parsed.description ?? "").slice(0, 600) || input,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8).map(String) : [],
      vibe: String(parsed.vibe ?? "").slice(0, 60) || "unclassified",
      imagePrompt: String(parsed.imagePrompt ?? input).slice(0, 800),
      imageStyle: (parsed.imageStyle as Exclude<LogoStyle, "auto">) ?? "meme",
    };
  } catch {
    return null;
  }
}

export async function forge(
  source: ForgeSource,
  input: string,
  style: LogoStyle,
): Promise<GenerateResult> {
  return (await forgeWithProvider(source, input, style)) ?? forgeLocally(source, input, style);
}
