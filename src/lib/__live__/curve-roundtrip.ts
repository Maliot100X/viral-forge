// Live devnet round trip through the real production code path.
//
// Mints a real token via createCoin(), funds its curve via the same second
// phase the launch route uses, then does a REAL buy and a REAL sell against
// that curve with the actual buyToken/sellToken functions.
//
// Run: npx tsx src/lib/__live__/curve-roundtrip.test.ts   (or via vitest)
// This moves real devnet SOL. It is not part of the default test run.

import { readFileSync } from "node:fs";

function loadEnv() {
  const raw = readFileSync("/home/coder/.env", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

import {
  createCoin,
  newCurveAccount,
  readCurveState,
  buyToken,
  sellToken,
} from "../onchain";
import { walletBalanceSol } from "../solana";
import { formatPrice, spotPriceScaled, quoteBuy } from "../curve";

async function main() {
  console.log("wallet before:", await walletBalanceSol());

  const curve = newCurveAccount();
  console.log("curve address:", curve.address);

  const created = await createCoin({
    name: "Forge Curve Test",
    symbol: "FCT",
    description: "live round trip test",
    uri: "https://viral-forge-gamma.vercel.app/icon.svg",
    // The dev buy IS the curve's opening SOL reserve, so it must clear the rent
    // floor. `createCoin` funds the curve itself from this amount, which is why
    // the probe no longer wires a separate funding transfer by hand.
    devBuySol: 1,
    curveAddress: curve.address,
    confirm: true,
  });
  console.log("MINT:", created.mint);
  console.log("SIG:", created.explorer);
  console.log("curve lamports after create:", created.curveLamports);
  if (created.curveLamports <= 0) {
    throw new Error("createCoin reported funding no curve — a token nobody could sell");
  }

  // The curve was already funded by the dev buy inside createCoin. This reads
  // back what actually landed rather than trusting the figure it returned.
  const state = await readCurveState(curve.address);
  console.log("curve lamports:", state.lamports, "reserve SOL:", Number(state.realSolReserve) / 1e9);
  console.log("price:", formatPrice(spotPriceScaled(state), 12));

  // REAL BUY through the production function.
  const q = quoteBuy(state, 200_000_000n);
  console.log("expected out on 0.2 SOL buy:", q.amountOut.toString());

  const buy = await buyToken({
    curve,
    mint: created.mint,
    amount: 0.2,
    minOut: 0n,
    confirm: true,
  });
  console.log("BUY SIG:", buy.explorer);
  console.log("buy in:", buy.amountIn.toString(), "out:", buy.amountOut.toString(), "fee:", buy.fee.toString());
  console.log("reserve after buy SOL:", Number(buy.curve.realSolReserve) / 1e9);

  // The trader defaults to the launch wallet, which already holds the creator
  // allocation (RESERVED_SUPPLY), so the balance after a buy is not the buy's
  // output on its own. What must hold is the DELTA: the buy moved exactly the
  // tokens the quote promised. This is the assertion that was missing when a
  // previous probe reported a buy that had moved no tokens at all.
  const before0 = 200_000_000n * 10n ** 9n; // RESERVED_SUPPLY, the creator side
  const boughtAtoms = BigInt(buy.traderTokenBalance) - before0;
  if (boughtAtoms <= 0n) {
    throw new Error(`buyer gained ${boughtAtoms} tokens after a buy — not a trade`);
  }
  if (boughtAtoms !== buy.amountOut) {
    throw new Error(`buyer gained ${boughtAtoms} but quote promised ${buy.amountOut}`);
  }
  console.log("BUY VERIFIED: buyer gained", boughtAtoms.toString(), "tokens (exactly the quote)");
  console.log("curve token balance after buy:", buy.curveTokenBalance);

  // REAL SELL back through the production function.
  const sell = await sellToken({
    curve,
    mint: created.mint,
    amount: 1000,
    minOut: 0n,
    confirm: true,
  });
  console.log("SELL SIG:", sell.explorer);
  console.log("sell payout lamports:", sell.amountOut.toString(), "fee:", sell.fee.toString());
  console.log("reserve after sell SOL:", Number(sell.curve.realSolReserve) / 1e9);

  const afterAtoms = BigInt(sell.traderTokenBalance);
  const soldAtoms = BigInt(sell.amountIn);
  if (afterAtoms !== BigInt(buy.traderTokenBalance) - soldAtoms) {
    throw new Error(
      `after selling ${soldAtoms}, buyer holds ${afterAtoms}; expected ${BigInt(buy.traderTokenBalance) - soldAtoms}`,
    );
  }
  if (BigInt(sell.curveTokenBalance) !== BigInt(buy.curveTokenBalance) + soldAtoms) {
    throw new Error("curve did not receive the tokens back — the sell was one-sided");
  }
  if (BigInt(sell.amountOut) <= 0n) {
    throw new Error("sell paid out no SOL");
  }
  console.log("SELL VERIFIED: " + soldAtoms.toString() + " tokens returned to the curve for " + sell.amountOut.toString() + " lamports");

  console.log("wallet after:", await walletBalanceSol());
  console.log("ROUNDTRIP_OK");
}

main().catch((e) => {
  console.error("ROUNDTRIP_FAILED", e?.code ?? "", e?.message ?? e);
  process.exit(1);
});
