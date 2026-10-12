import Forge from "@/components/Forge";
import TickerTape from "@/components/TickerTape";
import CoinCard from "@/components/CoinCard";
import { connection } from "next/server";
import { getRadarState, listCoins, getTrends } from "@/lib/store";

// These pages read the store on every request; a blocking route is the honest
// shape for them under `cacheComponents`. See nextjs.org/docs/messages/blocking-prerender-dynamic
// (docs call this option `dynamic`, but the segment key in Next 16.4 is `instant`).
export const instant = false;

export default async function Home() {
  // Store-backed reads must happen per-request, never at prerender time.
  await connection();

  const [coins, radar, trends] = await Promise.all([
    listCoins(),
    getRadarState(),
    getTrends(),
  ]);

  const sim = coins.filter((c) => c.mode === "simulated").length;
  const live = coins.length - sim;

  return (
    <>
      <TickerTape />

      <section className="mx-auto w-full max-w-6xl px-4 pt-10">
        <p className="label">solana · pump.fun · ai-native</p>
        <h1 className="mono mt-3 text-3xl leading-tight sm:text-5xl">
          ANYTHING VIRAL
          <br />
          <span className="text-accent">BECOMES A COIN.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-dim">
          A prompt, a post on X, a hashtag, a picture, a TikTok, or whatever the
          world is googling right now. The AI names it, writes the lore, draws the
          logo and you launch in one click. You only add the socials.
        </p>

        <div className="mono mt-4 flex flex-wrap gap-4 text-[11px] text-fg-faint">
          <span className="text-accent">try it free →</span>
          <span>no wallet needed to forge · wallet only to launch</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-fg-dim">
          <span className="pill" style={{ borderColor: "var(--line-bright)" }}>
            AI name + ticker + lore
          </span>
          <span className="pill" style={{ borderColor: "var(--line-bright)" }}>
            AI logo · meme / 3D / realistic
          </span>
          <span className="pill" style={{ borderColor: "var(--line-bright)" }}>
            trend radar · auto-launch
          </span>
        </div>
      </section>

      <section className="mx-auto mt-8 grid w-full max-w-6xl grid-cols-2 gap-3 px-4 lg:grid-cols-4">
        {[
          { k: "coins forged", v: String(coins.length), s: `${live} live · ${sim} simulated` },
          { k: "trends tracked", v: String(trends.length), s: "4 sources configured" },
          { k: "radar", v: radar.running ? "ON" : "OFF", s: `${radar.ticks} scans · simulation` },
          { k: "network", v: "SOL", s: "pump.fun · mainnet" },
        ].map((stat) => (
          <div key={stat.k} className="card p-3">
            <p className="label">{stat.k}</p>
            <p className="mono mt-1 text-2xl">{stat.v}</p>
            <p className="mono mt-1 text-[10px] text-fg-faint">{stat.s}</p>
          </div>
        ))}
      </section>

      <Forge />

      <section className="mx-auto w-full max-w-6xl px-4 pb-6">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="mono text-sm">recent forges</h2>
          <a href="/coins" className="mono text-[11px] text-fg-dim hover:text-accent">
            all →
          </a>
        </div>

        {coins.length === 0 ? (
          <div className="card p-4 text-xs text-fg-dim">
            No coins yet. Forge one above — it takes a single line of text.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {coins.slice(0, 6).map((c) => (
              <CoinCard key={c.id} coin={c} compact />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-10">
        <div className="card p-4">
          <p className="label mb-3">radar</p>
          <div className="mono flex flex-wrap items-center gap-3 text-xs">
            <span className={radar.running ? "text-accent" : "text-fg-faint"}>
              {radar.running ? "RUNNING" : "IDLE"}
            </span>
            <span className="text-fg-faint">
              {radar.ticks} scans · {radar.seen.length} seen topics ·{" "}
              {radar.budget.spentSol.toFixed(3)} SOL spent
            </span>
            <a href="/radar" className="ml-auto hover:text-accent">
              open →
            </a>
          </div>
          <div className="mt-3">
            {radar.log.slice(0, 3).map((l, i) => (
              <div key={i} className="log-line">
                <span className="text-fg-faint">
                  {new Date(l.at).toISOString().slice(11, 19)}
                </span>
                <span>{l.message}</span>
              </div>
            ))}
            {radar.log.length === 0 && (
              <p className="mono text-[11px] text-fg-faint">no scans yet</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
