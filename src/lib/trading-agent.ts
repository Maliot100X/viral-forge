// ---------------------------------------------------------------------------
// Trading agents.
//
// An agent here is a persistent instruction plus a budget, not a bot with a
// key. It cannot sign anything. Every action it takes goes through
// `decideTrade()` below and then out through the same `/api/trade` gates a
// human uses — the quote is read from the curve, the slippage floor is enforced
// server-side, and the transaction is still signed by the curve and the launch
// wallet exactly as it is for a manual trade.
//
// That constraint is the design, not a limitation to work around. Solana skill
// guardrail W009 says never sign without explicit approval; the way to honour it
// for an autonomous agent is to give the agent no signing path at all and let it
// only *propose* trades that flow through the one gated route.
//
// The brain picks the action. When the brain is unavailable the agent falls
// back to a deterministic rule over the real curve state, and the resulting
// decision is labelled `provenance: "local"` rather than pretending a model
// reasoned about it.
// ---------------------------------------------------------------------------

import { chatJSON, brainAvailable, brainModel, type BrainMessage } from "./brain";
import {
  formatPrice,
  quoteBuy,
  quoteSell,
  spotPriceScaled,
} from "./curve";
import type { CurveAccountState } from "./onchain";

export type TradeAction = "buy" | "sell" | "hold";

/** Where a decision came from. Shown in the UI so a rule is never read as AI. */
export type DecisionProvenance = "river" | "local";

export interface AgentStrategy {
  /** The instruction, in the user's words. */
  prompt: string;
  /** Maximum SOL the agent may have committed at any time. */
  budgetSol: number;
  /** Never trade more than this in a single action. */
  maxTradeSol: number;
  /** Slippage tolerance in basis points. */
  slippageBps: number;
  /**
   * Optional per-agent API key. When present it overrides the server's brain
   * key for this agent's calls, so an agent can run on the owner's own quota.
   */
  apiKey?: string;
}

export const DEFAULT_STRATEGY: Omit<AgentStrategy, "prompt"> = {
  budgetSol: 0.25,
  maxTradeSol: 0.05,
  slippageBps: 300,
};

