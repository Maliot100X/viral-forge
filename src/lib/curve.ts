// ---------------------------------------------------------------------------
// Constant-product bonding curve.
//
// This is the pricing and supply model behind every token this site launches.
// It is a plain `x * y = k` AMM, the same family of curve pump.fun uses, which
// means the numbers here are legible to anyone who has traded a memecoin:
// buying pushes the price up along a smooth curve, selling pushes it back down,
// and the curve's SOL reserve is real money sitting in a real account.
//
// The curve is implemented *locally* rather than delegated to a third-party
// launchpad service, for two reasons:
//
//   1. PumpDev's market and trading endpoints resolve against mainnet. A token
//      we mint on devnet therefore has no bonding curve there ("Token bonding
//      curve not found"), so buy/sell could never work on devnet through it.
//   2. We want the curve on devnet with no real capital at risk, while keeping
//      the mainnet switch a configuration change rather than a rewrite.
//
// Everything in this file is pure and total: same inputs, same outputs, no
// network, no clock, no randomness. That is deliberate — the curve is the part
// that decides how much money changes hands, so it is the part that must be
// testable without a chain.
// ---------------------------------------------------------------------------

/**
 * Total supply minted for every coin, in atomic units (9 decimals).
 *
 * 1,000,000,000 tokens, matching the reference launchpads so the numbers a
 * trader sees here mean the same thing they mean there.
 */
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 9n;

/** Decimals for every coin we mint. */
export const TOKEN_DECIMALS = 9;

/**
 * Tokens reserved for the curve at launch: 800,000,000 (80%).
 *
 * The remaining 20% is held back as the "creator allocation". Real launchpads
 * put the same 80/20 split on the curve, and keeping it identical means the
 * starting price and the shape of the curve are recognisable rather than
 * idiosyncratic.
 */
export const CURVE_SUPPLY = (TOTAL_SUPPLY * 80n) / 100n;

/** Tokens never sold by the curve: 200,000,000 (20%). */
export const RESERVED_SUPPLY = TOTAL_SUPPLY - CURVE_SUPPLY;

/**
 * Virtual SOL reserve at launch, in lamports (30 SOL).
 *
 * "Virtual" because no wallet holds it. It is the curve's y-intercept: it sets
 * the opening price without requiring anyone to deposit 30 SOL. This is the
 * standard trick that makes a bonding curve start at a sane market cap while
 * every lamport actually paid in still sits in the real reserve.
 */
export const VIRTUAL_SOL_RESERVE = 30n * 1_000_000_000n;

/** Lamports in one SOL. */
const LAMPORTS = 1_000_000_000n;

/**
 * Graduation threshold: 85 SOL of real reserve moves the coin to "graduated".
 *
 * Graduating does not remove liquidity or change the formula — it is a label
 * the UI shows, and the point at which a coin is considered mature enough to
 * stop being labelled "on the curve".
 */
export const GRADUATION_SOL = 85n * LAMPORTS;

export interface CurveState {
  /** Real lamports held by the curve account. */
  realSolReserve: bigint;
  /** Tokens still owned by the curve, in atomic units. */
  tokenReserve: bigint;
}

export interface CurveQuote {
  /** Lamports (or tokens) the caller must pay. */
  amountIn: bigint;
  /** Tokens (or lamports) the caller receives. */
  amountOut: bigint;
  /** Fee taken from `amountIn`, in the same unit as `amountIn`. */
  fee: bigint;
  /** `amountIn` minus the fee — what actually reaches the reserve. */
  netIn: bigint;
  /** Price of the whole trade, in lamports per token (scaled by 1e9). */
  effectivePrice: bigint;
  /** Price after the trade executes, in lamports per token (scaled by 1e9). */
  priceAfter: bigint;
  /** Reserve after the trade executes. */
  stateAfter: CurveState;
}

export class CurveError extends Error {
  constructor(
    public code:
      | "insufficient_liquidity"
      | "insufficient_reserve"
      | "zero_amount"
      | "below_rent_exempt"
      | "curve_sold_out",
    message: string,
  ) {
    super(message);
    this.name = "CurveError";
  }
}

