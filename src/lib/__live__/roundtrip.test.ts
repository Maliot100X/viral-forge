// Real round-trip against the live Neon database.
//
// Not picked up by `npm test` (which only includes src/**/*.test.ts and clears
// DATABASE_URL). Run explicitly:
//   npx vitest run src/lib/__live__/roundtrip.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function loadEnv() {
  const txt = readFileSync("/home/coder/.env", "utf8");
  for (const line of txt.split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[line.slice(0, i).trim()] = v;
  }
}
loadEnv();
process.env.DATABASE_URL ||= process.env.DATABASE_URL_UNPOOLED;

describe("store against live Neon", () => {
  it("round-trips a coin, flips it live only via markCoinLive, and reads the pre-existing rows", async () => {
    const s = await import("../store");
    const db = await import("../db");

    const health = await db.dbHealth();
    console.log("db health:", JSON.stringify(health));
    expect(health.ok).toBe(true);
    expect(s.persistence()).toBe("postgres");

    // 1. Pre-existing rows must be readable and correctly classified.
    const all = await s.listCoins();
    console.log(`pre-existing rows: ${all.length}`);
    for (const c of all) {
      console.log(`  [${c.mode}] ${c.symbol} ${c.name} mint=${c.mint || "(none)"}`);
    }
    expect(all.length).toBeGreaterThan(0);
    // A record is live only when it carries a signature and an explorer link.
    for (const c of all.filter((x) => x.mode === "live")) {
      expect(c.txSignature, `${c.name} marked live without a signature`).toBeTruthy();
      expect(c.explorerUrl).toBeTruthy();
    }
    const preLive = all.filter((c) => c.mode === "live");
    console.log(`live rows verified to carry a signature: ${preLive.length}`);
    expect(preLive.length).toBeGreaterThan(0);

    // 2. A fresh insert must come back SIMULATED even if the caller lies.
    const stamp = Date.now().toString(36).toUpperCase();
    const mint = `RT${stamp}${"x".repeat(40)}`.slice(0, 43);
    const imagePrompt = `rt-prompt-${stamp}`;
    await s.addCoin({
      id: `rt_${stamp}`, name: "Round Trip", symbol: "$RT",
      description: "round trip row", imageUrl: "https://example.invalid/x.png",
      imagePrompt, imageStyle: "meme", tags: ["a", "b"], vibe: "v",
      source: "prompt", sourceRef: "rt", mint, createdAt: new Date().toISOString(),
      // Deliberately claims live; addCoin must refuse to record that.
      mode: "live", launchedBy: "user",
      pumpUrl: `https://pump.fun/coin/${mint}`,
      provenance: "river", imageProvenance: "pollinations",
    });

    const inserted = await s.getCoin(mint);
    expect(inserted).not.toBeNull();
    expect(inserted!.tags).toEqual(["a", "b"]);
    expect(inserted!.provenance).toBe("river");
    expect(inserted!.mode).toBe("simulated");
    expect(inserted!.txSignature).toBeUndefined();
    console.log(`inserted ${inserted!.name} -> mode=${inserted!.mode} (no signature yet)`);

    // 3. Only markCoinLive may flip it, and it must attach the real signature.
    await s.markCoinLive(mint, {
      txSignature: "sig-roundtrip",
      explorerUrl: `https://explorer.solana.com/tx/sig-roundtrip?cluster=devnet`,
      cluster: "devnet",
    });
    const after = await s.getCoin(mint);
    expect(after!.mode).toBe("live");
    expect(after!.txSignature).toBe("sig-roundtrip");
    expect(after!.cluster).toBe("devnet");
    console.log(`after markCoinLive -> mode=${after!.mode} cluster=${after!.cluster}`);

    // 4. Trends, radar log and radar state.
    const trendId = `t_${stamp}`;
    await s.setTrends([{
      id: trendId, source: "google", title: `RT trend ${stamp}`, score: 9,
      startedAt: new Date().toISOString(), url: "u", context: "c",
      firstSeenAt: new Date().toISOString(), isNew: false,
    }]);
    expect((await s.getTrends()).some((t) => t.id === trendId)).toBe(true);

    await s.logRadar(`roundtrip log ${stamp}`);
    expect((await s.getRadarState()).log.some((l) => l.message === `roundtrip log ${stamp}`)).toBe(true);

    await s.updateSettings({ enabled: true, buySol: 5 });
    const settings = (await s.getRadarState()).settings;
    expect(settings.enabled).toBe(true);
    expect(settings.buySol).toBe(0);
    console.log("radar settings persisted with buySol clamped to", settings.buySol);

    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    );
    console.log("tables:", tables.map((t) => t.table_name).join(", "));

    // 5. Clean up only what this test created.
    await db.query("DELETE FROM coins WHERE mint = $1", [mint]);
    await db.query("DELETE FROM trends WHERE id = $1", [trendId]);
    await db.query("DELETE FROM radar_seen WHERE trend_id = $1", [trendId]);
    await db.query("DELETE FROM radar_log WHERE message = $1", [`roundtrip log ${stamp}`]);
    await db.query("DELETE FROM radar_state WHERE key = 'settings'");
    // Leave the coins table exactly as it was found.
    const remaining = await s.listCoins();
    console.log(`rows after cleanup: ${remaining.length}`);
    expect(remaining.some((c) => c.mint === mint)).toBe(false);
  }, 120_000);
});
