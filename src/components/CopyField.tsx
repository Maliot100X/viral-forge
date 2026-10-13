"use client";

import { useCallback, useRef, useState } from "react";

/**
 * CopyField — a monospace value with a copy affordance.
 *
 * The reference site puts a small ⧉ button next to the mint. Ours says what it
 * did, because a silent copy on a browser that blocks the clipboard API is
 * indistinguishable from a broken button.
 *
 * Two shapes, because the two call sites are different:
 *   - default: a full-width row of text (the mint).
 *   - `asChild`: a `.btn`-styled control for a button row (copy link).
 */
export default function CopyField({
  value,
  label,
  asChild = false,
  children,
}: {
  value: string;
  /** Used in the tooltip, so a screen-reader user knows what gets copied. */
  label?: string;
  /** Render as a `.btn` control that sits in a flex row of buttons. */
  asChild?: boolean;
  /** Visible text when `asChild`. Defaults to the label. */
  children?: React.ReactNode;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Older browsers and non-secure origins reject the async clipboard API.
      // The fallback is a real selection rather than a silent failure.
      try {
        const el = document.createElement("textarea");
        el.value = value;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        ok = document.execCommand("copy");
        document.body.removeChild(el);
      } catch {
        ok = false;
      }
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  }, [value]);

  if (asChild) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        title={`Copy ${label ?? "value"}`}
        aria-live="polite"
        className="btn"
      >
        {state === "copied" ? "copied ✓" : state === "failed" ? "copy blocked" : (children ?? label ?? "copy")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`Copy ${label ?? "value"}`}
      className="group flex w-full items-start gap-2 text-left"
    >
      <span className="mono break-all text-xs text-fg-dim group-hover:text-accent">{value}</span>
      <span className="mono shrink-0 text-[11px] text-fg-faint group-hover:text-accent">
        {state === "copied" ? "copied" : state === "failed" ? "copy blocked" : "⧉"}
      </span>
    </button>
  );
}
