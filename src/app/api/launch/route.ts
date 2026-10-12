import { NextResponse } from "next/server";
import { z } from "zod";
import { addCoin } from "@/lib/store";
import { generateCoinId, generateMint } from "@/lib/ids";
import {
  activeCluster,
  explorerUrl,
  launchWallet,
  mainnetEnabled,
  sendLaunch,
  simulateLaunch,
  walletBalanceSol,
} from "@/lib/solana";
import type { Coin } from "@/lib/types";

// Launch endpoint.
//
// Three honest modes, matching real capability rather than a hardcoded label:
//
//   "simulated" — record the coin locally. Nothing is signed or broadcast.
//   "devnet"    — sign and submit a real devnet transaction. Requires
//                 `confirm: true`, which the UI only sets after showing the
//                 transaction summary and getting an explicit click
//                 (Solana Foundation skill guardrail W009).
//   "live"      — mainnet. Refused unless SOLANA_CLUSTER=mainnet-beta AND
//                 ENABLE_MAINNET=true are both set. Two switches, so mainnet
//                 is never reachable by changing one variable by accident.
//
// GET returns the launch summary the UI must display before anything is sent.

const Body = z.object({
  name: z.string().min(1).max(60),
  symbol: z.string().min(1).max(10),
  description: z.string().max(800).optional().default(""),
  imagePrompt: z.string().max(800).optional().default(""),
  imageStyle: z
    .enum(["meme", "cartoon", "3d", "realistic", "anime"])
    .optional()
    .default("meme"),
  imageUrl: z.string().max(600).optional(),
  tags: z.array(z.string()).max(8).optional().default([]),
  vibe: z.string().max(60).optional().default(""),
  source: z
    .enum(["prompt", "x", "hashtag", "image", "tiktok", "trend"])
    .optional()
    .default("prompt"),
  sourceRef: z.string().max(200).optional().default(""),
  provenance: z.enum(["river", "local"]).optional(),
  imageProvenance: z.enum(["pollinations", "procedural"]).optional(),
  /** "simulated" | "devnet" | "live" */
  mode: z.enum(["simulated", "devnet", "live"]).optional().default("simulated"),
  /** Dev buy in SOL. 0 records the coin without moving value. */
  buySol: z.number().min(0).max(100).optional().default(0),
  /** Must be explicitly true to sign and send anything. */
  confirm: z.boolean().optional().default(false),
});

export async function GET() {
  const summary = await simulateLaunch({ buySol: 0 });
  return NextResponse.json({
    cluster: activeCluster(),
    mainnetEnabled: mainnetEnabled(),
    walletConfigured: launchWallet() !== null,
    walletBalanceSol: await walletBalanceSol(),
    walletAddress: launchWallet()?.publicKey.toBase58() ?? null,
    preview: summary,
  });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const b = parsed.data;

  // ---- mainnet gate -------------------------------------------------------
  if (b.mode === "live" && !mainnetEnabled()) {
    return NextResponse.json(
      {
        error: "mainnet_not_enabled",
        detail:
          "Mainnet is disabled. It requires SOLANA_CLUSTER=mainnet-beta and " +
          "ENABLE_MAINNET=true. See the switch-on checklist in the plan.",
        cluster: activeCluster(),
      },
      { status: 409 },
    );
  }

  const mint = generateMint();
  const cluster = activeCluster();

  // ---- decide what actually happens --------------------------------------
  const wantsChain = b.mode === "devnet" || b.mode === "live";
  const wantsValue = wantsChain && b.buySol > 0;

  if (wantsChain && !b.confirm) {
    // Nothing is sent. Hand back the summary so the UI can show it and ask.
    const summary = await simulateLaunch({ buySol: b.buySol });
    return NextResponse.json(
      {
        error: "confirmation_required",
        detail:
          "This launch would submit a real transaction. Show the summary and " +
          "resend with confirm:true after the user approves.",
        summary,
      },
      { status: 428 },
    );
  }

  // Simulate before sending, and refuse to send into a failing simulation.
  if (wantsValue) {
    const pre = await simulateLaunch({ buySol: b.buySol });
    if (!pre) {
      return NextResponse.json(
        { error: "no_wallet", detail: "No launch wallet is configured." },
        { status: 409 },
      );
    }
    if (pre.simulationError) {
      return NextResponse.json(
        {
          error: "simulation_failed",
          detail: pre.simulationError,
          summary: pre,
        },
        { status: 422 },
      );
    }
  }

  let txSignature: string | undefined;
  let txExplorerUrl: string | undefined;
  let sentSol = 0;

  if (wantsValue) {
    try {
      const sent = await sendLaunch({ buySol: b.buySol, confirm: true });
      if (sent) {
        txSignature = sent.signature;
        txExplorerUrl = sent.explorerUrl;
        sentSol = sent.sol;
      }
    } catch (err) {
      return NextResponse.json(
        {
          error: "send_failed",
          detail: err instanceof Error ? err.message : "unknown_error",
        },
        { status: 502 },
      );
    }
  }

  // A coin is only ever labelled "live" when a transaction actually landed.
  // Otherwise it is "simulated", regardless of what was requested.
  const mode: Coin["mode"] = txSignature ? "live" : "simulated";

  const coin: Coin = {
    id: generateCoinId(),
    name: b.name,
    symbol: b.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
    description: b.description,
    imageUrl: b.imageUrl ?? `/api/logo/${mint}.webp`,
    imagePrompt: b.imagePrompt,
    imageStyle: b.imageStyle,
    tags: b.tags,
    vibe: b.vibe,
    source: b.source,
    sourceRef: b.sourceRef,
    mint,
    createdAt: new Date().toISOString(),
    mode,
    launchedBy: "user",
    pumpUrl: `https://pump.fun/coin/${mint}`,
    txSignature,
    explorerUrl: txExplorerUrl,
    cluster,
    provenance: b.provenance,
    imageProvenance: b.imageProvenance,
  };

  await addCoin(coin);

  return NextResponse.json(
    {
      coin,
      simulated: !txSignature,
      cluster,
      sentSol,
      explorerUrl: txExplorerUrl,
      /** Real address link for the recorded mint. */
      walletExplorerUrl: launchWallet()
        ? explorerUrl(launchWallet()!.publicKey.toBase58(), "address", cluster)
        : undefined,
      note: txSignature
        ? `Recorded and submitted to ${cluster}. Verify: ${txExplorerUrl}`
        : "Recorded locally. No transaction was signed or broadcast.",
    },
    { status: 201 },
  );
}
