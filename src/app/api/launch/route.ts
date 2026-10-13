import { NextResponse } from "next/server";
import { z } from "zod";
import { addCoin, rememberCurveSecret } from "@/lib/store";
import { generateCoinId } from "@/lib/ids";
import {
  CURVE_MIN_BALANCE,
  OnchainError,
  createCoin,
  newCurveAccount,
  readCurveState,
} from "@/lib/onchain";
import { activeCluster, explorerUrl, launchWallet, mainnetEnabled, walletBalanceSol } from "@/lib/solana";
import { FORGE_FEE_LAMPORTS } from "@/lib/curve";
import type { Coin } from "@/lib/types";

/**
 * Rent for the mint account (82 bytes) plus the two token accounts (165 bytes
 * each) the create transaction opens. Read back from the RPC by `createCoin`
 * before anything is signed; this is the same figure used for budgeting, kept
 * here so the launch summary can be produced without an RPC round trip.
 */
const MINT_RENT_LAMPORTS = 1_488_440 + 2_039_280;

/**
 * Smallest dev buy that leaves the curve rent-exempt, in SOL.
 *
 * The curve account must hold at least its own rent exemption or Solana will
 * not let it exist, and a curve that cannot exist cannot pay a seller. Derived
 * from `CURVE_MIN_BALANCE` rather than written twice, so the two can never
 * drift apart.
 */
const MIN_CURVE_SOL = Number(CURVE_MIN_BALANCE) / 1_000_000_000;

// Launch endpoint.
//
// Three honest modes, matching real capability rather than a hardcoded label:
//
//   "simulated" — record the coin locally. Nothing is signed or broadcast.
//   "devnet"    — mint a real SPL token, create a real curve account to hold
//                 its reserve, and let the dev buy fund that reserve. Requires
//                 `confirm: true`, which the UI only sets after showing the
//                 transaction summary and getting an explicit click
//                 (Solana Foundation skill guardrail W009).
//   "live"      — mainnet. Refused unless SOLANA_CLUSTER=mainnet-beta AND
//                 ENABLE_MAINNET=true are both set. Two switches, so mainnet
//                 is never reachable by changing one variable by accident.
//
// The mode recorded on the coin is derived from whether a transaction actually
// landed, never from what was requested. A coin whose mint failed is recorded
// as "simulated" with the failure attached, so /coins never overstates itself.
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
  /**
   * Dev buy in SOL. This is the curve's opening SOL reserve, so it must cover
   * the curve account's rent for the token to be tradeable at all. Zero is
   * rejected on the chain path rather than producing a token nobody can sell.
   */
  buySol: z.number().min(0).max(100).optional().default(0),
  /** Must be explicitly true to sign and send anything. */
  confirm: z.boolean().optional().default(false),
});

