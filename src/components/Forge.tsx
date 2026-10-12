"use client";

import { useMemo, useState } from "react";
import { useToast } from "./Toasts";
import { phaseDelay, useForgeProcess } from "@/lib/process";
import { seedFromPrompt } from "@/lib/images";
import type { Coin, ForgeSource, GenerateResult, LogoStyle } from "@/lib/types";
import type { LaunchSummary } from "@/lib/solana";

const MODES: Array<[ForgeSource, string]> = [
  ["prompt", "✦ Prompt"],
  ["x", "𝕏 X post"],
  ["hashtag", "# Hashtag"],
  ["image", "▣ Image"],
  ["tiktok", "♪ TikTok"],
  ["trend", "▲ Trends"],
];

const HINTS: Record<ForgeSource, { label: string; hint: string; examples: string[] }> = {
  prompt: {
    label: "Describe the coin in one line. AI does the rest.",
    hint: "a cat that refuses to pay taxes, in space",
    examples: [
      "a cat that refuses to pay taxes, in space",
      "gigachad pigeon running the Federal Reserve",
      "a frog that only trades at 3am",
      "toaster that wants to go to the moon",
    ],
  },
  x: {
    label: "Paste a post URL or the text of the post.",
    hint: "https://x.com/user/status/…",
    examples: [
      "https://x.com/user/status/1800000000000000000",
      "this guy explained the entire economy with a sandwich",
    ],
  },
  hashtag: {
    label: "Give it a hashtag. It writes the rest.",
    hint: "#Monsterdon",
    examples: ["#Monsterdon", "#SilentSunday", "#thebat1959", "#FragrantPlaces"],
  },
  image: {
    label: "Describe the image, or paste an image URL.",
    hint: "a raccoon in a business suit",
    examples: [
      "a raccoon in a business suit",
      "https://example.com/photo.jpg",
      "a dog wearing sunglasses at a funeral",
    ],
  },
  tiktok: {
    label: "Paste a TikTok URL or describe the clip.",
    hint: "https://www.tiktok.com/@user/video/…",
    examples: [
      "https://www.tiktok.com/@user/video/7300000000000000000",
      "guy reviews gas stations in a full suit",
    ],
  },
  trend: {
    label: "Give it a live trend. It names the coin after it.",
    hint: "peyton woodring",
    examples: [
      "peyton woodring",
      "nhl standings",
      "eagles vs jaguars",
      "national coming out day",
    ],
  },
};

const STYLES: LogoStyle[] = ["auto", "meme", "cartoon", "3d", "realistic", "anime"];

interface Step {
  n: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { n: "01", title: "FEED IT", body: "Prompt, X link, hashtag, image, TikTok or a live trend. Any of them." },
  { n: "02", title: "AI FORGES", body: "Name, ticker, description, tags and a logo in the style that fits (meme, cartoon, 3D, realistic). Edit anything." },
  { n: "03", title: "LAUNCH", body: "Review, sign, and the coin is recorded with its mint and metadata." },
];

