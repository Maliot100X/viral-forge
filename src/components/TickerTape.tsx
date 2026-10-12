"use client";

import { useEffect, useState } from "react";
import type { Trend } from "@/lib/types";

const SOURCE_BADGE: Record<Trend["source"], string> = {
  google: "G",
  bluesky: "B",
  mastodon: "M",
  reddit: "R",
};

/**
 * TickerTape — the live trend marquee at the top of the homepage. Polls
 * /api/trends, renders the cached set, and falls back to a static placeholder
 * line while the first scan lands so the layout never collapses.
 */
export default function TickerTape() {
  const [trends, setTrends] = useState<Trend[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/trends");
        if (!res.ok) return;
        const data = (await res.json()) as { trends: Trend[] };
        if (alive) setTrends(data.trends ?? []);
      } catch {
        /* offline is fine — tape just shows the placeholder */
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const items = trends.length
    ? trends.slice(0, 28)
    : [
        {
          id: "seed-1",
          source: "google" as const,
          title: "no scan yet — open the radar to pull live trends",
          score: 0,
          url: "/radar",
          context: "",
          startedAt: "",
          firstSeenAt: "",
          isNew: false,
        },
      ];

  // duplicated once so the CSS -50% translate loops seamlessly
  const loop = [...items, ...items];

  return (
    <div className="tape border-y border-line bg-bg-soft/60 py-1.5">
      <div className="tape-track">
        {loop.map((t, idx) => (
          <span key={`${t.id}-${idx}`} className="mono text-[11px] text-fg-dim">
            <span className="pill mr-2 text-fg-faint" style={{ borderColor: "var(--line-bright)" }}>
              {SOURCE_BADGE[t.source]}
            </span>
            <a href={t.url} target="_blank" rel="noreferrer" className="hover:text-accent">
              {t.title}
            </a>
            {t.score > 0 && <span className="ml-2 text-accent-dim">{t.score}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
