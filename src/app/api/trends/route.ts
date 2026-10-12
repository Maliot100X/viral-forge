import { NextResponse, connection } from "next/server";
import { scanAll } from "@/lib/trends";
import { getTrends, setTrends } from "@/lib/store";

// GET returns the cached trend set (fast, what the homepage tape renders).
// POST forces a fresh scan across every enabled source.

export async function GET() {
  await connection();
  const trends = await getTrends();
  return NextResponse.json({ trends });
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
