import { describe, expect, it } from "vitest";
import { forgeFromTrend, forgeLocally } from "./forge";
import type { Trend } from "./types";

describe("forgeLocally", () => {
  it("is deterministic for the same source/input/style", () => {
    const a = forgeLocally("prompt", "cyber frog", "meme");
    const b = forgeLocally("prompt", "cyber frog", "meme");
    expect(a).toEqual(b);
  });

  it("produces a non-empty name and an uppercase symbol", () => {
    const r = forgeLocally("prompt", "cyber frog", "auto");
    expect(r.name.length).toBeGreaterThan(0);
    expect(r.symbol).toBe(r.symbol.toUpperCase());
    expect(r.symbol.length).toBeGreaterThanOrEqual(3);
    expect(r.symbol.length).toBeLessThanOrEqual(5);
  });

  it("appends the project attribution to every lore", () => {
    const r = forgeLocally("prompt", "quantum llama", "auto");
    expect(r.description).toContain("Launched thru viral-forge");
  });

  it("derives at least three tags", () => {
    const r = forgeLocally("prompt", "cyber frog on mars", "auto");
    expect(r.tags.length).toBeGreaterThanOrEqual(3);
  });

  it("never resolves a concrete style to 'auto'", () => {
    const r = forgeLocally("prompt", "cyber frog", "realistic");
    expect(r.imageStyle).toBe("realistic");
  });

  it("infers cartoon style from animal words when style is auto", () => {
    const r = forgeLocally("prompt", "a very good dog", "auto");
    expect(r.imageStyle).toBe("cartoon");
  });

  it("infers 3d style from render words when style is auto", () => {
    const r = forgeLocally("prompt", "chrome 3d render", "auto");
    expect(r.imageStyle).toBe("3d");
  });

  it("handles empty input without throwing", () => {
    const r = forgeLocally("prompt", "", "auto");
    expect(r.name.length).toBeGreaterThan(0);
  });
});

describe("forgeFromTrend", () => {
  const trend: Trend = {
    id: "t1",
    source: "google",
    title: "AI agents take over the timeline",
    score: 90,
    startedAt: new Date().toISOString(),
    url: "https://example.com",
    context: "Exploding interest · category: technology",
    firstSeenAt: new Date().toISOString(),
    isNew: true,
  };

  it("seeds the coin from the trend title", () => {
    const r = forgeFromTrend(trend);
    expect(r.description).toContain("AI agents take over the timeline");
    expect(r.description).toContain("Launched thru viral-forge");
  });

  it("strips the category annotation from context", () => {
    expect(forgeFromTrend(trend).description).not.toContain("category:");
  });
});
