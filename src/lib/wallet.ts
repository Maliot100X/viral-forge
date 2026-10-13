"use client";

import { useSyncExternalStore } from "react";

/**
 * The connected wallet, as one shared client-side value.
 *
 * The connect button used to own its address in local `useState`, which meant
 * nothing else in the app could read it: the trade panel had no way to know
 * which wallet to trade into, so every trade silently fell back to the launch
 * wallet. Lifting it here makes the connected address readable from any
 * component.
 *
 * This holds a PUBLIC KEY only. No key material is stored, nothing here signs,
 * and the extension remains the only thing that can authorise a transfer.
 */

interface WalletState {
  /** Base58 public key of the connected wallet, or null. */
  address: string | null;
  /** True while the extension's connect prompt is open. */
  connecting: boolean;
  /** False when no injected provider exists in this browser. */
  available: boolean;
}

/** The subset of the Solana wallet-standard provider this UI uses. */
export interface InjectedProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

export function getProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    phantom?: { solana?: InjectedProvider };
    solana?: InjectedProvider;
    solflare?: InjectedProvider;
  };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? null;
}

let state: WalletState = { address: null, connecting: false, available: false };
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>): void {
  const next = { ...state, ...patch };
  if (
    next.address === state.address &&
    next.connecting === state.connecting &&
    next.available === state.available
  ) {
    return;
  }
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): WalletState {
  return state;
}

// Server render has no window, so it always reports "not connected".
function serverSnapshot(): WalletState {
  return { address: null, connecting: false, available: false };
}

/** Reactive wallet state. Any component can read the connected address. */
export function useWallet(): WalletState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Non-reactive read, for event handlers and one-shot checks. */
export function walletAddress(): string | null {
  return state.address;
}

/**
 * Binds the extension's own events to the shared store and adopts an
 * already-authorised account. Idempotent — safe to call from several
 * components, and the listener set is reference-counted so the last unmount
 * removes it.
 */
let bound = 0;
export function bindWallet(): () => void {
  const provider = getProvider();
  if (!provider || typeof window === "undefined") {
    set({ available: false });
    return () => {};
  }

  set({ available: true });
  bound += 1;

  if (bound === 1) {
    provider
      .connect({ onlyIfTrusted: true })
      .then((res) => set({ address: res.publicKey.toString() }))
      .catch(() => {
        /* not previously authorised — expected on a first visit */
      });

    const onConnect = () => {
      const pk = provider.publicKey?.toString();
      if (pk) set({ address: pk });
    };
    const onDisconnect = () => set({ address: null });
    provider.on?.("connect", onConnect);
    provider.on?.("disconnect", onDisconnect);

    (provider as unknown as { __vfCleanup?: () => void }).__vfCleanup = () => {
      provider.removeListener?.("connect", onConnect);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }

  return () => {
    bound -= 1;
    if (bound === 0) {
      (provider as unknown as { __vfCleanup?: () => void }).__vfCleanup?.();
      delete (provider as unknown as { __vfCleanup?: () => void }).__vfCleanup;
    }
  };
}

const SHORT = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`;

/**
 * Connects, or disconnects when already connected.
 *
 * Returns the resulting address so a caller can act on it directly rather than
 * waiting for a re-render.
 */
export async function toggleWallet(): Promise<
  { ok: true; address: string | null } | { ok: false; reason: "no_provider" | "declined" }
> {
  const provider = getProvider();
  if (!provider) return { ok: false, reason: "no_provider" };

  if (state.address) {
    try {
      await provider.disconnect?.();
    } catch {
      /* some providers throw when already disconnected */
    }
    set({ address: null });
    return { ok: true, address: null };
  }

  set({ connecting: true });
  try {
    const res = await provider.connect();
    const pk = res.publicKey.toString();
    set({ address: pk, connecting: false });
    return { ok: true, address: pk };
  } catch {
    set({ connecting: false });
    return { ok: false, reason: "declined" };
  }
}

export { SHORT as shortAddress };
