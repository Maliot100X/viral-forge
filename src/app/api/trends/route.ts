import { NextResponse, connection } from "next/server";
import { scanAll } from "@/lib/trends";
import { getTrends, setTrends } from "@/lib/store";

// GET returns the cached trend set (fast, what the homepage tape renders).
// POST forces a fresh scan across every enabled source.

export async function GET() {
  await connection();
  const cached = await getTrends();
  if (cached.length) return NextResponse.json({ trends: cached });

  // Cold cache (fresh server, fresh deploy). The homepage tape and the
  // companion both read this endpoint, so populate it rather than showing an
  // empty feed until someone happens to trigger a scan.
  const { trends, errors } = await scanAll({
    google: true,
    bluesky: true,
    mastodon: true,
    reddit: true,
  });
  if (trends.length) await setTrends(trends);
  return NextResponse.json({ trends, errors });
}

export async function POST() {
  await connection();
  const { trends, errors } = await scanAll({
    google: true,
    bluesky: true,
    mastodon: true,
    reddit: true,
  });
  if (trends.length) await setTrends(trends);
  return NextResponse.json({ trends, errors });
}
