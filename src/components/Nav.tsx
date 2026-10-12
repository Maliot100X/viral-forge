"use client";

import Link from "next/link";
import { useState } from "react";
import { useToast } from "./Toasts";

/**
 * Nav — top bar from the reference site: wordmark, 4 links, network badge,
 * SFX toggle, connect-wallet button.
 *
 * The wallet button is UI state only. It never requests an account from an
 * extension, never reads a keypair, and never signs. Clicking it toggles a local
 * display address so the layout and states match the reference exactly.
 */
export default function Nav() {
  const { push } = useToast();
  const [connected, setConnected] = useState(false);
  const [sfx, setSfx] = useState(false);
  const [network] = useState<"mainnet" | "devnet">("mainnet");

  const ADDRESS = "3rG9ZwcT2Vh48KN6sMajYtCEoxRhh8WKULo8U99umDzp";

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
          <span className="pill pill-live">{network}</span>

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
            onClick={() => {
              setConnected((v) => !v);
              push(
                connected ? "Disconnected" : "Wallet UI connected (no signing)",
                connected ? "info" : "ok",
              );
            }}
          >
            {connected ? (
              <span className="mono">
                {ADDRESS.slice(0, 4)}…{ADDRESS.slice(-4)}
              </span>
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
          <a key={href} href={href} className="tab whitespace-nowrap">
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}
