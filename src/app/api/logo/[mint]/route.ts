import { logoFromMint } from "@/lib/logo";
import type { LogoStyle } from "@/lib/types";

// Serves the generated pixel logo. Route shape matches the reference site's
// /api/logo/<mint>.webp. The extension is accepted and stripped, so both
// /api/logo/<mint> and /api/logo/<mint>.webp resolve — the latter because the
// reference site's markup uses it directly.

const VALID: LogoStyle[] = ["auto", "meme", "cartoon", "3d", "realistic", "anime"];

export async function GET(
  req: Request,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint: raw } = await ctx.params;
  const mint = raw.replace(/\.(webp|png|svg|jpg)$/i, "");

  if (!mint || mint.length > 64 || !/^[A-Za-z0-9]+$/.test(mint)) {
    return new Response("bad mint", { status: 400 });
  }

  const styleParam = new URL(req.url).searchParams.get("style") ?? "auto";
  const style = (VALID.includes(styleParam as LogoStyle)
    ? styleParam
    : "auto") as LogoStyle;

  const svg = logoFromMint(mint, style);

  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
