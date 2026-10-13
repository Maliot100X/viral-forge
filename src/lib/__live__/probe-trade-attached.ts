// Live devnet probe: trade against an ALREADY attached curve.
//
// attachCurve stocks a curve for an existing mint; this proves the resulting
// market is real by doing a genuine buy and a genuine sell through the
// production buyToken/sellToken functions, asserting on-chain balance DELTAS.
//
// Run: npx tsx src/lib/__live__/probe-trade-attached.ts <mint> [curveAddress]
//
// The secret is read from the database, never from argv: the whole point of
// persisting it immediately after attach is that it is the source of truth. A
// secret passed on the command line is how the ZKAT curve was lost.

// Must be first: db.ts captures DATABASE_URL at module-eval time, and ESM
// hoists static imports above this module's body.
import "./env";

import { buyToken, sellToken, readCurveState, curveKeypair } from "../onchain";
import { walletBalanceSol } from "../solana";
import { quoteBuy, RESERVED_SUPPLY, formatPrice, spotPriceScaled } from "../curve";

async function main() {
  const mint = process.argv[2];
  const curveAddressArg = process.argv[3];
  if (!mint) {
    throw new Error("usage: probe-trade-attached.ts <mint> [curveAddress]");
  }

  // Dynamic: pulls in the store, which pulls in db.ts, only after ./env ran.
  const { getCoin, getCurveSecret } = await import("../store");

  const coin = await getCoin(mint);
  if (!coin) throw new Error(`no coin row for ${mint}`);
  const curveAddress = curveAddressArg || coin.curveAddress;
  if (!curveAddress) throw new Error(`${coin.symbol} has no curve_address`);

  const secret = await getCurveSecret(mint);
  if (!secret) throw new Error(`${coin.symbol} has no persisted curve secret`);

  const curve = { address: curveAddress, secret };
  // The secret must derive the address, or the sell cannot pay out.
  curveKeypair(curve);
  console.log(`${coin.symbol} curve ${curveAddress} secret round-tripped from the DB`);

  console.log("wallet before:", await walletBalanceSol());
  const before = await readCurveState(curveAddress);
  console.log("reserve before SOL:", Number(before.realSolReserve) / 1e9);
  console.log("price:", formatPrice(spotPriceScaled(before), 12));

  const expected = quoteBuy(before, 20_000_000n);
  const buy = await buyToken({ curve, mint, amount: 0.02, minOut: 0n, confirm: true });
  console.log("BUY SIG:", buy.explorer);
  console.log("buy out:", buy.amountOut.toString(), "expected:", expected.amountOut.toString());
  console.log("curve tokens after buy:", buy.curveTokenBalance);

  const gained = BigInt(buy.traderTokenBalance) - RESERVED_SUPPLY;
  if (gained !== buy.amountOut) {
    throw new Error(`buyer gained ${gained} but the trade reported ${buy.amountOut}`);
  }
  console.log("BUY VERIFIED: gained", gained.toString(), "tokens");

  const sell = await sellToken({ curve, mint, amount: 1000, minOut: 0n, confirm: true });
  console.log("SELL SIG:", sell.explorer);
  console.log("sell payout lamports:", sell.amountOut.toString());
  if (BigInt(sell.amountOut) <= 0n) throw new Error("sell paid out nothing");
  if (BigInt(sell.curveTokenBalance) !== BigInt(buy.curveTokenBalance) + BigInt(sell.amountIn)) {
    throw new Error("curve did not receive the sold tokens back");
  }
  console.log("SELL VERIFIED");

  const after = await readCurveState(curveAddress);
  console.log("reserve after SOL:", Number(after.realSolReserve) / 1e9);
  console.log("wallet after:", await walletBalanceSol());
  console.log("TRADE_OK");
}

main().catch((e) => {
  console.error("TRADE_FAILED", e?.code ?? "", e?.message ?? e);
  process.exit(1);
});
