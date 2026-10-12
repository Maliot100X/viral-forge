// ---------------------------------------------------------------------------
// Image generation via Pollinations (flux.1-schnell).
//
// This is the real image path. The previous build drew 16x16 procedural pixel
// sprites; those remain as a fallback when the image service is unreachable,
// but they are no longer the primary source of a coin's artwork.
//
// Cost note, verified against the live account: flux.1-schnell bills at roughly
// $0.002 per image. Requests are cached by the provider (`x-cache: HIT` on
// repeat prompts) and we additionally pin a deterministic seed per mint, so
// re-rendering the same coin does not re-bill.
// ---------------------------------------------------------------------------

import type { ImageProvenance, LogoStyle } from "./types";

const POLLINATIONS_BASE = "https://gen.pollinations.ai";
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.1-schnell";

export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  /** Fixed seed makes a given coin's artwork stable across requests. */
  seed?: number;
  style?: Exclude<LogoStyle, "auto">;
  timeoutMs?: number;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
  model: string;
  provenance: ImageProvenance;
  /** The media.pollinations.ai URL, present once uploaded. */
  url?: string;
}

export function imageGenAvailable(): boolean {
  return Boolean(process.env.POLLINATIONS_API_KEY);
}

export function imageModel(): string {
  return process.env.POLLINATIONS_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
}

/** Prompt suffix per house style, so art stays visually on-brand. */
const STYLE_SUFFIX: Record<Exclude<LogoStyle, "auto">, string> = {
  meme: "flat 2D meme sticker illustration, bold black outline, high contrast, simple shapes",
  cartoon: "hand-drawn cartoon character, expressive face, clean cel shading, thick lines",
  "3d": "glossy 3D render, soft studio lighting, depth of field, subsurface scattering",
  realistic:
    "photorealistic, cinematic lighting, shallow depth of field, shot on 50mm lens",
  anime: "anime cel-shaded art, dynamic pose, vibrant palette, crisp linework",
};

export function buildImagePrompt(
  base: string,
  style: Exclude<LogoStyle, "auto">,
): string {
  return (
    `${base.trim()}. ${STYLE_SUFFIX[style]}. ` +
    `Single centered subject, strong silhouette, clean simple background, ` +
    `square composition, no text, no watermark, no lettering.`
  );
}

/**
 * FNV-1a hash -> stable seed. Same mint always yields the same seed, so a
 * coin's logo is reproducible without storing the image itself.
 */
export function seedFromMint(mint: string): number {
  let h = 2166136261;
  for (let i = 0; i < mint.length; i++) {
    h ^= mint.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 1_000_000;
}

/**
 * Stable seed for artwork that has no mint yet.
 *
 * The forge preview has no mint, so it cannot use `seedFromMint`. Deriving the
 * seed from the prompt itself keeps the preview stable while the user edits.
 * The preview therefore matches the final art only when the prompt matches —
 * which is the honest behaviour: change the prompt, the art changes.
 */
export function seedFromPrompt(prompt: string): number {
  return seedFromMint(prompt.trim().toLowerCase());
}

/**
 * Generate a real image. Returns null rather than throwing when the service is
 * unavailable or the key is missing — callers fall back to procedural art.
 */
export async function generateImage(
  opts: GenerateImageOptions,
): Promise<GeneratedImage | null> {
  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) return null;

  const {
    prompt,
    model = imageModel(),
    width = 512,
    height = 512,
    seed = 42,
    style,
    timeoutMs = 45_000,
  } = opts;

  const full = style ? buildImagePrompt(prompt, style) : prompt;
  const url = new URL(`${POLLINATIONS_BASE}/image/${encodeURIComponent(full)}`);
  url.searchParams.set("model", model);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  url.searchParams.set("seed", String(seed));
  url.searchParams.set("nologo", "true");

  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;

    const buf = new Uint8Array(await res.arrayBuffer());
    // A zero-byte 200 is not success. This exact failure mode bit us with a
    // different provider, so guard on real payload size.
    if (buf.byteLength < 1024) return null;

    return {
      bytes: buf,
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      model: res.headers.get("x-model-used") ?? model,
      provenance: "pollinations",
      url: `${POLLINATIONS_BASE}/image/${encodeURIComponent(full)}?model=${model}&seed=${seed}`,
    };
  } catch {
    return null;
  }
}
