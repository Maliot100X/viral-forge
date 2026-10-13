"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./Toasts";
import { phaseDelay, useForgeProcess } from "@/lib/process";
import type { Coin, GenerateResult } from "@/lib/types";
import type { LaunchSummary } from "@/lib/solana";

/**
 * AgentDock — the floating launch agent, bottom-right.
 *
 * It is a real conversation over POST /api/agent: the River brain reads the
 * message and answers with one action (chat, forge or launch). Slash commands
 * are parsed server-side, so the syntax advertised in the panel is the syntax
 * that actually runs.
 *
 * The critical property is that this component cannot spend on its own. A
 * "launch" action from the brain is only ever a proposal: the panel asks
 * /api/launch with confirm:false, renders the summary it gets back, and needs a
 * deliberate click on "sign & submit" before anything is sent. Guardrail W009
 * lives in one place, and this is a client of it, not a bypass.
 */

type AgentAction =
  | { type: "chat"; reply: string }
  | { type: "forge" | "launch"; reply: string; source: string; input: string; style: string; buySol?: number };

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Rendered as a highlighted command echo, so the syntax is obvious. */
  command?: boolean;
  /** Attached once a coin has actually been made. */
  coin?: Coin;
  /** The generated draft, shown with its artwork before any launch. */
  gen?: GenerateResult;
  /**
   * Everything needed to (re)send the launch: the confirmed summary plus the
   * generated payload. The summary alone is not enough — it describes the
   * transaction, not the coin — so the generation travels with it.
   */
  pending?: PendingLaunch;
  busy?: boolean;
}

interface PendingLaunch {
  summary: LaunchSummary;
  gen: GenerateResult;
  input: string;
  source: string;
  buySol: number;
}

interface CommandInfo {
  command: string;
  description: string;
}

let seq = 0;
const nextId = () => ++seq;