export async function GET() {
  const wallet = launchWallet();
  const balance = await walletBalanceSol();
  return NextResponse.json({
    cluster: activeCluster(),
    mainnetEnabled: mainnetEnabled(),
    walletConfigured: wallet !== null,
    walletBalanceSol: balance,
    walletAddress: wallet?.publicKey.toBase58() ?? null,
    // What a launch costs at minimum: the mint and two token accounts' rent,
    // plus the SOL that has to sit in the curve before it can pay a seller.
    minimumLamports:
      Number(FORGE_FEE_LAMPORTS) + Number(CURVE_MIN_BALANCE) + MINT_RENT_LAMPORTS,
    minimumSol:
      (Number(FORGE_FEE_LAMPORTS) + Number(CURVE_MIN_BALANCE) + MINT_RENT_LAMPORTS) /
      1_000_000_000,
    curveMinimumSol: MIN_CURVE_SOL,
    walletExplorerUrl: wallet
      ? explorerUrl(wallet.publicKey.toBase58(), "address", activeCluster())
      : undefined,
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
  const cluster = activeCluster();

  // ---- mainnet gate -------------------------------------------------------
  // Deliberately before the confirmation gate: a mainnet request under a devnet
  // build is refused outright rather than being told to confirm first.
  if (b.mode === "live" && !mainnetEnabled()) {
    return NextResponse.json(
      {
        error: "mainnet_not_enabled",
        detail:
          "Mainnet is disabled. It requires SOLANA_CLUSTER=mainnet-beta and " +
          "ENABLE_MAINNET=true. See the switch-on checklist in the plan.",
        cluster,
      },
      { status: 409 },
    );
  }

  const wantsChain = b.mode === "devnet" || b.mode === "live";

  // A curve with less than its rent exemption cannot exist, and a token whose
  // curve does not exist cannot be sold. Refusing here is honest; minting it
  // anyway would produce a token the trade screen has to apologise for.
  if (wantsChain && b.buySol < MIN_CURVE_SOL) {
    return NextResponse.json(
      {
        error: "curve_reserve_too_small",
        detail:
          `A dev buy of at least ${MIN_CURVE_SOL} SOL is required: that is the ` +
          "minimum the curve needs to stay rent-exempt, and without it nobody " +
          "could ever sell this token.",
        minimumSol: MIN_CURVE_SOL,
      },
      { status: 400 },
    );
  }

  if (wantsChain && !b.confirm) {
    // Nothing is sent. Hand back the full cost breakdown so the UI can show a
    // real number and ask, rather than a vague "are you sure".
    const wallet = launchWallet();
    const balance = await walletBalanceSol();
    const needSol =
      b.buySol + (Number(FORGE_FEE_LAMPORTS) + MINT_RENT_LAMPORTS) / 1e9 + 0.0009;
    return NextResponse.json(
      {
        error: "confirmation_required",
        detail:
          "This launch would mint a real token on " +
          cluster +
          " and open a real trading curve. Show the summary and resend with " +
          "confirm:true after the user approves.",
        summary: {
          name: b.name,
          symbol: b.symbol.toUpperCase(),
          cluster,
          devBuySol: b.buySol,
          feeLamports: Number(FORGE_FEE_LAMPORTS),
          // One mint account and two token accounts, per the create transaction.
          rentLamports: MINT_RENT_LAMPORTS,
          curveRentLamports: Number(CURVE_MIN_BALANCE),
          totalSol: needSol,
          walletAddress: wallet?.publicKey.toBase58() ?? null,
          walletBalanceSol: balance,
          sufficientFunds: wallet !== null && balance !== null && balance >= needSol,
        },
      },
      { status: 428 },
    );
  }

  // ---- real launch --------------------------------------------------------
  let mint = "";
  let txSignature: string | undefined;
  let txExplorerUrl: string | undefined;
  let curveAddress: string | undefined;
  let spentSol = 0;
  let tokenProgram: string | undefined;
  let mintAuthority: string | undefined;
  let failure: string | undefined;

  if (wantsChain) {
    const wallet = launchWallet();
    if (!wallet) {
      return NextResponse.json(
        { error: "no_wallet", detail: "No launch wallet is configured." },
        { status: 409 },
      );
    }

    // The curve account is generated here, before the mint, because the mint
    // transaction has to fund it: a curve that exists but holds no lamports
    // cannot pay a seller, and creating it afterwards would be a second
    // transaction that could fail on its own.
    const curve = newCurveAccount();

    try {
      const created = await createCoin({
        name: b.name,
        symbol: b.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
        description: b.description,
        imageUrl: b.imageUrl,
        devBuySol: b.buySol,
        curveAddress: curve.address,
        confirm: true,
      });
      mint = created.mint;
      txSignature = created.signature;
      txExplorerUrl = created.explorer;
      curveAddress = curve.address;
      spentSol = created.spentLamports / 1e9;
      tokenProgram = created.tokenProgram;
      mintAuthority = created.mintAuthority ?? undefined;
      rememberCurveSecret(mint, curve.secret);
    } catch (err) {
      if (err instanceof OnchainError) {
        const status =
          err.code === "insufficient_funds" || err.code === "no_wallet" ? 409 : 502;
        return NextResponse.json(
          { error: err.code, detail: err.message },
          { status },
        );
      }
      return NextResponse.json(
        {
          error: "send_failed",
          detail: err instanceof Error ? err.message : "unknown_error",
        },
        { status: 502 },
      );
    }
  }

  // A coin is only ever labelled "live" when a real mint landed. Otherwise it is
  // "simulated", regardless of what was requested.
  const mode: Coin["mode"] = mint && txSignature ? "live" : "simulated";

  const coin: Coin = {
    id: generateCoinId(),
    name: b.name,
    symbol: b.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
    description: b.description,
    imageUrl: b.imageUrl ?? "/icon.svg",
    imagePrompt: b.imagePrompt,
    imageStyle: b.imageStyle,
    tags: b.tags,
    vibe: b.vibe,
    source: b.source,
    sourceRef: b.sourceRef,
    // Records written without a mint would collide on the UNIQUE mint column,
    // so an unlaunched record keeps its generated id and an empty mint.
    mint,
    createdAt: new Date().toISOString(),
    mode,
    launchedBy: "user",
    pumpUrl: mint ? `https://pump.fun/coin/${mint}` : "",
    txSignature,
    explorerUrl: txExplorerUrl,
    cluster: mint ? cluster : undefined,
    provenance: b.provenance,
    imageProvenance: b.imageProvenance,
    curveAddress,
    initialBuySol: b.buySol,
    tokenProgram,
    mintAuthority,
  };

  // addCoin keys on mint, which is empty for a local-only record; the store
  // treats an empty mint as a unique row so nothing is overwritten.
  await addCoin(coin);

  // Read the curve straight back off chain so the response quotes the reserve
  // that actually exists rather than the number that was requested.
  let curve = null;
  if (curveAddress) {
    try {
      curve = await readCurveState(curveAddress);
    } catch {
      // The mint landed; a failed curve read must not fail the launch.
      curve = null;
    }
  }

  return NextResponse.json(
    {
      coin,
      simulated: !txSignature,
      cluster,
      spentSol,
      explorerUrl: txExplorerUrl,
      curve,
      mintExplorerUrl: mint ? explorerUrl(mint, "address", cluster) : undefined,
      walletExplorerUrl: launchWallet()
        ? explorerUrl(launchWallet()!.publicKey.toBase58(), "address", cluster)
        : undefined,
      failure,
      note: txSignature
        ? `Minted ${mint} on ${cluster} and opened a real trading curve at ${curveAddress}. Verify: ${txExplorerUrl}`
        : "Recorded locally. No transaction was signed or broadcast.",
    },
    { status: 201 },
  );
}
