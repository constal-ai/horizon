import type { Ctx, Fact, Handle } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import type { HzPlan, HzStepResult } from "../src/contracts.js";
import { attemptProgressDigest, runHorizon } from "../src/workflow.js";

const plan: HzPlan = {
  object: "constal.horizon.plan", version: 1, revision: 1, status: "ready", objective: "Implement durable behavior",
  summary: "Implement and verify one durable behavior.", specification: "Use the existing seam and prove durable execution.",
  workspaceRoot: "/workspace/repositories/source", unknowns: [], risks: [], question: null, blockedReason: null,
  steps: [{ id: "implement", title: "Implement", responsibility: "Implement the durable behavior.",
    specification: "Inspect, edit, and verify the existing implementation.", dependsOn: [], verification: ["focused test passes"],
    stopWhen: "The focused test passes." }],
};

const stepResult: HzStepResult = {
  object: "constal.horizon.step-result", version: 1, stepId: "implement", status: "complete", summary: "Implemented and tested.",
  changedFiles: ["src/index.ts"], verification: ["focused test passed"], observations: ["existing seam reused"],
  unknowns: [], blockedReason: null,
};

const discoveryPlan = {
  object: "constal.horizon.discovery-plan" as const, version: 1 as const, status: "ready" as const,
  summary: "The repository is ready for focused investigation.", workspaceRoot: plan.workspaceRoot,
  focuses: [{ id: "implementation", title: "Implementation seam", mission: "Find the existing implementation seam.",
    questions: ["Which abstraction owns the behavior?"], evidenceNeeded: ["Source and focused tests"],
    stopWhen: "The owner and proof surface are known." }], unknowns: [], blockedReason: null,
};

const investigation = {
  object: "constal.horizon.investigation" as const, version: 1 as const, focusId: "implementation",
  status: "complete" as const, summary: "The existing seam is identified.", findings: ["The runtime owns the behavior."],
  evidence: ["src/index.ts"], unknowns: [], planImplications: ["Reuse the runtime seam."], blockedReason: null,
};

const verification = {
  object: "constal.horizon.verification" as const, version: 1 as const, stepId: "implement",
  verdict: "passed" as const, summary: "Independent proof passed.",
  checks: [{ target: "focused behavior", outcome: "passed" as const, evidence: "focused test passed" }],
  unknowns: [], failureBrief: null, blockedReason: null,
};

function handle<T>(value: T): Handle<T> {
  const promise = Promise.resolve(value) as Promise<T> & Partial<Handle<T>>;
  Object.assign(promise, { id: "handle", resolved: true, seq: 1, outcome: null, result: value, error: undefined,
    cancel: async () => undefined });
  return promise as Handle<T>;
}

