import { Pool, type PoolClient, type QueryResultRow } from "pg";

// ---------------------------------------------------------------------------
// Postgres (Neon) persistence layer.
//
// This replaces the previous JSON-file store, which silently degraded to
// per-instance memory on Vercel: the serverless filesystem is read-only, so
// every cold start began with zero coins. Postgres is the only store here that
// actually survives a cold start.
//
// The `coins` table predates this module — an earlier build wrote to it — so
// the schema below is additive: it reuses that table's existing columns
// (ticker, logo_url, logo_style, status, create_sig, explorer, mint_sig) and
// only ever ADDs the columns this store needs. Nothing is dropped or renamed.
//
// Design rules:
//   - One pooled connection per serverless instance, created lazily.
//   - Schema is created/altered on first use, so a fresh database needs no
//     manual migration step.
//   - When DATABASE_URL is absent we do NOT pretend to persist. `durable()`
//     reports false and callers surface that to the UI.
// ---------------------------------------------------------------------------

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? "";

/** True when a Postgres connection string is configured. */
export function durable(): boolean {
  return CONNECTION_STRING.length > 0;
}

let pool: Pool | null = null;
let migrated: Promise<void> | null = null;

/**
 * ERROR-ONLY logging. pg's default pool emits an `error` event for idle-client
 * failures; an unhandled `error` event would crash the serverless instance.
 */
function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: CONNECTION_STRING,
    // Neon's pooler terminates TLS with its own chain; the pg client does not
    // ship Neon's CA, so verification has to be relaxed here.
    ssl: CONNECTION_STRING.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  // Never let a background socket error take the process down.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return pool;
}

const SCHEMA = `
-- The pre-existing table, declared in full so a fresh database gets the same
-- shape. On the current database this is a no-op: every column already exists.
CREATE TABLE IF NOT EXISTS coins (
  id           SERIAL PRIMARY KEY,
  mint         TEXT UNIQUE,
  name         TEXT NOT NULL,
  ticker       TEXT,
  description  TEXT DEFAULT '',
  tags         TEXT[] DEFAULT '{}',
  logo_style   TEXT,
  logo_url     TEXT,
  source       TEXT,
  status       TEXT,
  create_sig   TEXT,
  mint_sig     TEXT,
  explorer     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive migrations. Each is a no-op once applied.
ALTER TABLE coins ADD COLUMN IF NOT EXISTS image_prompt     TEXT DEFAULT '';
ALTER TABLE coins ADD COLUMN IF NOT EXISTS vibe             TEXT DEFAULT '';
ALTER TABLE coins ADD COLUMN IF NOT EXISTS source_ref       TEXT DEFAULT '';
ALTER TABLE coins ADD COLUMN IF NOT EXISTS launched_by      TEXT DEFAULT 'user';
ALTER TABLE coins ADD COLUMN IF NOT EXISTS pump_url         TEXT DEFAULT '';
ALTER TABLE coins ADD COLUMN IF NOT EXISTS cluster          TEXT;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS provenance       TEXT;
ALTER TABLE coins ADD COLUMN IF NOT EXISTS image_provenance TEXT;

CREATE INDEX IF NOT EXISTS coins_created_at_idx ON coins (created_at DESC);
CREATE INDEX IF NOT EXISTS coins_status_idx ON coins (status);

CREATE TABLE IF NOT EXISTS trends (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL,
  title          TEXT NOT NULL,
  score          INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  context        TEXT NOT NULL DEFAULT '',
  first_seen_at  TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS radar_seen (
  trend_id    TEXT PRIMARY KEY,
  first_seen  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS radar_log (
  id       BIGSERIAL PRIMARY KEY,
  at       TEXT NOT NULL,
  message  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS radar_state (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);
`;

/** Idempotent schema creation. Cached per instance; retried on failure. */
export async function ensureSchema(): Promise<void> {
  if (!durable()) return;
  if (!migrated) {
    migrated = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(SCHEMA);
      } finally {
        client.release();
      }
    })().catch((err) => {
      // Clear the cached promise so the next call retries instead of
      // permanently serving from a failed migration.
      migrated = null;
      throw err;
    });
  }
  return migrated;
}

/** Run a parameterised query. Throws when no database is configured. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** Borrow a client for a multi-statement transaction. */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- radar_state helpers ----------------------------------------------------

export async function readState<T>(key: string): Promise<T | null> {
  const rows = await query<{ value: T }>(
    "SELECT value FROM radar_state WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function writeState(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO radar_state (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

/** Health probe used by /api/status. Never throws. */
export async function dbHealth(): Promise<{
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}> {
  if (!durable()) return { configured: false, ok: false, latencyMs: null };
  const started = Date.now();
  try {
    await query("SELECT 1");
    return { configured: true, ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