export default function AgentDock() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [engine, setEngine] = useState<{ available: boolean; model: string | null } | null>(null);

  const { push } = useToast();
  const process = useForgeProcess();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * The generation runner is declared after `send` (it needs `requestLaunch`,
   * which needs `patch`), so `send` reaches it through a ref. That keeps the
   * dependency order honest instead of relying on hoisting that would capture
   * a stale closure.
   */
  const forgeRef = useRef<
    ((id: number, action: Extract<AgentAction, { type: "forge" | "launch" }>) => void) | null
  >(null);

  const append = useCallback((m: Omit<Msg, "id">) => {
    const id = nextId();
    setMsgs((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  const patch = useCallback((id: number, next: Partial<Msg>) => {
    setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)));
  }, []);

  // Real commands from the server, so the panel never advertises a route that
  // does not exist.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agent");
        if (!res.ok) return;
        const data = (await res.json()) as {
          available?: boolean;
          model?: string | null;
          commands?: CommandInfo[];
        };
        if (cancelled) return;
        setCommands(data.commands ?? []);
        setEngine({ available: Boolean(data.available), model: data.model ?? null });
      } catch {
        /* the dock stays usable; it just loses the hint row */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, thinking]);

  const history = useCallback(
    () =>
      msgs
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.text })),
    [msgs],
  );

  /** Ask the agent what to do. Nothing is generated or sent on this call. */
  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || thinking) return;
      setInput("");
      setOpen(true);
      append({
        role: "user",
        text,
        command: text.startsWith("/"),
      });
      setThinking(true);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, history: history() }),
        });
        const data = (await res.json()) as {
          action?: AgentAction;
          error?: string;
        };
        const action = data.action;
        if (!action) {
          append({ role: "assistant", text: "No answer came back." });
          return;
        }
        if (action.type === "chat") {
          append({ role: "assistant", text: action.reply });
          return;
        }
        // forge / launch: show the intent, then let the user run it.
        const id = append({ role: "assistant", text: action.reply });
        forgeRef.current?.(id, action);
      } catch {
        append({ role: "assistant", text: "The agent is unreachable right now." });
      } finally {
        setThinking(false);
      }
    }, [thinking, append, history]);

  /** confirm:false — the server simulates and returns 428 with the summary. */
  const requestLaunch = useCallback(
    async (
      id: number,
      gen: GenerateResult,
      action: Extract<AgentAction, { type: "forge" | "launch" }>,
    ) => {
      try {
        const res = await fetch("/api/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...gen,
            source: action.source || "prompt",
            sourceRef: action.input,
            mode: "devnet",
            buySol: action.buySol ?? 0,
            confirm: false,
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          detail?: string;
          summary?: LaunchSummary;
        };
        if (res.status === 428 && data.summary) {
          patch(id, {
            busy: false,
            pending: {
              summary: data.summary,
              gen,
              input: action.input,
              source: action.source || "prompt",
              buySol: action.buySol ?? 0,
            },
          });
          append({
            role: "assistant",
            text: "Review the transaction above, then sign. Nothing is sent until you do.",
          });
          return;
        }
        patch(id, { busy: false });
        append({
          role: "assistant",
          text: data.detail ?? data.error ?? `launch request failed (${res.status})`,
        });
      } catch {
        patch(id, { busy: false });
        append({ role: "assistant", text: "Could not reach the launch endpoint." });
      }
    },
    [append, patch],
  );

  /**
   * Generate the coin for an approved intent and narrate it through the shared
   * process store, so the existing process panel and this dock tell one story.
   */
  const runForge = useCallback(
    async (id: number, action: Extract<AgentAction, { type: "forge" | "launch" }>) => {
      patch(id, { busy: true });
      process.begin(
        (action.source || "prompt") as Parameters<typeof process.begin>[0],
        (action.style || "auto") as Parameters<typeof process.begin>[1],
        action.input,
      );
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const delay = phaseDelay(reduced);

      try {
        await wait(delay);
        process.advance("naming", action.input);
        await wait(delay);
        process.advance("lore", action.input);

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: action.source || "prompt",
            input: action.input,
            style: action.style || "auto",
          }),
        });
        if (!res.ok) throw new Error(`generation failed (${res.status})`);
        const gen = (await res.json()) as GenerateResult;

        process.advance("logo", action.input);
        await wait(delay);
        process.succeed();
        patch(id, { busy: false, text: `Made ${gen.name} (${gen.symbol}).`, gen });

        if (action.type === "forge") {
          push(`Forged ${gen.symbol}`, "ok");
          return;
        }

        // launch: ask the server for the transaction summary. Nothing is signed.
        await requestLaunch(id, gen, action);
      } catch (e) {
        const message = e instanceof Error ? e.message : "generation failed";
        process.fail(message);
        patch(id, { busy: false });
        append({ role: "assistant", text: message + ". Nothing was launched." });
      }
    },
    [append, patch, process, push, requestLaunch],
  );

  // Publish the runner where `send` looks for it.
  useEffect(() => {
    forgeRef.current = (id, action) => void runForge(id, action);
  }, [runForge]);

  /** confirm:true — the only path in this component that signs and sends. */
  const confirmLaunch = useCallback(
    async (id: number, pending: PendingLaunch, buySol: number) => {
      patch(id, { busy: true });
      process.advance("launching");
      try {
        const res = await fetch("/api/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...pending.gen,
            source: pending.source,
            sourceRef: pending.input,
            mode: "devnet",
            buySol,
            confirm: true,
          }),
        });
        const data = (await res.json()) as { coin?: Coin; detail?: string; error?: string };
        if (!res.ok || !data.coin) {
          throw new Error(data.detail ?? data.error ?? `launch failed (${res.status})`);
        }
        const coin = data.coin;
        patch(id, { busy: false, pending: undefined, coin });
        append({
          role: "assistant",
          text: coin.txSignature
            ? `${coin.symbol} is on ${coin.cluster}. Transaction submitted — verify it on the explorer below.`
            : `${coin.symbol} was recorded locally. No transaction was broadcast.`,
        });
        process.markLaunched(coin.symbol);
        push(
          coin.txSignature ? `${coin.symbol} submitted to devnet` : `${coin.symbol} recorded`,
          "ok",
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "launch failed";
        process.fail(message);
        patch(id, { busy: false });
        append({ role: "assistant", text: message });
      }
    },
    [append, patch, process, push],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the launch agent chat"
        className="btn fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 text-xs"
      >
        <span aria-hidden="true" className="text-accent">
          ▚
        </span>
        <span className="mono">launch agent</span>
        {engine && (
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${engine.available ? "bg-accent" : "bg-line-bright"}`}
          />
        )}
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-4 right-4 z-40 flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col"
      aria-label="Launch agent chat"
    >
      <div className="card flex max-h-[min(34rem,calc(100vh-6rem))] flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span aria-hidden="true" className="text-accent">
            ▚
          </span>
          <span className="label">launch agent</span>
          <span className="mono ml-auto text-[10px] text-fg-faint">
            {engine ? (engine.available ? (engine.model ?? "river") : "offline") : "…"}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse the launch agent"
            className="mono px-1 text-fg-faint hover:text-fg"
          >
            ×
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
          {msgs.length === 0 && (
            <div className="text-xs leading-relaxed text-fg-dim">
              <p>
                I turn an idea into a coin and, if you approve it, submit the launch to
                devnet. Ask me anything, or use a command:
              </p>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {(commands.length
                  ? commands
                  : [
                      { command: "/launch <idea>", description: "Forge and launch a coin" },
                      { command: "/forge <idea>", description: "Generate without launching" },
                    ]
                ).map((c) => (
                  <li key={c.command}>
                    <button
                      type="button"
                      onClick={() => void send(c.command.replace(/\s*<.*>$/, "") + " ")}
                      className="mono text-left text-[11px] text-accent hover:underline"
                    >
                      {c.command}
                    </button>
                    <span className="ml-2 text-[11px] text-fg-faint">{c.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ol className="flex flex-col gap-3">
            {msgs.map((m) => (
              <li key={m.id} className={m.role === "user" ? "self-end" : ""}>
                {m.role === "user" ? (
                  <div
                    className={`mono ml-auto max-w-[85%] rounded-md border px-2.5 py-1.5 text-[11px] ${
                      m.command
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-line bg-bg text-fg-dim"
                    }`}
                  >
                    {m.text}
                  </div>
                ) : (
                  <div className="mr-auto max-w-[92%]">
                    <p className="text-xs leading-relaxed text-fg-dim">{m.text}</p>
                    {m.busy && (
                      <p className="mono mt-1 text-[10px] text-accent">
                        <span aria-hidden="true" className="blink">
                          ●
                        </span>{" "}
                        working…
                      </p>
                    )}
                    {m.coin && m.coin.mint && <CoinLine coin={m.coin} />}
                    {m.gen && <ForgeCard gen={m.gen} />}
                    {m.pending && (
                      <ConfirmCard
                        summary={m.pending.summary}
                        buySol={m.pending.buySol}
                        busy={Boolean(m.busy)}
                        onConfirm={(sol) => void confirmLaunch(m.id, m.pending!, sol)}
                        onCancel={() => patch(m.id, { pending: undefined })}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>

          {thinking && (
            <p role="status" aria-live="polite" className="mono mt-3 text-[10px] text-fg-faint">
              <span aria-hidden="true" className="blink">
                ●
              </span>{" "}
              thinking…
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-3 py-2.5">
          <div className="flex items-end gap-2">
            <textarea
              className="textarea"
              style={{ minHeight: "3.25rem" }}
              rows={2}
              placeholder="/launch a frog that only trades at 3am"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Message the launch agent"
            />
            <button
              type="button"
              className="btn btn-primary shrink-0"
              disabled={thinking || !input.trim()}
              onClick={() => void send(input)}
            >
              send
            </button>
          </div>
          <p className="mono mt-1.5 text-[9px] text-fg-faint">
            enter to send · shift+enter for a new line · nothing signs without your click
          </p>
        </div>
      </div>
    </aside>
  );
}

/** The transaction summary the server returns with 428. Reviewed before signing. */
function ConfirmCard({
  summary,
  buySol,
  busy,
  onConfirm,
  onCancel,
}: {
  summary: LaunchSummary;
  buySol: number;
  busy: boolean;
  onConfirm: (buySol: number) => void;
  onCancel: () => void;
}) {
  const [sol, setSol] = useState(buySol);
  return (
    <div className="card mono mt-2 p-3 text-[11px] text-fg-dim">
      <p className="label mb-2">confirm transaction</p>
      <div className="flex flex-col gap-1">
        <Row k="cluster" v={summary.cluster} accent />
        <Row
          k="from"
          v={`${summary.from.slice(0, 8)}…${summary.from.slice(-6)}`}
        />
        <Row
          k="amount"
          v={sol > 0 ? `${sol.toFixed(4)} SOL` : "0 SOL · record only"}
        />
        <Row
          k="balance"
          v={summary.balanceSol === null ? "unknown" : `${summary.balanceSol.toFixed(4)} SOL`}
        />
      </div>

      {summary.belowRentExempt && (
        <p className="mt-2 text-danger">
          Below the rent-exempt floor of {(summary.rentExemptMinimum / 1e9).toFixed(6)} SOL — the
          amount is raised to that, or send 0 to record without moving value.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <label className="text-fg-faint" htmlFor="agent-devbuy">
          dev buy
        </label>
        <input
          id="agent-devbuy"
          type="number"
          min={0}
          max={100}
          step={0.001}
          value={sol}
          onChange={(e) => setSol(Number(e.target.value) || 0)}
          className="input w-24"
        />
        <span className="text-fg-faint">SOL</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onConfirm(sol)}
        >
          {busy ? "signing…" : "sign & submit"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          cancel
        </button>
      </div>
      <p className="mt-2 text-[10px] text-fg-faint">
        Nothing is signed until you press sign &amp; submit.
      </p>
    </div>
  );
}

/**
 * A forged coin, shown with real artwork. There is no mint until a launch
 * happens, so the art is rendered from the prompt with the same seed the final
 * render will use — preview and launched artwork stay identical.
 */
function ForgeCard({ gen }: { gen: GenerateResult }) {
  const url = `/api/logo/preview.webp?${new URLSearchParams({
    style: gen.imageStyle,
    prompt: gen.imagePrompt,
  }).toString()}`;
  return (
    <div className="card mt-2 p-2.5">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${gen.name} logo`}
          width={72}
          height={72}
          className="h-[72px] w-[72px] shrink-0 rounded-md border border-line"
        />
        <div className="min-w-0">
          <p className="mono text-[11px] text-fg">
            {gen.name} <span className="text-accent">{gen.symbol}</span>
          </p>
          <p className="mt-1 text-[11px] leading-snug text-fg-dim">{gen.description}</p>
          <p className="mono mt-1 text-[9px] text-fg-faint">
            {gen.vibe ? `${gen.vibe} · ` : ""}
            {gen.provenance === "river" ? "branded by river ai" : "branded locally"}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-faint">{k}</span>
      <span className={accent ? "text-accent" : "truncate"}>{v}</span>
    </div>
  );
}

/** Result of a real launch: mint, mode and a verifiable explorer link. */
function CoinLine({ coin }: { coin: Coin }) {
  return (
    <div className="card mono mt-2 p-2.5 text-[11px] text-fg-dim">
      <div className="truncate">
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
          <span className="text-fg-faint">verify</span>
        </div>
      ) : (
        <div className="mt-1 text-fg-faint">recorded locally — nothing broadcast</div>
      )}
      <a href={`/coin/${coin.mint}`} className="mono mt-1 inline-block text-accent hover:underline">
        open coin →
      </a>
    </div>
  );
}