describe("Horizon workflow", () => {
  it("fingerprints observed progress independently of self-report wording", async () => {
    const first = await attemptProgressDigest({ execution: stepResult, executionTools: [], verification,
      verificationTools: [] });
    const second = await attemptProgressDigest({ execution: { ...stepResult, summary: "Different wording." },
      executionTools: [], verification: { ...verification, summary: "Another wording." }, verificationTools: [] });
    const failed = await attemptProgressDigest({ execution: stepResult, executionTools: [],
      verification: { ...verification, verdict: "failed" }, verificationTools: [] });
    expect(second).toBe(first);
    expect(failed).not.toBe(first);
  });

  it("commits an immutable plan, delegates one work unit, reconciles, and packages the result", async () => {
    const committed: unknown[] = []; let sequence = 0;
    const ctx = {
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.1.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: unknown) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, toolEvidence: [] });
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 1, action: "complete", summary: "All work is proven.",
          remainingUnknowns: [], replanBrief: null, question: null, blockedReason: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon({ objective: plan.objective }, ctx);
    expect(result.status).toBe("complete");
    expect(result.artifact?.ref).toBe("artifact-ref");
    expect(result.longHorizon).toMatchObject({ durablePlan: true, specialistRuns: 6, replans: 0 });
    expect((committed as Array<{ kind?: string }>).map(({ kind }) => kind)).toEqual([
      "horizon.request", "horizon.discovery-plan", "horizon.investigation", "horizon.plan", "horizon.step-result",
      "horizon.verification", "horizon.progress", "horizon.reconciliation", "horizon.result",
    ]);
  });

  it("preserves failed evidence and creates a new immutable plan revision before retrying", async () => {
    const committed: Array<{ kind?: string; plan?: HzPlan }> = []; let sequence = 0;
    let plannerRuns = 0; let executorRuns = 0; let reconcilerRuns = 0;
    const revisedPlan: HzPlan = { ...plan, revision: 2,
      specification: "Preserve the first attempt as evidence and execute the corrected repository-native approach." };
    const failed: HzStepResult = { ...stepResult, status: "failed", summary: "The planned seam was stale.",
      changedFiles: [], verification: ["focused test exposed the stale seam"], unknowns: [{ id: "stale-seam",
        question: "Which live boundary replaces the planned seam?", state: "open", resolution: null, evidence: ["test failure"] }] };
    const failedVerification = { ...verification, verdict: "failed" as const, summary: "The focused proof failed.",
      checks: [{ target: "focused behavior", outcome: "failed" as const, evidence: "focused test failed" }],
      failureBrief: "Use the observed live seam and make the focused test pass." };
    const ctx = {
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.1.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; plan?: HzPlan }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++;
          return handle({ plan: plannerRuns === 1 ? plan : revisedPlan, toolEvidence: [] });
        }
        if (task.id === "horizon-executor") {
          executorRuns++;
          return handle({ result: executorRuns === 1 ? failed : stepResult, toolEvidence: [] });
        }
        if (task.id === "horizon-verifier") {
          return handle({ verification: executorRuns === 1 ? failedVerification : verification, toolEvidence: [] });
        }
        if (task.id === "horizon-reconciler") {
          reconcilerRuns++;
          return handle({ reconciliation: reconcilerRuns === 1 ? {
            object: "constal.horizon.reconciliation", version: 1, action: "replan",
            summary: "The live seam invalidates the remaining implementation approach.", remainingUnknowns: failed.unknowns,
            replanBrief: "Preserve the failed attempt as evidence and rewrite the work unit around the observed live boundary.",
            question: null, blockedReason: null,
          } : {
            object: "constal.horizon.reconciliation", version: 1, action: "complete", summary: "The revised work is proven.",
            remainingUnknowns: [], replanBrief: null, question: null, blockedReason: null,
          }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("complete");
    expect(result.plan.revision).toBe(2);
    expect(result.longHorizon).toMatchObject({ durablePlan: true, specialistRuns: 10, replans: 1 });
    expect(committed.filter(({ kind }) => kind === "horizon.plan").map(({ plan: committedPlan }) => committedPlan?.revision)).toEqual([1, 2]);
    expect(committed.filter(({ kind }) => kind === "horizon.step-result")).toHaveLength(2);
  });

  it("durably waits for a material user decision and synthesizes a new plan revision", async () => {
    const committed: Array<{ kind?: string; plan?: HzPlan }> = []; let sequence = 0; let plannerRuns = 0;
    const plannerInputs: Array<{ answer?: string | null }> = [];
    const needsInput: HzPlan = { ...plan, status: "needs-input", revision: 1, steps: [],
      question: "Should the public contract preserve v1 behavior or adopt v2?",
      unknowns: [{ id: "contract-version", question: "Which public contract is intended?", state: "needs-input",
        resolution: null, evidence: ["Both versions exist in source."] }] };
    const revised: HzPlan = { ...plan, revision: 2, specification: "Adopt v2 as explicitly selected by the user." };
    const ctx = {
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.1.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; plan?: HzPlan }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      await: () => handle({ answer: "Adopt v2." }),
      spawn: (task: { id: string }, input: { answer?: string | null }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerInputs.push(input); plannerRuns++;
          return handle({ plan: plannerRuns === 1 ? needsInput : revised, toolEvidence: [] });
        }
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 1, action: "complete", summary: "The v2 work is proven.",
          remainingUnknowns: [], replanBrief: null, question: null, blockedReason: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("complete");
    expect(result.plan.revision).toBe(2);
    expect(result.longHorizon).toMatchObject({ specialistRuns: 7, replans: 1 });
    expect(plannerInputs.map(({ answer }) => answer ?? null)).toEqual([null, "Adopt v2."]);
    expect(committed.map(({ kind }) => kind)).toContain("horizon.answer");
  });

  it("stops repeated replan cycles when execution and verification add no evidence", async () => {
    const committed: Array<{ kind?: string }> = []; let sequence = 0; let plannerRuns = 0;
    const failedExecution: HzStepResult = { ...stepResult, status: "failed", summary: "Attempt failed.", changedFiles: [],
      verification: ["same failure"], observations: ["same evidence"], unknowns: [{ id: "blocked-path",
        question: "How can this path be repaired?", state: "open", resolution: null, evidence: ["same failure"] }] };
    const failedProof = { ...verification, verdict: "failed" as const, summary: "Same proof failed.",
      checks: [{ target: "focused behavior", outcome: "failed" as const, evidence: "same failure" }],
      failureBrief: "The same observable failure remains." };
    const ctx = {
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.1.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++;
          return handle({ plan: { ...plan, revision: plannerRuns }, toolEvidence: [] });
        }
        if (task.id === "horizon-executor") return handle({ result: failedExecution, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification: failedProof, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 1, action: "replan",
          summary: "Try the work unit again.", remainingUnknowns: failedExecution.unknowns,
          replanBrief: "Retry the unresolved work unit.", question: null, blockedReason: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("no new evidence");
    expect(result.plan.revision).toBe(3);
    expect(result.longHorizon).toMatchObject({ specialistRuns: 14, replans: 2, plateauCycles: 2 });
    expect(committed.map(({ kind }) => kind)).toContain("horizon.plateau");
  });
});
