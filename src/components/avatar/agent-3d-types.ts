import type React from "react";

/**
 * Typings for the three.ws `<agent-3d>` custom element served from their CDN.
 * The methods are declared optional because the element registers them lazily
 * once the scene finishes booting; callers must feature-check before use.
 */

export type Agent3DLoadProgress = { pct?: number };

export type Agent3DElement = HTMLElement & {
  wave?: (opts?: { style?: string }) => Promise<void>;
  say?: (text: string, opts?: { voice?: boolean }) => Promise<void>;
  speak?: (text: string, opts?: Record<string, unknown>) => Promise<void>;
  play?: (
    name: string,
    opts?: { loop?: boolean; duration?: number; fade_ms?: number },
  ) => Promise<boolean | void>;
  playClip?: (
    name: string,
    opts?: { fade_ms?: number; userInitiated?: boolean },
  ) => void | Promise<void>;
  setMood?: (valence: number, arousal?: number, opts?: Record<string, unknown>) => void;
  expressEmotion?: (trigger: string, weight?: number) => void;
  lookAt?: (target: string) => Promise<void>;
};

export type Agent3DStatus = "loading" | "ready" | "error";

export type Agent3DHandle = {
  el: Agent3DElement | null;
  ready: boolean;
  wave: (opts?: { style?: string }) => Promise<void>;
  say: (text: string, opts?: { voice?: boolean }) => Promise<void>;
  play: (clip: string, opts?: { fade_ms?: number }) => Promise<boolean>;
  setMood: (valence: number, arousal?: number) => void;
  lookAt: (target: string) => Promise<void>;
};

export type Agent3DProps = {
  /** Absolute GLB URL. */
  body: string;
  name?: string;
  /** CSS colour applied through the element's `--agent-accent` custom property. */
  accent?: string;
  mode?: "inline" | "floating" | "section" | "fullscreen" | "widget";
  background?: string;
  /** Hides the element's built-in chrome. */
  kiosk?: boolean;
  eager?: boolean;
  namePlate?: boolean;
  avatarChat?: boolean;
  instructions?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Tighter readiness budget and a smaller empty-canvas tolerance. */
  compact?: boolean;
  onReady?: () => void;
  onError?: (message: string) => void;
  onProgress?: (pct: number) => void;
};

// React 19 declares the JSX namespace inside the `react` module, so augmenting
// it requires the namespace syntax this rule otherwise discourages.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "agent-3d": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        body?: string;
        src?: string;
        name?: string;
        mode?: string;
        kiosk?: string;
        eager?: string;
        background?: string;
        brain?: string;
        instructions?: string;
        accent?: string;
        "name-plate"?: string;
        "avatar-chat"?: string;
      };
    }
  }
}

export {};
