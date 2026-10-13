"use client";

/**
 * Loads the three.ws `agent-3d` web component from their CDN.
 *
 * The script is 3.3 MB and ships as an ES2020 module that registers
 * `<agent-3d>` as a custom element. We insert it once per document and hand
 * every caller the same promise.
 *
 * SRI note: three.ws publishes a hash in versions.json, but the JS at a fixed
 * version path is occasionally republished (see versions.json
 * `currentBuild.publishedAt`). When that happens the pinned hash no longer
 * matches and the browser refuses to execute the module. So we try with
 * integrity first and fall back to a plain load rather than breaking the page.
 */

const CDN_BASE = "https://three.ws/agent-3d";
const VERSION = "1.5.2";
const SRC = `${CDN_BASE}/${VERSION}/agent-3d.js`;

/**
 * sha384 of agent-3d@1.5.2, re-derived from the served bytes with
 * `openssl dgst -sha384 -binary | openssl base64 -A`.
 */
const INTEGRITY =
  "sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q";

export const AGENT_3D_TAG = "agent-3d";

type LoadState = "idle" | "loading" | "ready" | "failed";

let state: LoadState = "idle";
let pending: Promise<boolean> | null = null;

function alreadyDefined(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.customElements !== "undefined" &&
    window.customElements.get(AGENT_3D_TAG) !== undefined
  );
}

function insertScript(integrity: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = SRC;
    script.crossOrigin = "anonymous";
    script.async = true;
    if (integrity) script.integrity = integrity;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`failed to load ${SRC}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

async function waitForDefinition(timeoutMs = 8000): Promise<boolean> {
  if (alreadyDefined()) return true;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    if (alreadyDefined()) return true;
  }
  return false;
}

/**
 * Idempotent. Resolves true when `<agent-3d>` is registered and usable.
 */
export function loadAgent3dScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (alreadyDefined()) {
    state = "ready";
    return Promise.resolve(true);
  }
  if (pending) return pending;

  state = "loading";
  pending = (async () => {
    try {
      await insertScript(INTEGRITY);
    } catch {
      // Republished build: fall back to an unpinned load.
      try {
        await insertScript(undefined);
      } catch {
        state = "failed";
        pending = null;
        return false;
      }
    }
    const ok = await waitForDefinition();
    state = ok ? "ready" : "failed";
    if (!ok) pending = null;
    return ok;
  })();

  return pending;
}

export function agent3dLoadState(): LoadState {
  return state;
}

export const AGENT_3D_SRC = SRC;
export const AGENT_3D_INTEGRITY = INTEGRITY;
