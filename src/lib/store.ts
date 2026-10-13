import type {
  Coin,
  RadarLogEntry,
  RadarSettings,
  RadarState,
  Trend,
} from "./types";
import { durable, query, readState, writeState } from "./db";

// ---------------------------------------------------------------------------
// Persistence.
//
// Backed by Postgres (Neon) via `./db`. The previous JSON-file implementation
// is gone: on Vercel the filesystem is read-only and ephemeral, so it silently
// degraded to per-instance memory and every cold start began with an empty
// /coins. Records now survive cold starts and are shared across instances.
//
// When DATABASE_URL is absent the store still serves the API (empty reads,
// no-op writes) but `persistence()` reports `"memory"` so the UI can say so
// instead of implying data was saved.
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: RadarSettings = {
  enabled: false,
  intervalSec: 60,
  maxPerTick: 2,
  buySol: 0,
  minScore: 35,
  dailyBudgetSol: 1,
  sources: { google: true, bluesky: true, mastodon: true, reddit: true },
};

const STATE_SETTINGS = "settings";
const STATE_COUNTERS = "counters";

interface Counters {
  ticks: number;
  spentSol: number;
  launchesToday: number;
  budgetDay: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultCounters(): Counters {
  return { ticks: 0, spentSol: 0, launchesToday: 0, budgetDay: today() };
}

/** Whether records actually persist across cold starts. */
export function persistence(): "postgres" | "memory" {
  return durable() ? "postgres" : "memory";
}

// In-memory fallback. Only ever used when no database is configured, so it
// never masks a configured-but-broken database.
const memory: { coins: Coin[] } = { coins: [] };

/**
 * Curve secrets, held apart from the `Coin` shape on purpose.
 *
 * A coin object is serialised straight to the browser by /api/coins and every
 * page that reads it. The curve account's private key can authorise SOL payouts
 * out of the reserve, so it must never be reachable from anything the client
 * receives. It goes in through `rememberCurveSecret`, is written to Postgres by
 * `addCoin`, and is read back only by the server-side trade route.
 */
const curveSecrets = new Map<string, string>();

/** Records the curve keypair for a mint so `addCoin` can persist it. */
export function rememberCurveSecret(mint: string, secret: string): void {
  curveSecrets.set(mint, secret);
}

/** The stored base58 curve secret for a mint, or null when it has no curve. */
export async function getCurveSecret(mint: string): Promise<string | null> {
  const cached = curveSecrets.get(mint);
  if (cached) return cached;
  if (!durable()) return null;
  const rows = await query<{ curve_secret: string | null }>(
    "SELECT curve_secret FROM coins WHERE mint = $1 LIMIT 1",
    [mint],
  );
  const secret = rows[0]?.curve_secret ?? null;
  if (secret) curveSecrets.set(mint, secret);
  return secret;
}

// --- row mapping ------------------------------------------------------------

// The table's `status` column is the record's launch state. Only an actually
// broadcast transaction may write 'LIVE' — see markCoinLive.
const STATUS_LIVE = "LIVE";

interface CoinRow {
  id: number;
  mint: string | null;
  name: string;
  ticker: string | null;
  description: string | null;
  tags: string[] | null;
  logo_style: string | null;
  logo_url: string | null;
  source: string | null;
  status: string | null;
  create_sig: string | null;
  mint_sig: string | null;
  explorer: string | null;
  created_at: Date | string;
  image_prompt: string | null;
  vibe: string | null;
  source_ref: string | null;
  launched_by: string | null;
  pump_url: string | null;
  cluster: string | null;
  provenance: string | null;
  image_provenance: string | null;
  curve_address: string | null;
  curve_secret: string | null;
  initial_buy_sol: string | null;
  mint_authority: string | null;
  token_program: string | null;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function rowToCoin(r: CoinRow): Coin {
  const live = r.status === STATUS_LIVE;
  return {
    // Rows written before a mint existed have none; fall back to a stable
    // row-scoped id so they stay addressable instead of colliding on "".
    id: r.mint ?? `row_${r.id}`,
    name: r.name,
    symbol: r.ticker ?? "",
    description: r.description ?? "",
    imageUrl: r.logo_url ?? "",
    imagePrompt: r.image_prompt ?? "",
    imageStyle: (r.logo_style as Coin["imageStyle"]) ?? "meme",
    tags: r.tags ?? [],
    vibe: r.vibe ?? "",
    source: (r.source as Coin["source"]) ?? "prompt",
    sourceRef: r.source_ref ?? "",
    mint: r.mint ?? "",
    createdAt: iso(r.created_at),
    mode: live ? "live" : "simulated",
    launchedBy: r.launched_by === "radar" ? "radar" : "user",
    pumpUrl: r.pump_url || (r.mint ? `https://pump.fun/coin/${r.mint}` : ""),
    txSignature: live ? (r.create_sig ?? undefined) : undefined,
    explorerUrl: r.explorer ?? undefined,
    cluster: (r.cluster as Coin["cluster"]) ?? undefined,
    provenance: (r.provenance as Coin["provenance"]) ?? undefined,
    imageProvenance: (r.image_provenance as Coin["imageProvenance"]) ?? undefined,
    curveAddress: r.curve_address ?? undefined,
    initialBuySol: r.initial_buy_sol ? Number(r.initial_buy_sol) : undefined,
    mintAuthority: r.mint_authority ?? undefined,
    tokenProgram: r.token_program ?? undefined,
  };
}

function sortNewestFirst(a: Coin, b: Coin): number {
  return b.createdAt.localeCompare(a.createdAt);
}

// --- coins ------------------------------------------------------------------

export async function listCoins(filter?: string): Promise<Coin[]> {
  let coins: Coin[];
  if (durable()) {
    const rows = await query<CoinRow>(
      "SELECT * FROM coins ORDER BY created_at DESC, id DESC",
    );
    coins = rows.map(rowToCoin);
  } else {
    coins = [...memory.coins].sort(sortNewestFirst);
  }
  if (!filter || filter === "all") return coins;
  if (filter === "radar") return coins.filter((c) => c.launchedBy === "radar");
  if (filter === "manual") return coins.filter((c) => c.launchedBy === "user");
  if (filter === "live") return coins.filter((c) => c.mode === "live");
  if (filter === "simulated") return coins.filter((c) => c.mode === "simulated");
  return coins;
}

export async function getCoin(mint: string): Promise<Coin | null> {
  if (durable()) {
    const rows = await query<CoinRow>(
      "SELECT * FROM coins WHERE mint = $1 OR id::text = $1 LIMIT 1",
      [mint],
    );
    return rows[0] ? rowToCoin(rows[0]) : null;
  }
  return memory.coins.find((c) => c.mint === mint || c.id === mint) ?? null;
}

export async function addCoin(coin: Coin): Promise<Coin> {
  if (!durable()) {
    memory.coins = [coin, ...memory.coins.filter((c) => c.mint !== coin.mint)];
    return coin;
  }
  // A brand-new record is never live: status only becomes LIVE in
  // markCoinLive, after a signature actually lands.
  await query(
    `INSERT INTO coins (
       mint, name, ticker, description, tags, logo_style, logo_url, source,
       status, create_sig, explorer, created_at, image_prompt, vibe,
       source_ref, launched_by, pump_url, cluster, provenance, image_provenance,
       curve_address, curve_secret, initial_buy_sol, mint_authority, token_program
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,'SIM',NULL,NULL,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22
     )
     ON CONFLICT (mint) DO UPDATE SET
       name = EXCLUDED.name,
       ticker = EXCLUDED.ticker,
       description = EXCLUDED.description,
       tags = EXCLUDED.tags,
       logo_style = EXCLUDED.logo_style,
       logo_url = EXCLUDED.logo_url,
       source = EXCLUDED.source,
       image_prompt = EXCLUDED.image_prompt,
       vibe = EXCLUDED.vibe,
       source_ref = EXCLUDED.source_ref,
       launched_by = EXCLUDED.launched_by,
       pump_url = EXCLUDED.pump_url,
       provenance = EXCLUDED.provenance,
       image_provenance = EXCLUDED.image_provenance,
       curve_address = COALESCE(EXCLUDED.curve_address, coins.curve_address),
       curve_secret = COALESCE(EXCLUDED.curve_secret, coins.curve_secret),
       initial_buy_sol = COALESCE(EXCLUDED.initial_buy_sol, coins.initial_buy_sol),
       mint_authority = COALESCE(EXCLUDED.mint_authority, coins.mint_authority),
       token_program = COALESCE(EXCLUDED.token_program, coins.token_program)`,
    [
      coin.mint,
      coin.name,
      coin.symbol,
      coin.description,
      coin.tags ?? [],
      coin.imageStyle,
      coin.imageUrl,
      coin.source,
      coin.createdAt,
      coin.imagePrompt,
      coin.vibe,
      coin.sourceRef,
      coin.launchedBy,
      coin.pumpUrl,
      coin.cluster ?? null,
      coin.provenance ?? null,
      coin.imageProvenance ?? null,
      coin.curveAddress ?? null,
      curveSecrets.get(coin.mint) ?? null,
      coin.initialBuySol ?? null,
      coin.mintAuthority ?? null,
      coin.tokenProgram ?? null,
    ],
  );
  return coin;
}

/**
 * Attach the result of a confirmed on-chain launch to an existing record.
 * This is the ONLY writer of status='LIVE' — a record becomes live here and
 * nowhere else, so the flag always means a signature exists.
 */
export async function markCoinLive(
  mint: string,
  patch: Pick<Coin, "txSignature" | "explorerUrl" | "cluster">,
): Promise<void> {
  if (!durable()) {
    memory.coins = memory.coins.map((c) =>
      c.mint === mint ? ({ ...c, mode: "live", ...patch } as Coin) : c,
    );
    return;
  }
  await query(
    `UPDATE coins SET
       status     = $2,
       create_sig = COALESCE($3, create_sig),
       explorer   = COALESCE($4, explorer),
       cluster    = COALESCE($5, cluster)
     WHERE mint = $1`,
    [
      mint,
      STATUS_LIVE,
      patch.txSignature ?? null,
      patch.explorerUrl ?? null,
      patch.cluster ?? null,
    ],
  );
}

// --- trends -----------------------------------------------------------------

interface TrendRow {
  id: string;
  source: string;
  title: string;
  score: number;
  started_at: string;
  url: string;
  context: string;
  first_seen_at: string;
}

export async function getTrends(): Promise<Trend[]> {
  if (!durable()) return [];
  const rows = await query<TrendRow>(
    "SELECT * FROM trends ORDER BY position ASC, score DESC",
  );
  const seen = new Set(
    (await query<{ trend_id: string }>("SELECT trend_id FROM radar_seen")).map(
      (r) => r.trend_id,
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source as Trend["source"],
    title: r.title,
    score: r.score,
    startedAt: r.started_at,
    url: r.url,
    context: r.context,
    firstSeenAt: r.first_seen_at,
    isNew: !seen.has(r.id),
  }));
}

export async function setTrends(trends: Trend[]): Promise<void> {
  if (!durable()) return;
  const existing = new Set(
    (await query<{ trend_id: string }>("SELECT trend_id FROM radar_seen")).map(
      (r) => r.trend_id,
    ),
  );
  await query("DELETE FROM trends");
  for (const [i, t] of trends.entries()) {
    await query(
      `INSERT INTO trends
         (id, source, title, score, started_at, url, context, first_seen_at, position, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         score = EXCLUDED.score,
         position = EXCLUDED.position,
         updated_at = EXCLUDED.updated_at`,
      [
        t.id,
        t.source,
        t.title,
        t.score,
        t.startedAt,
        t.url,
        t.context,
        t.firstSeenAt || new Date().toISOString(),
        i,
        new Date().toISOString(),
      ],
    );
    if (!existing.has(t.id)) {
      await query(
        `INSERT INTO radar_seen (trend_id, first_seen) VALUES ($1, $2)
         ON CONFLICT (trend_id) DO NOTHING`,
        [t.id, new Date().toISOString()],
      );
    }
  }
}

// --- radar ------------------------------------------------------------------

async function getSettings(): Promise<RadarSettings> {
  const stored = durable() ? await readState<Partial<RadarSettings>>(STATE_SETTINGS) : null;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sources: { ...DEFAULT_SETTINGS.sources, ...stored?.sources },
  };
}

