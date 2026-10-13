/**
 * Proves the reported regression is fixed: a connected devnet wallet with no SOL
 * must be able to buy, because the launch wallet is the fee payer and the
 * connected wallet only receives tokens.
 *
 * This drives the real route handler against real devnet. It asserts:
 *   1. a fresh 0-SOL wallet is NOT rejected,
 *   2. the fill carries a real signature that landed,
 *   3. the tokens arrived in the fresh wallet's own ATA,
 *   4. the response labels who funded it.
 *
 * Run: npx tsx src/lib/__live__/probe-empty-wallet-buy.ts
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
// Side-effect import: populates process.env before any DB-backed module is
// evaluated. Must stay first so `db.ts` sees DATABASE_URL.
import "./env";

async function main(): Promise<void> {
  const { POST } = await import("../../app/api/trade/route");
  const { connection } = await import("../solana");
  const { TOKEN_PROGRAM_ID, tokenBalance } = await import("../onchain");

  const mint = process.env.PROBE_MINT ?? "7BR4KjUSbhQrQ4nBxFiYUgvbQ3XmEYAQRG2QWeUs7JSC";
  const fresh = Keypair.generate();
  const conn = connection();

  const bal = await conn.getBalance(fresh.publicKey);
  console.log(`fresh wallet      ${fresh.publicKey.toBase58()}`);
  console.log(`its SOL balance   ${bal} lamports`);
  if (bal >= 5_000) throw new Error("probe wallet is not empty — test is meaningless");

  const before = await tokenBalance(
    conn,
    getAssociatedTokenAddressSync(new PublicKey(mint), fresh.publicKey, true, TOKEN_PROGRAM_ID),
  );

  const req = (body: unknown) =>
    new Request("http://localhost/api/trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Phase 1 — quote. Must be 428 and must not sign anything.
  const q = await POST(req({ mint, action: "buy", amount: 0.02, traderPublicKey: fresh.publicKey.toBase58() }));
  console.log(`\nquote             HTTP ${q.status}`);
  const qBody = (await q.json()) as Record<string, unknown>;
  if (q.status !== 428) {
    console.log(JSON.stringify(qBody, null, 2));
    throw new Error(`expected 428 for the quote gate, got ${q.status}`);
  }
  if ("signature" in qBody) throw new Error("quote response leaked a signature");

  // Phase 2 — confirm. This is the step that used to fail with 409 invalid_trader.
  const c = await POST(
    req({ mint, action: "buy", amount: 0.02, confirm: true, traderPublicKey: fresh.publicKey.toBase58() }),
  );
  console.log(`confirm           HTTP ${c.status}`);
  const body = (await c.json()) as Record<string, unknown>;
  if (!c.ok) {
    console.log(JSON.stringify(body, null, 2));
    throw new Error(`EMPTY_WALLET_BUY_FAILED: ${c.status} ${JSON.stringify(body)}`);
  }

  const after = await tokenBalance(
    conn,
    getAssociatedTokenAddressSync(new PublicKey(mint), fresh.publicKey, true, TOKEN_PROGRAM_ID),
  );

  console.log(`signature         ${body.signature}`);
  console.log(`explorer          ${body.explorerUrl}`);
  console.log(`fundedBy          ${body.fundedBy}`);
  console.log(`traderIsConnected ${body.traderIsConnectedWallet}`);
  console.log(`received (atoms)  ${after.toString()} (was ${before.toString()})`);
  console.log(`wallet SOL after  ${await conn.getBalance(fresh.publicKey)} lamports`);

  // Confirm the signature really landed on chain, rather than trusting the 201.
  const { confirmSignature } = await import("../onchain");
  const conf = await confirmSignature(conn, String(body.signature), 60_000);
  if (!conf.ok || conf.err) {
    throw new Error(`signature did not confirm: ${JSON.stringify(conf)}`);
  }
  console.log(`chain confirmed   slot ${conf.slot}`);

  if (after <= before) throw new Error("token balance did not increase — the buy did not really fill");
  if (body.fundedBy !== "launch_wallet") throw new Error(`fundedBy was ${body.fundedBy}, expected launch_wallet`);
  if (body.traderIsConnectedWallet !== true) throw new Error("tokens did not go to the connected wallet");

  console.log("\nEMPTY_WALLET_BUY_OK");
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
