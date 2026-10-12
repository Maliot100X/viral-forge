"use client";

import { create } from "zustand";
import type { ForgeSource, LogoStyle } from "./types";

/**
 * Shared forge-process state.
 *
 * The forge form writes into this store as it works; the companion bot reads
 * from it. That is the whole point: the bot narrates real work rather than
 * cycling canned lines on a timer.
 */

export type Phase =
  | "idle"
  | "reading"
  | "naming"
  | "lore"
  | "logo"
  | "ready"
  | "launching"
  | "launched"
  | "error";

export type StepStatus = "pending" | "active" | "done" | "failed";

export interface ProcessStep {
  id: Phase;
  label: string;
  status: StepStatus;
}

/** The ordered checklist the bot renders. Mirrors the real generation path. */
export const STEP_PLAN: ReadonlyArray<{ id: Phase; label: string }> = [
  { id: "reading", label: "reading source" },
  { id: "naming", label: "naming coin" },
  { id: "lore", label: "writing lore" },
  { id: "logo", label: "drawing logo" },
  { id: "ready", label: "ready to launch" },
];

export const PHASE_MESSAGE: Record<Phase, string> = {
  idle: "Nothing to forge yet. Pick a source on the left and give me something viral.",
  reading: "Parsing what you gave me and pulling the signal out of it.",
  naming: "Working the name and ticker off the strongest words in the source.",
  lore: "Writing the description and tagging it so it reads like it belongs here.",
  logo: "Rendering the pixel logo from the mint hash and the style you picked.",
  ready: "Draft is built. Every field is editable before you launch it.",
  launching: "Recording the coin with its mint and metadata.",
  launched: "Coin is recorded. Check it on the launched page.",
  error: "That run failed. Nothing was written — fix the input and go again.",
};

const SOURCE_LABEL: Record<ForgeSource, string> = {
  prompt: "prompt",
  x: "X post",
  hashtag: "hashtag",
  image: "image",
  tiktok: "TikTok",
  trend: "live trend",
};

interface ForgeProcessState {
  phase: Phase;
  source: ForgeSource;
  style: LogoStyle;
  subject: string;
  stepIndex: number;
  steps: ProcessStep[];
  message: string;
  /** Monotonic counter so the bot can replay narration per run. */
  runId: number;
  launchedSymbol: string | null;
  error: string | null;

  begin: (source: ForgeSource, style: LogoStyle, subject: string) => void;
  advance: (phase: Phase, subject?: string) => void;
  succeed: () => void;
  fail: (message: string) => void;
  markLaunched: (symbol: string) => void;
  reset: () => void;
}

function freshSteps(): ProcessStep[] {
  return STEP_PLAN.map((s) => ({ ...s, status: "pending" as StepStatus }));
}

function withAdvanced(steps: ProcessStep[], phase: Phase): ProcessStep[] {
  const target = steps.findIndex((s) => s.id === phase);
  if (target === -1) return steps;
  return steps.map((s, i) => ({
    ...s,
    status: i < target ? "done" : i === target ? "active" : "pending",
  }));
}

export const useForgeProcess = create<ForgeProcessState>((set) => ({
  phase: "idle",
  source: "prompt",
  style: "auto",
  subject: "",
  stepIndex: -1,
  steps: freshSteps(),
  message: PHASE_MESSAGE.idle,
  runId: 0,
  launchedSymbol: null,
  error: null,

  begin: (source, style, subject) =>
    set((s) => ({
      phase: "reading",
      source,
      style,
      subject,
      stepIndex: 0,
      steps: withAdvanced(freshSteps(), "reading"),
      message: PHASE_MESSAGE.reading,
      runId: s.runId + 1,
      launchedSymbol: null,
      error: null,
    })),

  advance: (phase, subject) =>
    set((s) => {
      const steps = withAdvanced(s.steps, phase);
      const stepIndex = steps.findIndex((x) => x.id === phase);
      return {
        phase,
        steps,
        stepIndex,
        subject: subject ?? s.subject,
        message: PHASE_MESSAGE[phase],
      };
    }),

  succeed: () =>
    set((s) => ({
      phase: "ready",
      steps: s.steps.map((x) => ({ ...x, status: "done" as StepStatus })),
      stepIndex: STEP_PLAN.length - 1,
      message: PHASE_MESSAGE.ready,
    })),

  fail: (message) =>
    set((s) => ({
      phase: "error",
      error: message,
      message,
      steps: s.steps.map((x) =>
        x.status === "active" ? { ...x, status: "failed" as StepStatus } : x,
      ),
    })),

  markLaunched: (symbol) =>
    set({
      phase: "launched",
      launchedSymbol: symbol,
      message: PHASE_MESSAGE.launched,
    }),

  reset: () =>
    set({
      phase: "idle",
      subject: "",
      stepIndex: -1,
      steps: freshSteps(),
      message: PHASE_MESSAGE.idle,
      launchedSymbol: null,
      error: null,
    }),
}));

export function sourceLabel(s: ForgeSource): string {
  return SOURCE_LABEL[s];
}

/** Pace the real phases so a fast local forge still reads as work happening. */
export const PHASE_DELAY_MS = 260;

export function phaseDelay(prefersReduced: boolean): number {
  return prefersReduced ? 0 : PHASE_DELAY_MS;
}