async function getCounters(): Promise<Counters> {
  const stored = durable() ? await readState<Counters>(STATE_COUNTERS) : null;
  return { ...defaultCounters(), ...stored };
}

export async function getRadarState(): Promise<RadarState> {
  const settings = await getSettings();
  const counters = await getCounters();

  const log: RadarLogEntry[] = durable()
    ? await query<RadarLogEntry>(
        "SELECT at, message FROM radar_log ORDER BY id DESC LIMIT 200",
      )
    : [];

  const recentTitles = (await getTrends()).slice(0, 12).map((t) => t.title);

  return {
    settings,
    running: settings.enabled,
    // The radar never spends. buySol is clamped to 0 by updateSettings and the
    // launch path still needs an explicit /api/launch confirmation, so the
    // radar cannot report itself as able to sign.
    liveCapable: false,
    seen: durable()
      ? (await query<{ trend_id: string }>("SELECT trend_id FROM radar_seen")).map(
          (r) => r.trend_id,
        )
      : [],
    ticks: counters.ticks,
    budget: {
      spentSol: counters.spentSol,
      launchesToday: counters.launchesToday,
      resetsAt: `${today()}T24:00:00.000Z`,
    },
    log,
    recentTitles,
    adminRequired: false,
  };
}

export async function updateSettings(
  patch: Partial<RadarSettings>,
): Promise<RadarSettings> {
  const current = await getSettings();
  const next: RadarSettings = {
    ...current,
    ...patch,
    sources: { ...current.sources, ...(patch.sources ?? {}) },
  };
  // Hard floor: this build cannot spend. buySol is clamped to 0 regardless of
  // what a client sends, and enabled is honoured only as a scanning flag.
  next.buySol = 0;
  if (durable()) await writeState(STATE_SETTINGS, next);
  return next;
}

