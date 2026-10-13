import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import {
  getAgent,
  getCoin,
  listAgentRuns,
  publicAgent,
  type AgentRunRecord,
} from "@/lib/store";
import { readMarket, type MarketRead } from "@/lib/market";
import { activeCluster } from "@/lib/solana";
import { resolveAvatarBody } from "@/components/avatar/avatar-catalog";
import AgentStage from "@/components/avatar/AgentStage";

export const instant = false;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return { title: "Agent not found · VIRAL.forge" };
  const coin = await getCoin(agent.mint);
  const title = `${agent.name}${coin ? ` · ${coin.symbol}` : ""} · VIRAL.forge`;
  return {
    title,
    description:
      agent.tagline ||
      `An autonomous trading agent on ${activeCluster()} that trades the bonding curve of ${coin?.symbol ?? agent.mint}.`,
  };
}

function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function atoms(value: string | undefined, decimals = 9): number {
  if (!value) return 0;
  try {
    return Number(BigInt(value)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

function short(s: string, head = 6, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export default async function AgentProfilePage({ params }: Params) {
  await connection();
  const { id } = await params;

  const agent = await getAgent(id);
  if (!agent) notFound();

  const [coin, runs, market] = await Promise.all([
    getCoin(agent.mint),
    listAgentRuns(id, 50),
    getCoin(agent.mint).then((c) => readMarket(c ?? {}) as Promise<MarketRead>),
  ]);

  const view = publicAgent(agent);
  const body = resolveAvatarBody(agent.avatarGlbUrl);
  const remaining = Math.max(0, agent.budgetSol - agent.spentSol);

  const filled = runs.filter((r) => Boolean(r.signature));
  const holds = runs.filter((r) => r.action === "hold");
  const buys = filled.filter((r) => r.action === "buy");
  const sells = filled.filter((r) => r.action === "sell");

  const tradedVolumeSol = filled.reduce(
    (sum, r) => sum + (r.action === "buy" ? r.amount : 0),
    0,
  );

  // Realized vs. spent is the only honest P&L we can show: we know what the agent
  // paid and what it received back in SOL, and nothing about unrealized value.
  const netSol = agent.realizedSol - agent.spentSol;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/agents" className="mono text-[11px] text-fg-faint hover:text-accent">
          ← agents
        </Link>
        <span className="mono text-[11px] text-fg-faint">/</span>
        <span className="mono text-[11px] text-fg-dim">{agent.id}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        {/* ---------------- identity + 3D ---------------- */}
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <AgentStage
              body={body.url}
              name={agent.name}
              accent="#7cf9c0"
              className="h-[340px] w-full sm:h-[420px]"
            />
            <div className="border-t border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h1 className="mono text-lg text-fg">{agent.name}</h1>
                  {agent.tagline && (
                    <p className="mono mt-1 text-[11px] leading-relaxed text-fg-dim">
                      {agent.tagline}
                    </p>
                  )}
                </div>
                <span className={`pill ${agent.status === "running" ? "pill-sim" : "pill-live"}`}>
                  {agent.status}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="pill pill-live">{activeCluster()}</span>
                <span className="pill" style={{ color: "var(--violet)" }}>
                  {agent.walletMode === "creator" ? "creator wallet" : "platform wallet"}
                </span>
                <span className="pill" style={{ color: "var(--fg-faint)" }}>
                  {view.hasApiKey ? "own brain key" : "site brain"}
                </span>
                <span className="pill" style={{ color: "var(--fg-faint)" }}>
                  body {body.id === body.url ? "custom" : body.id}
                </span>
              </div>

              {agent.walletMode === "creator" && agent.traderPubkey && (
                <p className="mono mt-3 text-[10px] leading-relaxed text-fg-faint">
                  Trades from {short(agent.traderPubkey, 8, 8)}. We store the public key only, so
                  this agent cannot sign here — it proposes and that wallet confirms.
                </p>
              )}
            </div>
          </div>

          <div className="card p-4">
            <p className="label mb-2">strategy</p>
            <p className="mono text-[11px] leading-relaxed text-fg-dim">
              {agent.prompt || "No strategy prompt was set; the default conservative prompt applies."}
            </p>
          </div>
        </div>

        {/* ---------------- numbers ---------------- */}
        <div className="space-y-4">
          <div className="card p-5">
            <p className="label mb-3">performance</p>
            <dl className="mono grid grid-cols-2 gap-x-5 gap-y-3 text-[11px] sm:grid-cols-3">
              <Stat k="budget" v={`${fmt(agent.budgetSol, 3)} SOL`} />
              <Stat k="spent" v={`${fmt(agent.spentSol, 5)} SOL`} />
              <Stat k="remaining" v={`${fmt(remaining, 5)} SOL`} />
              <Stat k="realized" v={`${fmt(agent.realizedSol, 5)} SOL`} />
              <Stat
                k="net"
                v={`${netSol >= 0 ? "+" : ""}${fmt(netSol, 5)} SOL`}
                tone={netSol > 0 ? "ok" : netSol < 0 ? "bad" : undefined}
              />
              <Stat k="bought in" v={`${fmt(tradedVolumeSol, 5)} SOL`} />
            </dl>
            <p className="mono mt-3 text-[10px] leading-relaxed text-fg-faint">
              Net is realized minus spent. Unrealized value is deliberately not estimated — the
              position is on the curve, not in a quote we control.
            </p>
          </div>

          <div className="card p-5">
            <p className="label mb-3">on-chain activity</p>
            <dl className="mono grid grid-cols-2 gap-x-5 gap-y-3 text-[11px] sm:grid-cols-4">
              <Stat k="decisions" v={String(runs.length)} />
              <Stat k="filled" v={String(filled.length)} tone={filled.length ? "ok" : undefined} />
              <Stat k="buys" v={String(buys.length)} />
              <Stat k="sells" v={String(sells.length)} />
            </dl>
            {holds.length > 0 && (
              <p className="mono mt-3 text-[10px] text-fg-faint">
                {holds.length} decision{holds.length === 1 ? "" : "s"} to hold — recorded, so an
                agent that sat out is visible rather than looking broken.
              </p>
            )}
          </div>

          {coin && (
            <div className="card p-5">
              <p className="label mb-3">
                trading {coin.symbol} · {market.market ? "live curve" : "curve unreadable"}
              </p>
              {market.market ? (
                <dl className="mono grid grid-cols-2 gap-x-5 gap-y-3 text-[11px] sm:grid-cols-3">
                  <Stat k="price" v={market.market.price} />
                  <Stat k="reserve" v={`${fmt(market.market.reserveSol, 4)} SOL`} />
                  <Stat k="mcap" v={`${fmt(market.market.marketCapSol, 2)} SOL`} />
                  <Stat k="bonds" v={`${market.market.graduationPct.toFixed(2)}%`} />
                  <Stat k="sold" v={fmt(atoms(market.market.tokensSold), 0)} />
                  <Stat k="curve" v={short(market.market.address)} />
                </dl>
              ) : (
                <p className="mono text-[11px] text-fg-dim">
                  {market.error
                    ? `The curve could not be read: ${market.error}. Showing nothing rather than a zero.`
                    : "This coin has no trading curve."}
                </p>
              )}
              <Link
                href={`/coin/${agent.mint}`}
                className="mono mt-3 inline-block text-[11px] text-accent hover:underline"
              >
                open {coin.symbol} →
              </Link>
            </div>
          )}

          <div className="card p-5">
            <p className="label mb-3">run log · most recent {runs.length}</p>
            {runs.length === 0 ? (
              <p className="mono text-[11px] text-fg-dim">
                No runs recorded yet. Run this agent from the agents page.
              </p>
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                {runs.map((r) => (
                  <RunRow key={String(r.id)} run={r} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <p className="mono mt-6 text-[10px] leading-relaxed text-fg-faint">
        This agent holds no key. It decides, this site prices the decision against the curve&apos;s
        live on-chain reserve, and a transaction is submitted only after a confirmation. On{" "}
        {activeCluster()}, so mainnet is unreachable while ENABLE_MAINNET is off.
      </p>
    </section>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "ok" | "bad" }) {
  const color = tone === "ok" ? "var(--live)" : tone === "bad" ? "var(--danger)" : undefined;
  return (
    <div>
      <dt className="text-fg-faint">{k}</dt>
      <dd style={color ? { color } : undefined}>{v}</dd>
    </div>
  );
}

function RunRow({ run }: { run: AgentRunRecord }) {
  const failed = Boolean(run.error) && !run.signature;
  return (
    <li className="border-b border-dashed border-line pb-2 last:border-0">
      <div className="mono flex flex-wrap items-baseline gap-x-2 text-[10px]">
        <span className="text-fg-faint">
          {new Date(run.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span
          className={
            run.action === "hold" ? "text-fg-dim" : failed ? "text-[var(--danger)]" : "text-accent"
          }
        >
          {run.action}
        </span>
        {run.amount > 0 && <span className="text-fg-dim">{fmt(run.amount, 4)} SOL</span>}
        <span className="text-fg-faint">{run.provenance}</span>
        {run.signature && (
          <a
            href={run.explorer ?? "#"}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            {short(run.signature)} ↗
          </a>
        )}
        {failed && <span className="text-[var(--danger)]">{run.error}</span>}
      </div>
      {run.reason && (
        <p className="mono mt-1 text-[10px] leading-relaxed text-fg-faint">{run.reason}</p>
      )}
    </li>
  );
}
