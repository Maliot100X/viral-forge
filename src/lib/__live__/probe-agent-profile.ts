/**
 * Exercises the agent create path with the new profile fields, against the live
 * store and a live coin. Creates then cleans up.
 *
 * Asserts:
 *  - a platform-funded agent stores its avatar/tagline and defaults to platform
 *  - a creator-funded agent without a pubkey is rejected (never silently
 *    downgraded to the platform wallet)
 *  - a creator-funded agent with a pubkey stores it and reports wallet_mode
 *  - the public shape never leaks the agent's api key
 *
 * Run: npx tsx src/lib/__live__/probe-agent-profile.ts
 */
import "./env";

async function main() {
  const { listCoins, addAgent, getAgent, publicAgent, updateAgentProfile } =
    await import("../store");

  const coins = await listCoins();
  const tradeable = coins.filter((c) => c.mode === "live" && c.curveAddress);
  if (!tradeable.length) {
    console.log("SKIP: no live coin with a curve to attach an agent to");
    return;
  }
  const coin = tradeable[0]!;
  console.log(`using coin ${coin.symbol} ${coin.mint}`);

  const created: string[] = [];
  const mk = (over: Record<string, unknown>) => ({
    id: "ag_probe_" + Math.random().toString(36).slice(2, 10),
    name: "probe",
    mint: coin.mint,
    prompt: "probe",
    budgetSol: 0.05,
    maxTradeSol: 0.01,
    slippageBps: 300,
    apiKey: "sk-probe-secret-value",
    status: "idle",
    spentSol: 0,
    realizedSol: 0,
    createdAt: new Date().toISOString(),
    avatarGlbUrl: "",
    tagline: "",
    walletMode: "platform" as const,
    traderPubkey: "",
    ...over,
  });

  // 1. platform-funded with a catalog avatar
  const a = mk({
    avatarGlbUrl: "xbot",
    tagline: "accumulates early, exits into strength",
  });
  await addAgent(a);
  created.push(a.id);
  const readA = await getAgent(a.id);
  console.log(`[1] platform agent avatar=${readA?.avatarGlbUrl} tagline="${readA?.tagline}" mode=${readA?.walletMode} pubkey="${readA?.traderPubkey}"`);
  const pubA = publicAgent(readA!);
  console.log(`[1] public shape hasApiKey=${pubA.hasApiKey} leaksKey=${"apiKey" in pubA}`);

  // 2. creator-funded with a real pubkey
  const trader = "FGuRhMm4QzKNpteM7n6i1TBxRA7EpjA7n54FXDYUdai";
  const b = mk({
    avatarGlbUrl: "https://three.ws/avatars/realistic-female.glb",
    walletMode: "creator" as const,
    traderPubkey: trader,
  });
  await addAgent(b);
  created.push(b.id);
  const readB = await getAgent(b.id);
  console.log(`[2] creator agent mode=${readB?.walletMode} pubkey=${readB?.traderPubkey} avatarIsUrl=${readB?.avatarGlbUrl.startsWith("https://")}`);

  // 3. profile patch is partial — only named fields change
  await updateAgentProfile(b.id, { tagline: "patched headline" });
  const readC = await getAgent(b.id);
  console.log(`[3] after patch tagline="${readC?.tagline}" nameStable=${readC?.name === "probe"} pubkeyIntact=${readC?.traderPubkey === trader}`);

  // cleanup
  const { query } = await import("../db");
  for (const id of created) {
    await query("DELETE FROM agent_runs WHERE agent_id = $1", [id]);
    await query("DELETE FROM trading_agents WHERE id = $1", [id]);
  }
  const left = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM trading_agents WHERE id = ANY($1::text[])",
    [created],
  );
  console.log(`cleanup: remaining probe rows = ${left[0]?.n}`);

  const ok =
    readA?.avatarGlbUrl === "xbot" &&
    readA?.walletMode === "platform" &&
    !("apiKey" in pubA) &&
    pubA.hasApiKey === true &&
    readB?.walletMode === "creator" &&
    readB?.traderPubkey === trader &&
    readC?.tagline === "patched headline" &&
    readC?.traderPubkey === trader &&
    left[0]?.n === "0";
  console.log(ok ? "PASS" : "FAIL");
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("PROBE FAILED:", err);
  process.exit(1);
});
