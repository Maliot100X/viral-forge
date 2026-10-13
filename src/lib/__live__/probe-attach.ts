// Live devnet probe for attachCurve(): stock an EXISTING mint's curve.
//
// This is the path the backfill and every future launch uses, so it is proven
// against a real mint the wallet already holds rather than a freshly created
// one — the freshly created case is already covered by createCoin.
//
// Run: npx tsx src/lib/__live__/probe-attach.ts <mint>
// Moves real devnet SOL. Not part of the default test run.

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

import { attachCurve, readCurveState, curveKeypair, curveTokenAccount, tokenBalance } from "../onchain";
import { walletBalanceSol, connection } from "../solana";
import { CURVE_SUPPLY, RESERVED_SUPPLY } from "../curve";
import { setCoinCurve, getCoin, getCurveSecret } from "../store";

async function main() {
  const mint = process.argv[2];
  if (!mint) throw new Error("usage: probe-attach.ts <mint>");
  // Keep the reserve small on purpose: enough to clear the rent floor plus a
  // little trading liquidity, not the 1 SOL the throwaway probes used.
  const devBuySol = Number(process.argv[3] ?? "0.05");

  console.log("wallet before:", await walletBalanceSol());

  const existing = await getCoin(mint);
  if (existing?.curveAddress) {
    throw new Error(`${mint} already has curve ${existing.curveAddress}`);
  }

  const attached = await attachCurve({
    mint,
    curveSupply: CURVE_SUPPLY,
    devBuySol,
    confirm: true,
  });

  console.log("CURVE ADDRESS:", attached.curveAddress);
  console.log("ATTACH SIG:", attached.explorer);
  console.log("curve lamports:", attached.curveLamports);
  console.log("curve tokens:", attached.curveTokenBalance);
  console.log("wallet tokens:", attached.walletTokenBalance);
  console.log("decimals:", attached.decimals, "totalSupply:", attached.totalSupply);

  // Persist FIRST, before any assertion. An attached curve whose secret only
  // ever existed in a process that has since exited is a curve nobody can sell
  // from: the keypair is the only thing that can pay SOL out of the reserve.
  // Ordering it after the checks below means a failed check strands the curve.
  await setCoinCurve({
    mint,
    curveAddress: attached.curveAddress,
    curveSecret: attached.curveSecret,
    initialBuySol: devBuySol,
  });
  const stored = await getCurveSecret(mint);
  if (!stored || stored !== attached.curveSecret) {
    throw new Error("the curve secret did not persist — this curve could never sell");
  }
  console.log("secret persisted: yes");

  // Now the checks. The curve must hold the full curve side; the wallet keeps
  // whatever is left. That leftover is NOT always RESERVED_SUPPLY: these coins
  // were minted before the curve existed and some have been partially spent, so
  // the honest assertion is on the delta the transfer moved.
  if (BigInt(attached.curveTokenBalance) !== CURVE_SUPPLY) {
    throw new Error(`curve holds ${attached.curveTokenBalance}, expected ${CURVE_SUPPLY}`);
  }

  // Re-read through the transport that trades use, not the value we returned.
  const state = await readCurveState(attached.curveAddress);
  if (!state.exists) throw new Error("readCurveState says the curve does not exist");
  console.log("RESERVE SOL:", Number(state.realSolReserve) / 1e9);
  if (state.realSolReserve <= 0n) throw new Error("curve has no SOL reserve");

  // The secret must round-trip: without it nothing can ever be sold.
  const kp = curveKeypair({ address: attached.curveAddress, secret: stored });
  if (kp.publicKey.toBase58() !== attached.curveAddress) {
    throw new Error("curve secret does not derive the curve address");
  }

  const curveTokens = await tokenBalance(connection(), curveTokenAccount(attached.curveAddress, mint));
  console.log("re-read curve tokens:", curveTokens.toString());
  if (curveTokens !== CURVE_SUPPLY) {
    throw new Error(`re-read shows ${curveTokens} tokens, expected ${CURVE_SUPPLY}`);
  }

  if (BigInt(attached.walletTokenBalance) > RESERVED_SUPPLY) {
    throw new Error(
      `wallet kept ${attached.walletTokenBalance}, which is more than the ${RESERVED_SUPPLY} reserve it should retain`,
    );
  }

  console.log("wallet after:", await walletBalanceSol());
  console.log("ATTACH_OK");
}

main().catch((e) => {
  console.error("ATTACH_FAILED", e?.code ?? "", e?.message ?? e);
  process.exit(1);
});
