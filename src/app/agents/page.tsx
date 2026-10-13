import { connection } from "next/server";
import AgentsPanel from "@/components/AgentsPanel";
import { activeCluster } from "@/lib/solana";
import { listAgents, listCoins, publicAgent } from "@/lib/store";

// Reads the store per request. Under `cacheComponents` the honest declaration is
// a blocking route, not `dynamic = "force-dynamic"` (which Turbopack rejects).
export const instant = false;

export const metadata = {
  title: "Trading agents · VIRAL.forge",
  description:
    "Agents that trade the bonding curve of a coin launched here, on devnet, with every decision recorded.",
};

export default async function AgentsPage() {
  await connection();

  const [coins, agents] = await Promise.all([listCoins(), listAgents()]);

  // Only coins with a real curve can be traded. Offering a coin without one
  // would create an agent that can only ever fail.
  const tradeable = coins
    .filter((c) => c.mode === "live" && c.curveAddress)
    .map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name }));

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="label">autonomy</p>
      <h1 className="mono mt-2 text-2xl sm:text-3xl">TRADING AGENTS</h1>
      <p className="mono mt-3 max-w-3xl text-[11px] leading-relaxed text-fg-dim">
        An agent here is a strategy plus a decision loop. It holds no key: it proposes a trade, this
        site prices it against the curve&apos;s live on-chain reserve, and a transaction is only
        submitted after you confirm the quote. Budget and per-trade caps are enforced on the server,
        so a model cannot size a trade outside its own strategy.
      </p>

      <div className="mt-6">
        <AgentsPanel
          coins={tradeable}
          initialAgents={agents.map(publicAgent)}
          cluster={activeCluster()}
        />
      </div>

      <div className="card mt-6 p-4">
        <p className="label mb-2">what is not claimed here</p>
        <ul className="mono space-y-1 text-[10px] leading-relaxed text-fg-faint">
          <li>
            · Every trade is on {activeCluster()}. These agents cannot touch mainnet while{" "}
            ENABLE_MAINNET is off.
          </li>
          <li>
            · The server holds one key — the launch wallet&apos;s. An agent trades through that
            wallet, so it is not a separate on-chain actor.
          </li>
          <li>· An agent&apos;s own brain key, when set, is used for the decision only. It never signs.</li>
          <li>
            · A decision of &quot;hold&quot; is recorded too, so an agent that does nothing is
            visible rather than looking broken.
          </li>
        </ul>
      </div>
    </section>
  );
}
