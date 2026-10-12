import RadarPanel from "@/components/RadarPanel";
import CoinCard from "@/components/CoinCard";
import { connection } from "next/server";
import { getRadarState, listCoins } from "@/lib/store";

export const instant = false;

export const metadata = {
  title: "Trend Radar — auto-launch what is trending · VIRAL.forge",
  description:
    "Autonomous mode: scans Google Trends, Bluesky, Mastodon and Reddit on a timer, brands the hottest topics with AI and forges them.",
};

export default async function RadarPage() {
  await connection();
  const [state, launched] = await Promise.all([
    getRadarState(),
    listCoins("radar"),
  ]);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="label">autonomous mode</p>
      <h1 className="mono mt-2 text-2xl sm:text-3xl">TREND RADAR</h1>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-fg-dim">
        Scans Google Trends, Bluesky, Mastodon and Reddit on a timer, picks the
        hottest topics it has not seen yet, brands each one with the AI brain and
        records it. The radar never signs anything: it brands and records, so
        every coin it produces is off-chain until a human approves a launch
        through the forge. That is deliberate — an unsupervised process should
        not be able to move funds.
      </p>

      <RadarPanel initial={state} />

      <div className="mt-8">
        <p className="label mb-3">coins forged by the radar</p>
        {launched.length === 0 ? (
          <div className="card p-4 text-xs text-fg-dim">
            None yet. Start the radar, or run a single scan.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {launched.slice(0, 12).map((c) => (
              <CoinCard key={c.id} coin={c} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
