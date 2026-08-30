import type { Fact, Hash } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import { horizonProgress } from "../src/views/progress.js";

function fact(index: number, artifact: unknown): Fact {
  return { hash: `fact-${index}` as Hash, artifact, artifactHash: `artifact-${index}` as Hash, at: index } as Fact;
}

describe("Horizon durable progress view", () => {
  it("folds planning, verification, invalidation, replan, plateau, and completion", () => {
    let state = horizonProgress.init();
    state = horizonProgress.apply(state, fact(1, { kind: "horizon.request" }));
    expect(state.status).toBe("discovering");
    state = horizonProgress.apply(state, fact(2, { kind: "horizon.planning-phase", phase: "design" }));
    expect(state).toMatchObject({ status: "planning", planningPhase: "design" });
    state = horizonProgress.apply(state, fact(3, { kind: "horizon.plan", previousRevision: null,
      plan: { revision: 1, status: "ready" } }));
    expect(state).toMatchObject({ status: "executing", planRevision: 1, replans: 0 });
    state = horizonProgress.apply(state, fact(4, { kind: "horizon.verification",
      verification: { stepId: "implement", verdict: "passed" } }));
    expect(state.verifiedSteps).toEqual(["implement"]);
    state = horizonProgress.apply(state, fact(5, { kind: "horizon.plan-invalidation", steps: ["implement"] }));
    expect(state).toMatchObject({ status: "planning", verifiedSteps: [] });
    state = horizonProgress.apply(state, fact(6, { kind: "horizon.plan", previousRevision: 1,
      plan: { revision: 2, status: "ready" } }));
    expect(state).toMatchObject({ planRevision: 2, replans: 1 });
    state = horizonProgress.apply(state, fact(7, { kind: "horizon.progress", step: "implement",
      plateau: { stableCycles: 2 } }));
    expect(state).toMatchObject({ currentStep: "implement", plateauCycles: 2 });
    state = horizonProgress.apply(state, fact(8, { kind: "horizon.plateau" }));
    expect(state.status).toBe("blocked");
    state = horizonProgress.apply(state, fact(9, { kind: "horizon.result",
      result: { status: "complete", artifact: { ref: "artifact-ref" } } }));
    expect(state).toMatchObject({ status: "complete", artifactRef: "artifact-ref", currentStep: null });
  });
});
