// Reads every token account that holds one of our coin mints, so the orphans
// left by earlier probes can be identified instead of inferred.
//
// Several coins have less than the 800,000,000 CURVE_SUPPLY in the wallet
// because an earlier probe transferred tokens onto a curve account whose key
// was then lost. Those tokens still exist — this finds them.
//
// Run: npx tsx src/lib/__live__/probe-orphans.ts

import "./env";

import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  AccountLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connection, launchWallet } from "../solana";
import { tokenBalance } from "../onchain";

async function main() {
  const { listCoins } = await import("../store");
  const { CURVE_SUPPLY } = await import("../curve");

  const c = connection();
  const wallet = launchWallet();
  if (!wallet) throw new Error("no launch wallet configured");

  const coins = (await listCoins()).filter((x) => x.mode === "live" && x.mint);
  if (coins.length === 0) throw new Error("no LIVE coins — database unreachable?");

  const walletAtaOf = (mint: string) =>
    getAssociatedTokenAddressSync(new PublicKey(mint), wallet.publicKey, true, TOKEN_PROGRAM_ID);

  for (const coin of coins) {
    const mintKey = new PublicKey(coin.mint);
    const walletAta = walletAtaOf(coin.mint);
    const walletHeld = await tokenBalance(c, walletAta);

    // Every token account for this mint, whoever owns it. The orphan curves
    // are separate accounts, so an owner-filtered query would miss exactly the
    // accounts this probe exists to find: getProgramAccounts over the token
    // program, filtered by the 165-byte account size and the mint in the data.
    const accounts = await c
      .getProgramAccounts(TOKEN_PROGRAM_ID, {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
        ],
      })
      .catch(() => []);

    console.log(`\n${coin.symbol} ${coin.mint}`);
    console.log(`  wallet ATA ${walletAta.toBase58()} = ${walletHeld}`);
    console.log(`  token accounts holding this mint: ${accounts.length}`);
    for (const acc of accounts) {
      const parsed = AccountLayout.decode(acc.account.data) as {
        amount: bigint;
        owner: PublicKey;
      };
      const isWallet = acc.pubkey.equals(walletAta);
      console.log(
        `    ${acc.pubkey.toBase58()} owner=${parsed.owner.toBase58()} amount=${parsed.amount}` +
          (isWallet ? "  (wallet)" : ""),
      );
    }
    if (walletHeld < CURVE_SUPPLY) {
      console.log(`  SHORT: wallet holds ${walletHeld}, curve needs ${CURVE_SUPPLY}`);
    }
  }
}

main().catch((e) => {
  console.error("ORPHANS_FAILED", e?.message ?? e);
  process.exit(1);
});
