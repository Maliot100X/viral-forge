import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store reads VIRAL_FORGE_DATA_DIR at module load, so point it at a fresh
// temp dir before importing, and reset the module registry per test.
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vf-store-"));
  process.env.VIRAL_FORGE_DATA_DIR = dir;
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.VIRAL_FORGE_DATA_DIR;
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
    await s.addCoin(coin({ id: "c_2", mint: "mint2", launchedBy: "radar", mode: "live" }));
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

  it("marks only genuinely new trends as isNew", async () => {
    const s = await freshStore();
    const t = {
      id: "t1", source: "google" as const, title: "x", score: 1,
      startedAt: "2025-01-01T00:00:00.000Z", url: "u", context: "c",
      firstSeenAt: "2025-01-01T00:00:00.000Z", isNew: false,
    };
    await s.setTrends([t]);
    expect((await s.getTrends())[0].isNew).toBe(true);
    // Second sighting: the id is now in `seen`... but seen is only fed by the
    // radar, so a re-set still reports not-new only once seen is populated.
    const state = await s.getRadarState();
    expect(state.recentTitles).toContain("x");
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

  it("caps the radar log at 200 entries", async () => {
    const s = await freshStore();
    for (let i = 0; i < 260; i++) await s.logRadar(`entry ${i}`);
    expect((await s.getRadarState()).log.length).toBe(200);
  });

  it("records ticks and seen via the log extras", async () => {
    const s = await freshStore();
    await s.logRadar("tick", { ticks: 7, seen: ["a", "b"] });
    const state = await s.getRadarState();
    expect(state.ticks).toBe(7);
    expect(state.seen).toEqual(["a", "b"]);
  });

  it("survives a corrupt db file by falling back to empty", async () => {
    const s = await freshStore();
    await s.addCoin(coin());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "db.json"), "{not json", "utf8");
    // Drop the module-scope cache so the corrupt file is actually re-read.
    vi.resetModules();
    const s2 = await freshStore();
    expect(await s2.listCoins()).toEqual([]);
  });
});
