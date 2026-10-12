import { NextResponse, connection } from "next/server";
import { z } from "zod";
import {
  AGENT_COMMANDS,
  agentAvailable,
  agentModel,
  agentTurn,
  runAgentForge,
} from "@/lib/agent";

// One turn of the floating launch agent.
//
// POST /api/agent — the user's message goes in, exactly one action comes out.
//
// This route deliberately CANNOT sign anything. When the agent decides the user
// wants a launch it returns `{ action: "launch" }` and stops; the browser then
// calls POST /api/launch with `confirm: false` to get the transaction summary
// and, only after an explicit click, resends with `confirm: true`. That keeps a
// single gate in front of the signing key (Solana skill guardrail W009) instead
// of two code paths that both know how to spend.
//
// GET /api/agent — advertises the available commands and which brain is live,
// so the chat panel shows real syntax rather than invented help text.
//
// This project enables Cache Components, which forbids the `dynamic` segment
// export; `connection()` opts the handler out of prerendering instead.

const Body = z.object({
  message: z.string().min(1).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(20)
    .optional()
    .default([]),
  /** When true, the turn is committed to generation instead of just proposed. */
  runForge: z.boolean().optional().default(false),
});

export async function GET() {
  await connection();

  return NextResponse.json({
    available: agentAvailable(),
    model: agentAvailable() ? agentModel() : null,
    commands: AGENT_COMMANDS,
  });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { message, history } = parsed.data;

  // `agentTurn` is written never to throw, but a route that can only ever
  // return JSON is worth the belt-and-braces guard: an unexpected throw here
  // would surface in the chat as a dead panel.
  let action;
  try {
    action = await agentTurn(message, history);
  } catch (err) {
    return NextResponse.json({
      action: { type: "chat", reply: "The agent failed on that one. Try again." },
      error: err instanceof Error ? err.message : "unknown_error",
    });
  }

  // Generation is a separate, explicitly requested step: proposing a coin and
  // spending a River/Pollinations call on it are different decisions.
  if (parsed.data.runForge && (action.type === "forge" || action.type === "launch")) {
    try {
      const made = await runAgentForge(action.input, action.source, action.style);
      return NextResponse.json({
        action: { type: "chat", reply: made.reply },
        coin: made.coin,
      });
    } catch (err) {
      return NextResponse.json({
        action: {
          type: "chat",
          reply:
            "That generation failed: " +
            (err instanceof Error ? err.message : "unknown error") +
            ". Nothing was launched.",
        },
      });
    }
  }

  return NextResponse.json({ action });
}
