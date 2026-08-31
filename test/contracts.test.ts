import { describe, expect, it } from "vitest";
import { parseHzDesign, parseHzDiscoveryPlan, parseHzInvestigationResult, parseHzMilestoneWork, parseHzPlan, parseHzPlanCritique, parseHzPlanNarrative,
  parseHzReconciliation, parseHzRequest, parseHzRubric, parseHzStepAssertions, parseHzStepResult,
  parseHzSourceResolution, parseHzVerification, parseHzWorkPlan } from "../src/contracts.js";

const unknown = { id: "architecture-seam", question: "Which existing abstraction owns publication?", state: "resolved",
  resolution: "The deployment boundary owns it.", evidence: ["src/deploy.ts"] };

const plan = {
  object: "constal.horizon.plan", version: 1, revision: 1, status: "ready",
  objective: "Add a durable feature", summary: "Investigate, implement, and prove the feature.",
  specification: "Preserve the existing deployment boundary. Implement the feature as one coherent behavior and prove replay.",
  workspaceRoot: "/workspace/repositories/source", unknowns: [unknown], risks: ["Replay drift"], question: null,
  blockedReason: null,
  steps: [
    { id: "implement", milestoneId: "behavior", title: "Implement behavior", responsibility: "Own the semantic behavior.",
      specification: "Inspect the current seam, make the smallest coherent change, and retain existing authority boundaries.",
      dependsOn: [], verification: ["Run the focused replay test."], stopWhen: "The behavior and replay test pass." },
    { id: "verify", milestoneId: "behavior", title: "Reconcile proof", responsibility: "Verify the completed behavior independently.",
      specification: "Review the diff and execute the relevant suite.", dependsOn: ["implement"],
      verification: ["The suite passes and the diff stays within scope."], stopWhen: "Proof is conclusive or honestly blocked." },
  ],
  assertions: [
    { object: "constal.horizon.step-assertions", version: 1, revision: 1, stepId: "implement",
      assertions: [{ id: "implement-positive", claim: "The durable behavior is observable.",
        evidenceRequired: ["Focused replay test passes."], negativePath: false }] },
    { object: "constal.horizon.step-assertions", version: 1, revision: 1, stepId: "verify",
      assertions: [{ id: "verify-proof", claim: "Independent proof covers the changed behavior.",
        evidenceRequired: ["The relevant suite and diff review pass."], negativePath: false }] },
  ],
};

describe("Horizon transport contracts", () => {
  it("keeps semantic intent in natural-language specifications", () => {
    expect(parseHzPlan(plan)).toEqual(plan);
    const { steps: _steps, assertions: _assertions, ...narrative } = plan;
    expect(parseHzPlanNarrative({ ...narrative, object: "constal.horizon.plan-narrative" }, 1, plan.objective))
      .toEqual({ ...narrative, object: "constal.horizon.plan-narrative" });
    expect(parseHzRequest("Build and verify the agent")).toEqual({ objective: "Build and verify the agent", context: null,
      constraints: [], source: null, environment: { name: "default", cache: true, setup: [] } });
    expect(parseHzRequest({ objective: "Build it", source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
      environment: { name: "node", setup: [{ cmd: "npm", args: ["ci"], cwd: "/workspace/repo", timeoutMs: 600_000 }] } }))
      .toMatchObject({ source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
        environment: { name: "node", cache: true } });
    expect(parseHzSourceResolution({ object: "constal.horizon.source-resolution", version: 1, status: "ready",
      source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
      evidence: ["authenticated repository metadata"], question: null, blockedReason: null })?.status).toBe("ready");
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

  it("validates independent verification without interpreting its prose mechanically", () => {
    expect(parseHzVerification({ object: "constal.horizon.verification", version: 1, stepId: "implement",
      verdict: "passed", summary: "The specified behavior and replay proof passed.",
      checks: [{ target: "Replay after interruption", outcome: "passed", evidence: "focused replay test passed" }],
      unknowns: [], failureBrief: null, blockedReason: null }, "implement")?.verdict).toBe("passed");
    expect(parseHzVerification({ object: "constal.horizon.verification", version: 1, stepId: "implement",
      verdict: "failed", summary: "Replay still duplicates the effect.",
      checks: [{ target: "Replay after interruption", outcome: "failed", evidence: "duplicate receipt observed" }],
      unknowns: [], failureBrief: null, blockedReason: null }, "implement")).toBeNull();
  });

  it("validates every immutable planning phase as a structural handoff", () => {
    expect(parseHzRubric({ object: "constal.horizon.rubric", version: 1, revision: 1,
      objective: plan.objective, successCriteria: ["Replay proof passes."], constraints: ["Reuse the runtime."],
      nonGoals: ["No new scheduler."], openQuestions: [], verificationPrinciples: ["Observe replay behavior."] }, 1)).not.toBeNull();
    expect(parseHzDesign({ object: "constal.horizon.design", version: 1, revision: 1, summary: "Reuse runtime ownership.",
      decisions: [{ id: "runtime-owner", question: "Who owns recovery?", decision: "The runtime.",
        rationale: "It already owns the ledger.", evidence: ["src/runtime.ts"] }],
      milestones: [{ id: "behavior", title: "Durable behavior", outcome: "Replay succeeds.", dependsOn: [],
        responsibilities: ["Implement recovery."], risks: ["Duplicate effect."] }] }, 1)).not.toBeNull();
    expect(parseHzWorkPlan({ object: "constal.horizon.work-plan", version: 1, revision: 1, steps: plan.steps }, 1)).not.toBeNull();
    expect(parseHzMilestoneWork({ object: "constal.horizon.milestone-work", version: 1, revision: 1,
      milestoneId: "behavior", steps: plan.steps }, 1, "behavior")).not.toBeNull();
    expect(parseHzStepAssertions(plan.assertions[0], 1, "implement")).not.toBeNull();
    expect(parseHzPlanCritique({ object: "constal.horizon.plan-critique", version: 1, revision: 1,
      verdict: "accepted", summary: "The artifacts converge.", findings: [], question: null, blockedReason: null }, 1)).not.toBeNull();
  });
});
