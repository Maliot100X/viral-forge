// Backfill: give the coins minted before the curve existed a real, tradeable
// curve.
//
// These coins are genuinely on devnet — the mints exist and the launch wallet
// holds the full 1e9 supply — but they have no `curve_address`, so the trade
// route refuses them with 409 `curve_not_found`. That is the honest failure:
// there is no market to trade against. This module creates one by transferring
// the 80% curve side onto a fresh curve account, which is the same operation
// `attachCurve` performs for a new launch.
//
// Two rules hold throughout:
//
//   1. Verify before attach. A mint is only touched after its mint account and
//      the wallet's holding are read back from chain. Anything that does not
//      check out is skipped WITH A REASON — never guessed at.
//   2. Idempotent. A coin that already has a `curve_address` is skipped, so
//      re-running cannot double-stock a curve or strand a second keypair.

import {
  attachCurve,
  readCurveState,
  tokenBalance,
  curveTokenAccount,
  AttachedCurve,
} from "./onchain";
import { connection } from "./solana";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { CURVE_SUPPLY, RESERVED_SUPPLY, CURVE_RENT_FLOOR } from "./curve";
import { getCoin, listCoins, setCoinCurve } from "./store";

/**
 * The public devnet RPC rate-limits aggressively. Attaching several curves at
 * once trips 429s, and a 429 partway through a read used to be indistinguishable
 * from an empty account. Pacing the run is what makes it reliable.
 */
const BETWEEN_ATTACHES_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BackfillSkipReason =
  | "no_mint"
  | "already_has_curve"
  | "mint_not_found"
  | "wrong_token_program"
  | "wrong_supply"
  | "wallet_holding_too_small";

export interface BackfillOutcome {
  mint: string;
  ticker: string;
  status: "attached" | "skipped";
  reason?: BackfillSkipReason;
  detail?: string;
  attached?: AttachedCurve;
  /** Independently re-read from chain after the attach, not the return value. */
  verified?: { curveTokens: string; reserveSol: number };
}

export interface BackfillOptions {
  /** SOL to leave on each curve. Only needs to clear the rent floor. */
  reserveSol?: number;
  /** Attach at most this many curves in one run. */
  limit?: number;
  /** Print progress as it goes. */
  log?: (line: string) => void;
}

/** The smallest reserve that is still a working market. */
export const MIN_BACKFILL_RESERVE_SOL = Number(CURVE_RENT_FLOOR) / 1e9 + 0.01;

/**
 * Checks a single coin and, if it can honestly support a market, attaches one.
 * Returns an outcome rather than throwing, so one bad mint cannot abort a run.
 */
