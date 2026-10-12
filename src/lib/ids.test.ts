import { describe, expect, it } from "vitest";
import { generateCoinId, generateMint, shortMint, slug } from "./ids";

describe("generateMint", () => {
  it("produces a 44-char base58 string", () => {
    const mint = generateMint();
    expect(mint).toHaveLength(44);
    expect(mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("excludes the base58-confusable characters 0, O, I and l", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateMint()).not.toMatch(/[0OIl]/);
    }
  });

  it("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateMint()));
    expect(seen.size).toBe(200);
  });
});

describe("generateCoinId", () => {
  it("is prefixed and unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCoinId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^c_[0-9a-f]{14}$/);
  });
});

describe("shortMint", () => {
  it("truncates long mints with an ellipsis", () => {
    expect(shortMint("ABCDEFGHJKLMNPQRSTUVWXYZ")).toBe("ABCD…WXYZ");
  });

  it("returns short input untouched", () => {
    expect(shortMint("ABC")).toBe("ABC");
  });
});

describe("slug", () => {
  it("lowercases and hyphenates", () => {
    expect(slug("Doge 2.0 Moon!")).toBe("doge-2-0-moon");
  });

  it("strips leading and trailing separators", () => {
    expect(slug("  --hello--  ")).toBe("hello");
  });

  it("caps length at 48", () => {
    expect(slug("a".repeat(120))).toHaveLength(48);
  });
});
