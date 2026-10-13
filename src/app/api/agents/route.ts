import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OnchainError,
  TOKEN_PROGRAM_ID,
  buyToken,
  readCurveState,
  sellToken,
  tokenBalance,
  type CurveAccount,
} from "@/lib/onchain";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { activeCluster, connection, launchWallet } from "@/lib/solana";
import { formatPrice, spotPriceScaled } from "@/lib/curve";
import { generateCoinId } from "@/lib/ids";
import {
  addAgent,
  getAgent,
  getCoin,
  getCurveSecret,
  listAgentRuns,
  listAgents,
  publicAgent,
  recordAgentRun,
  recordTrade,
  setAgentStatus,
} from "@/lib/store";
import {
  allowances,
  decideTrade,
  quoteDecision,
  strategyFor,
  type AgentStrategy,
} from "@/lib/trading-agent";

// Autonomous trading agents.
//
// An agent is a *strategy row plus a decision loop*. It is not a key holder: the
// only signer in this project is the launch wallet, and an agent reaches it the
// same way a human click does — by asking this route to execute a trade it has
// already priced against the live reserve. There is deliberately no path here
// that signs without `confirm`, and no path that lets a model choose an amount
// outside the strategy's budget (see `allowances` in lib/trading-agent).
//
// GET  /api/agents                  — list agents, keys stripped
// GET  /api/agents?id=<id>          — one agent plus its run log
// POST /api/agents                  — create  ({ action: "create" })
// POST /api/agents                  — decide  ({ action: "run", id, confirm })

const CreateBody = z.object({
  action: z.literal("create"),
  name: z.string().min(1).max(60),
  mint: z.string().min(32).max(44),
  prompt: z.string().max(2000).optional().default(""),
  budgetSol: z.number().positive().max(100).optional(),
  maxTradeSol: z.number().positive().max(100).optional(),
  slippageBps: z.number().int().min(1).max(5_000).optional(),
  /** Optional per-agent brain key. Stored, never returned. */
  apiKey: z.string().min(8).max(200).optional(),
});

const RunBody = z.object({
  action: z.literal("run"),
  id: z.string().min(1),
  /**
   * Without this the agent still decides and the decision is recorded, but
   * nothing is signed. The 428 response is the quote to approve.
   */
  confirm: z.boolean().optional().default(false),
});

const Body = z.discriminatedUnion("action", [CreateBody, RunBody]);

// POST here can submit a real devnet transaction, so nothing about this route
// may be cached. `dynamic` is illegal under `cacheComponents`; a request-time
// read of the store is what actually keeps it uncached.
export const instant = false;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    const agents = await listAgents(url.searchParams.get("mint") ?? undefined);
    return NextResponse.json({
      agents: agents.map(publicAgent),
      cluster: activeCluster(),
    });
  }

  const agent = await getAgent(id);
  if (!agent) {
    return NextResponse.json(
      { error: "not_found", detail: `No agent with id ${id}.` },
      { status: 404 },
    );
  }
  const [runs, coin] = await Promise.all([listAgentRuns(id, 40), getCoin(agent.mint)]);

  return NextResponse.json({
    agent: publicAgent(agent),
    symbol: coin?.symbol ?? null,
    name: coin?.name ?? null,
    cluster: activeCluster(),
    runs,
  });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;

  return b.action === "create" ? create(b) : run(b);
}

async function create(b: z.infer<typeof CreateBody>) {
  const coin = await getCoin(b.mint);
  if (!coin) {
    return NextResponse.json(
      {
        error: "not_found",
        detail: `No coin recorded for ${b.mint}. An agent trades a coin launched here.`,
      },
      { status: 404 },
    );
  }
  if (!coin.curveAddress) {
    return NextResponse.json(
      {
        error: "curve_not_found",
        detail:
          `${coin.symbol || coin.name} has no trading curve, so an agent has nothing ` +
          "to trade against. Relaunch it to make it tradeable.",
      },
      { status: 409 },
    );
  }

  const partial: Partial<Omit<AgentStrategy, "prompt">> = {
    ...(b.budgetSol !== undefined ? { budgetSol: b.budgetSol } : {}),
    ...(b.maxTradeSol !== undefined ? { maxTradeSol: b.maxTradeSol } : {}),
    ...(b.slippageBps !== undefined ? { slippageBps: b.slippageBps } : {}),
  };
  // strategyFor clamps every number, so a client cannot post a 1000 SOL budget
  // against a 0.05 SOL reserve.
  const prompt =
    b.prompt.trim() ||
    "Trade this curve conservatively: accumulate while it is early, take profit into strength.";
  const strategy = strategyFor(prompt, partial);

  const agent = {
    id: "ag_" + generateCoinId().slice(2),
    name: b.name,
    mint: b.mint,
    prompt: strategy.prompt,
    budgetSol: strategy.budgetSol,
    maxTradeSol: strategy.maxTradeSol,
    slippageBps: strategy.slippageBps,
    apiKey: b.apiKey ?? null,
    status: "idle",
    spentSol: 0,
    realizedSol: 0,
    createdAt: new Date().toISOString(),
  };

  await addAgent(agent);

  return NextResponse.json(
    { ok: true, agent: publicAgent(agent), symbol: coin.symbol, cluster: activeCluster() },
    { status: 201 },
  );
}

