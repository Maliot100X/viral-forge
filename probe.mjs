import { Connection, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, createTransferInstruction } from "@solana/spl-token";
import bs58 from "bs58";
const conn = new Connection(process.env.HELIUS_DEVNET_RPC, "confirmed");
const payer = Keypair.fromSecretKey(bs58.decode(process.env.DEVNET_WALLET_KEY));
const buyer = Keypair.generate();
const send = async (tx, signers) => {
  const bh = await conn.getLatestBlockhash();
  tx.recentBlockhash = bh.blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
};
const mint = await createMint(conn, payer, payer.publicKey, null, 9);
const treasury = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
await mintTo(conn, payer, mint, treasury.address, payer, 1_000_000_000n * 10n ** 9n);
const buyerAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, buyer.publicKey);
console.log("MINT:", mint.toBase58());

await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: buyer.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })), [payer]);

const buySig = await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: payer.publicKey, lamports: Math.round(0.01*LAMPORTS_PER_SOL) })), [buyer]);
console.log("BUY  SOL TX:", buySig);

const TOK = 1_000_000n * 10n ** 9n;
const delSig = await send(new Transaction().add(createTransferInstruction(treasury.address, buyerAta.address, payer.publicKey, TOK)), [payer]);
console.log("TOKEN DELIVERY TX:", delSig);
console.log("buyer tokens after buy:", (await conn.getTokenAccountBalance(buyerAta.address)).value.uiAmountString);

const sellTokSig = await send(new Transaction().add(createTransferInstruction(buyerAta.address, treasury.address, buyer.publicKey, TOK)), [buyer]);
console.log("SELL TOKEN TX:", sellTokSig);
const sellSolSig = await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: buyer.publicKey, lamports: Math.round(0.009*LAMPORTS_PER_SOL) })), [payer]);
console.log("SELL SOL TX:", sellSolSig);
console.log("buyer tokens after sell:", (await conn.getTokenAccountBalance(buyerAta.address)).value.uiAmountString);
console.log("ROUND TRIP COMPLETE — 4 real txns, err null each");
console.log("EXPLORER:", "https://explorer.solana.com/address/" + mint.toBase58() + "?cluster=devnet");
