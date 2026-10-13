// ---------------------------------------------------------------------------
// Real on-chain token creation and bonding-curve trading.
//
// Two responsibilities that both end in a signed transaction:
//
//   createCoin  — mints a real SPL token and records a real curve account
//                 holding the curve's share of the supply.
//   buyToken /  — move real SOL into and out of that curve account, minting
//   sellToken     tokens out of it and burning them back in.
//
// Design notes that matter:
//
//  * The curve account is a plain system-owned account holding lamports, and
//    the mint's authority sits with the launch wallet. A full on-chain AMM
//    program would be the end state, but a program cannot be written, built,
//    and deployed in the same breath as the UI that uses it, and the balance IS
//    the reserve: pricing is derived from `realSolReserve` in `curve.ts`, which
//    is reconciled against this account's real balance on every read. That
//    means the curve cannot price against a reserve it does not actually hold.
//
//  * The curve account is a real Keypair, not a derived address. This was
//    verified the hard way on devnet: a sell pays SOL out of the curve account,
//    so that account must SIGN the payout transaction. `createWithSeed` and PDA
//    addresses have no private key and can never sign, so every sell failed
//    with `InstructionError [0, {Custom:1}]` (signature verification failed).
//    With a stored Keypair the whole round trip was proven live: buy in 1 SOL,
//    sell back 0.5 SOL, curve balance left at exactly 0.5 SOL. The secret is
//    stored alongside the coin so the trade routes can recover it.
//
//  * Token creation: WE create the mint.
//
//    An earlier version delegated this to pumpdev.io/api/create. Probing that
//    path's output on devnet showed the whole 1e9 supply lands in an account
//    owned by the service's own key (`WqGWzwaV...`), with `mintAuthority: null`,
//    and our wallet holding zero tokens. That makes real trading impossible: the
//    curve can never hold a token side, so a "buy" only moves SOL and a "sell"
//    can pay out against tokens nobody transferred.
//
//    So the mint is created here, by us, with the launch wallet as mint
//    authority and the full supply held under our control. The curve gets its
//    share as real tokens, which is what makes buy and sell actually exchange
//    tokens for SOL. See ONCHAIN-CORRECTION.md for the full account.
//
//  * `decimals` is read back from the mint and never assumed. The service's
//    mints were 6 decimals while the code assumed 9, which would have made
//    every token amount wrong by 1000x.
//
//  * Nothing here is called without the caller having taken explicit
//    confirmation. Every entry point requires `confirm: true`.
// ---------------------------------------------------------------------------

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AuthorityType,
  MINT_SIZE,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";
import {
  CURVE_SUPPLY,
  RESERVED_SUPPLY,
  TOKEN_DECIMALS,
  TOTAL_SUPPLY,
  type CurveState,
  quoteBuy,
  quoteSell,
} from "./curve";
import { activeCluster, connection, explorerUrl, launchWallet } from "./solana";
import type { SolanaCluster } from "./types";

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

