import { notFound } from "next/navigation";
import Link from "next/link";
import { connection } from "next/server";
import { getCoin } from "@/lib/store";

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
    title: `$${coin.symbol} ${coin.name} · VIRAL.forge`,
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
  const shareText = encodeURIComponent(
    `$${coin.symbol} — ${coin.name}\n${coin.description.split("\n")[0]}\n\nForged with VIRAL.forge`,
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
        <span className="text-fg-dim">${coin.symbol}</span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coin.imageUrl}
            alt={`${coin.name} logo`}
            width={300}
            height={300}
            className="w-full rounded-lg border border-line"
            style={{ imageRendering: "pixelated" }}
          />
        </div>

        <div>
          <p className="mono text-sm text-fg-faint">${coin.symbol}</p>
          <h1 className="mono mt-1 text-2xl sm:text-3xl">{coin.name}</h1>

          <span className={`pill mt-3 inline-block ${live ? "pill-live" : "pill-sim"}`}>
            {live ? "LIVE" : "SIMULATED"}
          </span>

          <p className="mt-4 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-fg-dim">
            {coin.description}
          </p>

          <div className="mono mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="text-accent">{coin.vibe}</span>
            {coin.tags.map((t) => (
              <span key={t} className="text-fg-faint">
                #{t}
              </span>
            ))}
          </div>

          <p className="mono mt-3 text-[11px] text-fg-faint">
            forged from {coin.source} · {coin.sourceRef} · {age(coin.createdAt)} · by{" "}
            {coin.launchedBy === "radar" ? "the radar" : "a forger"}
          </p>

          <div className="divider my-5" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label mb-1">mint</p>
              <p className="mono break-all text-xs text-fg-dim">{coin.mint}</p>
            </div>
            <div>
              <p className="label mb-1">links</p>
              <div className="mono flex flex-wrap gap-3 text-xs">
                <a
                  href={coin.pumpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-accent"
                >
                  pump.fun
                </a>
                <a
                  href={`https://solscan.io/token/${coin.mint}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-accent"
                >
                  solscan
                </a>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <p className="label mb-2">share</p>
            <div className="mono flex flex-wrap gap-2 text-[11px]">
              <a
                className="btn"
                href={`https://x.com/intent/post?text=${shareText}`}
                target="_blank"
                rel="noreferrer"
              >
                post on X
              </a>
              <a className="btn" href={`/coin/${coin.mint}/opengraph-image`}>
                share card ↓
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <p className="label mb-2">market · live</p>
          <p className="mono text-xs text-fg-dim">
            {live
              ? "On-chain market data is not fetched by this build."
              : "Simulated coin. No on-chain market."}
          </p>
        </div>
        <div className="card p-4">
          <p className="label mb-2">trade · signs in your wallet</p>
          <p className="mono text-xs text-fg-dim">
            {live
              ? "Trading requires a signing wallet, which this build does not have."
              : "Trading is only available for coins that are live on-chain."}
          </p>
        </div>
      </div>
    </section>
  );
}
