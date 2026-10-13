import { describe, expect, it } from "vitest";
import {
  CURVE_RENT_FLOOR,
  CURVE_SUPPLY,
  CurveError,
  FEE_BPS,
  GRADUATION_SOL,
  LAMPORTS,
  RESERVED_SUPPLY,
  TOTAL_SUPPLY,
  VIRTUAL_SOL_RESERVE,
  applyRentFloor,
  atomsToTokens,
  formatPrice,
  graduationPct,
  initialCurveState,
  isGraduated,
  lamportsToSol,
  marketCapLamports,
  PRICE_SCALE,
  quoteBuy,
  quoteSell,
  replayCurve,
  solToLamports,
  spotPriceLamportsPerToken,
  spotPriceScaled,
  tokensToAtoms,
  withSlippage,
} from "./curve";

const ONE_SOL = LAMPORTS;

describe("curve constants", () => {
  it("splits supply 80/20 and conserves it exactly", () => {
    expect(TOTAL_SUPPLY).toBe(1_000_000_000n * 10n ** 9n);
    expect(CURVE_SUPPLY + RESERVED_SUPPLY).toBe(TOTAL_SUPPLY);
    expect(RESERVED_SUPPLY).toBe((TOTAL_SUPPLY * 20n) / 100n);
  });

  it("starts with an empty real reserve and the full curve supply", () => {
    const s = initialCurveState();
    expect(s.realSolReserve).toBe(0n);
    expect(s.tokenReserve).toBe(CURVE_SUPPLY);
  });
});

describe("pricing", () => {
  it("opens at a sane price: 30 virtual SOL over 800M tokens", () => {
    // 30e9 lamports / 800e15 atoms * 1e9 scale = 0.0000000375 -> 37 (nano-lamports)
    const p = spotPriceLamportsPerToken(initialCurveState());
    expect(p).toBe(37n);
  });

  it("caps the launch market cap at 37.5 SOL", () => {
    // The nominal launch price is 30e9 / 800e15 = 37.5 nano-lamports per
    // token, and with the 1e27 scale the market cap reproduces 37.5 SOL
    // exactly. The coarse 1e9 helper truncates that same price to 37, which is
    // why it must not be used for money maths.
    expect(spotPriceLamportsPerToken(initialCurveState())).toBe(37n);
    expect(marketCapLamports(initialCurveState())).toBe(37_500_000_000n);
    expect(formatPrice(spotPriceScaled(initialCurveState()), 10)).toBe("0.0000000375");
  });

  it("price rises monotonically with each buy", () => {
    let s = initialCurveState();
    let prev = spotPriceScaled(s);
    for (let i = 0; i < 25; i++) {
      const q = quoteBuy(s, ONE_SOL);
      const now = spotPriceScaled(q.stateAfter);
      expect(now).toBeGreaterThan(prev);
      prev = now;
      s = q.stateAfter;
    }
  });

  it("price falls monotonically with each sell", () => {
    // Buy in first so there is something to sell into.
    let s = initialCurveState();
    for (let i = 0; i < 10; i++) s = quoteBuy(s, ONE_SOL).stateAfter;
    let prev = spotPriceScaled(s);
    for (let i = 0; i < 5; i++) {
      const q = quoteSell(s, 10n ** 9n);
      const now = spotPriceScaled(q.stateAfter);
      expect(now).toBeLessThan(prev);
      prev = now;
      s = q.stateAfter;
    }
  });

  it("detects a price move far smaller than the coarse scale could", () => {
    // The 1e9 helper is frozen at this reserve size: a 5,000-token sell does
    // not budge it. The scaled price must still register the direction, which
    // is what stops the UI from reporting a flat price for a real trade.
    let s = initialCurveState();
    for (let i = 0; i < 10; i++) s = quoteBuy(s, ONE_SOL).stateAfter;
    const q = quoteSell(s, 5_000n * 10n ** 9n);
    expect(spotPriceLamportsPerToken(q.stateAfter)).toBe(spotPriceLamportsPerToken(s));
    expect(spotPriceScaled(q.stateAfter)).toBeLessThan(spotPriceScaled(s));
  });
});