export async function logRadar(
  message: string,
  extra?: Partial<Pick<Counters, "ticks" | "spentSol" | "launchesToday">> & {
    seen?: string[];
  },
): Promise<void> {
  const counters = await getCounters();
  const log: string[] = [];

  if (counters.budgetDay !== today()) {
    counters.budgetDay = today();
    counters.spentSol = 0;
    counters.launchesToday = 0;
    log.push(`New day (${counters.budgetDay}): daily budget reset`);
  }
  if (extra) {
    if (typeof extra.ticks === "number") counters.ticks = extra.ticks;
    if (typeof extra.spentSol === "number") counters.spentSol = extra.spentSol;
    if (typeof extra.launchesToday === "number")
      counters.launchesToday = extra.launchesToday;
  }
  log.push(message);

  if (!durable()) return;
  await writeState(STATE_COUNTERS, counters);
  const now = new Date().toISOString();
  for (const line of log) {
    await query("INSERT INTO radar_log (at, message) VALUES ($1, $2)", [now, line]);
  }
  // Keep the log bounded, matching the old 200-entry trim.
  await query(
    `DELETE FROM radar_log WHERE id NOT IN (
       SELECT id FROM radar_log ORDER BY id DESC LIMIT 200
     )`,
  );
}

// --- trades -----------------------------------------------------------------