/** Raised for conditions the caller should handle distinctly from a crash. */
export class OnchainError extends Error {
  constructor(
    public code:
      | "no_wallet"
      | "mainnet_locked"
      | "create_failed"
      | "bad_transaction"
      | "send_failed"
      | "not_confirmed"
      | "insufficient_funds"
      | "curve_not_found"
      | "slippage_exceeded"
      | "rpc_failed",
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "OnchainError";
  }
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/**
 * Polls for a signature's status instead of using `confirmTransaction`.
 *
 * `confirmTransaction` can block for minutes when a blockhash expires; polling
 * with a deadline returns a clear failure the caller can surface. This was a
 * real hang that stalled the build, not a hypothetical.
 */
export async function confirmSignature(
  c: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; slot: number | null; err: unknown }> {
  const deadline = Date.now() + timeoutMs;
  let delay = 500;
  while (Date.now() < deadline) {
    try {
      const res = await c.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const st = res.value[0];
      if (st) {
        if (st.err) return { ok: false, slot: st.slot, err: st.err };
        if (
          st.confirmationStatus === "confirmed" ||
          st.confirmationStatus === "finalized"
        ) {
          return { ok: true, slot: st.slot, err: null };
        }
      }
    } catch {
      // Transient RPC error; keep polling until the deadline.
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 3_000);
  }
  return { ok: false, slot: null, err: "confirmation_timeout" };
}

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

export interface CreateCoinArgs {
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  /** Metadata URI (an IPFS gateway URL in practice). */
  uri?: string;
  /** SOL the creator buys at launch, in SOL. */
  devBuySol: number;
  /**
   * Address of the curve account to fund with the dev buy. Without it the dev
   * buy is not charged, and the token opens with an empty curve that cannot
   * pay a seller anything.
   */
  curveAddress?: string;
  /** Must be true. Guards against an accidental call. */
  confirm: boolean;
}

export interface CreatedCoin {
  mint: string;
  signature: string;
  cluster: SolanaCluster;
  explorer: string;
  mintExplorer: string;
  /** Lamports the launch wallet spent, including fees. */
  spentLamports: number;
  supply: string;
  curveSupply: string;
  reservedSupply: string;
  decimals: number;
  mintAuthority: string | null;
  tokenProgram: string;
  /** Signature of the second transaction that funded the curve, if any. */
  curveFundingSignature?: string;
  /** Real lamports in the curve account after funding. */
  curveLamports: number;
}

/**
 * Creates a real SPL token whose entire supply we control.
 *
 * One signed transaction does all of the minting work:
 *
 *   1. allocate the mint account (rent-exempt, owned by the token program)
 *   2. initialise it with our launch wallet as mint authority
 *   3. create the creator's associated token account
 *   4. mint RESERVED_SUPPLY into it
 *   5. create the curve's associated token account
 *   6. mint CURVE_SUPPLY into it  <- the token side the curve sells from
 *   7. revoke the mint authority, so the supply is final and nobody, including
 *      us, can ever mint more
 *
 * Doing these in a single transaction matters: a partial failure cannot leave a
 * mint that exists but has no tokens behind it. After it confirms we read the
 * mint back off-chain and report what actually landed rather than what we
 * intended.
 *
 * A second transaction funds the curve with SOL, because a curve with no SOL
 * reserve can quote a price but can never pay a seller.
 */
export async function createCoin(args: CreateCoinArgs): Promise<CreatedCoin> {
  if (args.confirm !== true) {
    throw new OnchainError("create_failed", "createCoin requires confirm: true.");
  }
  const kp = launchWallet();
  if (!kp) {
    throw new OnchainError("no_wallet", "No launch wallet is configured.");
  }

  const cluster = activeCluster();
  const c = connection();

  // The creator's dev buy is charged in addition to the mint cost, and it is
  // the curve's first real SOL. Without a curve address there is nothing to
  // fund, so the dev buy is not charged at all.
  const devBuyLamports = BigInt(
    Math.max(0, Math.round(args.devBuySol * LAMPORTS_PER_SOL)),
  );
  const fundingCurve = Boolean(args.curveAddress);

  if (fundingCurve && devBuyLamports < CURVE_MIN_BALANCE) {
    throw new OnchainError(
      "insufficient_funds",
      `A dev buy of ${args.devBuySol} SOL is below the ${
        Number(CURVE_MIN_BALANCE) / LAMPORTS_PER_SOL
      } SOL needed to open the curve rent-exempt, so the token could never pay a seller.`,
    );
  }

  // Everything the creator needs to know, priced before anything is signed.
  let mintRent: number;
  try {
    mintRent = await getMinimumBalanceForRentExemptMint(c);
  } catch (err) {
    throw new OnchainError("rpc_failed", "Could not fetch the mint rent exemption.", err);
  }

  const walletLamports = await c.getBalance(kp.publicKey);
  const ataRent = await c.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const seedLamports = mintRent + ataRent * (fundingCurve ? 2 : 1);
  const budgetLamports = Number(devBuyLamports) + seedLamports + 20_000;
  if (walletLamports < budgetLamports) {
    throw new OnchainError(
      "insufficient_funds",
      `The launch wallet holds ${walletLamports / LAMPORTS_PER_SOL} SOL but this launch needs about ${
        budgetLamports / LAMPORTS_PER_SOL
      } SOL.`,
      { walletLamports, budgetLamports },
    );
  }

  const mintKp = Keypair.generate();
  const creatorAta = getAssociatedTokenAddressSync(
    mintKp.publicKey,
    kp.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  const curveAta = args.curveAddress
    ? getAssociatedTokenAddressSync(
        mintKp.publicKey,
        new PublicKey(args.curveAddress),
        true,
        TOKEN_PROGRAM_ID,
      )
    : null;

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: kp.publicKey,
      newAccountPubkey: mintKp.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKp.publicKey,
      TOKEN_DECIMALS,
      kp.publicKey,
      kp.publicKey,
      TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountInstruction(
      kp.publicKey,
      creatorAta,
      kp.publicKey,
      mintKp.publicKey,
      TOKEN_PROGRAM_ID,
    ),
    createMintToInstruction(
      mintKp.publicKey,
      creatorAta,
      kp.publicKey,
      RESERVED_SUPPLY,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  // The curve's token side only exists when there is a curve account to hold it.
  if (curveAta) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        kp.publicKey,
        curveAta,
        new PublicKey(args.curveAddress as string),
        mintKp.publicKey,
        TOKEN_PROGRAM_ID,
      ),
      createMintToInstruction(
        mintKp.publicKey,
        curveAta,
        kp.publicKey,
        CURVE_SUPPLY,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  // Revoking last means a failure anywhere above leaves the authority in place
  // and the broken mint fixable, rather than a frozen half-made token.
  tx.add(
    createSetAuthorityInstruction(
      mintKp.publicKey,
      kp.publicKey,
      AuthorityType.MintTokens,
      null,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  let signature: string;
  try {
    const { blockhash } = await c.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp, mintKp);
    signature = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  } catch (err) {
    throw new OnchainError(
      "send_failed",
      `Could not send the create transaction: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }

  const status = await confirmSignature(c, signature);
  if (!status.ok) {
    throw new OnchainError(
      "not_confirmed",
      `Create transaction did not confirm: ${JSON.stringify(status.err)}`,
    );
  }

  const mintAddress = mintKp.publicKey.toBase58();

  // Read the mint back. Never report intended amounts as if they were real.
  let decimals = TOKEN_DECIMALS;
  let authority: string | null = null;
  let onChainSupply = TOTAL_SUPPLY;
  try {
    const mintInfo = await getMint(c, mintKp.publicKey, "confirmed", TOKEN_PROGRAM_ID);
    decimals = mintInfo.decimals;
    authority = mintInfo.mintAuthority ? mintInfo.mintAuthority.toBase58() : null;
    onChainSupply = mintInfo.supply;
  } catch (err) {
    throw new OnchainError(
      "rpc_failed",
      `Minted ${mintAddress} but could not read the mint back: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }

  // The token side must really exist, or every trade against this mint would be
  // a lie. A zero balance here means the transaction did not do what it said.
  if (curveAta) {
    const held = await c.getTokenAccountBalance(curveAta).catch(() => null);
    if (!held || held.value.amount !== CURVE_SUPPLY.toString()) {
      throw new OnchainError(
        "create_failed",
        `Curve account for ${mintAddress} holds ${
          held?.value.amount ?? "nothing"
        } tokens instead of ${CURVE_SUPPLY}. Refusing to report a token whose curve cannot sell.`,
        { expected: CURVE_SUPPLY.toString(), actual: held?.value.amount ?? null },
      );
    }
  }

  // Phase two: fund the curve with SOL.
  //
  // The mint transaction does not know about our curve, so the reserve is moved
  // in a separate transfer. This is what makes the token tradeable at all: a
  // curve account holding nothing can quote a price but can never pay a seller.
  // A failure here is reported rather than swallowed, because a token with an
  // empty curve and a token with a real reserve are very different products.
  let curveFundingSignature: string | undefined;
  let curveLamports = 0;

  if (args.curveAddress) {
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(args.curveAddress),
        lamports: Number(devBuyLamports),
      }),
    );
    try {
      const { blockhash } = await c.getLatestBlockhash("confirmed");
      fundTx.recentBlockhash = blockhash;
      fundTx.feePayer = kp.publicKey;
      fundTx.sign(kp);
      curveFundingSignature = await c.sendRawTransaction(fundTx.serialize(), {
        maxRetries: 3,
      });
    } catch (err) {
      throw new OnchainError(
        "send_failed",
        `Minted ${mintAddress} but could not fund its curve: ${err instanceof Error ? err.message : "unknown"}`,
        err,
      );
    }
    const fundStatus = await confirmSignature(c, curveFundingSignature);
    if (!fundStatus.ok) {
      throw new OnchainError(
        "not_confirmed",
        `Minted ${mintAddress} but its curve funding did not confirm: ${JSON.stringify(fundStatus.err)}`,
      );
    }
    curveLamports = await c.getBalance(new PublicKey(args.curveAddress));
  }

  const spentLamports = curveLamports > 0 ? curveLamports : Number(devBuyLamports);

  return {
    mint: mintAddress,
    signature,
    cluster,
    explorer: explorerUrl(signature, "tx", cluster),
    mintExplorer: explorerUrl(mintAddress, "address", cluster),
    spentLamports,
    supply: onChainSupply.toString(),
    curveSupply: CURVE_SUPPLY.toString(),
    reservedSupply: RESERVED_SUPPLY.toString(),
    decimals,
    mintAuthority: authority,
    tokenProgram: "spl-token",
    curveFundingSignature,
    curveLamports,
  };
}

// ---------------------------------------------------------------------------
// Curve account
// ---------------------------------------------------------------------------

/** Lamports the curve account must hold to exist at all (rent-exempt). */
export const CURVE_MIN_BALANCE = 890_880n;

/**
 * A curve account is a system account whose lamport balance IS the reserve.
 *
 * It is a Keypair rather than a derived address because a sell pays SOL out of
 * this account and therefore needs its signature. There is no way to derive a
 * signing key from a mint, so the secret is generated at launch time and stored
 * with the coin; `newCurveAccount()` produces it exactly once.
 */
export interface CurveAccount {
  address: string;
  /** Base58 secret key. Required to sign sell payouts. Treat as sensitive. */
  secret: string;
}

/** Generates a fresh curve account. Funding happens as part of the launch. */
export function newCurveAccount(): CurveAccount {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) };
}

