import "./env";

const MINT = "2vWbxJ2PCXpysXLYHy7vj6Up2JPPnPPFcuwJujgmahd1";

async function main() {
  const store = await import("../store");
  const c = await store.getCoin(MINT);
  console.log("getCoin.symbol :", JSON.stringify(c?.symbol));
  const list = await store.listCoins();
  const hit = list.find((x) => x.mint === MINT);
  console.log("listCoins.sym  :", JSON.stringify(hit?.symbol));
  console.log("persistence    :", store.persistence());
}
main().catch((e) => { console.error(e); process.exit(1); });
