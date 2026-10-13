// One-off devnet receipt check. Given signatures it prints slot, error and fee
// straight from the chain, which is how the "did it really land" question gets
// answered without trusting our own logs.
//
// Run: npx tsx src/lib/__live__/verify.mts <signature> [signature...]

import { readFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";

function loadEnv() {
  const raw = readFileSync("/home/coder/.env", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const sigs = process.argv.slice(2);
if (sigs.length === 0) {
  console.error("usage: verify.mts <signature> [signature...]");
  process.exit(2);
}

const c = new Connection(process.env.HELIUS_DEVNET_RPC as string, "confirmed");

for (const sig of sigs) {
  const tx = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  console.log(
    sig.slice(0, 12),
    tx
      ? `slot=${tx.slot} err=${JSON.stringify(tx.meta?.err)} fee=${tx.meta?.fee}`
      : "NOT FOUND",
  );
}
