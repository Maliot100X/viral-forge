"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./Toasts";
import { bindWallet, shortAddress, toggleWallet, useWallet } from "@/lib/wallet";

/**
 * TradePanel — real buys and sells against the coin's on-chain bonding curve.
 *
 * Every button here submits a real devnet transaction. The flow is deliberately
 * two-phase and is not cosmetic:
 *
 *  1. POST without `confirm` → the server prices the trade from the curve's
 *     live balance and returns 428 with the quote. Nothing is signed.
 *  2. POST with `confirm: true` → the transaction is submitted and confirmed.
 *
 * The fill shown afterwards is read back from chain (token balance deltas), not
 * echoed from the request, and every fill links to its own explorer page so the
 * trade can be checked by someone who does not trust this UI.
 */

interface Quote {
  mint: string;
  symbol: string;
  action: "buy" | "sell";
  amount: number;
  cluster: string;
  curveAddress: string;
  reserveSol: number;
  amountIn: string;
  expectedOut: string;
  fee: string;
  minOut: string;
  slippageBps: number;
  price: string;
  priceAfter: string;
}

interface Fill {
  signature: string;
  explorerUrl: string;
  action: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  fee: string;
  price: string;
  priceAfter: string;
  reserveSol: number;
  traderTokenBalance: string;
  traderIsConnectedWallet: boolean;
  /** The connected wallet's own SOL, or null when it could not be read. */
  traderBalanceLamports?: string | null;
  /** "launch_wallet" when this site funded the buy on the user's behalf. */
  fundedBy?: "launch_wallet" | "trader";
}

interface MarketCurve {
  exists: boolean;
  reserveSol: number;
  tokensOnCurve: string;
  price: string;
  graduationPct: number;
  graduated: boolean;
}

const BUY_PRESETS = [0.05, 0.1, 0.25, 0.5, 1];
const SELL_PRESETS = [25, 50, 100];

const TOKEN_DECIMALS = 9;

function fromAtoms(atoms: string | number | bigint): number {
  try {
    return Number(BigInt(atoms)) / 10 ** TOKEN_DECIMALS;
  } catch {
    return 0;
  }
}