/** The curve state a freshly launched coin starts from. */
export function initialCurveState(): CurveState {
  return { realSolReserve: 0n, tokenReserve: CURVE_SUPPLY };
}

/**
 * Integer ceiling division. Used wherever a fractional result must round in the
 * house's favour (fees, and the tokens a buyer receives).
 */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * Fee in basis points. 100 bps = 1%. Charged on the input side of every trade,
 * matching the 1% total that pump.fun-style launchpads take.
 */
export const FEE_BPS = 100n;

export function feeOn(amountIn: bigint): bigint {
  return (amountIn * FEE_BPS) / 10_000n;
}

/**
 * Smallest input whose fee does not round to zero, in lamports.
 *
 * `feeOn` truncates, so any input below this pays no fee at all. Rather than
 * let a fee-free micro-buy through, `quoteBuy` rejects amounts under it.
 */
export const FEE_MIN_AMOUNT = 10_000n / FEE_BPS;

/**
 * Flat fee the creation service charges to mint a token, in lamports.
 *
 * Read from https://pumpdev.io/api/health, which reports a commission rate of
 * 0.0025. It is declared here so the launch screen can show a real total before
 * the user confirms, rather than discovering the cost afterwards.
 */
export const FORGE_FEE_LAMPORTS = 2_500_000n;

/**
 * Price of one whole token right now, in lamports, scaled by 1e9.
 *
 * WARNING: this scale has too little resolution to be used as a price or to
 * compare two prices. With `x` around 8e17 atomic units, `y * 1e9 / x` keeps
 * only about two significant figures, so a sell of even a few thousand tokens
 * does not change the result at all and a "price went down" check silently
 * passes without being true. Kept only because it is the scale the UI's
 * original label was written against; use `spotPriceScaled` for anything that
 * compares, charts, or charges money.
 */
export function spotPriceLamportsPerToken(state: CurveState): bigint {
  const y = VIRTUAL_SOL_RESERVE + state.realSolReserve;
  const x = state.tokenReserve;
  return (y * 10n ** 9n) / x;
}

/**
 * Exact fixed-point scale for `spotPriceScaled`.
 *
 * 1e27 is chosen so the smallest meaningful price movement survives integer
 * truncation: a single atomic unit of token changes the quotient by far more
 * than one at every reserve size this curve can reach.
 */
export const PRICE_SCALE = 10n ** 27n;

/**
 * Price of one whole token in lamports, scaled by `PRICE_SCALE`.
 *
 * This is the price function to use for display precision, charts, and any
 * comparison between two states. It is monotonic in the reserve ratio, so a
 * buy always raises it and a sell always lowers it, which is the property the
 * UI needs in order to be honest about what a trade did.
 */
export function spotPriceScaled(state: CurveState): bigint {
  const y = VIRTUAL_SOL_RESERVE + state.realSolReserve;
  return (y * PRICE_SCALE) / state.tokenReserve;
}

/** Renders a `spotPriceScaled` value as a decimal SOL string. */
export function formatPrice(scaled: bigint, dp = 12): string {
  const digits = PRICE_SCALE.toString().length - 1;
  const whole = scaled / PRICE_SCALE;
  const frac = scaled % PRICE_SCALE;
  const fracStr = frac.toString().padStart(digits, "0").slice(0, dp);
  return dp === 0 ? whole.toString() : `${whole}.${fracStr}`;
}

/**
 * Market cap in lamports implied by the current price over full supply.
 *
 * Uses the high-resolution price, so the value moves with every trade instead
 * of stepping by a whole SOL at a time.
 */
export function marketCapLamports(state: CurveState): bigint {
  return (spotPriceScaled(state) * TOTAL_SUPPLY) / PRICE_SCALE;
}

/** Progress toward graduation, 0–100, one decimal place. */
export function graduationPct(state: CurveState): number {
  if (state.realSolReserve >= GRADUATION_SOL) return 100;
  const bps = (state.realSolReserve * 10_000n) / GRADUATION_SOL;
  return Number(bps) / 100;
}

