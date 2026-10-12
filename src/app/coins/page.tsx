import CoinCard from "@/components/CoinCard";
import Link from "next/link";
import { connection } from "next/server";
import { listCoins } from "@/lib/store";

export const instant = false;

export const metadata = {
  title: "Launched coins · VIRAL.forge",
  description: "Every coin forged and launched through VIRAL.forge.",
};

const FILTERS = [
  ["all", "all"],
  ["live", "on-chain"],
  ["simulated", "off-chain"],
  ["radar", "radar"],
  ["manual", "manual"],
] as const;

export default async function CoinsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: raw } = await searchParams;
  const filter = FILTERS.some(([f]) => f === raw) ? raw! : "all";

  await connection();
  const [coins, all] = await Promise.all([listCoins(filter), listCoins()]);

  const counts: Record<string, number> = {
    all: all.length,
    live: all.filter((c) => c.mode === "live").length,
    simulated: all.filter((c) => c.mode === "simulated").length,
    radar: all.filter((c) => c.launchedBy === "radar").length,
    manual: all.filter((c) => c.launchedBy === "user").length,
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="label">history</p>
      <h1 className="mono mt-2 text-2xl sm:text-3xl">LAUNCHED COINS</h1>

      <div className="mt-4 flex flex-wrap gap-1">
        {FILTERS.map(([value, label]) => (
          <a
            key={value}
            href={`/coins?filter=${value}`}
            className={`tab ${filter === value ? "tab-active" : ""}`}
          >
            {label}
            <span className="ml-1.5 text-fg-faint">{counts[value]}</span>
          </a>
        ))}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {coins.map((c) => (
          <CoinCard key={c.id} coin={c} />
        ))}
      </div>

      {coins.length === 0 && (
        <div className="card mt-5 p-4 text-xs text-fg-dim">
          Nothing here yet for this filter.{" "}
          <Link href="/" className="text-accent hover:underline">
            Forge a coin →
          </Link>
        </div>
      )}
    </section>
  );
}
