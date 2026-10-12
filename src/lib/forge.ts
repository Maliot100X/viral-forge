import type {
  ForgeSource,
  GenerateResult,
  LogoStyle,
  Trend,
} from "./types";
import { brainAvailable, brainModel, chatJSON } from "./brain";

// ---------------------------------------------------------------------------
// Forge engine.
//
// Two backends:
//   1. River AI (RIVER_API_KEY) — the real brain. Used when the key is present.
//   2. Deterministic local generator — the fallback, always available.
//
// `forge()` returns which path ran in `result.provenance`, so the UI can state
// honestly whether AI produced the coin or the templates did. Without that, a
// key-less deploy looks identical to an AI one, which is precisely the
// confusion this build exists to remove.
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

  return { name, symbol, description, tags, vibe, imagePrompt, imageStyle, provenance: "local" };
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

/** The subset of style names the image generator accepts for a forge. */
const FORGE_STYLES: Exclude<LogoStyle, "auto">[] = [
  "meme",
  "cartoon",
  "3d",
  "realistic",
  "anime",
];

/** Shapes a forge result before it is trusted. Anything malformed is rejected. */
function coerceForgeResult(
  raw: unknown,
  source: ForgeSource,
  input: string,
  style: LogoStyle,
): GenerateResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;

  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (name.length < 2) return null;

  const symbolRaw =
    typeof v.symbol === "string" ? v.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (symbolRaw.length < 2) return null;

  const description = typeof v.description === "string" ? v.description.trim() : "";
  if (description.length < 20) return null;

  const vibe = typeof v.vibe === "string" && v.vibe.trim() ? v.vibe.trim() : "unclassified";

  const tags = Array.isArray(v.tags)
    ? v.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase().trim().replace(/[^a-z0-9-]/g, ""))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const seed = hash(`${source}:${input}:${style}`);
  const declared =
    typeof v.imageStyle === "string" &&
    (FORGE_STYLES as string[]).includes(v.imageStyle)
      ? (v.imageStyle as Exclude<LogoStyle, "auto">)
      : null;
  const imageStyle = declared ?? resolveStyle(style, input, seed);

  const imagePrompt =
    typeof v.imagePrompt === "string" && v.imagePrompt.trim().length > 10
      ? v.imagePrompt.trim()
      : `${name}. ${description}`.slice(0, 400);

  return {
    name: name.slice(0, 60),
    symbol: symbolRaw.slice(0, 8),
    description: description.slice(0, 600),
    tags,
    vibe: vibe.slice(0, 60),
    imagePrompt: imagePrompt.slice(0, 800),
    imageStyle,
    provenance: "river",
  };
}

/**
 * Real brain path: ask River for the full coin branding and validate it.
 * Returns null when no key is configured or the model keeps emitting junk, so
 * callers fall back to the local generator rather than erroring. Never throws.
 */
export async function forgeWithProvider(
  source: ForgeSource,
  input: string,
  style: LogoStyle,
): Promise<GenerateResult | null> {
  if (!brainAvailable()) return null;

  const prompt =
    `You are the branding engine for a Solana memecoin launchpad. The launchpad ` +
    `turns viral internet moments into tradeable coins.\n\n` +
    `Source type: ${source}\n` +
    `Source material: ${input}\n` +
    `Requested art style: ${style === "auto" ? "choose the best fit" : style}\n\n` +
    `Write branding that feels native to crypto-Twitter: specific and funny, ` +
    `never generic filler, never corporate. Avoid trademarked names and real ` +
    `people.\n\n` +
    `Reply with STRICT JSON only — no prose, no markdown fence:\n` +
    `{\n` +
    `  "name": "2-4 word coin name",\n` +
    `  "symbol": "3-6 uppercase letters/digits",\n` +
    `  "description": "2-3 sentences of lore, the coin's origin story",\n` +
    `  "tags": ["5 lowercase single-word tags"],\n` +
    `  "vibe": "2-4 words",\n` +
    `  "imagePrompt": "one vivid visual prompt for the coin logo",\n` +
    `  "imageStyle": "one of meme|cartoon|3d|realistic|anime"\n` +
    `}`;

  return chatJSON(
    [
      {
        role: "system",
        content: "You reply with raw JSON objects and nothing else. No markdown fences.",
      },
      { role: "user", content: prompt },
    ],
    (raw) => coerceForgeResult(raw, source, input, style),
    { maxTokens: 800, temperature: 0.95, timeoutMs: 25_000, retries: 2 },
  );
}

/**
 * Forge a coin, preferring the real brain and falling back to templates.
 * The returned `provenance` field reports which one actually ran.
 */
export async function forge(
  source: ForgeSource,
  input: string,
  style: LogoStyle,
): Promise<GenerateResult> {
  return (await forgeWithProvider(source, input, style)) ?? forgeLocally(source, input, style);
}

/** Describes the active brain for the UI's status chip. */
export function brainStatus(): { live: boolean; label: string; model?: string } {
  if (!brainAvailable()) {
    return { live: false, label: "TEMPLATE BRAIN" };
  }
  return { live: true, label: "RIVER BRAIN", model: brainModel() };
}
