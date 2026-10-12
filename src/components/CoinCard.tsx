import type { Coin } from "@/lib/types";
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

export default function CoinCard({ coin, compact = false }: { coin: Coin; compact?: boolean }) {
  const live = coin.mode === "live";
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
          <a href={`/coin/${coin.mint}`} className="mono text-sm hover:text-accent">
            {coin.name}
          </a>
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
          ${coin.symbol} · {coin.source} · {coin.launchedBy} · {age(coin.createdAt)}
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

        <div className="mono mt-2 flex flex-wrap items-center gap-3 text-[10px]">
          <a href={`/coin/${coin.mint}`} className="hover:text-accent">
            open →
          </a>
          <a
            href={coin.pumpUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent"
          >
            pump.fun ↗
          </a>
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
          <span className="text-fg-faint">{shortMint(coin.mint)}</span>
        </div>
      </div>
    </article>
  );
}
