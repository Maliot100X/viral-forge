"use client";

import { useMemo } from "react";
import {
  CURVE_SUPPLY,
  GRADUATION_SOL,
  formatPrice,
  initialCurveState,
  quoteBuy,
  spotPriceScaled,
  type CurveState,
} from "@/lib/curve";

/**
 * CurveChart — the price path of this coin's bonding curve.
 *
 * This plots the *curve function itself*, not a wall-clock price history: a
 * constant-product curve's price is fully determined by how many tokens have
 * been sold, so the shape is derivable from the curve constants and does not
 * need an indexer or a candle feed. The current position is marked from the
 * live on-chain reserve.
 *
 * Uses `replayCurve` semantics indirectly — each point is a real `quoteBuy`
 * against the curve, so the line cannot drift from the pricing the trade route
 * actually executes.
 */

const POINTS = 64;

export default function CurveChart({
  reserveSol,
  tokensOnCurve,
  price,
}: {
  /** Real SOL held by the curve account, read from chain. */
  reserveSol: number;
  /** Tokens still held by the curve, as an atom string. */
  tokensOnCurve: string;
  /** Current spot price, pre-formatted. */
  price: string;
}) {
  const { path, area, marker, minLabel, maxLabel } = useMemo(() => {
    // Walk the curve by replaying buys of a fixed SOL size from the initial
    // state. Each step is the genuine quote, not a fitted approximation.
    const perStep = 0.25;
    const solLamports = BigInt(Math.round(perStep * 1e9));

    const states: CurveState[] = [];
    let state: CurveState = initialCurveState();
    for (let i = 0; i < POINTS; i++) {
      states.push(state);
      try {
        state = quoteBuy(state, solLamports).stateAfter;
      } catch {
        break;
      }
      // A graduated curve has no next price to show.
      if (state.realSolReserve >= GRADUATION_SOL) {
        states.push(state);
        break;
      }
    }

    const prices = states.map((s) => Number(spotPriceScaled(s)) / 1e27);
    const max = Math.max(...prices.filter((p) => Number.isFinite(p)), 1);
    const W = 100;
    const H = 32;

    const xs = (i: number) => (i / Math.max(1, states.length - 1)) * W;
    const ys = (p: number) => H - (p / max) * H;

    const line = states
      .map((s, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(2)},${ys(Number(spotPriceScaled(s)) / 1e27).toFixed(2)}`)
      .join(" ");

    // Where the coin actually is now: what fraction of the curve's token side
    // has been sold. CURVE_SUPPLY is what the curve started with, so the tokens
    // still sitting in the curve are exactly the unsold remainder.
    let sold = 0;
    try {
      const onCurve = BigInt(tokensOnCurve || "0");
      sold = 1 - Number(onCurve) / Number(CURVE_SUPPLY);
    } catch {
      sold = 0;
    }
    sold = Math.min(1, Math.max(0, sold));

    // Position the marker by re-deriving the reserve rather than by indexing
    // into the sampled array, so it is correct even for a reserve between steps.
    const idx = Math.round(sold * (states.length - 1));
    const markerX = xs(idx);
    const currentPrice = Number(price.replace(/[^0-9.eE-]/g, "")) || prices[idx] || 0;
    const markerY = ys(currentPrice || prices[idx] || 0);

    return {
      path: line,
      area: `${line} L${W},${H} L0,${H} Z`,
      marker: { x: markerX, y: markerY },
      minLabel: formatPrice(spotPriceScaled(states[0]), 4),
      maxLabel: formatPrice(spotPriceScaled(states[states.length - 1]), 4),
    };
  }, [price, tokensOnCurve]);

  const graduatedPct = useMemo(() => {
    try {
      const onCurve = BigInt(tokensOnCurve || "0");
      const sold = Number(CURVE_SUPPLY - onCurve) / Number(CURVE_SUPPLY);
      return Math.min(100, Math.max(0, sold * 100));
    } catch {
      return 0;
    }
  }, [tokensOnCurve]);

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="label">curve · price path</p>
        <span className="mono text-[10px] text-fg-faint">
          {graduatedPct.toFixed(1)}% of the sold side
        </span>
      </div>

      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={`Bonding curve price path, currently ${price}`}
      >
        <defs>
          <linearGradient id="curvefill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#curvefill)" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={marker.x}
          y1={0}
          x2={marker.x}
          y2={32}
          stroke="var(--violet)"
          strokeWidth="0.4"
          strokeDasharray="1.5 1.5"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={marker.x} cy={marker.y} r="1.2" fill="var(--violet)" />
      </svg>

      <div className="mono mt-2 flex justify-between text-[10px] text-fg-faint">
        <span>start {minLabel}</span>
        <span className="text-fg-dim">now {price}</span>
        <span>top {maxLabel}</span>
      </div>
      <p className="mono mt-2 text-[10px] leading-relaxed text-fg-faint">
        Reserve {reserveSol.toFixed(4)} SOL. The path is the curve&apos;s own pricing function,
        sampled with real quotes — a constant-product curve&apos;s price is fixed by how much of
        the sold side is gone, so this needs no indexer.
      </p>
    </div>
  );
}
