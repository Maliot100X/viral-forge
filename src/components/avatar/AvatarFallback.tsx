"use client";

/**
 * Shown when the three.ws CDN is unreachable or the body fails to render.
 * Deliberately not a spinner: a flat procedural sigil keeps the profile page
 * legible and makes it obvious that what you are looking at is a placeholder.
 */

type Props = {
  accent?: string;
  label?: string;
  compact?: boolean;
};

function sigilFrom(seed: string): number[] {
  // Deterministic 5x5 half-block so the same agent always looks the same.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const cells: number[] = [];
  for (let i = 0; i < 15; i += 1) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    cells.push((h >>> 0) % 2);
  }
  return cells;
}

export function AvatarFallback({ accent = "#7cf9c0", label, compact }: Props) {
  const cells = sigilFrom(label ?? "agent");
  // Mirror the left three columns into the right three so it reads as a crest.
  const mirrored: number[] = [];
  for (let row = 0; row < 5; row += 1) {
    const a = cells.slice(row * 3, row * 3 + 3);
    mirrored.push(...a, a[1]!, a[0]!);
  }

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg-soft"
      data-avatar-fallback="sigil"
    >
      <div
        className="grid-bg pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div
        className="relative grid grid-cols-5 gap-[3px]"
        aria-hidden
        style={{ filter: `drop-shadow(0 0 12px ${accent}55)` }}
      >
        {mirrored.map((on, i) => (
          <span
            key={i}
            style={{
              width: compact ? 8 : 13,
              height: compact ? 8 : 13,
              background: on ? accent : "transparent",
              border: on ? "none" : "1px solid var(--line)",
            }}
          />
        ))}
      </div>
      {!compact && (
        <div className="relative text-center">
          <div className="label">3D UNAVAILABLE</div>
          {label && (
            <div className="mono mt-1 text-xs text-fg-dim">{label}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default AvatarFallback;
