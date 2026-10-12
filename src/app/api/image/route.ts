import { NextResponse } from "next/server";
import { z } from "zod";
import { generateMint } from "@/lib/ids";
import {
  buildImagePrompt,
  generateImage,
  imageGenAvailable,
  imageModel,
} from "@/lib/images";
import type { LogoStyle } from "@/lib/types";

// Image endpoint. Generates a real image through Pollinations (flux.1-schnell)
// and returns the URL the coin should store.
//
// Falls back to the deterministic procedural sprite when no key is configured
// or the image service is unreachable, so the endpoint always returns a usable
// URL. The response says which path ran.

const Body = z.object({
  prompt: z.string().min(1).max(800),
  style: z
    .enum(["auto", "meme", "cartoon", "3d", "realistic", "anime"])
    .default("auto"),
  mint: z
    .string()
    .regex(/^[A-Za-z0-9]{32,44}$/)
    .optional(),
});

export async function GET() {
  return NextResponse.json({
    live: imageGenAvailable(),
    model: imageModel(),
    provider: "pollinations",
  });
}

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
  const mint = parsed.data.mint ?? generateMint();
  // "auto" resolves to a real style for the image prompt; the route always
  // produces a concrete image, never an abstract style token.
  const concreteStyle = style === "auto" ? "meme" : style;
  const url = `/api/logo/${mint}.webp`;

  const image = imageGenAvailable()
    ? await generateImage({
        prompt,
        style: concreteStyle as Exclude<LogoStyle, "auto">,
      })
    : null;

  return NextResponse.json({
    url,
    mint,
    style,
    prompt,
    imagePrompt: buildImagePrompt(prompt, concreteStyle as Exclude<LogoStyle, "auto">),
    imageProvenance: image ? "pollinations" : "procedural",
    model: image?.model,
  });
}
