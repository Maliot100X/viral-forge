// ---------------------------------------------------------------------------
// Market data: prices, metadata, and token intelligence.
//
// Three sources, each labelled honestly about what it can actually answer:
//
//   jupiter — real DEX prices and token metadata. Mainnet only. Asking it
//             about a devnet mint returns an empty result, not an error, so
//             the caller is told "unavailable" rather than shown a zero.
//   threews — three.ws's keyless crypto API. Read-only enrichment (holders,
//             security, whales, trending). No auth, so it is safe to call from
//             a request path, but it is still a third party and can be down.
//   curve   — our own bonding curve. The only source that is authoritative for
//             a token we launched on devnet, because no external DEX indexes
//             it. Its numbers come from the curve account, not from here.
//
// Every function returns `null` or an explicitly-empty value on failure rather
// than inventing a number. A price shown to someone about to trade must either
// be real or absent; a plausible-looking zero is worse than no data.
//
// Cache entries carry the time they were fetched so the UI can show staleness
// instead of implying live data.
// ---------------------------------------------------------------------------

import { activeCluster } from "./solana";

/** Where a piece of market data came from. Shown in the UI. */
export type DataSource = "jupiter" | "threews" | "curve";

export interface Priced<T> {
  value: T;
  source: DataSource;
  /** Unix ms when this value was fetched. */
  fetchedAt: number;
  /** True when served from cache rather than fetched on this call. */
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Test/ops hook: drop every cached value. */
export function clearDexCache(): void {
  cache.clear();
}

/**
 * Returns the cached value when it is still within `ttlMs`, otherwise calls
 * `load` and stores the result. A failed load is not cached, so a transient
 * outage does not pin an empty result in place for the whole TTL.
 */
async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T | null>,
): Promise<Priced<T> | null> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();
  if (hit && now - hit.fetchedAt < ttlMs) {
    return { value: hit.value, source: sourceOf(key), fetchedAt: hit.fetchedAt, cached: true };
  }
  const value = await load();
  if (value === null) return null;
  cache.set(key, { value, fetchedAt: now });
  return { value, source: sourceOf(key), fetchedAt: now, cached: false };
}

function sourceOf(key: string): DataSource {
  if (key.startsWith("jup:")) return "jupiter";
  if (key.startsWith("3ws:")) return "threews";
  return "curve";
}

/** Times that suit the data's churn rate. */
export const TTL = {
  /** A price is worth keeping briefly; seconds, not minutes. */
  price: 15_000,
  /** Token metadata barely changes. */
  metadata: 5 * 60_000,
  /** Holder and security snapshots are slower to move. */
  intelligence: 2 * 60_000,
  /** Trending lists change on the order of minutes. */
  trending: 60_000,
} as const;

/**
 * Fetch with a hard timeout and JSON parsing that refuses to treat a
 * non-JSON body as data. Third-party outages commonly answer 200 with an HTML
 * error page, which would otherwise be parsed into nonsense.
 */
async function getJson<T>(
  url: string,
  timeoutMs = 8_000,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text[0] !== "{" && text[0] !== "[") return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Jupiter — mainnet prices and metadata
// ---------------------------------------------------------------------------

const JUPITER_BASE = "https://lite-api.jup.ag";

interface JupiterPrice {
  usdPrice?: number;
  priceChange24h?: number;
  liquidity?: number;
  decimals?: number;
  blockId?: number;
}

export interface TokenPrice {
  mint: string;
  usdPrice: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
}

/**
 * Prices in USD for up to 50 mints.
 *
 * Jupiter only indexes mainnet, so a devnet mint yields no entry. That is
 * reported as `usdPrice: null`, which the UI renders as "no external market",
 * rather than as a zero that would read like a real price of $0.
 */