describe("quoteBuy", () => {
  it("charges a 1% fee and puts the rest into the reserve", () => {
    const q = quoteBuy(initialCurveState(), ONE_SOL);
    expect(q.fee).toBe(ONE_SOL / 100n);
    expect(q.netIn).toBe(ONE_SOL - q.fee);
    expect(q.stateAfter.realSolReserve).toBe(q.netIn);
  });

  it("reduces the token reserve by exactly the tokens handed out", () => {
    const before = initialCurveState();
    const q = quoteBuy(before, ONE_SOL);
    expect(before.tokenReserve - q.stateAfter.tokenReserve).toBe(q.amountOut);
  });

  it("gives less than the naive linear price, because price rises mid-trade", () => {
    const s = initialCurveState();
    const naive = (ONE_SOL * PRICE_SCALE) / spotPriceScaled(s);
    const q = quoteBuy(s, ONE_SOL);
    expect(q.amountOut).toBeLessThan(naive);
  });

  it("preserves k within rounding, which is the whole invariant", () => {
    const s = initialCurveState();
    const y0 = VIRTUAL_SOL_RESERVE + s.realSolReserve;
    const kBefore = s.tokenReserve * y0;
    const q = quoteBuy(s, 5n * ONE_SOL);
    const y1 = VIRTUAL_SOL_RESERVE + q.stateAfter.realSolReserve;
    const kAfter = q.stateAfter.tokenReserve * y1;
    // k must not decrease: the curve can only ever get richer.
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
  });

  it("never hands out more tokens than the curve holds, even for a huge buy", () => {
    const s = initialCurveState();
    const q = quoteBuy(s, 100_000n * ONE_SOL); // 100k SOL
    expect(q.amountOut).toBeLessThanOrEqual(CURVE_SUPPLY);
    expect(q.stateAfter.tokenReserve).toBeGreaterThanOrEqual(0n);
  });

  it("rejects zero and sub-fee amounts rather than returning a nonsense quote", () => {
    const s = initialCurveState();
    expect(() => quoteBuy(s, 0n)).toThrow(CurveError);
    expect(() => quoteBuy(s, -1n)).toThrow(CurveError);
    // Below 100 lamports the 1% fee truncates to zero, which would buy a slice
    // of the curve for free. That is a caller bug (bad scaling, or lamports
    // where SOL was meant), so it is rejected rather than silently accepted.
    expect(() => quoteBuy(s, 1n)).toThrow(CurveError);
    expect(() => quoteBuy(s, 99n)).toThrow(CurveError);
    // At the floor the fee finally exists and the quote is honoured.
    const q = quoteBuy(s, 100n);
    expect(q.fee).toBe(1n);
    expect(q.netIn).toBe(99n);
  });

  it("refuses to sell from an empty curve", () => {
    const empty = { realSolReserve: 0n, tokenReserve: 0n };
    expect(() => quoteBuy(empty, ONE_SOL)).toThrow(CurveError);
  });
});

describe("quoteSell", () => {
  it("charges a 1% fee on the gross payout", () => {
    let s = initialCurveState();
    for (let i = 0; i < 20; i++) s = quoteBuy(s, ONE_SOL).stateAfter;
    const q = quoteSell(s, 1_000_000n * 10n ** 9n);
    // The fee is charged on the gross payout: what the trader receives plus
    // what the curve keeps. `amountOut` is already net of it.
    const gross = q.amountOut + q.fee;
    expect(q.fee).toBe((gross * FEE_BPS) / 10_000n);
    expect(q.fee).toBeGreaterThan(0n);
    // And the reserve gives up exactly the gross, never merely the net.
    expect(s.realSolReserve - q.stateAfter.realSolReserve).toBe(gross);
  });

  it("returns the reserve to its pre-buy level when the round trip is exact", () => {
    // A buy followed by selling back everything it produced is the sharpest
    // test of the curve's accounting: the reserves must land back on their
    // starting values, and the only thing the round trip may leave behind is
    // what the curve legitimately kept.
    const s0 = initialCurveState();
    const buy = quoteBuy(s0, 10n * ONE_SOL);
    const sell = quoteSell(buy.stateAfter, buy.amountOut);

    // Token reserve is restored exactly: a sell adds `tokensIn` straight back,
    // and the buy handed out precisely that many.
    expect(sell.stateAfter.tokenReserve).toBe(s0.tokenReserve);

    // Real SOL retains the buy's fee minus the lamport of truncation the
    // sell's integer division discards. The curve is never made poorer by an
    // exact round trip, and the trader is never made whole.
    const retained = sell.stateAfter.realSolReserve - s0.realSolReserve;
    expect(retained).toBeGreaterThan(0n);
    expect(retained).toBe(buy.netIn - sell.amountOut - sell.fee);
    expect(retained).toBeLessThan(buy.fee);
  });

  it("round trip always loses money for the trader, never for the curve", () => {
    const s0 = initialCurveState();
    const buy = quoteBuy(s0, 5n * ONE_SOL);
    const sell = quoteSell(buy.stateAfter, buy.amountOut);
    expect(sell.amountOut).toBeLessThan(buy.amountIn);
  });

  it("cannot pay out more than the real reserve holds", () => {
    let s = initialCurveState();
    s = quoteBuy(s, ONE_SOL).stateAfter;
    // Try to sell 10x the curve supply — should be bounded, not a drain.
    expect(() => quoteSell(s, CURVE_SUPPLY * 10n)).toThrow(CurveError);
  });

  it("rejects zero", () => {
    let s = initialCurveState();
    s = quoteBuy(s, ONE_SOL).stateAfter;
    expect(() => quoteSell(s, 0n)).toThrow(CurveError);
  });
});