function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) < 0.0001) return n.toExponential(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default function TradePanel({
  mint,
  symbol,
  market,
  onTraded,
}: {
  mint: string;
  symbol: string;
  /** Live curve snapshot, used to size the sell presets and show progress. */
  market: MarketCurve | null;
  /** Called after a fill so the page can refresh its market numbers. */
  onTraded?: () => void;
}) {
  const { push } = useToast();
  const { address, connecting, available } = useWallet();

  const [amount, setAmount] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(300);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [busy, setBusy] = useState<"quote" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A quote is only valid for the curve it was priced against. Any edit to the
  // amount invalidates it rather than letting a stale number be confirmed.
  const quoteRef = useRef<Quote | null>(null);
  useEffect(() => {
    quoteRef.current = quote;
  }, [quote]);

  useEffect(() => bindWallet(), []);

  // Sell presets are a percentage of what the connected wallet actually holds,
  // read from chain. `null` means "we could not check" — never zero — so the
  // sell row can say so instead of implying an empty wallet.
  //
  // Holdings are keyed by `address + mint`: a read for a previous mint or a
  // previous wallet must never be mistaken for the current one.
  const [holdingsRead, setHoldingsRead] = useState<{
    key: string;
    amount: number | null;
    walletLamports?: number | null;
  } | null>(null);
  const holdingsKey = address ? `${address}:${mint}` : null;
  const heldTokens = holdingsKey && holdingsRead?.key === holdingsKey ? holdingsRead.amount : null;

  const refreshHoldings = useCallback(async () => {
    const key = holdingsKey;
    if (!key || !address) return;
    try {
      const res = await fetch(
        `/api/trade?mint=${encodeURIComponent(mint)}&holder=${encodeURIComponent(address)}`,
      );
      // A failed read leaves the previous reading in place rather than
      // reporting a balance we did not observe.
      if (!res.ok) {
        setHoldingsRead({ key, amount: null });
        return;
      }
      const data = (await res.json()) as {
        holdings?: { amount?: string };
        walletLamports?: number | null;
      };
      const raw = data.holdings?.amount;
      setHoldingsRead({
        key,
        amount: raw === undefined ? null : fromAtoms(raw),
        walletLamports: data.walletLamports ?? null,
      });
    } catch {
      setHoldingsRead({ key, amount: null });
    }
  }, [address, holdingsKey, mint]);

  useEffect(() => {
    // Deferred so the read never runs synchronously inside the effect body.
    const t = setTimeout(() => void refreshHoldings(), 0);
    return () => clearTimeout(t);
  }, [refreshHoldings]);

  const submit = useCallback(
    async (action: "buy" | "sell", humanAmount: number, confirm: boolean) => {
      setBusy(confirm ? "confirm" : "quote");
      setError(null);
      try {
        // The signature format differs between the two phases: a quote is a 428
        // with `summary`, a fill is a 201 with the result.
        if (confirm && quoteRef.current) {
          // Keep the curve the user approved: refuse to confirm a quote that was
          // priced at a different slippage than the one now selected.
          if (quoteRef.current.slippageBps !== slippageBps) {
            setQuote(null);
            setError("Slippage changed — re-quote before confirming.");
            return;
          }
        }

        const res = await fetch("/api/trade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mint,
            action,
            amount: humanAmount,
            slippageBps,
            confirm,
            ...(address ? { traderPublicKey: address } : {}),
          }),
        });

        const data = (await res.json()) as Record<string, unknown>;

        if (res.status === 428) {
          setQuote(data.summary as Quote);
          return;
        }

        if (!res.ok) {
          setQuote(null);
          setError((data.detail as string) || (data.error as string) || `HTTP ${res.status}`);
          return;
        }

        const result = data as unknown as Fill;
        setFill(result);
        setQuote(null);
        push(
          `${action === "buy" ? "Bought" : "Sold"} ${symbol} — ${shortTransaction(result.signature)}`,
          "ok",
        );
        void refreshHoldings();
        onTraded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "request failed");
      } finally {
        setBusy(null);
      }
    },
    [address, mint, onTraded, push, refreshHoldings, slippageBps, symbol],
  );

  const parsedAmount = Number(amount);
  const amountOk = Number.isFinite(parsedAmount) && parsedAmount > 0;

  // A connected wallet with no SOL can still buy: the launch wallet is the fee
  // payer and the connected wallet only receives tokens. Say so plainly instead
  // of letting the user assume their empty wallet is the blocker — that wrong
  // assumption is what made this look broken.
  const walletSol = holdingsRead?.walletLamports ?? null;
  const walletEmpty = address !== null && walletSol !== null && walletSol < 5_000;

  const sellAmount = (pct: number): number =>
    heldTokens === null ? 0 : Math.floor(heldTokens * (pct / 100) * 1e6) / 1e6;

  return (
    <div id="trade" className="card border-l-2 border-l-[var(--violet)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="label">
          trade · {address ? "signs with the launch wallet" : "connect a wallet to trade"}
        </p>
        {market?.exists && (
          <span className="mono text-[10px] text-fg-faint">
            reserve {fmt(market.reserveSol, 4)} SOL
          </span>
        )}
      </div>

      {/* --- holdings --- */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="mono text-[11px] text-fg-dim">
          {address ? (
            <>
              {shortAddress(address)} ·{" "}
              {heldTokens === null ? (
                <span className="text-fg-faint">holdings unknown</span>
              ) : (
                <span className="text-fg">{fmt(heldTokens, 2)} {symbol}</span>
              )}
            </>
          ) : (
            <span className="text-fg-faint">no wallet connected</span>
          )}
        </span>
        {!address && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={connecting}
            onClick={async () => {
              const res = await toggleWallet();
              if (!res.ok) {
                push(
                  res.reason === "no_provider"
                    ? "No Solana wallet found. Install Phantom or Solflare."
                    : "Wallet connection declined",
                  "info",
                );
              }
            }}
          >
            {connecting ? "connecting…" : available ? "connect wallet" : "no wallet found"}
          </button>
        )}
      </div>

      {/* --- buy --- */}
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="label">buy amount (SOL)</span>
          <input
            className="input mt-1"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setQuote(null);
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!amountOk || busy !== null || !market?.exists}
          onClick={() => void submit("buy", parsedAmount, false)}
        >
          {busy === "quote" ? "quoting…" : "quote buy"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {BUY_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`tab ${Number(amount) === p ? "tab-active" : ""}`}
            onClick={() => {
              setAmount(String(p));
              setQuote(null);
            }}
          >
            {p} SOL
          </button>
        ))}
      </div>

      {/* --- sell --- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="label">sell</span>
        {SELL_PRESETS.map((pct) => (
          <button
            key={pct}
            type="button"
            className="btn"
            disabled={busy !== null || !market?.exists || !heldTokens}
            title={heldTokens ? `${fmt(sellAmount(pct), 4)} ${symbol}` : "Connect a wallet that holds this token"}
            onClick={() => void submit("sell", sellAmount(pct), false)}
          >
            {pct}%
          </button>
        ))}
        {heldTokens === null && address && (
          <span className="mono text-[10px] text-fg-faint">holdings not read</span>
        )}
      </div>

      {/* --- slippage --- */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="label">slippage tolerance</span>
          <span className="mono text-[10px] text-fg-dim">{(slippageBps / 100).toFixed(2)}%</span>
        </div>
        <input
          type="range"
          min={1}
          max={2000}
          step={10}
          value={slippageBps}
          onChange={(e) => {
            setSlippageBps(Number(e.target.value));
            setQuote(null);
          }}
          className="mt-1 w-full accent-[var(--accent)]"
        />
      </div>

      {/* --- quote to confirm --- */}
      {quote && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label mb-2">confirm this {quote.action}</p>
          <dl className="mono space-y-1 text-[11px]">
            <Row k="you pay" v={quote.action === "buy" ? `${quote.amount} SOL` : `${fmt(fromAtoms(quote.amountIn), 4)} ${symbol}`} />
            <Row
              k="you receive"
              v={
                quote.action === "buy"
                  ? `${fmt(fromAtoms(quote.expectedOut), 4)} ${symbol}`
                  : `${fmt(Number(quote.expectedOut) / 1e9, 6)} SOL`
              }
            />
            <Row
              k="minimum out"
              v={
                quote.action === "buy"
                  ? `${fmt(fromAtoms(quote.minOut), 4)} ${symbol}`
                  : `${fmt(Number(quote.minOut) / 1e9, 6)} SOL`
              }
            />
            <Row k="fee" v={`${fmt(Number(quote.fee) / 1e9, 6)} SOL`} />
            <Row k="price now" v={quote.price} />
            <Row k="price after" v={quote.priceAfter} />
            <Row k="cluster" v={quote.cluster} />
          </dl>
          <p className="mono mt-2 text-[10px] text-fg-faint">
            This submits a real transaction on {quote.cluster}. Nothing has been signed yet.
            {address
              ? " Your wallet receives the tokens; this site's launch wallet pays, so you do not need SOL to buy."
              : " With no wallet connected the launch wallet trades both sides."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void submit(quote.action, quote.amount, true)}
            >
              {busy === "confirm" ? "submitting…" : `confirm ${quote.action}`}
            </button>
            <button type="button" className="btn" onClick={() => setQuote(null)}>
              cancel
            </button>
          </div>
        </div>
      )}

      {/* --- fill --- */}
      {fill && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label mb-2 text-[var(--live)]">filled on chain</p>
          <dl className="mono space-y-1 text-[11px]">
            <Row
              k="paid"
              v={fill.action === "buy" ? `${fmt(Number(fill.amountIn) / 1e9, 6)} SOL` : `${fmt(fromAtoms(fill.amountIn), 4)} ${symbol}`}
            />
            <Row
              k="received"
              v={fill.action === "buy" ? `${fmt(fromAtoms(fill.amountOut), 4)} ${symbol}` : `${fmt(Number(fill.amountOut) / 1e9, 6)} SOL`}
            />
            <Row k="fee" v={`${fmt(Number(fill.fee) / 1e9, 6)} SOL`} />
            <Row k="price after" v={fill.priceAfter} />
            <Row k="your balance" v={`${fmt(fromAtoms(fill.traderTokenBalance), 4)} ${symbol}`} />
            <Row k="reserve" v={`${fmt(fill.reserveSol, 4)} SOL`} />
            {fill.fundedBy === "launch_wallet" && (
              <Row k="funded by" v="launch wallet" />
            )}
          </dl>
          <a
            className="btn mt-3 inline-flex"
            href={fill.explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            view tx on explorer ↗
          </a>
        </div>
      )}

      {walletEmpty && (
        <p className="mono mt-2 text-[10px] text-[var(--sim)]">
          Your wallet holds {fmt((walletSol ?? 0) / 1e9, 4)} SOL. You can still buy — this site&apos;s
          launch wallet pays and the tokens are delivered to you. Fund it only if you want to trade
          with your own funds.
        </p>
      )}

      {error && <p className="mono mt-3 text-[11px] text-[var(--danger)]">{error}</p>}

      <p className="mono mt-4 text-[10px] leading-relaxed text-fg-faint">
        Routed through this site&apos;s own bonding curve. The price is quoted from the curve&apos;s
        live on-chain balance, not from the request. Fills are verified by reading token balances
        back off-chain after confirmation.
        {address ? (
          <> The server holds the only signing key; your wallet chooses whose token account fills.</>
        ) : (
          <> With no wallet connected the launch wallet trades, which is a real trade we are on both sides of.</>
        )}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="text-right text-fg">{v}</dd>
    </div>
  );
}

function shortTransaction(sig: string): string {
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}
