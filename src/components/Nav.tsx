"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "./Toasts";

/**
 * Nav — top bar from the reference site: wordmark, 4 links, network badge,
 * SFX toggle, connect-wallet button.
 *
 * Two things here are deliberately real rather than decorative:
 *
 *  - The network badge reads `cluster` from /api/status. It used to be a
 *    hardcoded "mainnet" pill, which sat there claiming mainnet while the
 *    server was running devnet.
 *  - The wallet button talks to a real injected provider (Phantom / Solflare)
 *    and displays the pubkey the extension actually returns. It used to show a
 *    hardcoded address after a local state flip, which looked connected while
 *    nothing was.
 *
 * Connecting only reads a public key. Nothing here signs, and no key material
 * ever reaches this component.
 */

/** The subset of the Solana wallet-standard provider this UI actually uses. */
interface InjectedProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

function getProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    phantom?: { solana?: InjectedProvider };
    solana?: InjectedProvider;
    solflare?: InjectedProvider;
  };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? null;
}

export default function Nav() {
  const { push } = useToast();
  const [sfx, setSfx] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [cluster, setCluster] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Read the cluster the server is really on. A failure here just leaves the
  // badge blank rather than asserting a network we cannot verify.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = (await res.json()) as { cluster?: string };
        if (!cancelled && data.cluster) setCluster(data.cluster);
      } catch {
        /* badge stays unset */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Adopt an already-authorised account, and track the extension's own
  // connect/disconnect events so the button never disagrees with the wallet.
  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;

    provider
      .connect({ onlyIfTrusted: true })
      .then((res) => setAddress(res.publicKey.toString()))
      .catch(() => {
        /* not previously authorised — expected on a first visit */
      });

    const onConnect = () => {
      const pk = provider.publicKey?.toString();
      if (pk) setAddress(pk);
    };
    const onDisconnect = () => setAddress(null);

    provider.on?.("connect", onConnect);
    provider.on?.("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("connect", onConnect);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, []);

  const toggleWallet = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      push("No Solana wallet found. Install Phantom or Solflare.", "info");
      return;
    }

    if (address) {
      try {
        await provider.disconnect?.();
      } catch {
        /* some providers throw if already disconnected */
      }
      setAddress(null);
      push("Disconnected", "info");
      return;
    }

    setConnecting(true);
    try {
      const res = await provider.connect();
      const pk = res.publicKey.toString();
      setAddress(pk);
      push(`Connected ${pk.slice(0, 4)}…${pk.slice(-4)}`, "ok");
    } catch {
      // A user-closed prompt lands here and is not an error worth shouting about.
      push("Wallet connection declined", "info");
    } finally {
      setConnecting(false);
    }
  }, [address, push]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          VIRAL<span className="text-accent">.forge</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {[
            ["Forge", "/"],
            ["Trend Radar", "/radar"],
            ["Launched", "/coins"],
            ["Tokenomics", "/tokenomics"],
          ].map(([label, href]) => (
            <Link key={href} href={href} className="tab">
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {cluster && (
            <span
              className={`pill ${cluster === "mainnet-beta" ? "pill-live" : "pill-sim"}`}
              title={`RPC cluster: ${cluster}`}
            >
              {cluster === "mainnet-beta" ? "mainnet" : cluster}
            </span>
          )}

          <button
            type="button"
            className="btn"
            aria-pressed={sfx}
            onClick={() => {
              setSfx((v) => !v);
              push(`SFX ${!sfx ? "on" : "off"}`, "info");
            }}
          >
            SFX {sfx ? "on" : "off"}
          </button>

          <button
            type="button"
            className="btn"
            aria-busy={connecting}
            disabled={connecting}
            onClick={toggleWallet}
          >
            {address ? (
              <span className="mono">
                {address.slice(0, 4)}…{address.slice(-4)}
              </span>
            ) : connecting ? (
              "connecting…"
            ) : (
              "connect wallet"
            )}
          </button>
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {[
          ["Forge", "/"],
          ["Trend Radar", "/radar"],
          ["Launched", "/coins"],
          ["Tokenomics", "/tokenomics"],
        ].map(([label, href]) => (
          <Link key={href} href={href} className="tab whitespace-nowrap">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
