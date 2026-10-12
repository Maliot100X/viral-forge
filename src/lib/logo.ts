import type { Coin, LogoStyle } from "./types";

// ---------------------------------------------------------------------------
// Pixel-logo generator.
//
// Produces SVG, matching the reference site's pixel-art logo aesthetic. The
// reference serves .webp from /api/logo/<mint>.webp; we keep the exact same
// route shape and content-type negotiation, but render SVG because it needs no
// native image dependency and scales crisply. Callers requesting .webp receive
// SVG bytes with an explicit svg content-type.
//
// Deterministic: the same mint always yields the same logo, so a coin's art is
// stable across reloads and deploys.
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const PALETTES: Record<string, string[][]> = {
  meme: [
    ["#ff4d6d", "#ffd166", "#06d6a0", "#118ab2", "#073b4c"],
    ["#f72585", "#b5179e", "#7209b7", "#4361ee", "#4cc9f0"],
    ["#ff9f1c", "#ffbf69", "#ffffff", "#2ec4b6", "#011627"],
  ],
  cartoon: [
    ["#5e60ce", "#64dfdf", "#48bfe3", "#5390d9", "#6930c3"],
    ["#f4a261", "#e76f51", "#e9c46a", "#2a9d8f", "#264653"],
  ],
  "3d": [
    ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"],
    ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff"],
  ],
  realistic: [
    ["#ffe0b2", "#d7a86e", "#8d6e63", "#4e342e", "#212121"],
    ["#cfd8dc", "#90a4ae", "#546e7a", "#37474f", "#eceff1"],
  ],
  anime: [
    ["#ff89bb", "#ffc7d9", "#bde0fe", "#a2d2ff", "#cdb4db"],
    ["#f72585", "#7209b7", "#3a0ca3", "#4361ee", "#4cc9f0"],
  ],
};

const GRID = 16;

function make(nullableMint: string, style: LogoStyle): string {
  const seed = hash(nullableMint);
  const r = rng(seed);
  const key = style === "auto" ? "meme" : style;
  const palette = PALETTES[key] ?? PALETTES.meme;
  const colors = palette[seed % palette.length];

  const bg = colors[colors.length - 1];
  const cells: string[] = [];

  // 8x8 mirrored sprite — classic pixel-avatar construction. Mirroring on the
  // X axis is what makes the output read as a character rather than noise.
  const size = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x <= Math.floor(size / 2); x++) {
      const on = r() > 0.42;
      if (!on) continue;
      const c = colors[Math.floor(r() * (colors.length - 1))];
      const scale = GRID / size;
      const px = (x * scale).toFixed(3);
      const py = (y * scale).toFixed(3);
      cells.push(
        `<rect x="${px}" y="${py}" width="${scale}" height="${scale}" fill="${c}"/>`,
      );
      const mx = ((size - 1 - x) * scale).toFixed(3);
      if (mx !== px) {
        cells.push(
          `<rect x="${mx}" y="${py}" width="${scale}" height="${scale}" fill="${c}"/>`,
        );
      }
    }
  }

  const accent = colors[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="512" height="512" shape-rendering="crispEdges" role="img" aria-label="Generated pixel logo">
<rect width="${GRID}" height="${GRID}" fill="${bg}"/>
${cells.join("\n")}
<rect x="0" y="0" width="${GRID}" height="${GRID}" fill="none" stroke="${accent}" stroke-width="0.5"/>
</svg>`;
}

export function logoFromMint(mint: string, style: LogoStyle = "auto"): string {
  return make(mint, style);
}

export function logoForCoin(coin: Pick<Coin, "mint" | "imageStyle">): string {
  return make(coin.mint, coin.imageStyle);
}