export function isGraduated(state: CurveState): boolean {
  return state.realSolReserve >= GRADUATION_SOL;
}

/**
 * Quotes a buy: `solIn` lamports are spent, tokens come out.
 *
 * Constant product: the reserve grows by `netIn`, so
 *
 *     tokensOut = x - k / (y + netIn)      where k = x * y
 *
 * computed without ever forming the product (`x - x*y/(y+netIn)` would overflow
 * for realistic reserves, so the algebra is rearranged to stay in range).
 */
export function quoteBuy(state: CurveState, solIn: bigint): CurveQuote {
  if (solIn <= 0n) {
    throw new CurveError("zero_amount", "Buy amount must be greater than zero.");
  }
  if (state.tokenReserve <= 0n) {
    throw new CurveError("curve_sold_out", "The curve has no tokens left to sell.");
  }

  const fee = feeOn(solIn);
  const netIn = solIn - fee;
  if (netIn <= 0n) {
    throw new CurveError("zero_amount", "Buy amount is smaller than the fee.");
  }
  // A buy so small that the 1% fee rounds away entirely is almost always a
  // caller bug — a mis-scaled amount, or lamports passed where SOL was meant.
  // Accepting it would let a dust buy take a full share of the curve for free.
  if (fee <= 0n) {
    throw new CurveError(
      "zero_amount",
      `Buy amount is below the fee floor of ${FEE_MIN_AMOUNT} lamports.`,
    );
  }

  const y = VIRTUAL_SOL_RESERVE + state.realSolReserve;
  // tokensOut = x * netIn / (y + netIn), rounded down. Rounding down means we
  // never hand out a token the reserve was not paid for.
  const tokensOut = (state.tokenReserve * netIn) / (y + netIn);
  if (tokensOut <= 0n) {
    throw new CurveError(
      "zero_amount",
      "Buy amount is too small to purchase a single atomic unit.",
    );
  }
  if (tokensOut > state.tokenReserve) {
    throw new CurveError("insufficient_liquidity", "Not enough tokens on the curve.");
  }

  const stateAfter: CurveState = {
    realSolReserve: state.realSolReserve + netIn,
    tokenReserve: state.tokenReserve - tokensOut,
  };

  return {
    amountIn: solIn,
    amountOut: tokensOut,
    fee,
    netIn,
    effectivePrice: (solIn * PRICE_SCALE) / tokensOut,
    priceAfter: spotPriceScaled(stateAfter),
    stateAfter,
  };
}

/**
 * Quotes a sell: `tokensIn` atomic units go back to the curve, lamports come
 * out.
 *
 *     solOut = y - k / (x + tokensIn)
 *
 * Rounded down, so the curve never pays out more than it took in.
 */
export function quoteSell(state: CurveState, tokensIn: bigint): CurveQuote {
  if (tokensIn <= 0n) {
    throw new CurveError("zero_amount", "Sell amount must be greater than zero.");
  }

  const y = VIRTUAL_SOL_RESERVE + state.realSolReserve;
  const grossOut = (y * tokensIn) / (state.tokenReserve + tokensIn);
  if (grossOut <= 0n) {
    throw new CurveError(
      "zero_amount",
      "Sell amount is too small to return a single lamport.",
    );
  }
  if (grossOut > state.realSolReserve) {
    // Cannot happen with a well-formed curve (the virtual reserve keeps the
    // payout strictly below the real one), but a corrupted state would
    // otherwise let a seller drain more than the reserve holds.
    throw new CurveError("insufficient_reserve", "The curve cannot cover this sell.");
  }

  const fee = feeOn(grossOut);
  const netOut = grossOut - fee;

  const stateAfter: CurveState = {
    realSolReserve: state.realSolReserve - grossOut,
    tokenReserve: state.tokenReserve + tokensIn,
  };

  return {
    amountIn: tokensIn,
    amountOut: netOut,
    fee,
    netIn: tokensIn,
    effectivePrice: netOut === 0n ? 0n : (tokensIn * PRICE_SCALE) / netOut,
    priceAfter: spotPriceScaled(stateAfter),
    stateAfter,
  };
}

