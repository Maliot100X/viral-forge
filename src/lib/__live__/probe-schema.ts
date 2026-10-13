// Ensures the durable schema exists, then lists what is actually in Neon.
// Run: npx tsx src/lib/__live__/probe-schema.ts
import "./env";

async function main() {
  const db = await import("../db");
  const store = await import("../store");

  // Any durable call runs ensureSchema(); a coin count is the cheapest one.
  const coins = await store.listCoins();
  console.log("durable:", db.durable());
  console.log("coins:", coins.length);

  const agents = await store.listAgents();
  console.log("agents:", agents.length);

  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' ORDER BY table_name`,
  );
  console.log("tables:", tables.map((r) => r.table_name).join(", "));

  const cols = await db.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trading_agents'
      ORDER BY ordinal_position`,
  );
  console.log("trading_agents cols:", cols.map((r) => `${r.column_name}:${r.data_type}`).join(", "));

  const runs = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agent_runs'
      ORDER BY ordinal_position`,
  );
  console.log("agent_runs cols:", runs.map((r) => r.column_name).join(", "));
}

main().catch((e) => {
  console.error("PROBE_FAILED", e?.code ?? "", e?.message ?? e);
  process.exit(1);
});
