import { NextResponse } from "next/server";
import { addCoin } from "@/lib/store";
import { generateCoinId, generateMint } from "@/lib/ids";
import type { Coin } from "@/lib/types";

// Launch endpoint.
//
// This endpoint records a coin. It does not sign, submit, or broadcast anything,
// and there is no RPC client or keypair anywhere in this project. The `mode`
// field is always "simulated" and is not client-settable, so no request can
// produce a record claiming to be live on-chain.

export async function POST(req: Request) {
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

  const mint = generateMint();
  const coin: Coin = {
    id: generateCoinId(),
    name: String(body.name).slice(0, 60),
    symbol: String(body.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
    description: String(body.description ?? "").slice(0, 800),
    imageUrl: `/api/logo/${mint}.webp`,
    imagePrompt: String(body.imagePrompt ?? "").slice(0, 800),
    imageStyle: body.imageStyle ?? "meme",
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 8).map(String) : [],
    vibe: String(body.vibe ?? "").slice(0, 60),
    source: body.source ?? "prompt",
    sourceRef: String(body.sourceRef ?? "").slice(0, 200),
    mint,
    createdAt: new Date().toISOString(),
    mode: "simulated",
    launchedBy: "user",
    pumpUrl: `https://pump.fun/coin/${mint}`,
  };

  await addCoin(coin);

  return NextResponse.json(
    {
      coin,
      simulated: true,
      note: "Recorded locally. No transaction was signed or broadcast.",
    },
    { status: 201 },
  );
}
