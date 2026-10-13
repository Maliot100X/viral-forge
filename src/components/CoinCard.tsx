import Link from "next/link";
import type { Coin } from "@/lib/types";
import type { MarketSnapshot } from "@/lib/market";
import { shortMint } from "@/lib/ids";

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtSol(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default function CoinCard({
  coin,
  compact = false,
  market = null,
}: {
  coin: Coin;
  compact?: boolean;
  /**
   * Live curve state read from chain by the caller. `null` means either the coin
   * has no curve or the read failed — both render as "market unavailable" rather
   * than as a price of zero, which would be a number we did not observe.
   */
  market?: MarketSnapshot | null;
}) {
  const live = coin.mode === "live";
  // A row whose mint is null never launched anything, so there is no coin page
  // to open. Linking anyway produced a dead /coin/null link that 404'd.
  const hasMint = Boolean(coin.mint);
  return (
    <article className="card flex gap-3 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={coin.imageUrl}
        alt=""
        width={compact ? 44 : 72}
        height={compact ? 44 : 72}
        className="shrink-0 rounded border border-line"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {hasMint ? (
            <Link href={`/coin/${coin.mint}`} className="mono text-sm hover:text-accent">
              {coin.name}
            </Link>
          ) : (
            <span className="mono text-sm text-fg-dim">{coin.name}</span>
          )}
          <span className={`pill ${live ? "pill-live" : "pill-sim"}`}>
            {live ? "LIVE" : "OFF-CHAIN"}
          </span>
          {coin.provenance === "river" && (
            <span className="pill" title="Branded by the River AI model">
              AI
            </span>
          )}
        </div>

        <p className="mono mt-0.5 text-[11px] text-fg-faint">
          {coin.symbol} · {coin.source} · {coin.launchedBy} · {age(coin.createdAt)}
          {coin.cluster ? ` · ${coin.cluster}` : ""}
        </p>

        {!compact && coin.description && (
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-fg-dim">
            {coin.description.split("\n")[0]}
          </p>
        )}

        {!compact && coin.sourceRef && (
          <p className="mono mt-1 text-[10px] text-fg-faint">← {coin.sourceRef}</p>
        )}

        {/* --- real market data, read from this coin's curve account --- */}
        {!compact && market?.exists && (
          <div className="mt-2 border-t border-line pt-2">
            <dl className="mono grid grid-cols-3 gap-x-2 gap-y-1 text-[10px]">
              <div>
                <dt className="text-fg-faint">price</dt>
                <dd className="text-fg" title={`${market.price} SOL`}>
                  {market.price}
                </dd>
              </div>
              <div>
                <dt className="text-fg-faint">mcap</dt>
                <dd className="text-fg">{fmtSol(market.marketCapSol, 2)} SOL</dd>
              </div>
              <div>
                <dt className="text-fg-faint">reserve</dt>
                <dd className="text-fg">{fmtSol(market.reserveSol)} SOL</dd>
              </div>
            </dl>

            <div className="mt-2 flex items-center gap-2">
              <div
                className="h-1 flex-1 overflow-hidden bg-bg-soft"
                role="progressbar"
                aria-valuenow={Math.round(market.graduationPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="graduation progress"
              >
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, Math.max(0, market.graduationPct))}%` }}
                />
              </div>
              <span className="mono text-[10px] text-fg-dim">
                {market.graduationPct.toFixed(1)}% to grad
              </span>
            </div>
          </div>
        )}

        {!compact && coin.mint && !market?.exists && (
          <p className="mono mt-2 border-t border-line pt-2 text-[10px] text-fg-faint">
            {coin.curveAddress ? "market unavailable" : "no bonding curve — not tradeable"}
          </p>
        )}

        <div className="mono mt-2 flex flex-wrap items-center gap-3 text-[10px]">
          {/* Direct route into the trade panel, so a launch list row is a place
              you can actually buy from rather than only read about. */}
          {hasMint && market?.exists && (
            <Link href={`/coin/${coin.mint}#trade`} className="text-accent hover:underline">
              buy / sell →
            </Link>
          )}
          {hasMint ? (
            <Link href={`/coin/${coin.mint}`} className="hover:text-accent">
              open →
            </Link>
          ) : (
            <span className="text-fg-faint" title="This coin was never launched on-chain">
              no mint yet
            </span>
          )}
          {hasMint && (
            <a
              href={coin.pumpUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent"
            >
              pump.fun ↗
            </a>
          )}
          {coin.txSignature && (
            <a
              href={coin.explorerUrl ?? `https://solscan.io/tx/${coin.txSignature}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent"
            >
              tx ↗
            </a>
          )}
          {hasMint && <span className="text-fg-faint">{shortMint(coin.mint)}</span>}
        </div>
      </div>
    </article>
  );
}
