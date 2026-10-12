export const metadata = {
  title: "Tokenomics — fees, buybacks & burn · VIRAL.forge",
  description:
    "How the platform earns: creation fees, trading fees, and the buyback-and-burn loop.",
};

const REVENUE = [
  {
    n: "01",
    title: "CREATION FEE",
    figure: "0.02 SOL",
    body:
      "Added to every token launched by a user through the forge. Paid in the same transaction they sign. If they do not launch, they do not pay.",
  },
  {
    n: "02",
    title: "TRADING FEE",
    figure: "1% of buys",
    body:
      "On every buy made through a coin page. Sells carry no fee. Trades made elsewhere are not ours to tax.",
  },
  {
    n: "03",
    title: "RADAR LAUNCHES",
    figure: "creator rewards",
    body:
      "Coins the Trend Radar launches from the treasury wallet earn creator rewards on their trading volume. Those flow into the same treasury.",
  },
];

const LOOP = ["FEES", "TREASURY", "BUYBACK", "BURN"];

export default function TokenomicsPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="label">how the platform makes money · and where it goes</p>
      <h1 className="mono mt-2 text-2xl sm:text-3xl">TOKENOMICS</h1>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-fg-dim">
        The platform earns small fees on every token created and traded through
        it. That revenue is not kept: it buys back the platform token on the open
        market and burns it, permanently reducing supply. Burns are detected
        on-chain automatically and listed below.
      </p>

      <div className="card mt-6 p-4">
        <p className="label mb-2">platform token</p>
        <div className="mono flex flex-wrap items-center gap-3 text-xs">
          <span className="text-fg-faint">
            Not deployed by this build. The reference platform&apos;s own token is at
          </span>
          <span className="text-accent">3BAX…pump</span>
          <a
            href="https://pump.fun/coin/3BAXtVzSRVnFHbdgJgBKQZaVvJpa6pLksAbBbXFppump"
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent"
          >
            pump.fun ↗
          </a>
          <a
            href="https://dexscreener.com/solana/3BAXtVzSRVnFHbdgJgBKQZaVvJpa6pLksAbBbXFppump"
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent"
          >
            chart ↗
          </a>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
          This study build has no token of its own and has collected no fees.
        </p>
      </div>

      <p className="label mt-8 mb-3">revenue · where it comes from</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {REVENUE.map((r) => (
          <div key={r.n} className="card p-4">
            <p className="mono text-xs text-accent">{r.n}</p>
            <p className="mono mt-2 text-xs">{r.title}</p>
            <p className="mono mt-1 text-lg">{r.figure}</p>
            <p className="mt-2 text-xs leading-relaxed text-fg-dim">{r.body}</p>
          </div>
        ))}
      </div>

      <p className="label mt-8 mb-3">the loop · 100% of net revenue</p>
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {LOOP.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="mono rounded border border-line-bright bg-bg-soft px-3 py-2 text-xs">
                {step}
              </span>
              {i < LOOP.length - 1 && <span className="text-accent">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-fg-dim">
          Net revenue = fees minus server, AI and RPC costs. Buybacks happen in
          batches, announced before execution, and logged with the transaction.
        </p>
      </div>

      <p className="label mt-8 mb-3">this build</p>
      <div className="card p-4">
        <div className="mono grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <p className="text-fg-faint">fees collected</p>
            <p className="mt-1 text-lg">0 SOL</p>
          </div>
          <div>
            <p className="text-fg-faint">tokens burned</p>
            <p className="mt-1 text-lg">0</p>
          </div>
          <div>
            <p className="text-fg-faint">treasury</p>
            <p className="mt-1 text-lg">none</p>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-fg-dim">
          This is a study build of the interaction model. It has no token, no
          treasury, no fee collection, and no on-chain activity of any kind. The
          figures above are real, and they are zero.
        </p>
      </div>
    </section>
  );
}