async function run(b: z.infer<typeof RunBody>) {
  const agent = await getAgent(b.id);
  if (!agent) {
    return NextResponse.json(
      { error: "not_found", detail: `No agent with id ${b.id}.` },
      { status: 404 },
    );
  }

  const coin = await getCoin(agent.mint);
  if (!coin) {
    return NextResponse.json(
      { error: "not_found", detail: `No coin recorded for ${agent.mint}.` },
      { status: 404 },
    );
  }
  if (!coin.curveAddress) {
    return NextResponse.json(
      { error: "curve_not_found", detail: `${coin.symbol} has no trading curve.` },
      { status: 409 },
    );
  }
  const secret = await getCurveSecret(agent.mint);
  if (!secret) {
    return NextResponse.json(
      {
        error: "curve_not_found",
        detail: "The curve keypair for this coin is missing from the database.",
      },
      { status: 500 },
    );
  }
  const curveAccount: CurveAccount = { address: coin.curveAddress, secret };

  // The decision is made against the live reserve, never against a stored
  // number, so an agent cannot act on a price that no longer exists.
  let curve;
  try {
    curve = await readCurveState(curveAccount.address);
  } catch (err) {
    return NextResponse.json(
      {
        error: "rpc_failed",
        detail: err instanceof Error ? err.message : "Could not read the curve.",
      },
      { status: 502 },
    );
  }

  const strategy: AgentStrategy = {
    prompt: agent.prompt,
    budgetSol: agent.budgetSol,
    maxTradeSol: agent.maxTradeSol,
    slippageBps: agent.slippageBps,
    apiKey: agent.apiKey ?? undefined,
  };

  // What the signing wallet actually holds, read from chain. Passing a zero here
  // would make `allowances` refuse every sell, so an agent could only ever buy
  // and never take profit — a strategy that silently cannot exit. A failed read
  // is not turned into a confident zero either; see the `heldTokensRead` flag
  // carried into the decision context.
  let heldTokens = 0n;
  let heldTokensRead = false;
  try {
    const kp = launchWallet();
    if (!kp) throw new Error("no_wallet");
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(agent.mint),
      kp.publicKey,
      true,
      TOKEN_PROGRAM_ID,
    );
    heldTokens = await tokenBalance(connection(), ata);
    heldTokensRead = true;
  } catch {
    heldTokens = 0n;
    heldTokensRead = false;
  }

  const ctxBase = {
    ticker: coin.symbol,
    mint: agent.mint,
    curve,
    strategy,
    spentSol: agent.spentSol,
    heldTokens,
  } as const;

  const decision = await decideTrade(ctxBase);

  // A hold, or a decision the strategy does not allow, ends here. It is still
  // recorded — an agent that never acts is still something the owner needs to
  // see, and silently doing nothing would look like the button was broken.
  if (decision.action === "hold") {
    await recordAgentRun({
      agentId: agent.id,
      mint: agent.mint,
      action: "hold",
      amount: 0,
      reason: decision.reason,
      provenance: decision.provenance,
      model: decision.model ?? null,
      signature: null,
      explorer: null,
      error: null,
    });
    return NextResponse.json({
      ok: true,
      traded: false,
      action: "hold",
      reason: decision.reason,
      provenance: decision.provenance,
      model: decision.model ?? null,
      run: { spentSol: agent.spentSol, budgetSol: agent.budgetSol },
      cluster: activeCluster(),
    });
  }

  const quote = quoteDecision(decision, curve, agent.slippageBps);
  if (!quote) {
    await recordAgentRun({
      agentId: agent.id,
      mint: agent.mint,
      action: decision.action,
      amount: decision.amount,
      reason: decision.reason,
      provenance: decision.provenance,
      model: decision.model ?? null,
      signature: null,
      explorer: null,
      error: "no_quote",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "no_quote",
        detail: "The reserve could not fill that trade. Nothing was signed.",
      },
      { status: 409 },
    );
  }

  // Same gate as /api/trade: a real transaction on devnet is not submitted until
  // the caller has been shown the numbers and has said confirm.
  if (!b.confirm) {
    return NextResponse.json(
      {
        ok: true,
        traded: false,
        action: decision.action,
        error: "confirmation_required",
        detail:
          `This agent wants to ${decision.action} on ${activeCluster()}. ` +
          "Show the quote and resend with confirm:true to submit it.",
        reason: decision.reason,
        provenance: decision.provenance,
        model: decision.model ?? null,
        summary: {
          mint: agent.mint,
          symbol: coin.symbol,
          cluster: activeCluster(),
          curveAddress: curveAccount.address,
          reserveSol: Number(curve.realSolReserve) / 1e9,
          amountIn: quote.amountIn.toString(),
          expectedOut: quote.amountOut.toString(),
          minOut: quote.minOut.toString(),
          fee: quote.fee.toString(),
          slippageBps: agent.slippageBps,
          price: formatPrice(spotPriceScaled(curve), 12),
          priceAfter: formatPrice(quote.priceAfter, 12),
        },
      },
      { status: 428 },
    );
  }

  await setAgentStatus(agent.id, "running");

  try {
    const result =
      decision.action === "buy"
        ? await buyToken({
            curve: curveAccount,
            mint: agent.mint,
            amount: quote.humanAmount,
            minOut: quote.minOut,
            confirm: true,
          })
        : await sellToken({
            curve: curveAccount,
            mint: agent.mint,
            amount: quote.humanAmount,
            minOut: quote.minOut,
            confirm: true,
          });

    await recordTrade({
      mint: agent.mint,
      action: decision.action,
      signature: result.signature,
      wallet: `agent:${agent.id}`,
      solLamports:
        decision.action === "buy"
          ? result.amountIn.toString()
          : result.amountOut.toString(),
      tokenAtoms:
        decision.action === "buy"
          ? result.amountOut.toString()
          : result.amountIn.toString(),
      feeLamports: result.fee.toString(),
      priceScaled: result.priceAfter.toString(),
      cluster: result.cluster,
    });

    await recordAgentRun({
      agentId: agent.id,
      mint: agent.mint,
      action: decision.action,
      amount: decision.amount,
      reason: decision.reason,
      provenance: decision.provenance,
      model: decision.model ?? null,
      signature: result.signature,
      explorer: result.explorer,
      error: null,
    });
    await setAgentStatus(agent.id, "idle");

    // Report the budget from the state AFTER the fill. Reading `allowances` off
    // the pre-trade `ctxBase` reported a `remainingSol` that had not been
    // debited, so it disagreed with the `spentSol` sitting next to it in the
    // same object — a UI showing 0.2 remaining on a 0.2 budget just after a
    // 0.05 fill. `recordAgentRun` already moved the ledger, so re-derive.
    const spentAfter =
      agent.spentSol + (decision.action === "buy" ? decision.amount : 0);
    const budgetAfter = allowances({ ...ctxBase, spentSol: spentAfter });

    return NextResponse.json(
      {
        ok: true,
        traded: true,
        action: decision.action,
        reason: decision.reason,
        provenance: decision.provenance,
        model: decision.model ?? null,
        signature: result.signature,
        explorerUrl: result.explorer,
        cluster: result.cluster,
        amountIn: result.amountIn.toString(),
        amountOut: result.amountOut.toString(),
        fee: result.fee.toString(),
        price: formatPrice(spotPriceScaled(result.curve), 12),
        priceAfter: formatPrice(result.priceAfter, 12),
        reserveSol: Number(result.curve.realSolReserve) / 1e9,
        traderTokenBalance: result.traderTokenBalance,
        budget: {
          spentSol: spentAfter,
          budgetSol: agent.budgetSol,
          remainingSol: budgetAfter.remainingSol,
        },
        /** False when the wallet's balance could not be read, so a hold on a
         *  failed read is not reported as a strategy that chose to sit out. */
        holdingsRead: heldTokensRead,
        heldTokens: heldTokens.toString(),
      },
      { status: 201 },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown_error";
    await recordAgentRun({
      agentId: agent.id,
      mint: agent.mint,
      action: decision.action,
      amount: decision.amount,
      reason: decision.reason,
      provenance: decision.provenance,
      model: decision.model ?? null,
      signature: null,
      explorer: null,
      error: err instanceof OnchainError ? err.code : detail,
    });
    await setAgentStatus(agent.id, "idle");

    if (err instanceof OnchainError) {
      const status =
        err.code === "insufficient_funds" ||
        err.code === "slippage_exceeded" ||
        err.code === "curve_not_found" ||
        err.code === "no_wallet"
          ? 409
          : 502;
      return NextResponse.json({ error: err.code, detail: err.message }, { status });
    }
    return NextResponse.json({ error: "send_failed", detail }, { status: 502 });
  }
}