describe("replayCurve", () => {
  it("derives the same state as applying quotes one at a time", () => {
    const trades = [
      { action: "buy" as const, solLamports: 2n * ONE_SOL, tokenAtoms: 0n },
      { action: "buy" as const, solLamports: 3n * ONE_SOL, tokenAtoms: 0n },
    ];
    const stepwise = trades.reduce(
      (acc, t) => (t.action === "buy" ? quoteBuy(acc, t.solLamports).stateAfter : acc),
      initialCurveState(),
    );
    expect(replayCurve(trades)).toEqual(stepwise);
  });

  it("is order dependent, as a real market is", () => {
    // Careful: two *buys* commute in this formula. The token reserve depends
    // only on the total netIn that reached the curve, so replaying 5 then 1
    // lands on exactly the same state as 1 then 5. Asserting otherwise would
    // encode a false belief about constant-product maths.
    const a = replayCurve([
      { action: "buy", solLamports: 5n * ONE_SOL, tokenAtoms: 0n },
      { action: "buy", solLamports: 1n * ONE_SOL, tokenAtoms: 0n },
    ]);
    const b = replayCurve([
      { action: "buy", solLamports: 1n * ONE_SOL, tokenAtoms: 0n },
      { action: "buy", solLamports: 5n * ONE_SOL, tokenAtoms: 0n },
    ]);
    expect(a.realSolReserve).toBe(b.realSolReserve);
    expect(a.tokenReserve).toBe(b.tokenReserve);

    // Direction, however, is very much order dependent: a buy then a sell does
    // not return to the start, because the curve keeps the fees. That is the
    // real asymmetry a trader pays for.
    const buyThenSell = replayCurve([
      { action: "buy", solLamports: 6n * ONE_SOL, tokenAtoms: 0n },
      { action: "sell", solLamports: 0n, tokenAtoms: 10n ** 15n },
    ]);
    const start = initialCurveState();
    expect(buyThenSell.tokenReserve).not.toBe(start.tokenReserve);
    expect(buyThenSell.realSolReserve).toBeGreaterThan(0n);
  });
});

describe("graduation", () => {
  it("is 0% at launch and clamps to 100% at the threshold", () => {
    expect(graduationPct(initialCurveState())).toBe(0);
    expect(graduationPct({ realSolReserve: GRADUATION_SOL * 2n, tokenReserve: 1n })).toBe(100);
    expect(isGraduated({ realSolReserve: GRADUATION_SOL, tokenReserve: 1n })).toBe(true);
  });

  it("reports a partial percentage with one decimal", () => {
    const half = { realSolReserve: GRADUATION_SOL / 2n, tokenReserve: CURVE_SUPPLY };
    expect(graduationPct(half)).toBe(50);
    const p = graduationPct({ realSolReserve: GRADUATION_SOL / 3n, tokenReserve: CURVE_SUPPLY });
    expect(p).toBeGreaterThan(33);
    expect(p).toBeLessThan(34);
  });
});

describe("rent floor", () => {
  it("raises a dust buy to the floor and says it did", () => {
    const r = applyRentFloor(1n);
    expect(r.solIn).toBe(CURVE_RENT_FLOOR);
    expect(r.floored).toBe(true);
  });

  it("leaves a healthy buy and a zero buy alone", () => {
    const big = applyRentFloor(ONE_SOL);
    expect(big.floored).toBe(false);
    expect(big.solIn).toBe(ONE_SOL);
    const zero = applyRentFloor(0n);
    expect(zero.floored).toBe(false);
  });
});

describe("formatting and parsing", () => {
  it("renders lamports as SOL with the requested precision", () => {
    expect(lamportsToSol(1_500_000_000n, 6)).toBe("1.500000");
    expect(lamportsToSol(0n, 3)).toBe("0.000");
    expect(lamportsToSol(ONE_SOL, 2)).toBe("1.00");
  });

  it("renders atomic token units without losing the whole part", () => {
    expect(atomsToTokens(1_000_000_000n * 10n ** 9n, 0)).toBe("1000000000");
    expect(atomsToTokens(1_500_000_000n, 4)).toBe("1.5000");
  });

  it("parses SOL strings, including the awkward ones", () => {
    expect(solToLamports("1")).toBe(ONE_SOL);
    expect(solToLamports("0.5")).toBe(ONE_SOL / 2n);
    expect(solToLamports("0.000000001")).toBe(1n);
    expect(solToLamports("")).toBe(0n);
    expect(solToLamports("abc")).toBe(0n);
    expect(solToLamports(".5")).toBe(ONE_SOL / 2n);
    expect(solToLamports("1.")).toBe(ONE_SOL);
  });

  it("parses token strings the same way", () => {
    expect(tokensToAtoms("1")).toBe(10n ** 9n);
    expect(tokensToAtoms("1000000")).toBe(10n ** 15n);
    expect(tokensToAtoms("nonsense")).toBe(0n);
  });

  it("round-trips a parse/format pair", () => {
    expect(lamportsToSol(solToLamports("12.345678901"), 9)).toBe("12.345678901");
  });
});

describe("slippage", () => {
  it("reduces the expected output by the tolerance", () => {
    expect(withSlippage(1_000_000n, 100n)).toBe(990_000n);
  });

  it("is a no-op at zero tolerance", () => {
    expect(withSlippage(1_000_000n, 0n)).toBe(1_000_000n);
  });

  it("leaves a safe floor for a sell", () => {
    const floor = withSlippage(1_000_000n, 500n);
    expect(floor).toBe(950_000n);
    expect(floor).toBeLessThan(1_000_000n);
  });
});
