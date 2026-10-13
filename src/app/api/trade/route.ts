import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnchainError,
  buyToken,
  readCurveState,
  sellToken,
  type CurveAccount,
} from "@/lib/onchain";
import {
  formatPrice,
  marketCapLamports,
  quoteBuy,
  quoteSell,
  spotPriceScaled,
} from "@/lib/curve";
import { activeCluster, launchWallet, walletAddress } from "@/lib/solana";
import { getCoin, getCurveSecret, listTrades, recordTrade } from "@/lib/store";

// Trading endpoint for coins launched here.
//
// This is a real bonding curve, not a mock: a buy moves SOL into the coin's
// curve account and real tokens out of it, and a sell moves tokens back in and
// SOL out, signed by the curve's own stored keypair. Both sides move in the same
// transaction, and both are ordinary devnet transactions anyone can verify in an
// explorer. A trade that moved only one side would not be a trade.
//
// The response reports token balances read back off-chain after confirmation, so
// a caller can check the tokens really arrived instead of trusting a number.
//
// The price is never taken from the request. It is quoted from the curve's real
// on-chain balance at the moment of the call, so a client cannot ask for a
// better price than the reserve supports.
//
// GET  /api/trade?mint=<mint>&amount=<n>&action=<buy|sell>  — a quote only.
// POST /api/trade                                            — executes.
//
// As with /api/launch, nothing is signed unless `confirm` is explicitly true.

const Body = z.object({
  mint: z.string().min(32).max(44),
  action: z.enum(["buy", "sell"]),
  /** SOL for a buy, tokens for a sell. Human units. */
  amount: z.number().positive().max(1_000_000_000),
  /** Slippage tolerance in basis points. 300 = 3%. */
  slippageBps: z.number().int().min(1).max(5_000).optional().default(300),
  confirm: z.boolean().optional().default(false),
});

/** Loads a coin and its curve keypair, or explains precisely what is missing. */
async function curveFor(mint: string): Promise<
  | { ok: true; coin: NonNullable<Awaited<ReturnType<typeof getCoin>>>; curve: CurveAccount }
  | { ok: false; status: number; error: string; detail: string }
> {
  const coin = await getCoin(mint);
  if (!coin) {
    return {
      ok: false,
      status: 404,
      error: "not_found",
      detail: `No coin recorded for ${mint}.`,
    };
  }
  // A coin only has a curve if it was launched after curves existed. Records
  // from before that are real SPL tokens but have no reserve, so they cannot be
  // traded — saying so is better than quoting a price that cannot be paid.
  if (!coin.curveAddress) {
    return {
      ok: false,
      status: 409,
      error: "curve_not_found",
      detail:
        `${coin.symbol || coin.name} was minted before trading curves existed, ` +
        "so it has no reserve to trade against. Relaunch it to make it tradeable.",
    };
  }
  const secret = await getCurveSecret(mint);
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "curve_not_found",
      detail: "The curve keypair for this coin is missing from the database.",
    };
  }
  return { ok: true, coin, curve: { address: coin.curveAddress, secret } };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mint = url.searchParams.get("mint") ?? "";
  const action = url.searchParams.get("action") === "sell" ? "sell" : "buy";
  const amount = Number(url.searchParams.get("amount") ?? "0");

  const found = await curveFor(mint);
  if (!found.ok) {
    return NextResponse.json(
      { error: found.error, detail: found.detail },
      { status: found.status },
    );
  }

  let curve;
  try {
    curve = await readCurveState(found.curve.address);
  } catch (err) {
    return NextResponse.json(
      {
        error: "rpc_failed",
        detail: err instanceof Error ? err.message : "Could not read the curve.",
      },
      { status: 502 },
    );
  }

  const trades = await listTrades(mint, 20);

  // A quote is only meaningful with an amount; without one the caller just
  // wants the current state, which is still worth returning.
  if (!(amount > 0)) {
    return NextResponse.json({
      mint,
      cluster: activeCluster(),
      curve,
      marketCapLamports: marketCapLamports(curve).toString(),
      price: formatPrice(spotPriceScaled(curve), 12),
      trades,
      wallet: walletAddress(),
    });
  }

  const quote = quoteFor(action, curve, amount);
  if ("error" in quote) {
    return NextResponse.json({ error: quote.error }, { status: 400 });
  }

  return NextResponse.json({
    mint,
    action,
    cluster: activeCluster(),
    amount,
    curve,
    quote: {
      amountIn: quote.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      fee: quote.fee.toString(),
      priceAfter: quote.priceAfter.toString(),
      priceAfterLabel: formatPrice(quote.priceAfter, 12),
    },
    price: formatPrice(spotPriceScaled(curve), 12),
    trades,
    wallet: walletAddress(),
  });
}