export function strategyFor(
  prompt: string,
  partial: Partial<Omit<AgentStrategy, "prompt">> = {},
): AgentStrategy {
  return {
    prompt,
    budgetSol: clamp(partial.budgetSol ?? DEFAULT_STRATEGY.budgetSol, 0.001, 100),
    maxTradeSol: clamp(partial.maxTradeSol ?? DEFAULT_STRATEGY.maxTradeSol, 0.001, 100),
    slippageBps: Math.round(clamp(partial.slippageBps ?? DEFAULT_STRATEGY.slippageBps, 1, 5_000)),
    ...(partial.apiKey ? { apiKey: partial.apiKey } : {}),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export interface AgentDecision {
  action: TradeAction;
  /** SOL for a buy; tokens for a sell. Zero on a hold. */
  amount: number;
  /** One sentence explaining the decision, shown in the agent log. */
  reason: string;
  provenance: DecisionProvenance;
  /** The model that produced it, when one did. */
  model?: string;
}

export interface DecideContext {
  ticker: string;
  mint: string;
  curve: CurveAccountState;
  strategy: AgentStrategy;
  /** SOL the agent has already spent. Used to enforce the budget. */
  spentSol: number;
  /** Tokens the agent is holding right now, read from chain. */
  heldTokens: bigint;
  /** Recent fills, newest first, for context. */
  recent?: Array<{ action: string; amount: string; at: string }>;
}

/**
 * What the agent may do given its budget and holdings.
 *
 * This is computed before the brain is asked, and the brain's answer is
 * validated against it. A model cannot talk the agent past its budget, sell
 * tokens it does not hold, or trade a coin with no curve.
 */
export function allowances(ctx: DecideContext): {
  canBuy: boolean;
  canSell: boolean;
  maxBuySol: number;
  maxSellTokens: number;
  remainingSol: number;
} {
  const remainingSol = Math.max(0, ctx.strategy.budgetSol - ctx.spentSol);
  const onChain = ctx.curve.exists;
  const maxBuySol = Math.max(0, Math.min(ctx.strategy.maxTradeSol, remainingSol));
  return {
    // A curve that does not exist, or holds no tokens, cannot sell to a buyer.
    canBuy: onChain && ctx.curve.tokenReserve > 0n && maxBuySol >= 0.001,
    canSell: onChain && ctx.heldTokens > 0n,
    maxBuySol,
    maxSellTokens: Number(ctx.heldTokens) / 1e9,
    remainingSol,
  };
}

/**
 * Deterministic fallback: a light mean-reversion rule over the real curve.
 * Buys while the curve is small, sells into strength, holds otherwise.
 */
export function localDecision(ctx: DecideContext): AgentDecision {
  const a = allowances(ctx);
  const progress =
    Number(ctx.curve.realSolReserve) / 1e9 / (Number(ctx.curve.realSolReserve) / 1e9 + 30);

  if (a.canSell && progress > 0.15) {
    return {
      action: "sell",
      amount: Math.round(a.maxSellTokens * 25) / 100,
      reason: `Reserve is up to ${(Number(ctx.curve.realSolReserve) / 1e9).toFixed(3)} SOL; taking 25% off.`,
      provenance: "local",
    };
  }
  if (a.canBuy) {
    const size = Math.round(Math.min(a.maxBuySol, 0.02) * 1e6) / 1e6;
    if (size >= 0.001) {
      return {
        action: "buy",
        amount: size,
        reason: `Curve is early at ${(progress * 100).toFixed(1)}% — buying ${size} SOL.`,
        provenance: "local",
      };
    }
  }
  return {
    action: "hold",
    amount: 0,
    reason: a.remainingSol < 0.001 ? "Budget spent." : "Nothing worth doing right now.",
    provenance: "local",
  };
}

const SYSTEM = `You are an autonomous trading agent for a Solana devnet memecoin launchpad.

You are given the live on-chain state of one bonding curve and your constraints.
Reply with JSON only:

{"action":"buy"|"sell"|"hold","amount":<number>,"reason":"<one sentence>"}

Rules you must not break:
- "buy"  — amount is SOL to spend. It MUST be <= maxBuySol.
- "sell" — amount is tokens to sell. It MUST be <= maxSellTokens.
- "hold" — amount is 0. Use this when nothing is attractive.
- This is devnet with play SOL. Be decisive but never exceed a limit.
- "reason" is one short sentence, under 140 characters, no numbers that you
  invented — only numbers from the state you were given.`;

function stateSummary(ctx: DecideContext): string {
  const a = allowances(ctx);
  const reserveSol = Number(ctx.curve.realSolReserve) / 1e9;
  const price = formatPrice(spotPriceScaled(ctx.curve), 12);
  const recent = (ctx.recent ?? [])
    .slice(0, 5)
    .map((r) => `${r.action} ${r.amount}`)
    .join(", ");

  return [
    `coin: ${ctx.ticker} (${ctx.mint})`,
    `strategy: ${ctx.strategy.prompt}`,
    `curve reserve: ${reserveSol} SOL`,
    `curve tokens remaining: ${ctx.curve.tokenReserve.toString()}`,
    `spot price: ${price}`,
    `you hold: ${a.maxSellTokens} tokens`,
    `budget: ${ctx.strategy.budgetSol} SOL, spent ${ctx.spentSol} SOL, remaining ${a.remainingSol} SOL`,
    `maxBuySol: ${a.maxBuySol}`,
    `maxSellTokens: ${a.maxSellTokens}`,
    `can buy: ${a.canBuy}, can sell: ${a.canSell}`,
    recent ? `recent fills: ${recent}` : "recent fills: none",
  ].join("\n");
}

/**
 * Asks the brain what to do, then forces the answer inside the allowances.
 *
 * The clamping is not a nicety: a model that returns `amount: 50` on a 0.05 SOL
 * budget would otherwise authorise a real 50 SOL transfer. Every field is
 * checked, and anything invalid degrades to the local rule.
 */
export async function decideTrade(ctx: DecideContext): Promise<AgentDecision> {
  const a = allowances(ctx);

  // A per-agent key wins over the server key, so an owner can run on their own
  // quota without it being shared.
  const keyed = Boolean(ctx.strategy.apiKey) || brainAvailable();
  if (!keyed) return localDecision(ctx);

  // With a per-agent key we cannot use the shared brain client (it reads the
  // server env), so that path calls the model directly below.
  const messages: BrainMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: stateSummary(ctx) },
  ];

  let raw: Record<string, unknown> | null = null;
  let model: string | undefined;

  if (ctx.strategy.apiKey) {
    raw = await callWithKey(messages, ctx.strategy.apiKey);
    model = brainModel();
  } else {
    raw = await chatJSON<Record<string, unknown>>(
      messages,
      (v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null),
      { maxTokens: 200, temperature: 0.5, timeoutMs: 20_000, retries: 1 },
    );
    model = brainModel();
  }

  if (!raw || typeof raw.action !== "string") return localDecision(ctx);

  const action = raw.action as TradeAction;
  const reason =
    typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim().slice(0, 200)
      : "No reason given.";

  if (action === "hold") {
    return { action: "hold", amount: 0, reason, provenance: "river", model };
  }

  const amount = typeof raw.amount === "number" ? raw.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return localDecision(ctx);

  if (action === "buy") {
    if (!a.canBuy) return localDecision(ctx);
    // Hard ceiling, applied after the model, before anything is signed.
    const capped = Math.min(amount, a.maxBuySol);
    if (capped < 0.001) return localDecision(ctx);
    return { action: "buy", amount: capped, reason, provenance: "river", model };
  }

  if (action === "sell") {
    if (!a.canSell) return localDecision(ctx);
    const capped = Math.min(amount, a.maxSellTokens);
    if (capped <= 0) return localDecision(ctx);
    return { action: "sell", amount: capped, reason, provenance: "river", model };
  }

  return localDecision(ctx);
}

