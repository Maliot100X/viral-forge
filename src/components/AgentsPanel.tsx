"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "./Toasts";

/**
 * AgentsPanel — create and run trading agents against a real bonding curve.
 *
 * The important honesty property is in the two-phase run: pressing "run" does
 * not trade. It asks the agent what it wants to do, the server prices that
 * against the live reserve, and the result is shown as a quote. Only pressing
 * "confirm" submits a transaction. An agent here is never a key holder; it is a
 * strategy that proposes, and a human approves.
 */

interface Agent {
  id: string;
  name: string;
  mint: string;
  prompt: string;
  budgetSol: number;
  maxTradeSol: number;
  slippageBps: number;
  status: string;
  spentSol: number;
  realizedSol: number;
  createdAt: string;
  hasApiKey: boolean;
}

interface TradeableCoin {
  mint: string;
  symbol: string;
  name: string;
}

interface Quote {
  mint: string;
  symbol: string;
  cluster: string;
  curveAddress: string;
  reserveSol: number;
  amountIn: string;
  expectedOut: string;
  minOut: string;
  fee: string;
  slippageBps: number;
  price: string;
  priceAfter: string;
}

interface RunOutcome {
  action: "buy" | "sell" | "hold";
  reason: string;
  provenance: string;
  model: string | null;
  signature?: string;
  explorerUrl?: string;
  cluster?: string;
  reserveSol?: number;
  priceAfter?: string;
  holdingsRead?: boolean;
  heldTokens?: string;
}

interface AgentRun {
  id: string | number;
  action: string;
  amount: number;
  reason: string;
  provenance: string;
  model: string | null;
  signature: string | null;
  explorer: string | null;
  error: string | null;
  createdAt: string;
}

const BUDGETS = [0.1, 0.25, 0.5, 1];
const PER_TRADE = [0.02, 0.05, 0.1, 0.25];

