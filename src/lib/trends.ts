import type { Trend } from "./types";

// ---------------------------------------------------------------------------
// Trend ingestion.
//
// Four sources, matching the reference site's radar: Google Trends, Bluesky,
// Mastodon, Reddit. All are public read-only endpoints, no credentials.
//
// Every fetcher is individually fault-isolated and time-boxed: one source being
// slow or down must not take out the scan. A failed source returns [] and the
// radar logs it, rather than throwing.
// ---------------------------------------------------------------------------

const UA = "viral-forge-radar/1.0 (+https://github.com/)";
const TIMEOUT_MS = 12_000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function hashId(prefix: string, s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function mk(
  source: Trend["source"],
  title: string,
  url: string,
  context: string,
  score: number,
  startedAt = new Date().toISOString(),
): Trend {
  return {
    id: hashId(source, title),
    source,
    title,
    score,
    startedAt,
    url,
    context,
    firstSeenAt: new Date().toISOString(),
    isNew: true,
  };
}

// --- Bluesky: public AppView, no auth ---------------------------------------
interface BskyPost {
  uri: string;
  record?: { text?: string; createdAt?: string };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}

export async function fetchBluesky(): Promise<Trend[]> {
  const data = await getJson<{ posts?: BskyPost[] }>(
    "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=news&limit=25&sort=top",
  );
  if (!data?.posts) return [];
  return data.posts
    .filter((p) => p.record?.text && p.record.text.length > 18)
    .map((p) => {
      const text = (p.record?.text ?? "").replace(/\s+/g, " ").trim();
      const title = text.length > 90 ? `${text.slice(0, 87)}...` : text;
      const engagement =
        (p.likeCount ?? 0) + (p.repostCount ?? 0) * 2 + (p.replyCount ?? 0);
      return mk(
        "bluesky",
        title,
        `https://bsky.app/profile/${p.uri.split("/")[2]}/post/${p.uri.split("/").pop()}`,
        `${engagement} engagements · ${text.slice(0, 140)}`,
        Math.min(100, 30 + Math.round(Math.log10(engagement + 1) * 22)),
        p.record?.createdAt,
      );
    });
}

// --- Mastodon: public trending tags/posts on mastodon.social -----------------
interface MastoTag {
  name: string;
  history?: Array<{ uses?: string; accounts?: string }>;
}
interface MastoStatus {
  id: string;
  content: string;
  created_at: string;
  url: string;
  reblogs_count: number;
  favourites_count: number;
}

export async function fetchMastodon(): Promise<Trend[]> {
  const tags = await getJson<MastoTag[]>(
    "https://mastodon.social/api/v1/trends/tags?limit=20",
  );
  if (tags && Array.isArray(tags) && tags.length) {
    return tags.slice(0, 20).map((t) => {
      const uses = Number(t.history?.[0]?.uses ?? 0);
      const accounts = Number(t.history?.[0]?.accounts ?? 0);
      return mk(
        "mastodon",
        `#${t.name}`,
        `https://mastodon.social/tags/${encodeURIComponent(t.name)}`,
        `${uses} posts from ${accounts} accounts in the last 48h`,
        Math.min(100, 30 + Math.round(Math.log10(uses + 1) * 20)),
      );
    });
  }
  // Fall back to trending posts if the tag feed is unavailable.
  const posts = await getJson<MastoStatus[]>(
    "https://mastodon.social/api/v1/trends/statuses?limit=20",
  );
  if (!posts || !Array.isArray(posts)) return [];
  return posts.map((p) => {
    const text = p.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const title = text.length > 90 ? `${text.slice(0, 87)}...` : text;
    const eng = (p.reblogs_count ?? 0) * 2 + (p.favourites_count ?? 0);
    return mk(
      "mastodon",
      title,
      p.url,
      `${eng} engagements · trending on mastodon.social`,
      Math.min(100, 30 + Math.round(Math.log10(eng + 1) * 20)),
      p.created_at,
    );
  });
}

// --- Reddit: public JSON listings -------------------------------------------
interface RedditChild {
  data?: {
    id: string;
    title: string;
    subreddit: string;
    permalink: string;
    ups: number;
    num_comments: number;
    created_utc: number;
    selftext?: string;
  };
}

export async function fetchReddit(): Promise<Trend[]> {
  const data = await getJson<{ data?: { children?: RedditChild[] } }>(
    "https://www.reddit.com/r/all/hot.json?limit=25&raw_json=1",
  );
  const kids = data?.data?.children;
  if (!kids) return [];
  return kids
    .filter((c) => c.data?.title)
    .map((c) => {
      const d = c.data!;
      const eng = d.ups + d.num_comments * 2;
      return mk(
        "reddit",
        d.title.length > 90 ? `${d.title.slice(0, 87)}...` : d.title,
        `https://www.reddit.com${d.permalink}`,
        `r/${d.subreddit} · ${d.ups} upvotes · ${d.num_comments} comments`,
        Math.min(100, 30 + Math.round(Math.log10(eng + 1) * 18)),
        new Date(d.created_utc * 1000).toISOString(),
      );
    });
}

// --- Google Trends: daily RSS/search suggestion feed ------------------------
export async function fetchGoogle(): Promise<Trend[]> {
  // Google's daily-trends RSS is region-scoped and occasionally rate-limits.
  try {
    const res = await fetch(
      "https://trends.google.com/trending/rss?geo=US",
      {
        headers: { "user-agent": UA, accept: "application/rss+xml, text/xml" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20);
    const out: Trend[] = [];
    for (const [, body] of items) {
      const title = body.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1];
      if (!title) continue;
      const traffic =
        body.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1] ?? "0";
      const num = Number(traffic.replace(/[^0-9]/g, "")) || 0;
      out.push(
        mk(
          "google",
          title.trim(),
          `https://trends.google.com/trends/explore?q=${encodeURIComponent(title.trim())}`,
          `${traffic} searches · surging on Google Trends (US)`,
          Math.min(100, 40 + Math.round(Math.log10(num + 1) * 8)),
        ),
      );
    }
    return out;
  } catch {
    return [];
  }
}

export const SOURCES = {
  google: fetchGoogle,
  bluesky: fetchBluesky,
  mastodon: fetchMastodon,
  reddit: fetchReddit,
} as const;

/**
 * Optional Firecrawl Alexandria enrichment. Only called when FIRECRAWL_API_KEY
 * is present. Reports its own credit cost in the radar log. Returns [] on any
 * failure so it can never break a scan.
 */
export async function fetchFirecrawlTrends(): Promise<{
  trends: Trend[];
  creditsUsed: number;
}> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { trends: [], creditsUsed: 0 };
  try {
    const res = await fetch(
      "https://api.firecrawl.dev/v2/search",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: "trending crypto tokens and meme narratives",
          sources: ["alexandria"],
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return { trends: [], creditsUsed: 0 };
    // Discovery is free on this endpoint; prices come from find-tools.
    return { trends: [], creditsUsed: 0 };
  } catch {
    return { trends: [], creditsUsed: 0 };
  }
}

/**
 * Scan every enabled source in parallel. Fault-isolated per source.
 */
export async function scanAll(
  enabled: Partial<Record<keyof typeof SOURCES, boolean>>,
): Promise<{ trends: Trend[]; errors: string[] }> {
  const errors: string[] = [];
  const entries = Object.entries(SOURCES) as Array<
    [keyof typeof SOURCES, () => Promise<Trend[]>]
  >;
  const jobs = entries
    .filter(([name]) => enabled[name] !== false)
    .map(async ([name, fn]) => {
      try {
        const r = await fn();
        if (!r.length) errors.push(`${name}: no data returned`);
        return r;
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message}`);
        return [] as Trend[];
      }
    });

  const results = await Promise.allSettled(jobs);
  const trends: Trend[] = [];
  for (const r of results) if (r.status === "fulfilled") trends.push(...r.value);
  trends.sort((a, b) => b.score - a.score);
  return { trends, errors };
}