export async function backfillOne(
  mint: string,
  opts: BackfillOptions = {},
): Promise<BackfillOutcome> {
  const log = opts.log ?? (() => {});
  const reserveSol = opts.reserveSol ?? 0.05;
  const coin = await getCoin(mint);
  const ticker = coin?.symbol ?? "";

  if (!mint || !mint.trim()) {
    return { mint, ticker, status: "skipped", reason: "no_mint" };
  }
  if (coin?.curveAddress) {
    return {
      mint,
      ticker,
      status: "skipped",
      reason: "already_has_curve",
      detail: coin.curveAddress,
    };
  }

  const c = connection();
  const mintKey = new PublicKey(mint);

  // 1. The mint must exist and be a classic SPL mint. Token-2022 mints carry
  //    transfer-fee extensions that would silently change the curve maths.
  let info;
  try {
    info = await getMint(c, mintKey, "confirmed", TOKEN_PROGRAM_ID);
  } catch {
    return {
      mint,
      ticker,
      status: "skipped",
      reason: "mint_not_found",
      detail: "no classic SPL mint at that address",
    };
  }

  // 2. Supply must be the finished 1e9. A mint that is still mintable, or was
  //    minted to a different size, would not match the curve's assumptions.
  const expectedSupply = CURVE_SUPPLY + RESERVED_SUPPLY;
  if (BigInt(info.supply) !== expectedSupply) {
    return {
      mint,
      ticker,
      status: "skipped",
      reason: "wrong_supply",
      detail: `supply is ${info.supply}, expected ${expectedSupply}`,
    };
  }

  // 3. The wallet must actually hold a curve's worth. Tokens cannot be minted
  //    to fill a gap: the mint authority is revoked on these coins.
  const walletAta = curveTokenAccount(
    (await import("./solana")).launchWallet()!.publicKey.toBase58(),
    mint,
  );
  const held = await tokenBalance(c, walletAta);
  if (held < CURVE_SUPPLY) {
    return {
      mint,
      ticker,
      status: "skipped",
      reason: "wallet_holding_too_small",
      detail: `wallet holds ${held}, curve needs ${CURVE_SUPPLY}`,
    };
  }
  if (reserveSol < MIN_BACKFILL_RESERVE_SOL) {
    throw new Error(
      `reserveSol ${reserveSol} is below the ${MIN_BACKFILL_RESERVE_SOL} SOL rent floor`,
    );
  }

  log(`attaching ${ticker || mint} · reserve ${reserveSol} SOL`);
  const attached = await attachCurve({
    mint,
    curveSupply: CURVE_SUPPLY,
    devBuySol: reserveSol,
    confirm: true,
  });

  // 4. Persist the curve, then re-read from chain. The DB write and the chain
  //    are checked separately so a mismatch is visible rather than assumed.
  await setCoinCurve({
    mint,
    curveAddress: attached.curveAddress,
    curveSecret: attached.curveSecret,
    initialBuySol: reserveSol,
    mintAuthority: info.mintAuthority ? info.mintAuthority.toBase58() : null,
    tokenProgram: info.tlvData && info.tlvData.length > 0 ? "token-2022" : TOKEN_PROGRAM_ID.toBase58(),
  });

  const curveAta = curveTokenAccount(attached.curveAddress, mint);
  const curveTokens = await tokenBalance(c, curveAta);
  const state = await readCurveState(attached.curveAddress);
  if (curveTokens !== CURVE_SUPPLY) {
    throw new Error(
      `curve for ${mint} holds ${curveTokens} tokens after backfill, expected ${CURVE_SUPPLY}`,
    );
  }

  return {
    mint,
    ticker,
    status: "attached",
    attached,
    verified: {
      curveTokens: curveTokens.toString(),
      reserveSol: Number(state.realSolReserve) / 1e9,
    },
  };
}

/** Backfills every LIVE coin that does not yet have a curve. */
export async function backfillCurves(
  opts: BackfillOptions = {},
): Promise<BackfillOutcome[]> {
  const log = opts.log ?? (() => {});
  const coins = await listCoins();
  const live = coins.filter((c) => c.mode === "live" && c.mint);
  const results: BackfillOutcome[] = [];
  let attached = 0;
  let first = true;

  for (const coin of live) {
    if (opts.limit !== undefined && attached >= opts.limit) {
      log(`limit of ${opts.limit} reached; stopping`);
      break;
    }
    // Serialise the attaches. Running them concurrently against the public
    // devnet RPC reliably produces 429s, and a throttled read is not evidence
    // about anything.
    if (!first) await sleep(BETWEEN_ATTACHES_MS);
    first = false;
    try {
      const outcome = await backfillOne(coin.mint, opts);
      results.push(outcome);
      if (outcome.status === "attached") attached += 1;
      log(
        outcome.status === "attached"
          ? `  ok   ${outcome.ticker} ${outcome.mint} -> ${outcome.attached!.curveAddress}`
          : `  skip ${outcome.ticker} ${outcome.mint} (${outcome.reason}) ${outcome.detail ?? ""}`,
      );
    } catch (err) {
      // A failed attach is a skip with the reason attached, not a crash: the
      // other coins still deserve their curve.
      results.push({
        mint: coin.mint,
        ticker: coin.symbol,
        status: "skipped",
        detail: err instanceof Error ? err.message : String(err),
      });
      log(`  fail ${coin.symbol} ${coin.mint}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return results;
}
