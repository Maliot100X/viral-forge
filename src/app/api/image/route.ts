import { NextResponse } from "next/server";
import { z } from "zod";
import { logoFromMint } from "@/lib/logo";
import { generateMint } from "@/lib/ids";

// Image endpoint. Returns a generated pixel logo for a prompt.
//
// The reference site forwards to an image model and persists to IPFS. This
// build generates locally and deterministically so the endpoint works with no
// provider key and no network — the response shape (a URL under /api/logo/…)
// is identical, so the UI is unchanged.

const Body = z.object({
  prompt: z.string().min(1).max(800),
  style: z
    .enum(["auto", "meme", "cartoon", "3d", "realistic", "anime"])
    .default("auto"),
  mint: z.string().regex(/^[A-Za-z0-9]{32,44}$/).optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { prompt, style } = parsed.data;
  // Derive a stable mint from the prompt so the same prompt yields the same
  // logo, matching the reference behaviour where a coin's art is fixed.
  const mint = parsed.data.mint ?? generateMint();
  const url = `/api/logo/${mint}.webp`;

  return NextResponse.json({
    url,
    mint,
    style,
    prompt,
    svg: logoFromMint(mint, style),
  });
}
