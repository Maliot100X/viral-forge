import { notFound } from "next/navigation";
import Link from "next/link";
import { connection } from "next/server";
import { getCoin } from "@/lib/store";
import { readMarket } from "@/lib/market";
import CopyField from "@/components/CopyField";
import CurveChart from "@/components/CurveChart";
import TradePanel from "@/components/TradePanel";

// Reads the curve from devnet on every request: a cached bond price is a wrong
// price. Blocking route rather than `dynamic`, which `cacheComponents` rejects.
export const instant = false;

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtSol(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtTokens(atoms: string): string {
  try {
    const n = Number(BigInt(atoms)) / 1e9;
    if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  } catch {
    return "—";
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  await connection();
  const coin = await getCoin(mint);
  if (!coin) return { title: "Coin not found · VIRAL.forge" };
  return {
    title: `${coin.symbol} ${coin.name} · VIRAL.forge`,
    description: coin.description.split("\n")[0],
  };
}

export default async function CoinPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  await connection();
  const coin = await getCoin(mint);
  if (!coin) notFound();

  const live = coin.mode === "live";
  const { market, error: marketError } = await readMarket(coin);
  const tradeable = Boolean(market?.exists);

  const shareText = encodeURIComponent(
    `${coin.symbol} — ${coin.name}\n${coin.description.split("\n")[0]}\n\n${
      market ? `market cap ${fmtSol(market.marketCapSol, 2)} SOL · ` : ""
    }bonding curve on ${coin.cluster ?? "devnet"}\n\nForged with VIRAL.forge`,
  );

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="mono mb-4 text-[11px] text-fg-faint">
        <Link href="/" className="hover:text-accent">
          forge
        </Link>
        {" / "}
        <Link href="/coins" className="hover:text-accent">
          launched
        </Link>
        {" / "}
        <span className="text-fg-dim">{coin.symbol}</span>
      </p>

      {/* Two-column reference layout: hero + facts on the left, the market and
          the trade form on the right, so a buyer never scrolls to trade. */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* ---------------- left: hero ---------------- */}
        <div>
          <div className="card p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coin.imageUrl}
              alt={`${coin.name} logo`}
              width={52}
              height={52}
              className="border-2 border-line bg-bg-soft"
              style={{ imageRendering: "pixelated" }}
            />

            <p className="mono mt-4 text-sm text-accent">{coin.symbol}</p>
            <h1 className="mono mt-1 text-2xl sm:text-3xl">{coin.name}</h1>

            <span className={`pill mt-3 inline-block ${live ? "pill-live" : "pill-sim"}`}>
              {live ? "LIVE" : "SIMULATED"}
            </span>

            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-fg-dim">
              {coin.description}
            </p>

            <div className="mono mt-4 flex flex-wrap gap-1 text-[11px]">
              <span className="pill border-accent/40 text-accent">{coin.vibe}</span>
              {coin.tags.map((t) => (
                <span key={t} className="pill text-fg-faint">
                  #{t}
                </span>
              ))}
            </div>

            <p className="mono mt-4 text-[11px] text-fg-faint">
              forged from {coin.source} · {coin.sourceRef} · {age(coin.createdAt)} · by{" "}
              {coin.launchedBy === "radar" ? "the radar" : "a forger"}
              {coin.provenance && <> · brain {coin.provenance}</>}
              {coin.imageProvenance && <> · art {coin.imageProvenance}</>}
            </p>

            <div className="divider my-6" />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="label mb-1">mint</p>
                <CopyField value={coin.mint} />
              </div>
              <div>
                <p className="label mb-1">links</p>
                <div className="mono flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <a
                    href={`https://solscan.io/token/${coin.mint}?cluster=${clusterParam(coin.cluster)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:text-accent"
                  >
                    solscan ↗
                  </a>
                  <a
                    href={coin.pumpUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:text-accent"
                  >
                    pump.fun ↗
                  </a>
                  {/* Stored at launch and never surfaced until now. */}
                  {coin.explorerUrl && (
                    <a
                      href={coin.explorerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:text-accent"
                    >
                      create tx ↗
                    </a>
                  )}
                  {market && (
                    <a
                      href={`https://solscan.io/account/${market.address}?cluster=${clusterParam(coin.cluster)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:text-accent"
                    >
                      curve ↗
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <p className="label mb-2">share</p>
              <div className="mono flex flex-wrap gap-2 text-[11px]">
                <a
                  className="btn btn-primary"
                  href={`https://x.com/intent/post?text=${shareText}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  post on X
                </a>
                <a className="btn" href={`/coin/${coin.mint}/opengraph-image`}>
                  share card ↓
                </a>
                <CopyField value={`https://viral-forge-gamma.vercel.app/coin/${coin.mint}`} label="link" asChild>
                  copy link
                </CopyField>
              </div>
            </div>
          </div>

          {/* The curve, drawn from the real pricing function rather than from a
              recorded history: we do not index every trade yet, and a fabricated
              candle chart would be worse than an honest curve. */}
          {market && (
            <div className="card mt-6 p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="label">curve · constant product</p>
                <span className="mono text-[10px] text-fg-faint">{coin.cluster ?? "devnet"}</span>
              </div>
              <CurveChart
                reserveSol={market.reserveSol}
                tokensOnCurve={market.tokensOnCurve}
                price={market.price}
              />
            </div>
          )}
        </div>

        {/* ---------------- right: market + trade ---------------- */}
        <div className="space-y-6">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="label">market · {market ? "live" : "unavailable"}</p>
              {market && (
                <span className="mono text-[10px] text-fg-faint">
                  read from chain
                </span>
              )}
            </div>

            {market ? (
              <>
                <dl className="mono space-y-1.5 text-[11px]">
                  <Row k="price" v={`${market.price} SOL`} />
                  <Row k="market cap" v={`${fmtSol(market.marketCapSol, 2)} SOL`} />
                  <Row k="reserve" v={`${fmtSol(market.reserveSol, 4)} SOL`} />
                  <Row k="on the curve" v={`${fmtTokens(market.tokensOnCurve)} ${coin.symbol}`} />
                  <Row k="sold" v={`${fmtTokens(market.tokensSold)} ${coin.symbol}`} />
                </dl>

                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="label">
                      {market.graduated ? "graduated" : "bonding progress"}
                    </span>
                    <span className="mono text-[10px] text-fg-dim">
                      {(market.graduationPct * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-bg-soft">
                    <div
                      className="h-1.5 bg-accent"
                      style={{
                        width: `${Math.min(100, Math.max(0, market.graduationPct * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="mono text-xs text-fg-dim">
                {marketError
                  ? `The curve account could not be read (${marketError}). No price is shown rather than a stale one.`
                  : live
                    ? "This coin is live but has no bonding curve, so it cannot be traded here yet. Backfill attaches one."
                    : "Simulated coin. Nothing was minted, so there is no market."}
              </p>
            )}
          </div>

          {tradeable && market ? (
            <TradePanel
              mint={coin.mint}
              symbol={coin.symbol}
              market={{
                exists: market.exists,
                reserveSol: market.reserveSol,
                tokensOnCurve: market.tokensOnCurve,
                price: market.price,
                graduationPct: market.graduationPct,
                graduated: market.graduated,
              }}
            />
          ) : (
            <div className="card border-l-2 border-l-[var(--violet)] p-5">
              <p className="label mb-2">trade · unavailable</p>
              <p className="mono text-xs text-fg-dim">
                {marketError
                  ? "Trading is disabled while the curve cannot be read, so no transaction is priced against a wrong reserve."
                  : live
                    ? "This coin has no bonding curve attached yet, so there is nothing to buy from. An operator has to backfill it first."
                    : "Trading only exists for coins that were actually minted on chain."}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function clusterParam(cluster?: string): string {
  return cluster === "mainnet-beta" ? "mainnet-beta" : "devnet";
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="text-right text-fg">{v}</dd>
    </div>
  );
}
