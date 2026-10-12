"use client";

import { useState } from "react";
import { useToast } from "./Toasts";
import type { Coin, ForgeSource, GenerateResult, LogoStyle } from "@/lib/types";

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
  const [source, setSource] = useState<ForgeSource>("prompt");
  const [input, setInput] = useState("");
  const [style, setStyle] = useState<LogoStyle>("auto");

  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<GenerateResult | null>(null);
  const [coin, setCoin] = useState<Coin | null>(null);

  // editable draft, populated after generation
  const [draft, setDraft] = useState<GenerateResult | null>(null);

  const meta = HINTS[source];

  async function onGenerate() {
    if (!input.trim()) {
      push("Give it something to work with first", "err");
      return;
    }
    setBusy(true);
    setCoin(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, input: input.trim(), style }),
      });
      if (!res.ok) throw new Error(`generate failed (${res.status})`);
      const data = (await res.json()) as GenerateResult;
      setGen(data);
      setDraft(data);
      push(`Forged $${data.symbol}`, "ok");
    } catch (e) {
      push((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function onLaunch() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, source, sourceRef: input.trim() }),
      });
      if (!res.ok) throw new Error(`launch failed (${res.status})`);
      const data = (await res.json()) as { coin: Coin };
      setCoin(data.coin);
      push(`$${data.coin.symbol} recorded ${data.coin.mint.slice(0, 4)}…`, "ok");
    } catch (e) {
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
                  src={`/api/logo/${coin?.mint ?? "preview0000000000000000000000000000000000"}.webp?style=${draft.imageStyle}`}
                  alt={`${draft.name} logo`}
                  width={220}
                  height={220}
                  className="w-full rounded-md border border-line"
                />
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

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={onLaunch}
                  >
                    {busy ? "recording…" : "launch"}
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

                {coin && (
                  <div className="card mono p-3 text-[11px] text-fg-dim">
                    <div>
                      mint <span className="text-accent">{coin.mint}</span>
                    </div>
                    <div>
                      mode <span className="text-sim">{coin.mode}</span> · recorded
                      locally, nothing broadcast
                    </div>
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
