"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "./Toasts";
import { bindWallet, shortAddress, toggleWallet, useWallet } from "@/lib/wallet";

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

/** The nav links, shared by the desktop and mobile rows so they cannot drift. */
const LINKS: Array<[string, string]> = [
  ["Forge", "/"],
  ["Trend Radar", "/radar"],
  ["Launched", "/coins"],
  ["Agents", "/agents"],
  ["Tokenomics", "/tokenomics"],
];

export default function Nav() {
  const { push } = useToast();
  const [sfx, setSfx] = useState(false);
  const { address, connecting, available } = useWallet();
  const [cluster, setCluster] = useState<string | null>(null);

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

  // Adopt an already-authorised account and track the extension's own events.
  // The store is shared, so the trade panel sees the same address.
  useEffect(() => bindWallet(), []);

  const onToggleWallet = useCallback(async () => {
    const res = await toggleWallet();
    if (!res.ok) {
      if (res.reason === "no_provider") {
        push("No Solana wallet found. Install Phantom or Solflare.", "info");
      } else {
        // A user-closed prompt lands here and is not worth shouting about.
        push("Wallet connection declined", "info");
      }
      return;
    }
    push(res.address ? `Connected ${shortAddress(res.address)}` : "Disconnected", res.address ? "ok" : "info");
  }, [push]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="mono text-sm font-semibold tracking-tight">
          VIRAL<span className="text-accent">.forge</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map(([label, href]) => (
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
            onClick={onToggleWallet}
            title={
              available
                ? address
                  ? `Connected: ${address}`
                  : "Connect a Solana wallet"
                : "No Solana wallet detected in this browser"
            }
          >
            {address ? (
              <span className="mono">{shortAddress(address)}</span>
            ) : connecting ? (
              "connecting…"
            ) : (
              "connect wallet"
            )}
          </button>
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-2 lg:hidden">
        {LINKS.map(([label, href]) => (
          <Link key={href} href={href} className="tab whitespace-nowrap">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
