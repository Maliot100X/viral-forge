import "./env";

async function main() {
  const { query } = await import("../db");
  const rows = await query<{ ticker: string; name: string; status: string }>(
    "select ticker, name, status from coins order by status, ticker limit 12",
  );
  for (const r of rows) console.log(JSON.stringify(r));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
