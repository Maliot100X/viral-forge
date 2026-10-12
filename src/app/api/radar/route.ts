import { NextResponse, connection } from "next/server";
import { getRadarState, logRadar, setTrends, updateSettings } from "@/lib/store";
import { scanAll } from "@/lib/trends";
import { forgeFromTrend } from "@/lib/forge";
import { addCoin, listCoins } from "@/lib/store";
import { generateCoinId, generateMint } from "@/lib/ids";
import type { Coin, RadarSettings } from "@/lib/types";

export async function GET() {
  await connection();
  const state = await getRadarState();
  const launched = (await listCoins("radar")).slice(0, 24);
  return NextResponse.json({ ...state, launched });
}

export async function POST(req: Request) {
  await connection();
  let body: {
    action?: string;
    settings?: Partial<RadarSettings>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = body.action ?? "tick";

  if (action === "settings") {
    const next = await updateSettings(body.settings ?? {});
    await logRadar(
      `Settings saved: interval ${next.intervalSec}s · max ${next.maxPerTick}/scan · min heat ${next.minScore}`,
    );
    return NextResponse.json(await getRadarState());
  }

  if (action === "stop") {
    await updateSettings({ enabled: false });
    await logRadar("Radar stopped");
    return NextResponse.json(await getRadarState());
  }

  if (action === "start") {
    await updateSettings({ enabled: true });
    await logRadar(
      "Radar initialised (simulation mode · no wallet configured)",
    );
  }

  if (action === "recover") {
    const coins = await listCoins("radar");
    await logRadar(`Recovered ${coins.length} radar coin(s) from local state`);
    return NextResponse.json({
      ...(await getRadarState()),
      recovered: coins.length,
    });
  }

  if (action === "tick" || action === "start") {
    const state = await getRadarState();
    if (!state.settings.enabled) {
      await logRadar("Scan requested while radar is off — no action taken");
      return NextResponse.json(await getRadarState());
    }

    const { trends, errors } = await scanAll(state.settings.sources);
    await setTrends(trends);

    const seen = new Set(state.seen);
    const unseen = trends.filter(
      (t) => !seen.has(t.id) && t.score >= state.settings.minScore,
    );
    const toForge = unseen.slice(0, state.settings.maxPerTick);

    const created: Coin[] = [];
    for (const trend of toForge) {
      const gen = forgeFromTrend(trend);
      const mint = generateMint();
      const coin: Coin = {
        id: generateCoinId(),
        name: gen.name,
        symbol: gen.symbol,
        description: gen.description,
        imageUrl: `/api/logo/${mint}.webp`,
        imagePrompt: gen.imagePrompt,
        imageStyle: gen.imageStyle,
        tags: gen.tags,
        vibe: gen.vibe,
        source: "trend",
        sourceRef: `${trend.source}: ${trend.title.toLowerCase().slice(0, 60)}`,
        mint,
        createdAt: new Date().toISOString(),
        mode: "simulated",
        launchedBy: "radar",
        pumpUrl: `https://pump.fun/coin/${mint}`,
      };
      await addCoin(coin);
      created.push(coin);
      seen.add(trend.id);
    }

    const summary = created.length
      ? `Scan ${state.ticks + 1}: ${trends.length} trends · forged ${created
          .map((c) => `$${c.symbol}`)
          .join(", ")} (simulated)`
      : `Scan ${state.ticks + 1}: ${trends.length} trends · nothing above min heat ${state.settings.minScore}`;

    await logRadar(
      errors.length ? `${summary} · source issues: ${errors.join("; ")}` : summary,
      { seen: [...seen], ticks: state.ticks + 1 },
    );

    return NextResponse.json({
      ...(await getRadarState()),
      launched: created,
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
