import type {
  Coin,
  RadarLogEntry,
  RadarSettings,
  RadarState,
  Trend,
} from "./types";

// ---------------------------------------------------------------------------
// Persistence.
//
// JSON file store under .data/. Chosen over SQLite deliberately: this deploys to
// Vercel's serverless runtime, where the filesystem is read-only and ephemeral,
// so a native SQLite binding would fail at build and at runtime. The file store
// degrades safely — if the FS is not writable, everything still serves from
// memory and the app remains fully functional (records are just not persisted
// across cold starts).
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

interface DB {
  coins: Coin[];
  trends: Trend[];
  log: RadarLogEntry[];
  seen: string[];
  ticks: number;
  spentSol: number;
  launchesToday: number;
  budgetDay: string;
  settings: RadarSettings;
}

const DATA_DIR = process.env.VIRAL_FORGE_DATA_DIR ?? ".data";
const DB_FILE = `${DATA_DIR}/db.json`;

function emptyDB(): DB {
  return {
    coins: [],
    trends: [],
    log: [],
    seen: [],
    ticks: 0,
    spentSol: 0,
    launchesToday: 0,
    budgetDay: new Date().toISOString().slice(0, 10),
    settings: { ...DEFAULT_SETTINGS, sources: { ...DEFAULT_SETTINGS.sources } },
  };
}

// Module-scope cache. Survives across requests within a warm serverless
// instance, and is the source of truth if the filesystem is unavailable.
let cache: DB | null = null;
let fsWritable = true;

async function load(): Promise<DB> {
  if (cache) return cache;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DB>;
    cache = { ...emptyDB(), ...parsed };
    cache.settings = {
      ...DEFAULT_SETTINGS,
      ...parsed.settings,
      sources: { ...DEFAULT_SETTINGS.sources, ...parsed.settings?.sources },
    };
  } catch {
    cache = emptyDB();
  }
  return cache;
}

async function persist(db: DB): Promise<void> {
  if (!fsWritable) return;
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch {
    // Read-only FS (serverless). Keep serving from memory.
    fsWritable = false;
  }
}

// --- coins ------------------------------------------------------------------

export async function listCoins(filter?: string): Promise<Coin[]> {
  const db = await load();
  const sorted = [...db.coins].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  if (!filter || filter === "all") return sorted;
  if (filter === "radar") return sorted.filter((c) => c.launchedBy === "radar");
  if (filter === "manual") return sorted.filter((c) => c.launchedBy === "user");
  if (filter === "live") return sorted.filter((c) => c.mode === "live");
  if (filter === "simulated") return sorted.filter((c) => c.mode === "simulated");
  return sorted;
}

export async function getCoin(mint: string): Promise<Coin | null> {
  const db = await load();
  return db.coins.find((c) => c.mint === mint || c.id === mint) ?? null;
}

export async function addCoin(coin: Coin): Promise<Coin> {
  const db = await load();
  db.coins.unshift(coin);
  await persist(db);
  return coin;
}

// --- trends -----------------------------------------------------------------

export async function getTrends(): Promise<Trend[]> {
  const db = await load();
  return db.trends;
}

export async function setTrends(trends: Trend[]): Promise<void> {
  const db = await load();
  const existing = new Set(db.seen);
  db.trends = trends.map((t) => ({ ...t, isNew: !existing.has(t.id) }));
  await persist(db);
}

// --- radar ------------------------------------------------------------------

export async function getRadarState(): Promise<RadarState> {
  const db = await load();
  const today = new Date().toISOString().slice(0, 10);
  const resetsAt = `${today}T24:00:00.000Z`;
  return {
    settings: db.settings,
    running: db.settings.enabled,
    // Simulation-by-default: no radar wallet is configured in this build, so the
    // radar never reports itself as capable of spending. See /radar copy.
    liveCapable: false,
    seen: db.seen,
    ticks: db.ticks,
    budget: {
      spentSol: db.spentSol,
      launchesToday: db.launchesToday,
      resetsAt,
    },
    log: db.log,
    recentTitles: db.trends.slice(0, 12).map((t) => t.title),
    adminRequired: false,
  };
}

export async function updateSettings(
  patch: Partial<RadarSettings>,
): Promise<RadarSettings> {
  const db = await load();
  db.settings = {
    ...db.settings,
    ...patch,
    sources: { ...db.settings.sources, ...(patch.sources ?? {}) },
  };
  // Hard floor: this build cannot spend. buySol is clamped to 0 regardless of
  // what a client sends, and enabled is honoured only as a scanning flag.
  db.settings.buySol = 0;
  await persist(db);
  return db.settings;
}

export async function logRadar(
  message: string,
  extra?: Partial<Pick<DB, "seen" | "ticks" | "spentSol" | "launchesToday">>,
): Promise<void> {
  const db = await load();
  const today = new Date().toISOString().slice(0, 10);
  if (db.budgetDay !== today) {
    db.budgetDay = today;
    db.spentSol = 0;
    db.launchesToday = 0;
    db.log.unshift({
      at: new Date().toISOString(),
      message: `New day (${today}): daily budget reset`,
    });
  }
  db.log.unshift({ at: new Date().toISOString(), message });
  db.log = db.log.slice(0, 200);
  if (extra) {
    if (extra.seen) db.seen = extra.seen;
    if (typeof extra.ticks === "number") db.ticks = extra.ticks;
    if (typeof extra.spentSol === "number") db.spentSol = extra.spentSol;
    if (typeof extra.launchesToday === "number") db.launchesToday = extra.launchesToday;
  }
  await persist(db);
}