export default function Forge() {
  const { push } = useToast();
  const process = useForgeProcess();
  const [source, setSource] = useState<ForgeSource>("prompt");
  const [input, setInput] = useState("");
  const [style, setStyle] = useState<LogoStyle>("auto");

  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<GenerateResult | null>(null);
  const [coin, setCoin] = useState<Coin | null>(null);

  // The transaction summary returned by /api/launch when it refuses to send
  // without confirmation. Nothing is signed until the user approves this.
  const [pending, setPending] = useState<LaunchSummary | null>(null);
  const [buySol, setBuySol] = useState(0);

  // editable draft, populated after generation
  const [draft, setDraft] = useState<GenerateResult | null>(null);

  const meta = HINTS[source];

  /**
   * Preview art URL. There is no mint before launch, so the route is asked to
   * render from the prompt directly, with the same seed the final render will
   * use. That keeps preview and launched artwork identical instead of swapping
   * a placeholder for real art at the last moment.
   */
  const previewUrl = useMemo(() => {
    if (!draft) return null;
    const q = new URLSearchParams({
      style: draft.imageStyle,
      prompt: draft.imagePrompt,
    });
    if (!coin) q.set("seed", String(seedFromPrompt(draft.imagePrompt)));
    return `/api/logo/${coin?.mint ?? "preview"}.webp?${q.toString()}`;
  }, [draft, coin]);

  async function onGenerate() {
    if (!input.trim()) {
      push("Give it something to work with first", "err");
      return;
    }
    const subject = input.trim();
    setBusy(true);
    setCoin(null);
    setPending(null);
    process.begin(source, style, subject);

    // Drive the agent's checklist at real moments. The local forge is fast,
    // so the gaps are paced to keep the narration legible — and skipped
    // entirely when the user asks for reduced motion.
    const delay = phaseDelay(
      typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      await wait(delay);
      process.advance("naming", subject);
      await wait(delay);
      process.advance("lore", subject);

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, input: subject, style }),
      });
      if (!res.ok) throw new Error(`generate failed (${res.status})`);
      const data = (await res.json()) as GenerateResult;

      process.advance("logo", subject);
      await wait(delay);
      setGen(data);
      setDraft(data);
      process.succeed();
      push(`Forged $${data.symbol}`, "ok");
    } catch (e) {
      process.fail((e as Error).message);
      push((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask the server what a real launch would do. The server simulates and
   * returns the summary with HTTP 428 instead of sending, so nothing is signed
   * on this call. We show that summary and wait for an explicit click.
   */
  async function onRequestLaunch() {
    if (!draft) return;
    setBusy(true);
    setCoin(null);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          source,
          sourceRef: input.trim(),
          mode: "devnet",
          buySol,
          confirm: false,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        detail?: string;
        summary?: LaunchSummary;
      };
      if (res.status === 428 && data.summary) {
        setPending(data.summary);
        push("Review the transaction before signing", "ok");
        return;
      }
      if (!res.ok) throw new Error(data.detail ?? data.error ?? `launch failed (${res.status})`);
    } catch (e) {
      process.fail((e as Error).message);
      push((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  /** Actually sign and submit. Only reachable after the summary was approved. */
  async function onConfirmLaunch() {
    if (!draft) return;
    setBusy(true);
    process.advance("launching");
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          source,
          sourceRef: input.trim(),
          mode: "devnet",
          buySol,
          confirm: true,
        }),
      });
      const data = (await res.json()) as { coin?: Coin; detail?: string; error?: string };
      if (!res.ok || !data.coin) {
        throw new Error(data.detail ?? data.error ?? `launch failed (${res.status})`);
      }
      setCoin(data.coin);
      setPending(null);
      process.markLaunched(data.coin.symbol);
      push(`$${data.coin.symbol} launched on devnet`, "ok");
    } catch (e) {
      process.fail((e as Error).message);
      push((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  function update<K extends keyof GenerateResult>(k: K, v: GenerateResult[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  return (
    <section id="forge" className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap gap-1">
          {MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`tab ${source === value ? "tab-active" : ""}`}
              onClick={() => {
                setSource(value);
                setGen(null);
                setDraft(null);
                setCoin(null);
                setPending(null);
                process.reset();
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="label mb-3">input · {source}</p>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <p className="mb-2 text-sm text-fg-dim">{meta.label}</p>
            <textarea
              className="textarea"
              placeholder={meta.hint}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="label mr-1 self-center">[?] random</span>
              {meta.examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="tab"
                  style={{ borderColor: "var(--line)", fontSize: "0.625rem" }}
                  onClick={() => setInput(ex)}
                >
                  {ex.length > 42 ? `${ex.slice(0, 40)}…` : ex}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label mb-2">logo style</p>
            <div className="flex flex-wrap gap-1">
              {STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`tab ${style === s ? "tab-active" : ""}`}
                  onClick={() => setStyle(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-primary mt-4 w-full"
              disabled={busy}
              onClick={onGenerate}
            >
              {busy && !gen ? "forging…" : "forge a coin"}
            </button>
            <p className="mono mt-2 text-[10px] text-fg-faint">
              no wallet needed to forge · wallet only to launch
            </p>
          </div>
        </div>

        {gen && draft && (
          <>
            <div className="divider my-5" />
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={previewUrl ?? "none"}
                  src={previewUrl ?? ""}
                  alt={`${draft.name} logo preview`}
                  width={220}
                  height={220}
                  className="w-full rounded-md border border-line"
                />
                <p className="mono mt-1 text-[9px] text-fg-faint">
                  {coin
                    ? coin.imageProvenance === "pollinations"
                      ? "AI artwork · flux.1-schnell"
                      : "procedural artwork"
                    : "live preview · final art rendered on launch"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {STYLES.filter((s) => s !== "auto").map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`tab ${draft.imageStyle === s ? "tab-active" : ""}`}
                      style={{ fontSize: "0.5625rem", padding: "0.25rem 0.4rem" }}
                      onClick={() => update("imageStyle", s as GenerateResult["imageStyle"])}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <div>
                    <p className="label mb-1">name</p>
                    <input
                      className="input"
                      value={draft.name}
                      onChange={(e) => update("name", e.target.value)}
                    />
                  </div>
                  <div>
                    <p className="label mb-1">ticker</p>
                    <input
                      className="input"
                      value={draft.symbol}
                      onChange={(e) =>
                        update("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                      }
                    />
                  </div>
                </div>

                <div>
                  <p className="label mb-1">lore</p>
                  <textarea
                    className="textarea"
                    value={draft.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="label mb-1">vibe</p>
                    <input
                      className="input"
                      value={draft.vibe}
                      onChange={(e) => update("vibe", e.target.value)}
                    />
                  </div>
                  <div>
                    <p className="label mb-1">tags</p>
                    <input
                      className="input"
                      value={draft.tags.join(", ")}
                      onChange={(e) =>
                        update(
                          "tags",
                          e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8),
                        )
                      }
                    />
                  </div>
                </div>

                <div>
                  <p className="label mb-1">image prompt</p>
                  <textarea
                    className="textarea"
                    style={{ minHeight: "4rem" }}
                    value={draft.imagePrompt}
                    onChange={(e) => update("imagePrompt", e.target.value)}
                  />
                </div>

                {gen.provenance === "river" ? (
                  <p className="mono text-[10px] text-accent">
                    branded by river ai · {gen.name.length > 0 ? "live model" : ""}
                  </p>
                ) : (
                  <p className="mono text-[10px] text-sim">
                    branded locally · template brain (no model key)
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={onRequestLaunch}
                  >
                    {busy ? "preparing…" : "launch"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={onGenerate}
                  >
                    re-forge
                  </button>
                  {coin && (
                    <a className="btn" href={`/coin/${coin.mint}`}>
                      open coin →
                    </a>
                  )}
                </div>

                {pending && !coin && (
                  <div className="card mono p-3 text-[11px] text-fg-dim">
                    <p className="label mb-2">confirm transaction</p>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between gap-3">
                        <span className="text-fg-faint">cluster</span>
                        <span className="text-accent">{pending.cluster}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-fg-faint">from</span>
                        <span className="truncate">
                          {pending.from.slice(0, 8)}…{pending.from.slice(-6)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-fg-faint">amount</span>
                        <span>
                          {pending.sol > 0
                            ? `${pending.sol.toFixed(4)} SOL`
                            : "0 SOL · record only"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-fg-faint">balance</span>
                        <span>
                          {pending.balanceSol === null
                            ? "unknown"
                            : `${pending.balanceSol.toFixed(4)} SOL`}
                        </span>
                      </div>
                    </div>

                    {pending.belowRentExempt && (
                      <p className="mt-2 text-danger">
                        Below the rent-exempt floor — the amount was raised to{" "}
                        {(pending.rentExemptMinimum / 1e9).toFixed(6)} SOL, or send 0
                        to record without moving value.
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-fg-faint">dev buy</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.001}
                        value={buySol}
                        onChange={(e) => setBuySol(Number(e.target.value) || 0)}
                        className="input w-24"
                      />
                      <span className="text-fg-faint">SOL</span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={onConfirmLaunch}
                      >
                        {busy ? "signing…" : "sign & submit"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setPending(null)}
                      >
                        cancel
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] text-fg-faint">
                      Nothing is signed until you press sign &amp; submit.
                    </p>
                  </div>
                )}

                {coin && (
                  <div className="card mono p-3 text-[11px] text-fg-dim">
                    <div>
                      mint <span className="text-accent">{coin.mint}</span>
                    </div>
                    <div>
                      mode <span className="text-accent">{coin.mode}</span>
                      {coin.cluster ? ` · ${coin.cluster}` : ""}
                    </div>
                    {coin.txSignature ? (
                      <div className="mt-1 break-all">
                        tx{" "}
                        <a
                          href={coin.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline"
                        >
                          {coin.txSignature.slice(0, 20)}…
                        </a>{" "}
                        <span className="text-fg-faint">verify on explorer</span>
                      </div>
                    ) : (
                      <div className="mt-1 text-fg-faint">
                        recorded locally — nothing was broadcast
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="card p-4">
            <p className="mono text-xs text-accent">{s.n}</p>
            <p className="mono mt-2 text-sm">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-dim">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