/** A single executed buy or sell, recorded only after its transaction landed. */
export interface TradeRecord {
  id: number;
  mint: string;
  action: "buy" | "sell";
  signature: string;
  wallet: string;
  solLamports: string;
  tokenAtoms: string;
  feeLamports: string;
  priceScaled: string;
  cluster: string;
  createdAt: string;
}

interface TradeRow {
  id: number;
  mint: string;
  action: string;
  signature: string;
  wallet: string | null;
  sol_lamports: string | null;
  token_atoms: string | null;
  fee_lamports: string | null;
  price_scaled: string | null;
  cluster: string | null;
  created_at: Date | string;
}

/**
 * Persists a trade that already confirmed on chain.
 *
 * BigInt values are passed as strings: they exceed what a JS number can hold,
 * and pg would otherwise round them through a float on the way in.
 */
export async function recordTrade(
  trade: Omit<TradeRecord, "id" | "createdAt">,
): Promise<void> {
  if (!durable()) return;
  await query(
    `INSERT INTO trades (
       mint, action, signature, wallet, sol_lamports, token_atoms,
       fee_lamports, price_scaled, cluster
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      trade.mint,
      trade.action,
      trade.signature,
      trade.wallet,
      trade.solLamports,
      trade.tokenAtoms,
      trade.feeLamports,
      trade.priceScaled,
      trade.cluster,
    ],
  );
}

/** Trades for one mint, newest first. */
export async function listTrades(mint: string, limit = 50): Promise<TradeRecord[]> {
  if (!durable()) return [];
  const rows = await query<TradeRow>(
    `SELECT * FROM trades WHERE mint = $1 ORDER BY id DESC LIMIT $2`,
    [mint, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    mint: r.mint,
    action: r.action === "sell" ? "sell" : "buy",
    signature: r.signature,
    wallet: r.wallet ?? "",
    solLamports: r.sol_lamports ?? "0",
    tokenAtoms: r.token_atoms ?? "0",
    feeLamports: r.fee_lamports ?? "0",
    priceScaled: r.price_scaled ?? "0",
    cluster: r.cluster ?? "",
    createdAt: iso(r.created_at),
  }));
}
