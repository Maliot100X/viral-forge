// Backfill runner: attach a real curve to every LIVE coin that lacks one.
//
// Run: npx tsx src/lib/__live__/run-backfill.ts [reserveSol] [limit] [mint...]
//
// Idempotent: a coin with a curve is skipped, so this is safe to re-run.
// Moves real devnet SOL. Not part of the default test run.

// Must be first: db.ts captures DATABASE_URL at module-eval time.
import "./env";

import { backfillCurves, backfillOne, MIN_BACKFILL_RESERVE_SOL } from "../backfill";
import { walletBalanceSol } from "../solana";

async function main() {
  const argv = process.argv.slice(2);
  const reserveSol = argv[0] ? Number(argv[0]) : 0.05;
  const limit = argv[1] && argv[1] !== "-" ? Number(argv[1]) : undefined;
  const only = argv.slice(2);

  if (reserveSol < MIN_BACKFILL_RESERVE_SOL) {
    throw new Error(
      `reserve ${reserveSol} SOL is below the ${MIN_BACKFILL_RESERVE_SOL} SOL rent floor`,
    );
  }

  console.log("wallet before:", await walletBalanceSol());
  console.log("reserve per curve:", reserveSol, "SOL\n");

  const log = (l: string) => console.log(l);
  const results: import("../backfill").BackfillOutcome[] = [];
  if (only.length) {
    // Serial, deliberately. Promise.all here is what produced a wall of 429s on
    // the public devnet RPC and a 429 read is not evidence about anything.
    for (let i = 0; i < only.length; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      results.push(await backfillOne(only[i], { reserveSol, log }));
    }
  } else {
    results.push(...(await backfillCurves({ reserveSol, limit, log })));
  }

  const attached = results.filter((r) => r.status === "attached");
  const skipped = results.filter((r) => r.status === "skipped");

  console.log("\n=== attached ===");
  for (const r of attached) {
    console.log(
      `${r.ticker.padEnd(8)} ${r.mint} -> ${r.attached!.curveAddress}  tokens=${r.verified!.curveTokens} reserve=${r.verified!.reserveSol} SOL`,
    );
  }
  console.log("\n=== skipped ===");
  for (const r of skipped) {
    console.log(`${r.ticker.padEnd(8)} ${r.mint} (${r.reason ?? "error"}) ${r.detail ?? ""}`);
  }
  console.log(`\nattached ${attached.length}, skipped ${skipped.length}`);
  console.log("wallet after:", await walletBalanceSol());
  console.log("BACKFILL_DONE");
}

main().catch((e) => {
  console.error("BACKFILL_FAILED", e?.code ?? "", e?.message ?? e);
  process.exit(1);
});
