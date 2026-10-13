"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sourceLabel, useForgeProcess, type ProcessStep } from "@/lib/process";
import { useToast } from "./Toasts";
import type { Trend } from "@/lib/types";

/**
 * ProcessCompanion — the bottom-left agent panel.
 *
 * It reads the shared forge-process store, so its checklist and narration
 * track real work: reading the source, naming, writing lore, drawing the
 * logo, then the launch. It also surfaces live trend freshness from
 * /api/trends. Dismissing collapses it to a handle that reopens it.
 */

const SOURCE_LETTER: Record<string, string> = {
  google: "G",
  bluesky: "B",
  mastodon: "M",
  reddit: "R",
};

function relTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function StepRow({ step }: { step: ProcessStep }) {
  const glyph =
    step.status === "done"
      ? "✓"
      : step.status === "active"
        ? "▸"
        : step.status === "failed"
          ? "✗"
          : "·";
  const tone =
    step.status === "done"
      ? "text-accent"
      : step.status === "active"
        ? "text-fg"
        : step.status === "failed"
          ? "text-danger"
          : "text-fg-faint";
  return (
    <li className={`mono flex items-center gap-2 text-[11px] ${tone}`}>
      <span aria-hidden="true" className="w-3 shrink-0">
        {glyph}
      </span>
      <span>{step.label}</span>
    </li>
  );
}

export default function ProcessCompanion() {
  const phase = useForgeProcess((s) => s.phase);
  const steps = useForgeProcess((s) => s.steps);
  const message = useForgeProcess((s) => s.message);
  const subject = useForgeProcess((s) => s.subject);
  const source = useForgeProcess((s) => s.source);
  const launchedSymbol = useForgeProcess((s) => s.launchedSymbol);

  const [open, setOpen] = useState(true);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  // Starts at 0 and is filled in by an effect: reading the clock during render
  // would freeze the value at prerender time instead of per visit.
  const [now, setNow] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  // The engine actually in use, read from the API rather than asserted in copy.
  const [brain, setBrain] = useState<{ live: boolean; label: string } | null>(null);
  const [cluster, setCluster] = useState<string | null>(null);
  const { push } = useToast();
  const lastPhase = useRef(phase);

  // Ask the server which brain and cluster are really in use. The footer used
  // to hardcode "every coin here is simulated", which became a lie the moment
  // a real transaction landed.
  useEffect(() => {
    // This effect has no cleanup, so nothing ever flips this flag. It stays a
    // plain guard for the case where the component unmounts mid-fetch.
    const cancelled = false;
    async function loadStatus() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = (await res.json()) as {
          brain?: { live: boolean; label: string };
          cluster?: string;
        };
        if (cancelled) return;
        setBrain(data.brain ?? null);
        if (data.cluster) setCluster(data.cluster);
      } catch {
        /* non-essential */
      }
    }
    loadStatus();
  }, []);

  // Respect the OS motion preference.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // One trend fetch on mount, then a slow refresh — enough to read as live.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/trends");
        if (!res.ok) return;
        const data = (await res.json()) as { trends?: Trend[] };
        if (cancelled) return;
        setTrends((data.trends ?? []).slice(0, 5));
        setFetchedAt(Date.now());
      } catch {
        /* companion is non-essential; stay quiet on failure */
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Tick the freshness clock only while something is displayed.
  useEffect(() => {
    if (!fetchedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fetchedAt]);

  // Announce phase changes to assistive tech, and toast the terminal ones once.
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    if (phase === "launched" && launchedSymbol) {
      push(`${launchedSymbol} recorded`, "ok");
    }
  }, [phase, launchedSymbol, push]);

  const hot = useMemo(
    () => [...trends].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3),
    [trends],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the forge process agent"
        className="btn fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2 text-xs"
      >
        <span aria-hidden="true" className="text-accent">
          ◈
        </span>
        <span className="mono">process agent</span>
        {phase !== "idle" && (
          <span aria-hidden="true" className="blink text-accent">
            ●
          </span>
        )}
      </button>
    );
  }

  const working = phase !== "idle" && phase !== "error";

  return (
    <aside
      className="fixed bottom-4 left-4 z-40 w-[19rem] max-w-[calc(100vw-2rem)]"
      aria-label="Forge process agent"
    >
      <div className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span aria-hidden="true" className="text-accent">
            ◈
          </span>
          <span className="label">forge agent</span>
          <span
            className={`mono ml-auto text-[10px] ${
              working ? "text-accent" : "text-fg-faint"
            }`}
          >
            {working ? (
              <>
                <span aria-hidden="true" className={reduced ? "" : "blink"}>
                  ●
                </span>{" "}
                working
              </>
            ) : (
              "idle"
            )}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse the forge process agent"
            className="mono px-1 text-fg-faint hover:text-fg"
          >
            ×
          </button>
        </header>

        <div className="px-3 py-2.5">
          {/* status line — the only thing screen readers should announce */}
          <p role="status" aria-live="polite" className="text-xs leading-relaxed text-fg-dim">
            {message}
          </p>

          {subject && phase !== "idle" && (
            <p className="mono mt-1.5 truncate text-[10px] text-fg-faint">
              src {sourceLabel(source)} · {subject}
            </p>
          )}

          {(working || phase === "error") && (
            <ul className="mt-2.5 flex flex-col gap-1" aria-label="Forge steps">
              {steps.map((s) => (
                <StepRow key={s.id} step={s} />
              ))}
            </ul>
          )}

          {phase === "launched" && launchedSymbol && (
            <p className="mono mt-2 text-[11px] text-accent">
              recorded {launchedSymbol}
            </p>
          )}

          {phase === "idle" && (
            <button
              type="button"
              onClick={() => setShowTrends((v) => !v)}
              aria-expanded={showTrends}
              className="mono mt-2 text-[10px] text-fg-faint hover:text-accent"
            >
              {showTrends ? "hide" : "what the internet is on right now"}
            </button>
          )}

          {phase === "idle" && showTrends && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <span className="label">hot right now</span>
                {fetchedAt > 0 && (
                  <span className="mono ml-auto text-[9px] text-accent">
                    live · {relTime(new Date(fetchedAt).toISOString(), now)}
                  </span>
                )}
              </div>
              {hot.length === 0 ? (
                <p className="mono mt-1.5 text-[10px] text-fg-faint">
                  trend feed is quiet right now
                </p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {hot.map((t) => (
                    <li key={t.id} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mono mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-line-bright text-[9px] text-fg-dim"
                      >
                        {SOURCE_LETTER[t.source] ?? "?"}
                      </span>
                      <span className="text-[11px] leading-snug text-fg-dim">
                        {t.title}
                      </span>
                      <span className="mono ml-auto shrink-0 text-[10px] text-fg-faint">
                        {t.score}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="mono mt-1 px-1 text-[9px] text-fg-faint">
        {brain
          ? `${brain.label.toLowerCase()} · ${cluster ?? "devnet"}`
          : "checking engine…"}
      </p>
    </aside>
  );
}
