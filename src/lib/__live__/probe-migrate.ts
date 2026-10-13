/**
 * Verifies the additive `trading_agents` migration landed. Safe to re-run.
 *   npx tsx src/lib/__live__/probe-migrate.ts
 */
import "./env";

async function main() {
  const { query, ensureSchema, durable } = await import("../db");

  if (!durable()) {
    console.log("SKIP: no DATABASE_URL configured");
    return;
  }

  await ensureSchema();

  const cols = await query<{
    column_name: string;
    data_type: string;
    column_default: string | null;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'trading_agents'
      ORDER BY ordinal_position`,
  );

  console.log("trading_agents columns:");
  for (const c of cols) {
    console.log(
      `  ${c.column_name.padEnd(16)} ${c.data_type.padEnd(30)} null=${c.is_nullable} default=${c.column_default ?? "-"}`,
    );
  }

  const wanted = ["avatar_glb_url", "tagline", "wallet_mode", "trader_pubkey"];
  const present = new Set(cols.map((c) => c.column_name));
  const missing = wanted.filter((w) => !present.has(w));
  console.log(
    missing.length
      ? `MISSING: ${missing.join(", ")}`
      : "ALL MIGRATION COLUMNS PRESENT",
  );

  const idx = await query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'trading_agents' ORDER BY indexname`,
  );
  console.log("indexes:", idx.map((r) => r.indexname).join(", "));

  const n = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM trading_agents",
  );
  console.log("existing agent rows preserved:", n[0]?.count);

  const coins = await query<{ status: string; n: string }>(
    "SELECT status, count(*)::text AS n FROM coins GROUP BY status ORDER BY status",
  );
  console.log(
    "coin rows by status:",
    coins.map((r) => `${r.status}=${r.n}`).join(", "),
  );
}

main().catch((err) => {
  console.error("PROBE FAILED:", err);
  process.exit(1);
});