function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function atoms(atomsStr: string | undefined, decimals = 9): number {
  if (!atomsStr) return 0;
  try {
    return Number(BigInt(atomsStr)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

function short(sig: string): string {
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}

export default function AgentsPanel({
  coins,
  initialAgents,
  cluster,
}: {
  /** Coins that actually have a curve, so an agent has something to trade. */
  coins: TradeableCoin[];
  initialAgents: Agent[];
  cluster: string;
}) {
  const { push } = useToast();

  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [name, setName] = useState("");
  const [mint, setMint] = useState(coins[0]?.mint ?? "");
  const [prompt, setPrompt] = useState("");
  const [budgetSol, setBudgetSol] = useState(0.25);
  const [maxTradeSol, setMaxTradeSol] = useState(0.05);
  const [slippageBps, setSlippageBps] = useState(300);
  const [apiKey, setApiKey] = useState("");
  const [creating, setCreating] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [quoteFor, setQuoteFor] = useState<{ agent: Agent; quote: Quote; action: string; reason: string; provenance: string } | null>(null);
  const [outcome, setOutcome] = useState<{ agentId: string; result: RunOutcome } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, AgentRun[]>>({});

  // The create form's `mint` must follow the coin list if it arrives empty.
  const mintInit = useRef(false);
  useEffect(() => {
    if (!mintInit.current && !mint && coins[0]?.mint) {
      mintInit.current = true;
      const t = setTimeout(() => setMint(coins[0].mint), 0);
      return () => clearTimeout(t);
    }
  }, [coins, mint]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const data = (await res.json()) as { agents: Agent[] };
      setAgents(data.agents);
    } catch {
      /* list stays as it was */
    }
  }, []);

  const loadRuns = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agents?id=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { runs: AgentRun[] };
      setRuns((r) => ({ ...r, [id]: data.runs }));
    } catch {
      /* leave the previous log in place */
    }
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim() || "unnamed agent",
          mint,
          prompt,
          budgetSol,
          maxTradeSol,
          slippageBps,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((data.detail as string) || (data.error as string) || `HTTP ${res.status}`);
        return;
      }
      push(`Agent created · ${(data.agent as Agent).name}`, "ok");
      setName("");
      setPrompt("");
      setApiKey("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setCreating(false);
    }
  }, [apiKey, budgetSol, maxTradeSol, mint, name, prompt, push, refresh, slippageBps]);

  const run = useCallback(
    async (agent: Agent, confirm: boolean) => {
      setBusyId(agent.id);
      setError(null);
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "run", id: agent.id, confirm }),
        });
        const data = (await res.json()) as Record<string, unknown>;

        if (res.status === 428) {
          setQuoteFor({
            agent,
            quote: data.summary as Quote,
            action: String(data.action),
            reason: String(data.reason ?? ""),
            provenance: String(data.provenance ?? "local"),
          });
          push(`${agent.name} wants to ${String(data.action)}`, "info");
          return;
        }

        if (!res.ok) {
          setError((data.detail as string) || (data.error as string) || `HTTP ${res.status}`);
          await loadRuns(agent.id);
          return;
        }

        setQuoteFor(null);
        const result: RunOutcome = {
          action: (data.action as RunOutcome["action"]) ?? "hold",
          reason: String(data.reason ?? ""),
          provenance: String(data.provenance ?? "local"),
          model: (data.model as string | null) ?? null,
          signature: data.signature as string | undefined,
          explorerUrl: data.explorerUrl as string | undefined,
          cluster: data.cluster as string | undefined,
          reserveSol: data.reserveSol as number | undefined,
          priceAfter: data.priceAfter as string | undefined,
          holdingsRead: data.holdingsRead as boolean | undefined,
          heldTokens: data.heldTokens as string | undefined,
        };
        setOutcome({ agentId: agent.id, result });

        if (result.signature) {
          push(`${result.action} filled · ${short(result.signature)}`, "ok");
        } else if (result.action === "hold") {
          push(`${agent.name} held: ${result.reason}`, "info");
        }

        await refresh();
        await loadRuns(agent.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "request failed");
      } finally {
        setBusyId(null);
      }
    },
    [loadRuns, push, refresh],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      {/* ---------------- create ---------------- */}
      <div className="card h-fit p-5">
        <p className="label mb-3">new agent · {cluster}</p>

        {coins.length === 0 ? (
          <p className="mono text-xs text-fg-dim">
            No coin has a trading curve yet, so there is nothing for an agent to trade. Launch a
            coin first — an agent can only trade a curve that exists.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="label">name</span>
              <input
                className="input mt-1"
                value={name}
                maxLength={60}
                placeholder="devnet scalper"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="mt-3 block">
              <span className="label">coin to trade</span>
              <select className="select mt-1" value={mint} onChange={(e) => setMint(e.target.value)}>
                {coins.map((c) => (
                  <option key={c.mint} value={c.mint}>
                    ${c.symbol} — {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="label">strategy prompt</span>
              <textarea
                className="textarea mt-1"
                rows={3}
                maxLength={2000}
                value={prompt}
                placeholder="Accumulate while the curve is under 30% bonded, then take profit in thirds."
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>

            <div className="mt-3">
              <span className="label">budget (SOL)</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {BUDGETS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`tab ${budgetSol === b ? "tab-active" : ""}`}
                    onClick={() => setBudgetSol(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <span className="label">max per trade (SOL)</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PER_TRADE.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`tab ${maxTradeSol === b ? "tab-active" : ""}`}
                    onClick={() => setMaxTradeSol(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="label">slippage tolerance</span>
                <span className="mono text-[10px] text-fg-dim">{(slippageBps / 100).toFixed(2)}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={2000}
                step={10}
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
                className="mt-1 w-full accent-[var(--accent)]"
              />
            </div>

            <label className="mt-3 block">
              <span className="label">brain api key · optional</span>
              <input
                className="input mt-1"
                type="password"
                value={apiKey}
                placeholder="leave blank to use the site brain"
                onChange={(e) => setApiKey(e.target.value)}
              />
              <span className="mono mt-1 block text-[10px] text-fg-faint">
                Stored on the server and never returned by the API. Blank means the agent uses the
                site&apos;s own River key.
              </span>
            </label>

            <button
              type="button"
              className="btn btn-primary mt-4"
              disabled={creating || !mint}
              onClick={() => void create()}
            >
              {creating ? "creating…" : "create agent"}
            </button>
          </>
        )}

        {error && <p className="mono mt-3 text-[11px] text-[var(--danger)]">{error}</p>}
      </div>

      {/* ---------------- list ---------------- */}
      <div className="space-y-4">
        {agents.length === 0 && (
          <div className="card p-5">
            <p className="mono text-xs text-fg-dim">
              No agents yet. Create one on the left — it will trade the coin&apos;s real bonding
              curve, and nothing is signed until you confirm a quote.
            </p>
          </div>
        )}

        {agents.map((a) => {
          const coin = coins.find((c) => c.mint === a.mint);
          const busy = busyId === a.id;
          const remaining = Math.max(0, a.budgetSol - a.spentSol);
          return (
            <div key={a.id} className="card p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="mono text-sm text-fg">{a.name}</p>
                  <p className="mono text-[10px] text-fg-faint">
                    {coin ? `$${coin.symbol}` : short(a.mint)} ·{" "}
                    {a.hasApiKey ? "own brain key" : "site brain"} · {a.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void run(a, false)}
                  >
                    {busy ? "thinking…" : "run agent"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const next = openId === a.id ? null : a.id;
                      setOpenId(next);
                      if (next) void loadRuns(a.id);
                    }}
                  >
                    {openId === a.id ? "hide log" : "log"}
                  </button>
                </div>
              </div>

              <p className="mono mt-2 text-[11px] leading-relaxed text-fg-dim">{a.prompt}</p>

              <dl className="mono mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                <Stat k="budget" v={`${fmt(a.budgetSol, 2)} SOL`} />
                <Stat k="spent" v={`${fmt(a.spentSol, 4)} SOL`} />
                <Stat k="left" v={`${fmt(remaining, 4)} SOL`} />
                <Stat k="per trade" v={`${fmt(a.maxTradeSol, 3)} SOL`} />
              </dl>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                <Link href={`/coin/${a.mint}`} className="mono text-[11px] text-accent hover:underline">
                  open coin →
                </Link>
                <a
                  href={`/coin/${a.mint}`}
                  className="mono text-[11px] text-fg-faint hover:text-accent"
                >
                  id {a.id}
                </a>
              </div>

              {/* quote awaiting confirmation for this agent */}
              {quoteFor?.agent.id === a.id && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="label mb-2">
                    {quoteFor.agent.name} proposes to {quoteFor.action}
                  </p>
                  <dl className="mono space-y-1 text-[11px]">
                    <Row
                      k="you pay"
                      v={
                        quoteFor.action === "buy"
                          ? `${fmt(atoms(quoteFor.quote.amountIn), 9)} SOL`
                          : `${fmt(atoms(quoteFor.quote.amountIn), 4)} ${quoteFor.quote.symbol}`
                      }
                    />
                    <Row
                      k="you receive"
                      v={
                        quoteFor.action === "buy"
                          ? `${fmt(atoms(quoteFor.quote.expectedOut), 4)} ${quoteFor.quote.symbol}`
                          : `${fmt(atoms(quoteFor.quote.expectedOut), 6)} SOL`
                      }
                    />
                    <Row
                      k="minimum out"
                      v={
                        quoteFor.action === "buy"
                          ? `${fmt(atoms(quoteFor.quote.minOut), 4)} ${quoteFor.quote.symbol}`
                          : `${fmt(atoms(quoteFor.quote.minOut), 6)} SOL`
                      }
                    />
                    <Row k="fee" v={`${fmt(atoms(quoteFor.quote.fee), 6)} SOL`} />
                    <Row k="price now" v={quoteFor.quote.price} />
                    <Row k="price after" v={quoteFor.quote.priceAfter} />
                    <Row k="decision by" v={`${quoteFor.provenance}${quoteFor.reason ? ` · ${quoteFor.reason}` : ""}`} />
                  </dl>
                  <p className="mono mt-2 text-[10px] text-fg-faint">
                    This is a real transaction on {quoteFor.quote.cluster}. Nothing has been signed
                    yet.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void run(a, true)}
                    >
                      {busy ? "submitting…" : `confirm ${quoteFor.action}`}
                    </button>
                    <button type="button" className="btn" onClick={() => setQuoteFor(null)}>
                      cancel
                    </button>
                  </div>
                </div>
              )}

              {/* outcome of the last run for this agent */}
              {outcome?.agentId === a.id && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="label mb-2">
                    {outcome.result.signature ? "filled on chain" : "decision"}
                  </p>
                  <dl className="mono space-y-1 text-[11px]">
                    <Row k="action" v={outcome.result.action} />
                    <Row k="decided by" v={outcome.result.provenance} />
                    {outcome.result.model && <Row k="model" v={outcome.result.model} />}
                    <Row k="reason" v={outcome.result.reason || "—"} />
                    {outcome.result.holdingsRead === false && (
                      <Row k="holdings" v="not read — decision refused to assume zero" />
                    )}
                    {outcome.result.reserveSol !== undefined && (
                      <Row k="reserve" v={`${fmt(outcome.result.reserveSol, 4)} SOL`} />
                    )}
                    {outcome.result.priceAfter && <Row k="price after" v={outcome.result.priceAfter} />}
                  </dl>
                  {outcome.result.explorerUrl && (
                    <a
                      className="btn mt-3 inline-flex"
                      href={outcome.result.explorerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      view tx on explorer ↗
                    </a>
                  )}
                </div>
              )}

              {/* run log */}
              {openId === a.id && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="label mb-2">run log</p>
                  {(runs[a.id] ?? []).length === 0 ? (
                    <p className="mono text-[10px] text-fg-faint">No runs recorded yet.</p>
                  ) : (
                    <ul className="mono space-y-1.5 text-[10px]">
                      {(runs[a.id] ?? []).map((r) => (
                        <li key={String(r.id)} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-fg-faint">
                            {new Date(r.createdAt).toLocaleTimeString()}
                          </span>
                          <span className={r.action === "hold" ? "text-fg-dim" : "text-accent"}>
                            {r.action}
                          </span>
                          {r.amount > 0 && <span className="text-fg-dim">{fmt(r.amount, 4)}</span>}
                          <span className="text-fg-faint">{r.provenance}</span>
                          {r.error && <span className="text-[var(--danger)]">{r.error}</span>}
                          {r.explorer && (
                            <a
                              href={r.explorer}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-accent hover:underline"
                            >
                              tx ↗
                            </a>
                          )}
                          <span className="w-full text-fg-faint">{r.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-fg-faint">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="text-right text-fg">{v}</dd>
    </div>
  );
}
