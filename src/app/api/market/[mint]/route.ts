// Market data for a coin: our own curve, plus whatever external sources can
// honestly say about it.
//
// The old coin page rendered "On-chain market data is not fetched by this
// build." That was true and it was a dead end. This route replaces it.
//
// The hard rule is provenance. Every block of the response names its source and
// the time it was fetched, because on devnet most of these sources have nothing
// to say: Jupiter does not index devnet, and three.ws's token endpoints are
// pump.fun/mainnet oriented. "No external market" is a real, useful answer.
// A zero that looks like a price is not.
//
// GET /api/market/<mint>          — everything we can get
// GET /api/market/<mint>?light=1  — skip the slower intelligence calls

import { NextResponse } from "next/server";
import {
  externalMarketAvailable,
  holders,
  prices,
  threeWsReachable,
  tokenMetadata,
  tokenSecurity,
  trending,
} from "@/lib/dex";
import { readCurveState } from "@/lib/onchain";
import {
  formatPrice,
  graduationPct,
  isGraduated,
  marketCapLamports,
  RESERVED_SUPPLY,
  spotPriceScaled,
  TOTAL_SUPPLY,
  VIRTUAL_SOL_RESERVE,
} from "@/lib/curve";
import { activeCluster } from "@/lib/solana";
import { getCoin } from "@/lib/store";

// Reads a live curve reserve. A cached reserve is a wrong price.
export const instant = false;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint } = await ctx.params;
  if (!mint) {
    return NextResponse.json({ error: "invalid_mint" }, { status: 400 });
  }

  const light = new URL(req.url).searchParams.get("light") === "1";

  // Our curve is authoritative for a coin launched here: nothing else indexes
  // a devnet mint, and the reserve is the only real source of a price.
  const coin = await getCoin(mint);

  let curve = null;
  let curveError: string | null = null;
  if (coin?.curveAddress) {
    try {
      curve = await readCurveState(coin.curveAddress);
    } catch (err) {
      curveError = err instanceof Error ? err.message : "rpc_failed";
    }
  }

  // The external lookups are independent and any of them may be down, so they
  // run together and each failure is absorbed into a null.
  const [price, meta, security, holderSnapshot, trendList, threeWsUp] =
    await Promise.all([
      prices([mint]).catch(() => null),
      tokenMetadata(mint).catch(() => null),
      light ? Promise.resolve(null) : tokenSecurity(mint).catch(() => null),
      light ? Promise.resolve(null) : holders(mint).catch(() => null),
      light ? Promise.resolve(null) : trending().catch(() => null),
      threeWsReachable().catch(() => false),
    ]);

  return NextResponse.json({
    mint,
    cluster: activeCluster(),
    symbol: coin?.symbol ?? null,
    name: coin?.name ?? null,

    // Our own market. Null means "this coin has no curve", which the UI must
    // render as untradeable rather than as a price of zero.
    curve: curve
      ? {
          source: "curve",
          address: coin!.curveAddress,
          exists: curve.exists,
          reserveSol: Number(curve.realSolReserve) / 1e9,
          virtualSolReserve: Number(VIRTUAL_SOL_RESERVE) / 1e9,
          tokensOnCurve: curve.tokenReserve.toString(),
          tokensSold: (BigInt(TOTAL_SUPPLY) - BigInt(RESERVED_SUPPLY) - BigInt(curve.tokenReserve)).toString(),
          price: formatPrice(spotPriceScaled(curve), 12),
          priceScaled: spotPriceScaled(curve).toString(),
          marketCapLamports: marketCapLamports(curve).toString(),
          graduationPct: graduationPct(curve),
          graduated: isGraduated(curve),
          fetchedAt: Date.now(),
        }
      : null,
    curveError,

    // Third-party enrichment. Each is null when the source had nothing, and the
    // `source`/`fetchedAt` fields say where a non-null value came from.
    external: {
      /** False on devnet: no external DEX indexes these tokens. */
      available: externalMarketAvailable(),
      threeWsReachable: threeWsUp,
      price: price ?? null,
      metadata: meta ?? null,
      security: security ?? null,
      holders: holderSnapshot ?? null,
      trending: trendList ?? null,
    },
  });
}
