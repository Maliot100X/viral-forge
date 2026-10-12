import { describe, expect, it } from "vitest";
import { logoForCoin, logoFromMint } from "./logo";
import type { LogoStyle } from "./types";

const STYLES: LogoStyle[] = ["auto", "meme", "cartoon", "3d", "realistic", "anime"];

describe("logoFromMint", () => {
  it("returns a standalone SVG document", () => {
    const svg = logoFromMint("So11111111111111111111111111111111111111112");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("is deterministic — the same mint always yields identical art", () => {
    const mint = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    expect(logoFromMint(mint)).toBe(logoFromMint(mint));
  });

  it("changes with the mint", () => {
    expect(logoFromMint("mintAAA")).not.toBe(logoFromMint("mintBBB"));
  });

  it("renders every declared style without throwing", () => {
    for (const style of STYLES) {
      const svg = logoFromMint("So11111111111111111111111111111111111111112", style);
      expect(svg).toContain("<svg");
    }
  });

  it("produces different art for different styles of the same mint", () => {
    const mint = "So11111111111111111111111111111111111111112";
    expect(logoFromMint(mint, "meme")).not.toBe(logoFromMint(mint, "anime"));
  });

  it("uses crisp pixel rendering and a fixed viewBox", () => {
    const svg = logoFromMint("So11111111111111111111111111111111111111112");
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('viewBox="0 0 16 16"');
  });
});

describe("logoForCoin", () => {
  it("matches the mint+style pair", () => {
    const coin = { mint: "So11111111111111111111111111111111111111112", imageStyle: "anime" as const };
    expect(logoForCoin(coin)).toBe(logoFromMint(coin.mint, coin.imageStyle));
  });
});