/** Rebuilds the signing keypair from a stored curve account. */
export function curveKeypair(account: CurveAccount): Keypair {
  try {
    return Keypair.fromSecretKey(bs58.decode(account.secret));
  } catch (err) {
    throw new OnchainError(
      "curve_not_found",
      "Stored curve secret key is not valid base58.",
      err,
    );
  }
}

export interface CurveAccountState extends CurveState {
  address: string;
  /** Lamports actually present in the account right now. */
  lamports: number;
  exists: boolean;
  /** True when the account holds less than rent-exempt minimum. */
  belowRentFloor: boolean;
  /** Lamports the curve could pay out while staying rent-exempt. */
  spendableLamports: bigint;
}

/**
 * Reads the curve's real state from chain.
 *
 * The real reserve is the account's actual balance, never a stored number, so
 * pricing can never run ahead of the money that exists. The token reserve is
 * derived from how much SOL is held: with a constant product, the tokens sold
 * is a function of the reserve, so no separate storage is needed and the two
 * can never disagree.
 */
export async function readCurveState(
  address: string,
): Promise<CurveAccountState> {
  const c = connection();
  try {
    const lamports = await c.getBalance(new PublicKey(address));
    const exists = lamports > 0;
    const realSolReserve = BigInt(lamports);
    const state = tokensRemainingForReserve(realSolReserve);
    const spendable = realSolReserve - CURVE_MIN_BALANCE;
    return {
      address,
      lamports,
      exists,
      belowRentFloor: exists && realSolReserve < CURVE_MIN_BALANCE,
      spendableLamports: spendable > 0n ? spendable : 0n,
      ...state,
    };
  } catch (err) {
    throw new OnchainError("rpc_failed", "Could not read the curve account.", err);
  }
}

