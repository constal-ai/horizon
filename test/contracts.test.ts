import { describe, expect, it } from "vitest";
import { parseHzDiscoveryPlan, parseHzInvestigationResult, parseHzPlan, parseHzReconciliation, parseHzRequest,
  parseHzStepResult } from "../src/contracts.js";

const unknown = { id: "architecture-seam", question: "Which existing abstraction owns publication?", state: "resolved",
  resolution: "The deployment boundary owns it.", evidence: ["src/deploy.ts"] };

const plan = {
  object: "constal.horizon.plan", version: 1, revision: 1, status: "ready",
  objective: "Add a durable feature", summary: "Investigate, implement, and prove the feature.",
  specification: "Preserve the existing deployment boundary. Implement the feature as one coherent behavior and prove replay.",
  workspaceRoot: "/workspace/repositories/source", unknowns: [unknown], risks: ["Replay drift"], question: null,
  blockedReason: null,
  steps: [
    { id: "implement", title: "Implement behavior", responsibility: "Own the semantic behavior.",
      specification: "Inspect the current seam, make the smallest coherent change, and retain existing authority boundaries.",
      dependsOn: [], verification: ["Run the focused replay test."], stopWhen: "The behavior and replay test pass." },
    { id: "verify", title: "Reconcile proof", responsibility: "Verify the completed behavior independently.",
      specification: "Review the diff and execute the relevant suite.", dependsOn: ["implement"],
      verification: ["The suite passes and the diff stays within scope."], stopWhen: "Proof is conclusive or honestly blocked." },
  ],
};

describe("Horizon transport contracts", () => {
  it("keeps semantic intent in natural-language specifications", () => {
    expect(parseHzPlan(plan)).toEqual(plan);
    expect(parseHzRequest("Build and verify the agent")).toEqual({ objective: "Build and verify the agent", context: null, constraints: [] });
  });

  it("rejects structural dependency cycles without scoring plan prose", () => {
    const cyclic = structuredClone(plan);
    cyclic.steps[0]!.dependsOn = ["verify"];
    expect(parseHzPlan(cyclic)).toBeNull();
  });

  it("validates step and reconciliation envelopes", () => {
    expect(parseHzStepResult({ object: "constal.horizon.step-result", version: 1, stepId: "implement", status: "complete",
      summary: "Implemented and tested.", changedFiles: ["src/index.ts"], verification: ["tests passed"],
      observations: ["Existing boundary reused"], unknowns: [], blockedReason: null }, "implement")?.status).toBe("complete");
    expect(parseHzReconciliation({ object: "constal.horizon.reconciliation", version: 1, action: "replan",
      summary: "The live API differs from planning evidence.", remainingUnknowns: [unknown],
      replanBrief: "Preserve completed work and replace the remaining API assumption with the observed contract.",
      question: null, blockedReason: null })?.action).toBe("replan");
  });

  it("validates decomposed discovery and focused investigation envelopes", () => {
    const discovery = { object: "constal.horizon.discovery-plan", version: 1, status: "ready",
      summary: "The source is materialized and two decisions need focused evidence.", workspaceRoot: "/workspace/repositories/source",
      focuses: [{ id: "runtime", title: "Runtime ownership", mission: "Trace the runtime boundary.",
        questions: ["Which component owns recovery?"], evidenceNeeded: ["Runtime source and tests"],
        stopWhen: "Ownership and recovery invariants are proven." }], unknowns: [unknown], blockedReason: null };
    expect(parseHzDiscoveryPlan(discovery)).toEqual(discovery);
    expect(parseHzInvestigationResult({ object: "constal.horizon.investigation", version: 1, focusId: "runtime",
      status: "complete", summary: "The coordinator owns recovery.", findings: ["Recovery is ledger-driven."],
      evidence: ["src/runtime.ts"], unknowns: [unknown], planImplications: ["Keep recovery in the coordinator."],
      blockedReason: null }, "runtime")?.status).toBe("complete");
  });
});
