import { logoFromMint } from "@/lib/logo";
import { generateImage, imageGenAvailable, seedFromMint } from "@/lib/images";
import type { Coin, LogoStyle } from "@/lib/types";
import { getCoin } from "@/lib/store";

// Serves a coin's artwork.
//
// Route shape matches the reference site's /api/logo/<mint>.webp. The extension
// is stripped, so both /api/logo/<mint> and /api/logo/<mint>.webp resolve.
//
// Real generated art is preferred: if the mint is a known coin and image
// generation is configured, we render its imagePrompt through Pollinations and
// stream the bytes back with long-lived immutable caching. If anything is
// unavailable we fall back to the procedural sprite, which is deterministic and
// always works. Either way the caller gets a valid image, and the
// `x-image-source` header says which one it was.

const VALID: LogoStyle[] = ["auto", "meme", "cartoon", "3d", "realistic", "anime"];

export async function GET(
  req: Request,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint: raw } = await ctx.params;
  const mint = raw.replace(/\.(webp|png|svg|jpg|jpeg)$/i, "");

  if (!mint || mint.length > 64 || !/^[A-Za-z0-9]+$/.test(mint)) {
    return new Response("bad mint", { status: 400 });
  }

  const params = new URL(req.url).searchParams;
  const styleParam = params.get("style") ?? "auto";
  const style = (VALID.includes(styleParam as LogoStyle)
    ? styleParam
    : "auto") as LogoStyle;

  // An explicit ?seed= lets the forge preview pin the same seed it will use
  // after launch, so the art does not visibly change at the moment of launch.
  const seedParam = Number(params.get("seed"));
  const explicitSeed =
    Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : null;

  // Prefer the coin's own stored prompt so the art matches its branding.
  let coin: Coin | null;
  try {
    coin = await getCoin(mint);
  } catch {
    coin = null;
  }

  if (imageGenAvailable()) {
    const base =
      coin?.imagePrompt?.trim() ||
      params.get("prompt")?.trim() ||
      `Solana memecoin logo for ${
        coin?.name ?? "an unnamed token"
      }, ${coin?.vibe ?? "chaotic internet energy"}`;

    const concreteStyle: Exclude<LogoStyle, "auto"> =
      coin?.imageStyle ?? (style === "auto" ? "meme" : style);

    const image = await generateImage({
      prompt: base,
      style: concreteStyle,
      // Deterministic per mint: the same coin always renders the same art, and
      // a repeat request hits the provider cache instead of re-billing. An
      // explicit ?seed= (used by the pre-launch preview) wins when present.
      seed: explicitSeed ?? seedFromMint(mint),
    });

    if (image) {
      return new Response(new Uint8Array(image.bytes), {
        status: 200,
        headers: {
          "content-type": image.contentType,
          "cache-control": "public, max-age=31536000, immutable",
          "x-image-source": "pollinations",
          "x-image-model": image.model,
        },
      });
    }
  }

  const svg = logoFromMint(coin?.symbol ?? mint, style);

  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-image-source": "procedural",
    },
  });
}