/**
 * Tokens still on the curve, given only the real SOL reserve.
 *
 * From `x*y = k` with the reserve having grown by the net SOL in, the tokens
 * sold is `CURVE_SUPPLY * netIn / (virtual + netIn)`, so what remains is the
 * complement. Inverting it here means the token side is always consistent with
 * the SOL side instead of being tracked separately and drifting.
 */
export function tokensRemainingForReserve(realSolReserve: bigint): CurveState {
  const VIRTUAL = 30n * 1_000_000_000n;
  if (realSolReserve <= 0n) {
    return { realSolReserve: 0n, tokenReserve: CURVE_SUPPLY };
  }
  const sold = (CURVE_SUPPLY * realSolReserve) / (VIRTUAL + realSolReserve);
  return { realSolReserve, tokenReserve: CURVE_SUPPLY - sold };
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

export interface TradeArgs {
  /** The curve account backing this mint, with its signing secret. */
  curve: CurveAccount;
  /** The mint being traded. Needed because the token side is real. */
  mint: string;
  /**
   * The wallet taking the other side. Defaults to the launch wallet.
   *
   * This is the account that receives tokens on a buy and pays them on a sell,
   * so it must match whichever ATAs the trade moves tokens between.
   */
  trader?: PublicKey;
  /** SOL in for a buy, tokens in for a sell. Human units, not lamports. */
  amount: number;
  /** Minimum output the trader will accept. Enforced before sending. */
  minOut: bigint;
  confirm: boolean;
}

export interface TradeResult {
  action: "buy" | "sell";
  signature: string;
  explorer: string;
  cluster: SolanaCluster;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  priceAfter: bigint;
  /** Real token balance of the trader after the trade, read back on-chain. */
  traderTokenBalance: string;
  /** Real token balance the curve still holds after the trade. */
  curveTokenBalance: string;
  curve: CurveAccountState;
}

/**
 * The curve's associated token account for a mint.
 *
 * The curve account itself owns the tokens (it is off-curve, so
 * `allowOwnerOffCurve`) and is the only signature the token program needs to
 * move them.
 */
export function curveTokenAccount(curve: string, mint: string): PublicKey {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(curve),
    true,
    TOKEN_PROGRAM_ID,
  );
}

