// Reads what the launch wallet actually holds for each LIVE coin, on chain.
//
// The backfill needs a full CURVE_SUPPLY (80% of 1e9) in the wallet to stock a
// curve, and some of these coins were partially spent after minting. This
// prints the real holding per mint so the backfill can be judged against facts
// rather than against the 1e9 each coin was originally created with.
//
// Run: npx tsx src/lib/__live__/probe-holdings.ts

import "./env";

import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { connection, launchWallet } from "../solana";
import { TOKEN_PROGRAM_ID, tokenBalance, curveTokenAccount } from "../onchain";

async function main() {
  // Dynamic so the store is evaluated AFTER ./env has populated process.env.
  const { listCoins } = await import("../store");
  const { CURVE_SUPPLY } = await import("../curve");

  const c = connection();
  const wallet = launchWallet();
  if (!wallet) throw new Error("no launch wallet configured");
  console.log("wallet:", wallet.publicKey.toBase58());
  console.log("need CURVE_SUPPLY:", CURVE_SUPPLY.toString(), "(80%)\n");

  const coins = (await listCoins()).filter((x) => x.mode === "live" && x.mint);
  if (coins.length === 0) throw new Error("no LIVE coins found — is the database reachable?");

  for (const coin of coins) {
    const ata = curveTokenAccount(wallet.publicKey.toBase58(), coin.mint);
    let held = "unreadable";
    try {
      held = (await tokenBalance(c, ata)).toString();
    } catch (e) {
      held = `err ${(e as Error).message}`;
    }
    let supply = "?";
    let authority = "?";
    try {
      const info = await getMint(c, new PublicKey(coin.mint), "confirmed", TOKEN_PROGRAM_ID);
      supply = info.supply.toString();
      authority = info.mintAuthority ? info.mintAuthority.toBase58() : "revoked";
    } catch {
      supply = "no classic mint";
    }
    const readable = !held.startsWith("err") && held !== "unreadable";
    const enough = readable && BigInt(held) >= CURVE_SUPPLY;
    console.log(
      [
        coin.symbol.padEnd(8),
        coin.mint,
        `held=${held}`,
        `supply=${supply}`,
        `mintAuth=${authority}`,
        `enough=${enough}`,
        `curveAddr=${coin.curveAddress ?? "-"}`,
      ].join("  "),
    );
  }
}

main().catch((e) => {
  console.error("HOLDINGS_FAILED", e?.message ?? e);
  process.exit(1);
});
