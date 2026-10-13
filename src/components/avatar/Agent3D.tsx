"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { loadAgent3dScript } from "./loadAgent3dScript";
import type {
  Agent3DElement,
  Agent3DHandle,
  Agent3DProps,
  Agent3DStatus,
} from "./agent-3d-types";
import { AvatarFallback } from "./AvatarFallback";
import "./agent-3d-types";

/**
 * The element exposes a handful of overlapping ways to fire an animation and
 * which one is wired depends on the body's rig. Attempt them in order of
 * specificity: the boolean-returning `play()` is authoritative, the decoration
 * slot `playClip()` is a last resort that silently no-ops on unrigged bodies.
 */
async function fireClip(
  el: Agent3DElement,
  clip: string,
  fadeMs: number,
): Promise<boolean> {
  if (typeof el.play === "function") {
    try {
      const result = await el.play(clip, { fade_ms: fadeMs });
      if (result === true) return true;
      // `undefined` means the element accepted the name without a verdict.
      if (result === undefined) return true;
    } catch {
      /* fall through to the next strategy */
    }
  }
  if (typeof el.playClip === "function") {
    try {
      await el.playClip(clip, { userInitiated: true, fade_ms: fadeMs });
      return true;
    } catch {
      /* no clip by this name */
    }
  }
  return false;
}

export const Agent3D = forwardRef<Agent3DHandle, Agent3DProps>(function Agent3D(
  {
    body,
    name,
    accent = "#c8ff3d",
    mode = "section",
    background = "transparent",
    kiosk = true,
    eager = true,
    namePlate = false,
    avatarChat = false,
    instructions,
    className = "",
    style,
    compact = false,
    onReady,
    onError,
    onProgress,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<Agent3DElement | null>(null);
  const [status, setStatus] = useState<Agent3DStatus>("loading");

  // Callbacks live in refs so that changing them does not remount the element.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  onProgressRef.current = onProgress;

  const waitReady = useCallback(async (): Promise<Agent3DElement> => {
    const el = elRef.current;
    if (!el) throw new Error("agent-3d is not mounted");
    if (status === "ready") return el;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("agent:ready timed out")),
        20_000,
      );
      el.addEventListener(
        "agent:ready",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      el.addEventListener(
        "agent:error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("agent:error"));
        },
        { once: true },
      );
    });
    return el;
  }, [status]);

  useImperativeHandle(
    ref,
    (): Agent3DHandle => ({
      get el() {
        return elRef.current;
      },
      ready: status === "ready",
      async wave(opts) {
        const el = await waitReady();
        if (typeof el.wave === "function") await el.wave(opts);
        else await fireClip(el, "Wave", 350);
      },
      async say(text, opts) {
        const el = await waitReady();
        if (typeof el.say === "function") await el.say(text, opts);
        else if (typeof el.speak === "function") await el.speak(text, opts);
      },
      async play(clip, opts) {
        const el = await waitReady();
        return fireClip(el, clip, opts?.fade_ms ?? 400);
      },
      setMood(valence, arousal = 0.5) {
        const el = elRef.current;
        if (!el) return;
        if (typeof el.setMood === "function") {
          el.setMood(valence, arousal);
        } else if (typeof el.expressEmotion === "function") {
          const trigger =
            valence > 0.4 ? "celebration" : valence < -0.3 ? "concern" : "neutral";
          el.expressEmotion(trigger, Math.min(1, Math.abs(valence) + 0.4));
        }
      },
      async lookAt(target) {
        const el = await waitReady();
        if (typeof el.lookAt === "function") await el.lookAt(target);
      },
    }),
    [status, waitReady],
  );

  useEffect(() => {
    let cancelled = false;
    let element: Agent3DElement | null = null;
    const host = hostRef.current;
    const budget = compact || mode === "widget" ? 4500 : 14_000;
    // A compact card has no room to show a blank canvas, so demand one exists.
    const canvasRequired = compact || mode === "widget";

    async function mount() {
      setStatus("loading");
      try {
        const loaded = await loadAgent3dScript();
        if (cancelled || !host) return;
        if (!loaded) throw new Error("three.ws CDN script failed to load");

        host.replaceChildren();

        element = document.createElement("agent-3d") as Agent3DElement;
        element.setAttribute("body", body);
        if (name) element.setAttribute("name", name);
        element.setAttribute("mode", mode);
        element.setAttribute("background", background);
        // We drive dialogue ourselves; the element's own chat brain must stay off.
        element.setAttribute("brain", "none");
        element.setAttribute("name-plate", namePlate ? "on" : "off");
        element.setAttribute("avatar-chat", avatarChat ? "on" : "off");
        if (kiosk) element.setAttribute("kiosk", "");
        if (eager) element.setAttribute("eager", "");
        if (instructions) element.setAttribute("instructions", instructions);
        element.style.setProperty("--agent-accent", accent);
        element.style.width = "100%";
        element.style.height = "100%";
        element.style.display = "block";
        element.style.position = "absolute";
        element.style.inset = "0";

        const settle = (next: Agent3DStatus) => {
          if (cancelled) return;
          setStatus(next);
          if (next === "ready") onReadyRef.current?.();
        };

        element.addEventListener("agent:ready", () => settle("ready"));
        element.addEventListener("agent:load-progress", (event: Event) => {
          const detail = (event as CustomEvent).detail as
            | { pct?: number }
            | undefined;
          if (cancelled || detail?.pct == null) return;
          onProgressRef.current?.(detail.pct);
          if (detail.pct >= 99) settle("ready");
        });
        element.addEventListener("agent:error", (event: Event) => {
          if (cancelled) return;
          const detail = (event as CustomEvent).detail as
            | { message?: string; error?: string }
            | undefined;
          setStatus("error");
          onErrorRef.current?.(
            detail?.message ?? detail?.error ?? "agent-3d failed to initialize",
          );
        });

        // The element does not always emit agent:ready, so treat a rendered
        // canvas as good enough once the budget expires.
        const watchdog = window.setTimeout(() => {
          if (cancelled) return;
          if (canvasRequired && !element?.querySelector("canvas")) {
            setStatus("error");
            onErrorRef.current?.("agent-3d produced no canvas");
            return;
          }
          settle("ready");
        }, budget);

        elRef.current = element;
        host.appendChild(element);
        return () => window.clearTimeout(watchdog);
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        onErrorRef.current?.(
          error instanceof Error ? error.message : "agent-3d mount failed",
        );
      }
    }

    const cleanupPromise = mount();

    return () => {
      cancelled = true;
      elRef.current = null;
      void cleanupPromise.then((dispose) => dispose?.());
      host?.replaceChildren();
    };
  }, [
    body,
    name,
    accent,
    eager,
    kiosk,
    mode,
    background,
    compact,
    instructions,
    namePlate,
    avatarChat,
  ]);

  if (status === "error") {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        style={style}
        data-agent3d-status="error"
      >
        <AvatarFallback accent={accent} label={name} compact={compact} />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={style}
      data-agent3d-status={status}
      data-agent3d-body={body}
    >
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <span className="px-loader" aria-hidden />
          <span className="label">LOADING BODY</span>
        </div>
      )}
      <div
        ref={hostRef}
        className="agent3d-host absolute inset-0 h-full w-full"
        data-compact={compact ? "1" : "0"}
      />
    </div>
  );
});

export default Agent3D;