export async function prices(
  mints: string[],
): Promise<Priced<Record<string, TokenPrice>> | null> {
  const unique = [...new Set(mints.filter(Boolean))].slice(0, 50);
  if (unique.length === 0) return null;

  const key = `jup:price:${unique.join(",")}`;
  return cached(key, TTL.price, async () => {
    const raw = await getJson<Record<string, JupiterPrice>>(
      `${JUPITER_BASE}/price/v3?ids=${unique.join(",")}`,
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const out: Record<string, TokenPrice> = {};
    for (const mint of unique) {
      const p = raw[mint];
      out[mint] = {
        mint,
        usdPrice: typeof p?.usdPrice === "number" ? p.usdPrice : null,
        priceChange24h:
          typeof p?.priceChange24h === "number" ? p.priceChange24h : null,
        liquidityUsd: typeof p?.liquidity === "number" ? p.liquidity : null,
      };
    }
    return out;
  });
}

export interface TokenMetadata {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  logoUri: string | null;
  /** Jupiter's own tags, e.g. "verified", "strict". */
  tags: string[];
}

/** Token metadata for a single mint. Returns null when the mint is unknown. */
export async function tokenMetadata(
  mint: string,
): Promise<Priced<TokenMetadata> | null> {
  if (!mint) return null;
  const key = `jup:meta:${mint}`;
  return cached(key, TTL.metadata, async () => {
    const rows = await getJson<Array<Record<string, unknown>>>(
      `${JUPITER_BASE}/tokens/v2/search?query=${encodeURIComponent(mint)}&limit=5`,
    );
    // An unrecognised mint returns [], which is a clean "not indexed here".
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows.find((r) => r.id === mint) ?? rows[0];
    if (!row || typeof row.id !== "string") return null;
    return {
      mint: row.id,
      name: typeof row.name === "string" ? row.name : null,
      symbol: typeof row.symbol === "string" ? row.symbol : null,
      decimals: typeof row.decimals === "number" ? row.decimals : null,
      logoUri: typeof row.icon === "string" ? row.icon : null,
      tags: Array.isArray(row.tags)
        ? row.tags.filter((t): t is string => typeof t === "string")
        : [],
    };
  });
}

// ---------------------------------------------------------------------------
// three.ws — keyless crypto intelligence
// ---------------------------------------------------------------------------

const THREEWS_BASE = "https://three.ws/api";

export interface TokenSecurity {
  mint: string;
  /** Null when the source did not answer, never a defaulted `false`. */
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  isMutable: boolean | null;
  raw: Record<string, unknown>;
}

/**
 * Security flags for a mint via three.ws.
 *
 * The response shape is a third party's and is not guaranteed, so each field is
 * read defensively and left null when absent. A missing flag is reported as
 * unknown rather than as "safe".
 */
export async function tokenSecurity(
  mint: string,
): Promise<Priced<TokenSecurity> | null> {
  if (!mint) return null;
  const key = `3ws:security:${mint}`;
  return cached(key, TTL.intelligence, async () => {
    const raw = await getJson<Record<string, unknown>>(
      `${THREEWS_BASE}/crypto/security?address=${encodeURIComponent(mint)}`,
    );
    if (!raw || typeof raw !== "object") return null;
    const bool = (v: unknown): boolean | null =>
      typeof v === "boolean" ? v : null;
    return {
      mint,
      mintAuthorityRevoked: bool(raw.mintAuthorityRevoked ?? raw.mintAuthorityDisabled),
      freezeAuthorityRevoked: bool(
        raw.freezeAuthorityRevoked ?? raw.freezeAuthorityDisabled,
      ),
      isMutable: bool(raw.isMutable),
      raw,
    };
  });
}

export interface HolderSnapshot {
  mint: string;
  holderCount: number | null;
  topHolders: Array<{ address: string; pct: number | null }>;
}

/** Holder distribution via three.ws. */
export async function holders(
  mint: string,
): Promise<Priced<HolderSnapshot> | null> {
  if (!mint) return null;
  const key = `3ws:holders:${mint}`;
  return cached(key, TTL.intelligence, async () => {
    const raw = await getJson<Record<string, unknown>>(
      `${THREEWS_BASE}/crypto/holders?address=${encodeURIComponent(mint)}`,
    );
    if (!raw || typeof raw !== "object") return null;

    const list = Array.isArray(raw.holders)
      ? raw.holders
      : Array.isArray(raw.topHolders)
        ? raw.topHolders
        : [];

    const topHolders = list.slice(0, 20).flatMap((h) => {
      if (!h || typeof h !== "object") return [];
      const rec = h as Record<string, unknown>;
      const address =
        typeof rec.address === "string"
          ? rec.address
          : typeof rec.owner === "string"
            ? rec.owner
            : null;
      if (!address) return [];
      const pctRaw = rec.pct ?? rec.percentage ?? rec.share;
      const pct =
        typeof pctRaw === "number"
          ? pctRaw
          : typeof pctRaw === "string" && pctRaw !== ""
            ? Number(pctRaw)
            : null;
      return [{ address, pct: Number.isFinite(pct) ? pct : null }];
    });

    const countRaw = raw.holderCount ?? raw.totalHolders ?? raw.count;
    const holderCount =
      typeof countRaw === "number"
        ? countRaw
        : typeof countRaw === "string" && countRaw !== ""
          ? Number(countRaw)
          : null;

    return {
      mint,
      holderCount: Number.isFinite(holderCount) ? holderCount : null,
      topHolders,
    };
  });
}

export interface TrendingToken {
  mint: string;
  symbol: string | null;
  name: string | null;
}

/** Trending tokens via three.ws. */
export async function trending(): Promise<Priced<TrendingToken[]> | null> {
  const key = "3ws:trending";
  return cached(key, TTL.trending, async () => {
    const raw = await getJson<unknown>(`${THREEWS_BASE}/crypto/trending`);
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).tokens)
        ? ((raw as Record<string, unknown>).tokens as unknown[])
        : [];
    if (list.length === 0) return null;

    const tokens = list.slice(0, 25).flatMap((t) => {
      if (!t || typeof t !== "object") return [];
      const rec = t as Record<string, unknown>;
      const mint =
        typeof rec.address === "string"
          ? rec.address
          : typeof rec.mint === "string"
            ? rec.mint
            : null;
      if (!mint) return [];
      return [
        {
          mint,
          symbol: typeof rec.symbol === "string" ? rec.symbol : null,
          name: typeof rec.name === "string" ? rec.name : null,
        },
      ];
    });
    return tokens.length > 0 ? tokens : null;
  });
}

/** A third party is only useful if it answers; used by /api/status. */
export async function threeWsReachable(): Promise<boolean> {
  const raw = await getJson<unknown>(`${THREEWS_BASE}/crypto`, 5_000);
  return raw !== null;
}

/**
 * Whether external DEX data can exist for this cluster at all.
 *
 * Devnet tokens are not indexed by any of these sources, so the UI needs to
 * say "the curve is the market" instead of showing an empty Jupiter lookup as
 * though it were a data failure.
 */
export function externalMarketAvailable(): boolean {
  return activeCluster() === "mainnet-beta";
}
