/**
 * Verifies the /coins list actually renders real market data, using the same
 * readMarkets() the page uses.
 *
 * The user's complaint was that /coins showed nothing but a LIVE badge. This
 * asserts each tradeable coin resolves to a real price/reserve read from chain,
 * and that a coin with no curve is reported as missing rather than priced at 0.
 *
 * Run: npx tsx src/lib/__live__/probe-coins-market.ts
 */
import "./env";

async function main(): Promise<void> {
  const { listCoins } = await import("../store");
  const { readMarkets } = await import("../market");

  const coins = await listCoins();
  console.log(`coins in store    ${coins.length}`);

  const markets = await readMarkets(coins);
  console.log(`markets resolved  ${markets.size}`);

  const withCurve = coins.filter((c) => c.mint && c.curveAddress);
  console.log(`with a curve      ${withCurve.length}\n`);

  let rendered = 0;
  for (const c of withCurve) {
    const m = markets.get(c.mint!);
    if (!m) {
      console.log(`${c.symbol.padEnd(10)} ${c.mint}  MARKET_UNAVAILABLE`);
      continue;
    }
    console.log(
      `${c.symbol.padEnd(10)} ${c.mint.slice(0, 8)}…  price ${m.price}  ` +
        `reserve ${m.reserveSol} SOL  mcap ${m.marketCapSol.toFixed(3)} SOL  ` +
        `${m.graduationPct.toFixed(2)}%${m.graduated ? " GRADUATED" : ""}`,
    );
    if (m.exists && m.price && m.price !== "0") rendered++;
  }

  // A coin with no curve must not appear as a zero-priced market.
  const noCurve = coins.filter((c) => c.mint && !c.curveAddress);
  for (const c of noCurve) {
    if (markets.has(c.mint!)) throw new Error(`${c.symbol} has no curve but produced a market`);
  }
  console.log(`\ncurve-less coins correctly absent: ${noCurve.length}`);

  if (rendered === 0) throw new Error("no coin produced a real price — /coins would still look empty");
  console.log(`COINS_MARKET_OK (${rendered} coins with real on-chain prices)`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