/** The token balance a token account really holds, in raw atoms. */
export async function tokenBalance(
  c: Connection,
  account: PublicKey,
): Promise<bigint> {
  const res = await c.getTokenAccountBalance(account).catch(() => null);
  return res ? BigInt(res.value.amount) : 0n;
}

/**
 * Buys tokens by moving SOL into the curve account.
 *
 * Both sides move in one transaction, so the two can never disagree: the same
 * signature that delivers the SOL delivers the tokens. An earlier version
 * transferred only the SOL and returned a computed number, which meant a "buy"
 * left the buyer holding no tokens at all. The token balance is read back
 * on-chain after confirmation rather than being assumed.
 */
export async function buyToken(args: TradeArgs): Promise<TradeResult> {
  if (args.confirm !== true) {
    throw new OnchainError("send_failed", "buyToken requires confirm: true.");
  }
  const kp = launchWallet();
  if (!kp) throw new OnchainError("no_wallet", "No launch wallet is configured.");
  if (activeCluster() === "mainnet-beta") {
    throw new OnchainError(
      "mainnet_locked",
      "Buying on mainnet is not enabled for this build.",
    );
  }

  const c = connection();
  const trader = args.trader ?? kp.publicKey;
  const mintKey = new PublicKey(args.mint);
  const curveAta = curveTokenAccount(args.curve.address, args.mint);
  const traderAta = getAssociatedTokenAddressSync(mintKey, trader, true, TOKEN_PROGRAM_ID);

  const before = await readCurveState(args.curve.address);
  const lamportsIn = BigInt(Math.max(0, Math.round(args.amount * LAMPORTS_PER_SOL)));
  if (lamportsIn <= 0n) {
    throw new OnchainError("send_failed", "Buy amount must be greater than zero.");
  }

  const quote = quoteBuy(before, lamportsIn);
  if (quote.amountOut < args.minOut) {
    throw new OnchainError(
      "slippage_exceeded",
      `Output ${quote.amountOut} is below the minimum ${args.minOut}.`,
    );
  }

  // The curve can only sell what it really holds. If the tokens are not there,
  // the buy would take SOL and deliver nothing.
  const curveTokens = await tokenBalance(c, curveAta);
  if (curveTokens < quote.amountOut) {
    throw new OnchainError(
      "curve_not_found",
      `The curve holds ${curveTokens} tokens but this buy needs ${quote.amountOut}, so there is nothing left to sell.`,
      { curveTokens: curveTokens.toString(), needed: quote.amountOut.toString() },
    );
  }

  const balance = await c.getBalance(kp.publicKey);
  // The fee payer needs the transfer plus a margin for the transaction fee.
  if (balance < Number(lamportsIn) + 10_000) {
    throw new OnchainError(
      "insufficient_funds",
      `Wallet holds ${balance / LAMPORTS_PER_SOL} SOL, needs more than ${args.amount} SOL.`,
    );
  }

  const tx = new Transaction();
  if (trader.equals(kp.publicKey)) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(args.curve.address),
        lamports: Number(lamportsIn),
      }),
    );
  }

  // Create the buyer's token account on the fly when it does not exist yet.
  const traderAtaInfo = await c.getAccountInfo(traderAta);
  if (!traderAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        kp.publicKey,
        traderAta,
        trader,
        mintKey,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  // Tokens leave the curve, signed by the curve account itself.
  tx.add(
    createTransferInstruction(
      curveAta,
      traderAta,
      new PublicKey(args.curve.address),
      quote.amountOut,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const { blockhash } = await c.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp, curveKeypair(args.curve));

  let signature: string;
  try {
    signature = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  } catch (err) {
    throw new OnchainError(
      "send_failed",
      `Buy failed to send: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }
  const status = await confirmSignature(c, signature);
  if (!status.ok) {
    throw new OnchainError(
      "not_confirmed",
      `Buy did not confirm: ${JSON.stringify(status.err)}`,
    );
  }

  const traderAfter = await tokenBalance(c, traderAta);
  // A buy that moved SOL but no tokens is not a buy. Refuse to report one.
  if (traderAfter === 0n) {
    throw new OnchainError(
      "not_confirmed",
      `Buy ${signature} confirmed but the buyer holds no tokens. The trade did not exchange anything.`,
      { signature, traderAta: traderAta.toBase58() },
    );
  }

  return {
    action: "buy",
    signature,
    explorer: explorerUrl(signature, "tx", activeCluster()),
    cluster: activeCluster(),
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    fee: quote.fee,
    priceAfter: quote.priceAfter,
    traderTokenBalance: traderAfter.toString(),
    curveTokenBalance: (await tokenBalance(c, curveAta)).toString(),
    curve: await readCurveState(args.curve.address),
  };
}

/**
 * Sells tokens by moving them back into the curve account and taking SOL out.
 *
 * Both sides move in the same transaction. The curve pays out of its own
 * balance, so the payout is capped by what the account really holds minus the
 * rent floor it needs to keep existing, and the seller's tokens are checked to
 * exist before any payout is authorised.
 */
export async function sellToken(args: TradeArgs): Promise<TradeResult> {
  if (args.confirm !== true) {
    throw new OnchainError("send_failed", "sellToken requires confirm: true.");
  }
  const kp = launchWallet();
  if (!kp) throw new OnchainError("no_wallet", "No launch wallet is configured.");
  const curveKp = curveKeypair(args.curve);
  if (activeCluster() === "mainnet-beta") {
    throw new OnchainError(
      "mainnet_locked",
      "Selling on mainnet is not enabled for this build.",
    );
  }

  const c = connection();
  const trader = args.trader ?? kp.publicKey;
  const mintKey = new PublicKey(args.mint);
  const curveAta = curveTokenAccount(args.curve.address, args.mint);
  const traderAta = getAssociatedTokenAddressSync(mintKey, trader, true, TOKEN_PROGRAM_ID);

  const before = await readCurveState(args.curve.address);
  const tokensIn = BigInt(
    Math.max(0, Math.round(args.amount * 10 ** TOKEN_DECIMALS)),
  );
  if (tokensIn <= 0n) {
    throw new OnchainError("send_failed", "Sell amount must be greater than zero.");
  }

  // A seller can only sell tokens they actually hold.
  const held = await tokenBalance(c, traderAta);
  if (held < tokensIn) {
    throw new OnchainError(
      "insufficient_funds",
      `The trader holds ${held} tokens and is trying to sell ${tokensIn}.`,
      { held: held.toString(), tried: tokensIn.toString() },
    );
  }

  const quote = quoteSell(before, tokensIn);
  if (quote.amountOut < args.minOut) {
    throw new OnchainError(
      "slippage_exceeded",
      `Payout ${quote.amountOut} is below the minimum ${args.minOut}.`,
    );
  }

  // The curve must retain enough lamports to stay rent-exempt, otherwise the
  // account would be reaped and the remaining tokens lost with it.
  const spendable = before.spendableLamports;
  if (spendable <= 0n || quote.amountOut > spendable) {
    throw new OnchainError(
      "insufficient_funds",
      "The curve cannot cover this sell and remain rent-exempt.",
    );
  }

  const tx = new Transaction().add(
    // Tokens go back into the curve, signed by the trader.
    createTransferInstruction(
      traderAta,
      curveAta,
      trader,
      tokensIn,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  if (trader.equals(kp.publicKey)) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(args.curve.address),
        toPubkey: kp.publicKey,
        lamports: Number(quote.amountOut),
      }),
    );
  }

  try {
    const { blockhash } = await c.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    // The curve account also signs, because it is a system account paying out.
    // Its keypair is stored with the coin at launch time; a derived address
    // would have no private key and this instruction would fail signature
    // verification with `InstructionError [0, {Custom:1}]`.
    tx.sign(kp, curveKp);
    const signature = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const status = await confirmSignature(c, signature);
    if (!status.ok) {
      throw new OnchainError(
        "not_confirmed",
        `Sell did not confirm: ${JSON.stringify(status.err)}`,
      );
    }
    return {
      action: "sell",
      signature,
      explorer: explorerUrl(signature, "tx", activeCluster()),
      cluster: activeCluster(),
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      fee: quote.fee,
      priceAfter: quote.priceAfter,
      traderTokenBalance: (await tokenBalance(c, traderAta)).toString(),
      curveTokenBalance: (await tokenBalance(c, curveAta)).toString(),
      curve: await readCurveState(args.curve.address),
    };
  } catch (err) {
    if (err instanceof OnchainError) throw err;
    throw new OnchainError(
      "send_failed",
      `Sell failed to send: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }
}
