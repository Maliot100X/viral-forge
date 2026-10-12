import { NextResponse } from "next/server";
import { z } from "zod";
import { forge } from "@/lib/forge";

const Body = z.object({
  source: z.enum(["prompt", "x", "hashtag", "image", "tiktok", "trend"]),
  input: z.string().min(1).max(600),
  style: z
    .enum(["auto", "meme", "cartoon", "3d", "realistic", "anime"])
    .default("auto"),
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

  const { source, input, style } = parsed.data;
  const result = await forge(source, input, style);
  return NextResponse.json(result);
}
