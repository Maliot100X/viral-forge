import { NextResponse, connection } from "next/server";
import { addCoin, listCoins } from "@/lib/store";
import { generateCoinId, generateMint } from "@/lib/ids";
import type { Coin } from "@/lib/types";

export async function GET(req: Request) {
  await connection();
  const filter = new URL(req.url).searchParams.get("filter") ?? "all";
  const coins = await listCoins(filter);
  return NextResponse.json({ coins });
}

export async function POST(req: Request) {
  await connection();
  let body: Partial<Coin>;
  try {
    body = (await req.json()) as Partial<Coin>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.name || !body.symbol) {
    return NextResponse.json(
      { error: "name and symbol are required" },
      { status: 400 },
    );
  }

  const mint = body.mint?.trim() || generateMint();
  if (!/^[A-Za-z0-9]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  }

  const coin: Coin = {
    id: body.id ?? generateCoinId(),
    name: String(body.name).slice(0, 60),
    symbol: String(body.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
    description: String(body.description ?? "").slice(0, 800),
    imageUrl: body.imageUrl ?? `/api/logo/${mint}.webp`,
    imagePrompt: String(body.imagePrompt ?? "").slice(0, 800),
    imageStyle: body.imageStyle ?? "meme",
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 8).map(String) : [],
    vibe: String(body.vibe ?? "").slice(0, 60),
    source: body.source ?? "prompt",
    sourceRef: String(body.sourceRef ?? "").slice(0, 200),
    mint,
    createdAt: new Date().toISOString(),
    // Records are always simulated in this build — see /tokenomics and the
    // README. Nothing in this project signs or broadcasts a transaction.
    mode: "simulated",
    launchedBy: body.launchedBy === "radar" ? "radar" : "user",
    pumpUrl: `https://pump.fun/coin/${mint}`,
  };

  await addCoin(coin);
  return NextResponse.json({ coin }, { status: 201 });
}