/**
 * Lamports that must stay in the curve account to keep it rent-exempt.
 *
 * A curve holding fewer lamports than this cannot legally exist on Solana, so
 * the first buy is floored at this amount. Without the floor the launch
 * transaction is rejected by the runtime rather than by us, and the error is
 * far harder to read.
 */
export const CURVE_RENT_FLOOR = 890_880n;

/**
 * Raises a buy to the rent floor if needed and reports whether it did.
 *
 * This is a *display* concern as much as a transaction one: the UI shows the
 * floored amount so the buyer sees the real number they are about to sign,
 * rather than the smaller one they typed.
 */
export function applyRentFloor(solIn: bigint): { solIn: bigint; floored: boolean } {
  if (solIn > 0n && solIn < CURVE_RENT_FLOOR) {
    return { solIn: CURVE_RENT_FLOOR, floored: true };
  }
  return { solIn, floored: false };
}

/** Formats lamports as a SOL string with `dp` decimal places. */
export function lamportsToSol(lamports: bigint, dp = 6): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / LAMPORTS;
  const frac = abs % LAMPORTS;
  const fracStr = frac.toString().padStart(9, "0").slice(0, dp);
  return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

/** Formats atomic token units as a human token string. */
export function atomsToTokens(atoms: bigint, dp = 4): string {
  const whole = atoms / 10n ** BigInt(TOKEN_DECIMALS);
  const frac = atoms % 10n ** BigInt(TOKEN_DECIMALS);
  const fracStr = frac.toString().padStart(TOKEN_DECIMALS, "0").slice(0, dp);
  return dp === 0 ? whole.toString() : `${whole}.${fracStr}`;
}

/** Parses a decimal string of SOL into lamports, tolerating "" and junk. */
export function solToLamports(sol: string | number): bigint {
  const text = typeof sol === "number" ? sol.toString() : sol.trim();
  if (!text || !/^\d*\.?\d*$/.test(text)) return 0n;
  const [whole = "0", frac = ""] = text.split(".");
  const padded = (frac + "000000000").slice(0, 9);
  return BigInt(whole || "0") * LAMPORTS + BigInt(padded || "0");
}

/** Parses a decimal string of tokens into atomic units. */
export function tokensToAtoms(tokens: string | number): bigint {
  const text = typeof tokens === "number" ? tokens.toString() : tokens.trim();
  if (!text || !/^\d*\.?\d*$/.test(text)) return 0n;
  const [whole = "0", frac = ""] = text.split(".");
  const padded = (frac + "000000000").slice(0, TOKEN_DECIMALS);
  return BigInt(whole || "0") * 10n ** BigInt(TOKEN_DECIMALS) + BigInt(padded || "0");
}

/**
 * Slippage tolerance applied to a quote, as the minimum acceptable output.
 *
 * `bps` defaults to 100 (1%). A sell with `bps = 0` would demand the exact
 * quote and fail on any movement, so callers always pass a real tolerance.
 */
export function withSlippage(amountOut: bigint, bps: bigint): bigint {
  if (bps <= 0n) return amountOut;
  const keep = 10_000n - bps;
  return (amountOut * keep) / 10_000n;
}

/**
 * Replays buys and sells over the curve to derive its state.
 *
 * The chain holds the authoritative reserves in the curve account; this exists
 * so the state can also be rebuilt from the trade log, which is what makes the
 * server's view auditable against the chain instead of merely asserted.
 * Trades must be applied in order.
 */
export function replayCurve(
  trades: ReadonlyArray<{ action: "buy" | "sell"; solLamports: bigint; tokenAtoms: bigint }>,
  from: CurveState = initialCurveState(),
): CurveState {
  let state = from;
  for (const t of trades) {
    if (t.action === "buy") {
      const q = quoteBuy(state, t.solLamports);
      state = q.stateAfter;
    } else {
      const q = quoteSell(state, t.tokenAtoms);
      state = q.stateAfter;
    }
  }
  return state;
}

/** Re-exported so callers do not need to know the decimal scale. */
export { LAMPORTS, ceilDiv };
