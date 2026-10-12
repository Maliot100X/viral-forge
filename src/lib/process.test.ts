import { beforeEach, describe, expect, it } from "vitest";
import { PHASE_MESSAGE, STEP_PLAN, useForgeProcess } from "./process";

const s = () => useForgeProcess.getState();

describe("forge process machine", () => {
  beforeEach(() => {
    useForgeProcess.setState({
      phase: "idle",
      source: "prompt",
      style: "auto",
      subject: "",
      stepIndex: -1,
      steps: STEP_PLAN.map((x) => ({ ...x, status: "pending" as const })),
      message: PHASE_MESSAGE.idle,
      runId: 0,
      launchedSymbol: null,
      error: null,
    });
  });

  it("starts idle with every step pending", () => {
    expect(s().phase).toBe("idle");
    expect(s().steps.every((x) => x.status === "pending")).toBe(true);
  });

  it("begin() enters reading and records the source and subject", () => {
    s().begin("hashtag", "anime", "#Monsterdon");
    expect(s().phase).toBe("reading");
    expect(s().source).toBe("hashtag");
    expect(s().style).toBe("anime");
    expect(s().subject).toBe("#Monsterdon");
    expect(s().steps[0]).toMatchObject({ id: "reading", status: "active" });
    expect(s().steps[1].status).toBe("pending");
  });

  it("advance() completes prior steps and activates the target", () => {
    s().begin("prompt", "auto", "a frog that trades at 3am");
    s().advance("naming");
    s().advance("lore");

    const byId = Object.fromEntries(s().steps.map((x) => [x.id, x.status]));
    expect(byId.reading).toBe("done");
    expect(byId.naming).toBe("done");
    expect(byId.lore).toBe("active");
    expect(byId.logo).toBe("pending");
    expect(byId.ready).toBe("pending");
  });

  it("tracks stepIndex alongside the active phase", () => {
    s().begin("prompt", "auto", "x");
    s().advance("logo");
    expect(s().stepIndex).toBe(STEP_PLAN.findIndex((x) => x.id === "logo"));
  });

  it("succeed() marks every step done and lands on ready", () => {
    s().begin("prompt", "auto", "x");
    s().advance("naming");
    s().succeed();
    expect(s().phase).toBe("ready");
    expect(s().steps.every((x) => x.status === "done")).toBe(true);
  });

  it("fail() marks the active step failed and keeps the error", () => {
    s().begin("prompt", "auto", "x");
    s().advance("lore");
    s().fail("generate failed (500)");
    expect(s().phase).toBe("error");
    expect(s().error).toBe("generate failed (500)");
    expect(s().message).toBe("generate failed (500)");
    expect(s().steps.find((x) => x.id === "lore")?.status).toBe("failed");
    expect(s().steps.find((x) => x.id === "reading")?.status).toBe("done");
  });

  it("markLaunched() records the symbol", () => {
    s().begin("prompt", "auto", "x");
    s().succeed();
    s().markLaunched("BUCKET");
    expect(s().phase).toBe("launched");
    expect(s().launchedSymbol).toBe("BUCKET");
  });

  it("increments runId per run so narration can replay", () => {
    expect(s().runId).toBe(0);
    s().begin("prompt", "auto", "a");
    s().begin("prompt", "auto", "b");
    expect(s().runId).toBe(2);
  });

  it("begin() clears a prior error and launch result", () => {
    s().begin("prompt", "auto", "x");
    s().fail("boom");
    s().markLaunched("OLD");
    s().begin("prompt", "auto", "y");
    expect(s().error).toBeNull();
    expect(s().launchedSymbol).toBeNull();
  });

  it("reset() returns to idle with clean steps", () => {
    s().begin("prompt", "auto", "x");
    s().advance("lore");
    s().reset();
    expect(s().phase).toBe("idle");
    expect(s().subject).toBe("");
    expect(s().stepIndex).toBe(-1);
    expect(s().steps.every((x) => x.status === "pending")).toBe(true);
  });

  it("every phase has narration copy", () => {
    for (const p of [
      "idle",
      "reading",
      "naming",
      "lore",
      "logo",
      "ready",
      "launching",
      "launched",
      "error",
    ] as const) {
      expect(PHASE_MESSAGE[p]).toBeTruthy();
    }
  });
});