/** Shared quoting so GET and POST can never disagree about the price. */
function quoteFor(
  action: "buy" | "sell",
  curve: Parameters<typeof quoteBuy>[0],
  amount: number,
) {
  try {
    if (action === "buy") {
      const lamports = BigInt(Math.round(amount * 1_000_000_000));
      return quoteBuy(curve, lamports);
    }
    const atoms = BigInt(Math.round(amount * 10 ** 9));
    return quoteSell(curve, atoms);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "quote_failed" };
  }
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

  const found = await curveFor(b.mint);
  if (!found.ok) {
    return NextResponse.json(
      { error: found.error, detail: found.detail },
      { status: found.status },
    );
  }

  // Read the real state and quote from it. This is the number the user is
  // agreeing to, and the number the slippage check is measured against.
  let curve;
  try {
    curve = await readCurveState(found.curve.address);
  } catch (err) {
    return NextResponse.json(
      {
        error: "rpc_failed",
        detail: err instanceof Error ? err.message : "Could not read the curve.",
      },
      { status: 502 },
    );
  }

  const quote = quoteFor(b.action, curve, b.amount);
  if ("error" in quote) {
    return NextResponse.json({ error: quote.error }, { status: 400 });
  }

  // Slippage floor, enforced server-side before anything is signed.
  const minOut = (quote.amountOut * BigInt(10_000 - b.slippageBps)) / 10_000n;

  if (!b.confirm) {
    return NextResponse.json(
      {
        error: "confirmation_required",
        detail:
          "This would submit a real " +
          b.action +
          " transaction on " +
          activeCluster() +
          ". Show the quote and resend with confirm:true after the user approves.",
        summary: {
          mint: b.mint,
          symbol: found.coin.symbol,
          action: b.action,
          amount: b.amount,
          cluster: activeCluster(),
          curveAddress: found.curve.address,
          reserveSol: Number(curve.realSolReserve) / 1e9,
          amountIn: quote.amountIn.toString(),
          expectedOut: quote.amountOut.toString(),
          fee: quote.fee.toString(),
          minOut: minOut.toString(),
          slippageBps: b.slippageBps,
          price: formatPrice(spotPriceScaled(curve), 12),
          priceAfter: formatPrice(quote.priceAfter, 12),
        },
      },
      { status: 428 },
    );
  }

  const wallet = launchWallet();
  try {
    const result =
      b.action === "buy"
        ? await buyToken({
            curve: found.curve,
            mint: b.mint,
            amount: b.amount,
            minOut,
            confirm: true,
          })
        : await sellToken({
            curve: found.curve,
            mint: b.mint,
            amount: b.amount,
            minOut,
            confirm: true,
          });

    // Only recorded once the transaction actually confirmed, so the trade log
    // never contains a trade that did not happen.
    await recordTrade({
      mint: b.mint,
      action: b.action,
      signature: result.signature,
      wallet: wallet?.publicKey.toBase58() ?? "",
      solLamports:
        b.action === "buy" ? result.amountIn.toString() : result.amountOut.toString(),
      tokenAtoms:
        b.action === "buy" ? result.amountOut.toString() : result.amountIn.toString(),
      feeLamports: result.fee.toString(),
      priceScaled: result.priceAfter.toString(),
      cluster: result.cluster,
    });

    return NextResponse.json(
      {
        ok: true,
        action: b.action,
        mint: b.mint,
        signature: result.signature,
        explorerUrl: result.explorer,
        cluster: result.cluster,
        amountIn: result.amountIn.toString(),
        amountOut: result.amountOut.toString(),
        fee: result.fee.toString(),
        price: formatPrice(spotPriceScaled(result.curve), 12),
        priceAfter: formatPrice(result.priceAfter, 12),
        reserveSol: Number(result.curve.realSolReserve) / 1e9,
        // Read back on-chain, so a caller can verify the trade moved tokens.
        traderTokenBalance: result.traderTokenBalance,
        curveTokenBalance: result.curveTokenBalance,
        curve: result.curve,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof OnchainError) {
      const status =
        err.code === "insufficient_funds" ||
        err.code === "slippage_exceeded" ||
        err.code === "curve_not_found" ||
        err.code === "no_wallet"
          ? 409
          : 502;
      return NextResponse.json({ error: err.code, detail: err.message }, { status });
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
