import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store now persists to Postgres, which these unit tests deliberately do
// not touch: DATABASE_URL is cleared so every test exercises the in-memory
// fallback. Postgres behaviour is covered by the round-trip script run against
// the real database, not by this file.
//
// Two radar paths need a database — `seen` is a table and the log is capped by
// a SQL DELETE — so those are asserted against a stub rather than skipped.

const SAVED_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

afterEach(() => {
  if (SAVED_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED_DB_URL;
});

async function freshStore() {
  // resetModules() in beforeEach guarantees a clean module-scope cache.
  return import("./store");
}

function coin(over: Record<string, unknown> = {}) {
  return {
    id: "c_1",
    name: "Test Coin",
    symbol: "TEST",
    description: "lore",
    imageUrl: "/api/logo/abc.webp",
    imagePrompt: "prompt",
    imageStyle: "meme",
    tags: ["a", "b", "c"],
    vibe: "degen",
    source: "prompt",
    sourceRef: "test",
    mint: "So11111111111111111111111111111111111111112",
    createdAt: new Date().toISOString(),
    mode: "simulated",
    launchedBy: "user",
    pumpUrl: "https://pump.fun/coin/abc",
    ...over,
  } as never;
}

describe("store", () => {
  it("starts empty", async () => {
    const s = await freshStore();
    expect(await s.listCoins()).toEqual([]);
  });

  it("adds and reads back a coin", async () => {
    const s = await freshStore();
    await s.addCoin(coin());
    const coins = await s.listCoins();
    expect(coins).toHaveLength(1);
    expect(coins[0].symbol).toBe("TEST");
  });

  it("finds a coin by mint or by id", async () => {
    const s = await freshStore();
    await s.addCoin(coin());
    expect(await s.getCoin("So11111111111111111111111111111111111111112")).not.toBeNull();
    expect(await s.getCoin("c_1")).not.toBeNull();
    expect(await s.getCoin("nope")).toBeNull();
  });

  it("filters by mode and launcher", async () => {
    const s = await freshStore();
    await s.addCoin(coin({ id: "c_1", mint: "mint1", launchedBy: "user", mode: "simulated" }));
    // Live requires a signature (see the invariant tests below), so the live
    // fixture carries one rather than asserting the mode flag alone.
    await s.addCoin(
      coin({
        id: "c_2",
        mint: "mint2",
        launchedBy: "radar",
        mode: "live",
        txSignature: "sig-filter",
        explorerUrl: "https://explorer.solana.com/tx/sig-filter?cluster=devnet",
        cluster: "devnet",
      }),
    );
    expect(await s.listCoins("simulated")).toHaveLength(1);
    expect(await s.listCoins("live")).toHaveLength(1);
    expect(await s.listCoins("radar")).toHaveLength(1);
    expect(await s.listCoins("manual")).toHaveLength(1);
    expect(await s.listCoins("all")).toHaveLength(2);
  });

  it("sorts newest first", async () => {
    const s = await freshStore();
    await s.addCoin(coin({ id: "old", mint: "m1", createdAt: "2024-01-01T00:00:00.000Z" }));
    await s.addCoin(coin({ id: "new", mint: "m2", createdAt: "2025-01-01T00:00:00.000Z" }));
    const coins = await s.listCoins();
    expect(coins[0].id).toBe("new");
  });

  it("reports memory persistence when no database is configured", async () => {
    const s = await freshStore();
    expect(s.persistence()).toBe("memory");
  });

  it("reports liveCapable false and buySol 0 — the spend floor", async () => {
    const s = await freshStore();
    const state = await s.getRadarState();
    expect(state.liveCapable).toBe(false);
    expect(state.settings.buySol).toBe(0);
    expect(state.settings.enabled).toBe(false);
  });

  it("clamps buySol to 0 even when a client asks for a spend", async () => {
    const s = await freshStore();
    const next = await s.updateSettings({ buySol: 5, enabled: true });
    expect(next.buySol).toBe(0);
    expect(next.enabled).toBe(true);
    expect((await s.getRadarState()).settings.buySol).toBe(0);
  });

  it("merges partial source toggles without dropping the others", async () => {
    const s = await freshStore();
    const next = await s.updateSettings({ sources: { reddit: false } } as never);
    expect(next.sources.reddit).toBe(false);
    expect(next.sources.google).toBe(true);
    expect(next.sources.bluesky).toBe(true);
  });

  // Regression: a row once sat in the live database with status='LIVE' and
  // create_sig=NULL, pointing at an explorer *address* link. The site therefore
  // advertised an on-chain coin that had never been minted. `mode` is derived
  // from the signature, not read from the stored status, so that state can no
  // longer be produced or rendered.
  it("refuses to mark a coin live without a signature", async () => {
    const s = await freshStore();
    // A caller that omits the signature entirely.
    await s.addCoin(coin({ id: "c_1", mint: "mint1", mode: "live", txSignature: undefined }));
    // A caller that passes an empty string, which is not evidence of anything.
    await s.addCoin(coin({ id: "c_2", mint: "mint2", mode: "live", txSignature: "" }));

    for (const c of await s.listCoins()) {
      expect(c.mode, `${c.name} was stored as live`).toBe("simulated");
      expect(c.txSignature).toBeUndefined();
      // An explorer link without a transaction is not evidence either.
      expect(c.explorerUrl).toBeUndefined();
    }
  });

  it("marks a coin live only when a signature is attached", async () => {
    const s = await freshStore();
    await s.addCoin(coin({ id: "c_1", mint: "mint1", mode: "simulated" }));
    expect((await s.getCoin("mint1"))!.mode).toBe("simulated");

    await s.markCoinLive("mint1", {
      txSignature: "sig-real",
      explorerUrl: "https://explorer.solana.com/tx/sig-real?cluster=devnet",
      cluster: "devnet",
    });

    const live = (await s.getCoin("mint1"))!;
    expect(live.mode).toBe("live");
    expect(live.txSignature).toBe("sig-real");
    expect(live.explorerUrl).toContain("sig-real");
    expect(live.cluster).toBe("devnet");
  });

  it("does not report a cluster for a coin that is not live", async () => {
    const s = await freshStore();
    await s.addCoin(
      coin({ id: "c_1", mint: "mint1", mode: "live", cluster: "devnet", txSignature: undefined }),
    );
    expect((await s.getCoin("mint1"))!.cluster).toBeUndefined();
  });
});

describe("store against a stubbed postgres", () => {
  const rows: { at: string; message: string }[] = [];
  const state = new Map<string, unknown>();
  let trendRows: Record<string, unknown>[] = [];
  let seenIds = new Set<string>();
  const queries: { text: string; params: unknown[] }[] = [];

  /**
   * The stub the store sees. Built through a plain executor so the test file can
   * drive the same fake tables directly when it needs to seed a state that the
   * store's own writes would otherwise create.
   */
  const execute = async (text: string, params: unknown[] = []) => {
    const t = text.replace(/\s+/g, " ").trim();
    queries.push({ text: t, params });
    if (t.startsWith("INSERT INTO radar_log")) {
      rows.unshift({ at: params[0] as string, message: params[1] as string });
    }
    if (t.startsWith("DELETE FROM radar_log")) {
      rows.splice(200);
    }
    if (t.startsWith("SELECT at, message FROM radar_log")) {
      return rows.slice(0, 200);
    }
    if (t.startsWith("SELECT trend_id FROM radar_seen")) {
      return [...seenIds].map((id) => ({ trend_id: id }));
    }
    if (t.startsWith("INSERT INTO radar_seen")) {
      seenIds.add(params[0] as string);
      return [];
    }
    if (t.startsWith("DELETE FROM trends")) {
      trendRows = [];
      return [];
    }
    if (t.startsWith("INSERT INTO trends")) {
      trendRows.push({
        id: params[0], source: params[1], title: params[2], score: params[3],
        started_at: params[4], url: params[5], context: params[6],
        first_seen_at: params[7],
      });
      return [];
    }
    if (t.startsWith("SELECT * FROM trends")) return trendRows;
    return [];
  };
  const stubDb = { query: execute };

  beforeEach(() => {
    rows.length = 0;
    state.clear();
    trendRows = [];
    seenIds = new Set();
    queries.length = 0;
    process.env.DATABASE_URL = "postgresql://stub/db";
    vi.resetModules();
    vi.doMock("./db", () => ({
      durable: () => true,
      readState: async (k: string) => state.get(k) ?? null,
      writeState: async (k: string, v: unknown) => void state.set(k, v),
      query: execute,
    }));
  });

  afterEach(() => {
    vi.doUnmock("./db");
  });

  it("caps the radar log at 200 entries with a SQL trim", async () => {
    const s = await freshStore();
    for (let i = 0; i < 260; i++) await s.logRadar(`entry ${i}`);
    expect((await s.getRadarState()).log.length).toBe(200);
    expect(queries.some((q) => q.text.startsWith("DELETE FROM radar_log"))).toBe(true);
  });

  it("records ticks via the log extras", async () => {
    const s = await freshStore();
    await s.logRadar("tick", { ticks: 7 });
    expect((await s.getRadarState()).ticks).toBe(7);
  });

  it("seeds radar_seen on first sight and reports new only until then", async () => {
    const s = await freshStore();
    const t = {
      id: "t1", source: "google" as const, title: "x", score: 1,
      startedAt: "2025-01-01T00:00:00.000Z", url: "u", context: "c",
      firstSeenAt: "2025-01-01T00:00:00.000Z", isNew: false,
    };

    // Seed the trends table through the same stub the store uses. setTrends
    // records every trend it is given as seen, so a single setTrends call can
    // never observe the "new" branch — the seed has to happen underneath it.
    expect(await s.getTrends()).toEqual([]);
    await stubDb.query(
      "INSERT INTO trends (id, source, title, score, started_at, url, context, first_seen_at, position, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      ["t1", "google", "x", 1, t.startedAt, "u", "c", t.firstSeenAt, 0, t.startedAt],
    );

    // Not yet in radar_seen -> new.
    expect((await s.getTrends())[0].isNew).toBe(true);

    // Once the radar records the id as seen, it is no longer new.
    await stubDb.query(
      "INSERT INTO radar_seen (trend_id, first_seen) VALUES ($1, $2)",
      ["t1", t.firstSeenAt],
    );
    expect((await s.getTrends())[0].isNew).toBe(false);
    expect((await s.getRadarState()).recentTitles).toContain("x");
  });

  it("persists settings through radar_state", async () => {
    const s = await freshStore();
    await s.updateSettings({ enabled: true, buySol: 9 });
    const next = await s.getRadarState();
    expect(next.settings.enabled).toBe(true);
    expect(next.settings.buySol).toBe(0);
  });
});
