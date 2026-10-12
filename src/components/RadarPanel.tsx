"use client";

import { useState } from "react";
import { useToast } from "./Toasts";
import type { RadarSettings, RadarState } from "@/lib/types";

const SOURCE_LABELS: Array<[keyof RadarSettings["sources"], string]> = [
  ["google", "G Google"],
  ["bluesky", "B Bluesky"],
  ["mastodon", "M Mastodon"],
  ["reddit", "R Reddit"],
];

export default function RadarPanel({ initial }: { initial: RadarState }) {
  const { push } = useToast();
  const [state, setState] = useState<RadarState>(initial);
  const [form, setForm] = useState<RadarSettings>(initial.settings);
  const [busy, setBusy] = useState(false);

  async function call(action: string, settings?: Partial<RadarSettings>) {
    setBusy(true);
    try {
      const res = await fetch("/api/radar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, settings }),
      });
      if (!res.ok) throw new Error(`radar ${action} failed (${res.status})`);
      const data = (await res.json()) as RadarState;
      setState(data);
      setForm(data.settings);
      return data;
    } catch (e) {
      push((e as Error).message, "err");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runScan() {
    const before = state.ticks;
    const data = await call(state.running ? "tick" : "tick");
    if (!data) return;
    if (!data.settings.enabled) {
      push("Radar is off — start it first, then scan", "err");
      return;
    }
    const delta = data.ticks - before;
    push(delta > 0 ? `Scan complete (${data.ticks} total)` : "Scan ran, nothing new", delta > 0 ? "ok" : "info");
  }

  const budgetPct = Math.min(
    100,
    (state.budget.spentSol / Math.max(state.settings.dailyBudgetSol, 0.0001)) * 100,
  );

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {/* --- status --- */}
      <div className="card p-4">
        <p className="label mb-3">status</p>
        <div className="mono flex items-center gap-3 text-sm">
          <span className={state.running ? "text-accent" : "text-fg-faint"}>
            <span className={state.running ? "blink" : ""}>●</span>{" "}
            {state.running ? "RUNNING" : "IDLE"}
          </span>
          <span className="text-fg-faint">
            {state.ticks} scans · {state.seen.length} seen
          </span>
        </div>

        <div className="mono mt-3 text-[11px] text-fg-dim">
          {state.liveCapable
            ? "LIVE MODE · wallet configured"
            : "SIMULATION MODE · no wallet configured"}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="label">daily budget</p>
            <p className="mono text-[11px] text-fg-faint">
              {state.budget.spentSol.toFixed(3)} / {state.settings.dailyBudgetSol} SOL
            </p>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-bg-soft">
            <div
              className="h-full bg-accent"
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <p className="mono mt-2 text-[10px] text-fg-faint">
            {state.budget.launchesToday} launches today · resets 00:00 UTC
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => call(state.running ? "stop" : "start")}
          >
            {state.running ? "stop radar" : "start radar"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={runScan}>
            scan now
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => call("recover")}
          >
            recover launches
          </button>
        </div>
      </div>

      {/* --- settings --- */}
      <div className="card p-4">
        <p className="label mb-3">settings</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label mb-1">interval (sec)</p>
            <input
              className="input"
              type="number"
              min={10}
              max={3600}
              value={form.intervalSec}
              onChange={(e) =>
                setForm({ ...form, intervalSec: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <p className="label mb-1">max coins per scan</p>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={form.maxPerTick}
              onChange={(e) => setForm({ ...form, maxPerTick: Number(e.target.value) })}
            />
          </div>
          <div>
            <p className="label mb-1">daily budget (SOL)</p>
            <input
              className="input"
              type="number"
              min={0}
              step={0.1}
              value={form.dailyBudgetSol}
              onChange={(e) =>
                setForm({ ...form, dailyBudgetSol: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <p className="label mb-1">dev buy per coin (SOL)</p>
            <input
              className="input"
              type="number"
              value={0}
              readOnly
              title="Dev buys require a signing wallet, which this build does not have."
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="label">min heat</p>
            <p className="mono text-[11px] text-accent">{form.minScore}</p>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={form.minScore}
            className="mt-2 w-full accent-[var(--accent)]"
            onChange={(e) => setForm({ ...form, minScore: Number(e.target.value) })}
          />
        </div>

        <div className="mt-4">
          <p className="label mb-2">sources</p>
          <div className="flex flex-wrap gap-1">
            {SOURCE_LABELS.map(([key, label]) => {
              const on = form.sources[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`tab ${on ? "tab-active" : ""}`}
                  onClick={() =>
                    setForm({
                      ...form,
                      sources: { ...form.sources, [key]: !on },
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          className="btn mt-4"
          disabled={busy}
          onClick={() => call("settings", form)}
        >
          save settings
        </button>
      </div>

      {/* --- log --- */}
      <div className="card p-4 lg:col-span-2">
        <p className="label mb-3">radar log</p>
        <div className="max-h-72 overflow-y-auto">
          {state.log.length === 0 ? (
            <p className="mono text-[11px] text-fg-faint">no scans yet</p>
          ) : (
            state.log.map((l, i) => (
              <div key={i} className="log-line">
                <span className="shrink-0 text-fg-faint">
                  {new Date(l.at).toISOString().slice(11, 19)}
                </span>
                <span>{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