/**
 * Brain call with an explicit key.
 *
 * Deliberately a small duplicate of the brain client's request rather than a
 * change to it: `brain.ts` reads `process.env.RIVER_API_KEY` at call time and
 * keeps its model chain, retries, and JSON extraction. Threading an optional
 * key through all of that would touch the forge path, which has no need for it.
 */
async function callWithKey(
  messages: BrainMessage[],
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("https://api.river.ai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: brainModel(),
        max_tokens: 200,
        temperature: 0.5,
        messages,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * What a decision would actually do, quoted from the real curve.
 *
 * Returned so the caller can show the expected fill and the slippage floor
 * before the trade is sent, exactly as the manual trade panel does. A decision
 * that cannot be quoted is not executable.
 */
export interface AgentQuote {
  action: "buy" | "sell";
  /** Human units — SOL for a buy, tokens for a sell. */
  humanAmount: number;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  fee: bigint;
  priceAfter: bigint;
}

export function quoteDecision(
  decision: AgentDecision,
  curve: CurveAccountState,
  slippageBps: number = DEFAULT_STRATEGY.slippageBps,
): AgentQuote | null {
  if (decision.action === "hold" || decision.amount <= 0) return null;
  // The agent's tolerated slippage is what the floor is built from, not a global
  // constant — otherwise a strategy that asked for 5% is filled as if it asked
  // for 3%, and vice versa.
  const keep = BigInt(10_000 - slippageBps);
  try {
    if (decision.action === "buy") {
      const lamports = BigInt(Math.round(decision.amount * 1e9));
      const q = quoteBuy(curve, lamports);
      return {
        action: "buy",
        /** Human units, ready to hand to buyToken/sellToken. */
        humanAmount: decision.amount,
        amountIn: q.amountIn,
        amountOut: q.amountOut,
        minOut: (q.amountOut * keep) / 10_000n,
        fee: q.fee,
        priceAfter: q.priceAfter,
      };
    }
    const atoms = BigInt(Math.round(decision.amount * 1e9));
    const q = quoteSell(curve, atoms);
    return {
      action: "sell",
      humanAmount: decision.amount,
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      minOut: (q.amountOut * keep) / 10_000n,
      fee: q.fee,
      priceAfter: q.priceAfter,
    };
  } catch {
    return null;
  }
}
