// One-off devnet inspection: who really holds a mint's supply, and under which
// token program. Kept because it is the check that exposed the fake buy/sell
// recorded in ONCHAIN-CORRECTION.md — it must be runnable again.
//
// Run: npx tsx src/lib/__live__/probe-supply.mts <mint> <wallet>

import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

function loadEnv() {
  const raw = readFileSync("/home/coder/.env", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

/** Shape of a parsed SPL mint/token account as returned by the RPC. */
interface ParsedTokenData {
  parsed?: {
    info?: {
      owner?: string;
      mint?: string;
      decimals?: number;
      tokenAmount?: { uiAmountString?: string };
    };
  };
}

const c = new Connection(process.env.HELIUS_DEVNET_RPC as string, "confirmed");
const MINT = process.argv[2];
const WALLET = process.argv[3];
if (!MINT || !WALLET) {
  console.error("usage: probe-supply.mts <mint> <wallet>");
  process.exit(2);
}

const mintInfo = await c.getParsedAccountInfo(new PublicKey(MINT));
const parsed = (mintInfo.value?.data as ParsedTokenData | undefined)?.parsed?.info;
console.log("mint owner program:", mintInfo.value?.owner.toBase58());
console.log("mint decimals:", parsed?.decimals, "supply:", parsed?.tokenAmount?.uiAmountString);

const largest = await c.getTokenLargestAccounts(new PublicKey(MINT));
console.log("largest token accounts:", JSON.stringify(largest.value));
for (const a of largest.value) {
  const info = await c.getParsedAccountInfo(new PublicKey(a.address));
  const i = (info.value?.data as ParsedTokenData | undefined)?.parsed?.info;
  console.log(`  ${a.address} amount=${a.amount} owner=${i?.owner}`);
}

// The wallet's classic-SPL token accounts, the program our own mints use.
const mine = await c.getParsedTokenAccountsByOwner(new PublicKey(WALLET), {
  programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
});
console.log("wallet SPL token accounts:", mine.value.length);
