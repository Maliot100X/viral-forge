// Live devnet probe: drive the PRODUCTION agent route end to end.
//
// This is the proof that the /agents tab is not a mock. It imports the real
// route handler from src/app/api/agents/route.ts — the exact module the website
// calls — and exercises: create -> run (428 gate) -> confirm (real transaction).
//
// Nothing here reimplements the agent. If this fails, the site fails.
//
// Run: npx tsx src/lib/__live__/probe-agent-e2e.ts <mint> [prompt]
//
// The mint must already have a persisted curve; use probe-schema.ts to find one
// and run-backfill.ts to attach a curve if it does not.

// Must be first: db.ts captures DATABASE_URL at module-eval time, and ESM
// hoists static imports above this module's body.
import "./env";

import { readCurveState } from "../onchain";
import { walletBalanceSol } from "../solana";

const MINT = process.argv[2];
const PROMPT =
  process.argv[3] ??
  "Buy small on weakness, sell a quarter when the curve is up. Never exceed the budget.";

function fail(msg: string): never {
  console.error("AGENT_E2E_FAILED", msg);
  process.exit(1);
}

async function main() {
  if (!MINT) fail("usage: probe-agent-e2e.ts <mint> [prompt]");

  const store = await import("../store");
  const route = await import("../../app/api/agents/route");

  const coin = await store.getCoin(MINT!);
  if (!coin) fail(`no coin row for ${MINT}`);
  if (!coin.curveAddress) fail(`${coin.symbol} has no curve_address`);
  console.log(`${coin.symbol} ${MINT} curve ${coin.curveAddress}`);
  console.log("wallet before:", await walletBalanceSol());

  const before = await readCurveState(coin.curveAddress);
  console.log("reserve before SOL:", Number(before.realSolReserve) / 1e9);

  // ---- 1. create -----------------------------------------------------------
  const created = await route.POST(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name: "E2E Prover",
        mint: MINT,
        prompt: PROMPT,
        budgetSol: 0.2,
        maxTradeSol: 0.05,
        slippageBps: 300,
      }),
    }),
  );
  const createdBody = await created.json();
  if (created.status !== 201) fail(`create returned ${created.status}: ${JSON.stringify(createdBody)}`);
  const agentId: string = createdBody.agent.id;
  console.log("CREATED", agentId);
  if ("apiKey" in createdBody.agent) fail("create leaked the agent api key to the client");
  console.log("api key withheld from response:", createdBody.agent.hasApiKey === false);

  // ---- 2. run WITHOUT confirm -> must be the 428 gate -----------------------
  const gated = await route.POST(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", id: agentId, confirm: false }),
    }),
  );
  const gatedBody = await gated.json();
  console.log("run(confirm=false) ->", gated.status, JSON.stringify(gatedBody));

  // A hold is a legitimate decision: it means the agent chose not to trade, so
  // there is nothing to confirm. Only a buy/sell must hit the gate.
  const action: string = gatedBody.action;
  if (action === "buy" || action === "sell") {
    if (gated.status !== 428) {
      fail(`expected the 428 confirm gate for a ${action}, got ${gated.status}`);
    }
    console.log("428 GATE HELD: no transaction was signed without confirmation");
  } else {
    console.log(`agent chose "${action}" — no trade to confirm, which is a valid outcome`);
  }

  // ---- 3. run WITH confirm -> real transaction -----------------------------
  const ran = await route.POST(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", id: agentId, confirm: true }),
    }),
  );
  const ranBody = await ran.json();
  console.log("run(confirm=true) ->", ran.status, JSON.stringify(ranBody));

  if (!ranBody.ok) fail(`run failed: ${JSON.stringify(ranBody)}`);

  if (ranBody.traded) {
    if (!ranBody.signature) fail("a traded run must carry a signature");
    console.log("AGENT TRADE SIG:", ranBody.explorerUrl);
    const b = ranBody.budget;
    console.log("budget after fill:", JSON.stringify(b));
    if (b && b.remainingSol !== b.budgetSol - b.spentSol) {
      fail(
        `budget disagrees with itself: remaining ${b.remainingSol} vs budget ${b.budgetSol} minus spent ${b.spentSol}`,
      );
    }
    console.log("BUDGET CONSISTENT: remaining === budget - spent");
    const after = await readCurveState(coin.curveAddress);
    console.log("reserve after SOL:", Number(after.realSolReserve) / 1e9);
    if (Number(after.realSolReserve) === Number(before.realSolReserve)) {
      fail("reserve did not move: the agent reported a trade that did not land");
    }
    console.log("RESERVE MOVED: the agent's trade is real on devnet");
  } else {
    console.log("agent held on the confirmed run too; decision recorded without a signature");
  }

  // ---- 4. the run log is persisted ------------------------------------------
  const detail = await route.GET(
    new Request(`http://localhost/api/agents?id=${agentId}`),
  );
  const detailBody = await detail.json();
  console.log("runs recorded:", detailBody.runs?.length ?? 0);
  if (!detailBody.runs?.length) fail("no agent run was recorded");
  for (const r of detailBody.runs) {
    console.log(
      `  #${r.id} ${r.action} amt=${r.amount} via=${r.provenance} sig=${r.signature ? r.signature.slice(0, 12) + "..." : "none"} ${r.reason ?? ""}`,
    );
  }

  const agent = await store.getAgent(agentId);
  console.log("budget:", {
    spentSol: agent?.spentSol,
    realizedSol: agent?.realizedSol,
    budgetSol: agent?.budgetSol,
    status: agent?.status,
  });

  console.log("wallet after:", await walletBalanceSol());
  console.log("AGENT_E2E_OK");
}

main().catch((e) => {
  console.error("AGENT_E2E_FAILED", e?.code ?? "", e?.message ?? e);
  process.exit(1);
});
