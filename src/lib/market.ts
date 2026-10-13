import { readCurveState } from "./onchain";
import {
  formatPrice,
  graduationPct,
  isGraduated,
  marketCapLamports,
  RESERVED_SUPPLY,
  spotPriceScaled,
  TOTAL_SUPPLY,
  type CurveState,
} from "./curve";

/**
 * One coin's live market snapshot, read from its curve account.
 *
 * This type is shared by the launch list and the coin page so both render the
 * same numbers from the same read. They used to be two separate shapes, which
 * is how `/coins` ended up showing nothing but a LIVE badge while the detail
 * page showed a full quote.
 *
 * Every field here is derived from chain state. Nothing is inferred from the
 * request, and `exists: false` means the curve account could not be read —
 * which is rendered as "not tradeable", never as a price of zero.
 */
export interface MarketSnapshot {
  exists: boolean;
  reserveSol: number;
  tokensOnCurve: string;
  tokensSold: string;
  price: string;
  marketCapSol: number;
  graduationPct: number;
  graduated: boolean;
  address: string;
}

/** A snapshot plus the reason it is missing, so a caller can say why. */
export interface MarketRead {
  market: MarketSnapshot | null;
  error: string | null;
}

/** Build a snapshot from already-read curve state. Pure — no RPC. */
export function snapshotFrom(state: CurveState & { exists: boolean }, address: string): MarketSnapshot {
  const sold = BigInt(TOTAL_SUPPLY) - BigInt(RESERVED_SUPPLY) - BigInt(state.tokenReserve);
  return {
    exists: state.exists,
    reserveSol: Number(state.realSolReserve) / 1e9,
    tokensOnCurve: state.tokenReserve.toString(),
    tokensSold: sold.toString(),
    price: formatPrice(spotPriceScaled(state), 12),
    marketCapSol: Number(marketCapLamports(state)) / 1e9,
    graduationPct: graduationPct(state),
    graduated: isGraduated(state),
    address,
  };
}

/** Read one coin's curve. `null` address means the coin has no curve at all. */
export async function readMarket(coin: { curveAddress?: string }): Promise<MarketRead> {
  if (!coin.curveAddress) return { market: null, error: null };
  try {
    const state = await readCurveState(coin.curveAddress);
    return { market: snapshotFrom(state, coin.curveAddress), error: null };
  } catch (err) {
    return { market: null, error: err instanceof Error ? err.message : "rpc_failed" };
  }
}

/**
 * Read market snapshots for many coins, keyed by mint.
 *
 * The list page needs one curve read per tradeable coin, and doing them one at a
 * time made the page wait on a serial RPC round trip per row. Requests go out
 * together but capped, so a long list cannot open an unbounded number of
 * connections to the RPC endpoint at once.
 *
 * A coin whose read fails is simply absent from the map: the caller renders
 * "market unavailable" for it rather than a fabricated zero.
 */
export async function readMarkets(
  coins: Array<{ mint?: string; curveAddress?: string }>,
  concurrency = 6,
): Promise<Map<string, MarketSnapshot>> {
  const wanted = coins.filter(
    (c): c is { mint: string; curveAddress: string } => Boolean(c.mint && c.curveAddress),
  );

  const out = new Map<string, MarketSnapshot>();
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= wanted.length) return;
      const coin = wanted[i];
      try {
        const state = await readCurveState(coin.curveAddress);
        out.set(coin.mint, snapshotFrom(state, coin.curveAddress));
      } catch {
        /* left out of the map on purpose — never reported as an empty market */
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, wanted.length) }, () => worker()),
  );
  return out;
}
