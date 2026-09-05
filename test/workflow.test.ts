// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Ctx, Fact, Handle, SteerEvent } from "@constal/sdk";
import { describe, expect, it, vi } from "vitest";
import type { HzPlan, HzPlanContinuity, HzPlanningState, HzStepResult } from "../src/contracts.js";
import { applyPlanContinuity, attemptProgressDigest, runHorizon } from "../src/workflow.js";

const lifecycleState = vi.hoisted(() => ({ restores: 0 }));

vi.mock("../src/workspace/lifecycle.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/workspace/lifecycle.js")>();
  return { ...original,
    prepareWorkspace: async () => ({ receiptRef: "workspace-receipt", receipt: {
      object: "constal.horizon.workspace-ready" as const, version: 1 as const, session: "session", sandbox: "sandbox-id",
      root: "/workspace/repo" as const, cache: { key: "c".repeat(64), hit: true, image: "image-id" },
      runner: { protocol: "constal.workspace-runner" as const, version: 2 as const, digest: "d".repeat(64) },
      source: { kind: "artifact" as const, archive: { ref: "source-ref", bytes: 1, format: "tar.gz" as const }, github: null },
      baseline: { commit: "commit", tree: "tree" }, setup: { name: "default", cache: true, setup: [] },
    } }),
    captureWorkspaceCheckpoint: async (input: { stepId: string }) => ({ receiptRef: `checkpoint-${input.stepId}`,
      checkpoint: { image: `image-${input.stepId}`, cacheKey: input.stepId.padEnd(64, "0"),
        tree: `tree-${input.stepId}`, status: ` M ${input.stepId}` } }),
    inspectWorkspaceState: async () => ({ tree: "workspace-tree", status: " M src/index.ts" }),
    restoreWorkspaceAnchor: async (anchor: { tree: string; status: string }) => {
      lifecycleState.restores++; return { tree: anchor.tree, status: anchor.status };
    },
    archiveWorkspace: async (selected: { exec(input: { cmd: string }): unknown }) => selected.exec({ cmd: "tar" }),
  };
});

const plan: HzPlan = {
  object: "constal.horizon.plan", version: 1, revision: 1, status: "ready", objective: "Implement durable behavior",
  summary: "Implement and verify one durable behavior.", specification: "Use the existing seam and prove durable execution.",
  workspaceRoot: "/workspace/repo", unknowns: [], risks: [], question: null,
  steps: [{ id: "implement", milestoneId: "behavior", title: "Implement", responsibility: "Implement the durable behavior.",
    specification: "Inspect, edit, and verify the existing implementation.", dependsOn: [], verification: ["focused test passes"],
    stopWhen: "The focused test passes." }],
  assertions: [{ object: "constal.horizon.step-assertions", version: 1, revision: 1, stepId: "implement",
    assertions: [{ claim: "The focused behavior works.",
      evidenceRequired: ["The focused test passes."], negativePath: false }] }],
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
    stopWhen: "The owner and proof surface are known." }], unknowns: [],
};

const investigation = {
  object: "constal.horizon.investigation" as const, version: 1 as const, focusId: "implementation",
  status: "complete" as const, summary: "The existing seam is identified.", findings: ["The runtime owns the behavior."],
  evidence: ["src/index.ts"], unknowns: [], planImplications: ["Reuse the runtime seam."],
};

const verification = {
  object: "constal.horizon.verification" as const, version: 1 as const, stepId: "implement",
  verdict: "passed" as const, summary: "Independent proof passed.",
  checks: [{ target: "focused behavior", outcome: "passed" as const, evidence: "focused test passed" }],
  unknowns: [], failureBrief: null, blockedReason: null,
};

function continuity(revision: number, decisions: HzPlanContinuity["decisions"] = []): HzPlanContinuity {
  return { object: "constal.horizon.plan-continuity", version: 1, revision, decisions };
}

function planningState(value: HzPlan, decisions: HzPlanContinuity["decisions"] = []): HzPlanningState {
  return { object: "constal.horizon.planning-state", version: 1, revision: value.revision,
    investigations: [investigation], investigationObservationSignatures: [],
    rubric: { object: "constal.horizon.rubric", version: 1, revision: value.revision, objective: value.objective,
      successCriteria: ["The requested behavior is proven."], constraints: [], nonGoals: [], openQuestions: value.unknowns,
      verificationPrinciples: ["Use independent proof."] },
    design: { object: "constal.horizon.design", version: 1, revision: value.revision, summary: value.summary,
      decisions: [], milestones: [{ id: "behavior", title: "Behavior", outcome: "The behavior works.",
        dependsOn: [], responsibilities: ["Implement the behavior."], risks: [] }] },
    workPlan: { object: "constal.horizon.work-plan", version: 1, revision: value.revision, steps: value.steps },
    assertions: value.assertions, continuity: continuity(value.revision, decisions),
    critique: { object: "constal.horizon.plan-critique", version: 1, revision: value.revision,
      verdict: value.status === "ready" ? "accepted" : "needs-input",
      summary: value.summary, findings: [], question: value.question },
  };
}

const workspaceState = { tree: "workspace-tree", status: " M src/index.ts" };

function handle<T>(value: T): Handle<T> {
  const promise = Promise.resolve(value) as Promise<T> & Partial<Handle<T>>;
  Object.assign(promise, { id: "handle", resolved: true, seq: 1, outcome: null, result: value, error: undefined,
    cancel: async () => undefined });
  return promise as Handle<T>;
}

function casRuntime(onStore?: (value: unknown) => void) {
  const values = new Map<string, string>(); let sequence = 0;
  return async (_resource: unknown, operation: string, args: { text?: string; ref?: string }) => {
    if (operation === "putText" && typeof args.text === "string") {
      onStore?.(JSON.parse(args.text) as unknown);
      const ref = `cas-${++sequence}`; values.set(ref, args.text);
      return { ref, bytes: new TextEncoder().encode(args.text).byteLength };
    }
    if (operation === "getText" && typeof args.ref === "string" && values.has(args.ref)) {
      const text = values.get(args.ref)!; return { ref: args.ref, text, bytes: new TextEncoder().encode(text).byteLength };
    }
    throw new Error(`unexpected CAS operation ${operation}`);
  };
}

describe("Horizon workflow", () => {
  it.each(["discovery", "planning", "approval"])("consumes guidance arriving during %s before execution", async (arrival) => {
    const guidance: SteerEvent[] = [];
    const event: SteerEvent = { kind: "steer", seq: 1, hash: "steer-hash", prev: null, at: 1,
      tenant: "tenant", ledger: "main", branch: "main", eventId: "comment-2", run: "run", ref: null,
      actor: { kind: "operator", id: "reviewer" }, payload: { text: "Use a general rule, not an allowlist.\nKeep punctuation unchanged." } };
    let fact = 0; let planning = 0; let approvals = 0; let executed = 0; let approvedFact = "";
    const stored: Array<Record<string, unknown>> = [];
    const ctx = {
      run: { id: "run", session: "session", namespace: "default", tenant: "tenant",
        agent: { id: "horizon", version: "0.6.42", crn: "crn:constal:production:tenant:default:agent/horizon" } },
      resources: { model: "model", cas: "cas", sandbox: "sandbox" },
      ledger: { view: async () => guidance.slice() },
      commit: async (artifact: { kind?: string; planFact?: string }) => {
        if (artifact.kind === "horizon.approval-request") approvedFact = artifact.planFact!;
        return { hash: `fact-${++fact}`, artifact };
      },
      invoke: casRuntime((value) => stored.push(value as Record<string, unknown>)),
      await: () => {
        approvals++;
        if (arrival === "approval" && approvals === 1) guidance.push(event);
        return handle({ object: "constal.horizon.plan-decision", version: 1, planFact: approvedFact,
          decision: "approve", guidance: null });
      },
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") {
          if (arrival === "discovery") guidance.push(event);
          return handle({ investigation, toolEvidence: [] });
        }
        if (task.id === "horizon-planner") {
          planning++;
          if (arrival === "planning" && planning === 1) guidance.push(event);
          const selected = { ...plan, revision: planning };
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-executor") {
          executed++;
          const input = stored.at(-1)!;
          expect(input.request).toMatchObject({ context: { event: { issue: 2 }, steering: [event] } });
          expect(input.request).toMatchObject({ context: { review: {
            planFact: input.planFact, decision: { decision: "approve" }, fact: expect.any(String),
          } } });
          expect(planning).toBe(arrival === "discovery" ? 1 : 2);
          expect(approvals).toBe(arrival === "approval" ? 2 : 1);
          return handle({ result: stepResult, toolEvidence: [] });
        }
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "Verified.",
          remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current", replanBrief: null, question: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;
    const result = await runHorizon({ objective: plan.objective, context: { event: { issue: 2 } } }, ctx,
      { requirePlanApproval: true });
    expect(result.status, result.summary).toBe("complete");
    expect(result.summary).toBe("I've completed the approved changes.");
    expect(result.summary).not.toContain(plan.summary);
    expect(result.summary).not.toContain("Durable result");
    expect(executed).toBe(1);
    const plans = stored.filter((value) => "restartAt" in value);
    expect(plans.at(-1)).toMatchObject({ request: { context: { steering: [event] } } });
    if (arrival !== "discovery") expect(plans[1]).toMatchObject({ restartAt: "rubric", completed: [] });
  });

  it("turns invalid input into a durable blocked result instead of an uncaught exception", async () => {
    const committed: Array<{ kind?: string; stage?: string }> = []; let sequence = 0;
    const ctx = { commit: async (artifact: { kind?: string; stage?: string }) => {
      committed.push(artifact); return { hash: `fact-${++sequence}`, artifact,
        artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
    } } as unknown as Ctx;

    await expect(runHorizon({ objective: "" }, ctx)).resolves.toMatchObject({
      status: "blocked", plan: null, summary: expect.stringContaining("request validation"),
    });
    expect(committed).toContainEqual(expect.objectContaining({ kind: "horizon.application-failure",
      stage: "request validation" }));
  });

  it("fingerprints observed progress independently of self-report wording", async () => {
    const first = await attemptProgressDigest({ execution: stepResult, executionTools: [], verification,
      verificationTools: [], workspaceBefore: workspaceState, workspaceAfter: workspaceState });
    const second = await attemptProgressDigest({ execution: { ...stepResult, summary: "Different wording." },
      executionTools: [], verification: { ...verification, summary: "Another wording." }, verificationTools: [],
      workspaceBefore: workspaceState, workspaceAfter: workspaceState });
    const failed = await attemptProgressDigest({ execution: stepResult, executionTools: [],
      verification: { ...verification, verdict: "failed" }, verificationTools: [],
      workspaceBefore: workspaceState, workspaceAfter: workspaceState });
    expect(second).toBe(first);
    expect(failed).not.toBe(first);
  });

  it("applies reviewed continuity rather than comparing plan prose", () => {
    const next: HzPlan = { ...plan, revision: 2,
      assertions: plan.assertions.map((entry) => ({ ...entry, revision: 2 })),
      steps: plan.steps.map((entry) => ({ ...entry, specification: "Equivalent responsibility with clearer wording." })) };
    expect(applyPlanContinuity(next, [stepResult], continuity(2, [{ priorStepId: "implement", nextStepId: "implement",
      disposition: "retain", reason: "The responsibility and proof remain valid.", evidence: ["verification-fact"] }])))
      .toEqual({ completed: [stepResult], reverify: [], invalidated: [] });
    expect(applyPlanContinuity({ ...next, steps: [], assertions: [] }, [stepResult], continuity(2, [{ priorStepId: "implement",
      nextStepId: null, disposition: "dropped", reason: "The responsibility no longer exists.", evidence: ["new plan"] }])))
      .toEqual({ completed: [], reverify: [], invalidated: ["implement"] });
  });

  it("does not retain a completed dependent while its new prerequisite must rerun", () => {
    const dependent = { ...plan.steps[0]!, id: "publish", title: "Publish", dependsOn: ["implement"] };
    const next = { ...plan, revision: 2, steps: [plan.steps[0]!, dependent] };
    const published = { ...stepResult, stepId: "publish", summary: "Published the verified result." };
    const decisions: HzPlanContinuity["decisions"] = [
      { priorStepId: "implement", nextStepId: "implement", disposition: "rerun",
        reason: "The implementation contract changed.", evidence: ["new design"] },
      { priorStepId: "publish", nextStepId: "publish", disposition: "retain",
        reason: "Publication itself is unchanged.", evidence: ["publication receipt"] },
    ];
    expect(applyPlanContinuity(next, [stepResult, published], continuity(2, decisions))).toEqual({
      completed: [], reverify: ["publish"], invalidated: ["implement", "publish"],
    });
  });

  it.each([{ name: "small", discussion: null }, { name: "large", discussion: "Full original discussion. ".repeat(5_000) }])(
    "uses artifact-backed handoffs from discovery through packaging with $name context", async ({ discussion }) => {
    const committed: unknown[] = []; let sequence = 0;
    const inputs: unknown[] = [];
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.2.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: unknown) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime((value) => inputs.push(value)),
      spawn: (task: { id: string }, input: { ref: string }) => {
        expect(Object.keys(input)).toEqual(["ref"]);
        expect(typeof input.ref).toBe("string");
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "All work is proven.",
          remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current",
          replanBrief: null, question: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon({ objective: plan.objective, context: { discussion } }, ctx);
    expect(result.status).toBe("complete");
    expect(result.artifact?.ref).toBe("artifact-ref");
    expect(result.longHorizon).toMatchObject({ durablePlan: true, specialistRuns: 12, replans: 0 });
    expect(inputs[0]).toMatchObject({ request: { context: { discussion } }, workspaceRoot: "/workspace/repo" });
    expect((committed as Array<{ kind?: string }>).map(({ kind }) => kind)).toEqual([
      "horizon.request", "horizon.discovery-plan", "horizon.investigation", "horizon.plan", "horizon.step-result",
      "horizon.verification", "horizon.execution-attempt", "horizon.milestone", "horizon.progress",
      "horizon.reconciliation", "horizon.result",
    ]);
  });

  it("records an exhausted execution failure and returns the current durable plan", async () => {
    const committed: Array<{ kind?: string; stage?: string }> = []; let sequence = 0;
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.5.19", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; stage?: string }) => {
        committed.push(artifact); return { hash: `fact-${++sequence}`, artifact,
          artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime(),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-executor") throw new Error("execution provider remained unavailable after recovery");
        throw new Error(`unexpected task ${task.id}`);
      },
    } as unknown as Ctx;

    await expect(runHorizon(plan.objective, ctx)).resolves.toMatchObject({
      status: "blocked", plan: { revision: 1 }, summary: expect.stringContaining("work-unit execution"),
    });
    expect(committed).toContainEqual(expect.objectContaining({ kind: "horizon.application-failure",
      stage: "work-unit execution" }));
  });

  it("never translates durable runtime control flow into an application failure", async () => {
    let sequence = 0; const control = Object.assign(new Error("commit"), { name: "CommitYield" });
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.5.19", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: unknown) => ({ hash: `fact-${++sequence}`, artifact,
        artifactHash: `artifact-${sequence}` }) as unknown as Fact<unknown>,
      invoke: casRuntime(),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-executor") throw control;
        throw new Error(`unexpected task ${task.id}`);
      },
    } as unknown as Ctx;

    await expect(runHorizon(plan.objective, ctx)).rejects.toBe(control);
  });

  it.each([false, true])("preserves the complete prior attempt during forward repair (new guidance: %s)", async (steered) => {
    const committed: Array<{ kind?: string }> = []; const executorInputs: Array<Record<string, unknown>> = [];
    const planningInputs: Array<Record<string, unknown>> = []; const guidance: SteerEvent[] = [];
    let sequence = 0; let executorRuns = 0; let reconcilerRuns = 0; let planningRuns = 0;
    const failed: HzStepResult = { ...stepResult, status: "failed", summary: "The focused check failed.",
      verification: ["test failed"], observations: ["The existing partial edit is useful."] };
    const failedProof = { ...verification, verdict: "failed" as const, summary: "The behavior is incomplete.",
      checks: [{ target: "focused behavior", outcome: "failed" as const, evidence: "test failed" }],
      failureBrief: "Continue the partial implementation." };
    const ctx = { ledger: { view: async () => guidance.slice() },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.5.19", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string }) => {
        committed.push(artifact); return { hash: `fact-${++sequence}`, artifact,
          artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime((stored) => {
        if (stored && typeof stored === "object" && "restartAt" in stored) planningInputs.push(stored as Record<string, unknown>);
        if (stored && typeof stored === "object" && !Array.isArray(stored) && "previousAttempt" in stored && "completed" in stored) {
          executorInputs.push(stored as Record<string, unknown>);
        }
      }),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          const selected = { ...plan, revision: ++planningRuns };
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-executor") {
          executorRuns++;
          return handle({ result: executorRuns === 1 ? failed : stepResult, toolEvidence: [] });
        }
        if (task.id === "horizon-verifier") return handle({ verification: executorRuns === 1 ? failedProof : verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") {
          reconcilerRuns++;
          if (steered && reconcilerRuns === 1) guidance.push({ kind: "steer", seq: 1, hash: "steering", prev: null, at: 1,
            tenant: "tenant", ledger: "main", branch: "main", eventId: "follow-up", run: "run", ref: null,
            actor: { kind: "operator", id: "reviewer" }, payload: { text: "Preserve the current implementation while correcting its checks." } });
          return handle({ reconciliation: reconcilerRuns === 1 ? {
            object: "constal.horizon.reconciliation", version: 2, action: "repair-step",
            summary: "Continue the useful partial implementation.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null,
          } : { object: "constal.horizon.reconciliation", version: 2, action: "complete",
            summary: "The repaired work is proven.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);

    expect(result.status).toBe("complete");
    expect(result.longHorizon.replans).toBe(steered ? 1 : 0);
    expect(executorInputs).toHaveLength(2);
    expect(executorInputs[0]?.previousAttempt).toBeNull();
    expect(executorInputs[1]?.previousAttempt).toMatchObject({ execution: { status: "failed" },
      verification: { verdict: "failed" }, workspaceBefore: workspaceState, workspaceAfter: workspaceState });
    expect(committed.filter(({ kind }) => kind === "horizon.execution-attempt")).toHaveLength(2);
    if (steered) expect(planningInputs[1]).toMatchObject({ executionEvidence: {
      execution: failed, verification: failedProof, workspaceBefore: workspaceState, workspaceAfter: workspaceState,
    } });
  });

  it("reverifies a completed implementation without running the executor twice", async () => {
    const committed: Array<{ kind?: string }> = []; let sequence = 0; let executorRuns = 0;
    let verifierRuns = 0; let reconcilerRuns = 0;
    const stored: Array<Record<string, unknown>> = [];
    const executionEvidence = [{ name: "workspace_exec", status: "ok" as const, args: { cmd: "npm", args: ["test"] },
      ref: "execution-result", result: { exitCode: 0 } }];
    const executionReceipts = [{ name: "workspace_exec", status: "ok", ref: "execution-result" }];
    const inconclusive = { ...verification, verdict: "failed" as const, summary: "The proof command was inconclusive.",
      checks: [{ target: "focused behavior", outcome: "not-run" as const, evidence: "temporary test runner failure" }],
      failureBrief: "Repeat independent verification without changing implementation." };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.5.19", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string }) => {
        committed.push(artifact); return { hash: `fact-${++sequence}`, artifact,
          artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime((value) => stored.push(value as Record<string, unknown>)),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-executor") { executorRuns++; return handle({ result: stepResult, toolEvidence: executionEvidence }); }
        if (task.id === "horizon-verifier") {
          verifierRuns++;
          expect(stored.at(-1)).toMatchObject({ executionToolEvidence: executionReceipts,
            executionReused: verifierRuns > 1, workspaceBefore: workspaceState });
          if (verifierRuns === 1) expect(stored.at(-1)?.previousAttempt).toBeNull();
          else expect(stored.at(-1)?.previousAttempt).toMatchObject({ execution: stepResult,
            verification: inconclusive, executionToolEvidence: executionReceipts, workspaceAfter: workspaceState });
          return handle({ verification: verifierRuns === 1 ? inconclusive : verification, toolEvidence: [] });
        }
        if (task.id === "horizon-reconciler") {
          reconcilerRuns++;
          return handle({ reconciliation: reconcilerRuns === 1 ? {
            object: "constal.horizon.reconciliation", version: 2, action: "reverify",
            summary: "Repeat proof against the unchanged workspace.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null,
          } : { object: "constal.horizon.reconciliation", version: 2, action: "complete",
            summary: "Independent proof passed.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);

    expect(result.status).toBe("complete");
    expect(executorRuns).toBe(1);
    expect(verifierRuns).toBe(2);
    expect(committed.map(({ kind }) => kind)).toContain("horizon.execution-reused");
    const attempts = stored.filter((value) => value.object === "constal.horizon.execution-attempt");
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) expect(attempt.executionToolEvidence).toEqual(executionReceipts);
  });

  it("restores the latest verified workspace only when reconciliation explicitly selects it", async () => {
    lifecycleState.restores = 0;
    let sequence = 0; let executorRuns = 0; let reconcilerRuns = 0;
    const failed: HzStepResult = { ...stepResult, status: "failed", summary: "The attempted edit was mis-scoped." };
    const failedProof = { ...verification, verdict: "failed" as const, summary: "Unrelated files changed.",
      checks: [{ target: "change scope", outcome: "failed" as const, evidence: "unrelated diff" }],
      failureBrief: "Discard the mis-scoped attempt." };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.5.19", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: unknown) => ({ hash: `fact-${++sequence}`, artifact,
        artifactHash: `artifact-${sequence}` }) as unknown as Fact<unknown>,
      invoke: casRuntime(),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-executor") { executorRuns++; return handle({ result: executorRuns === 1 ? failed : stepResult, toolEvidence: [] }); }
        if (task.id === "horizon-verifier") return handle({ verification: executorRuns === 1 ? failedProof : verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") {
          reconcilerRuns++;
          return handle({ reconciliation: reconcilerRuns === 1 ? {
            object: "constal.horizon.reconciliation", version: 2, action: "repair-step",
            summary: "Abandon the mis-scoped workspace changes.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "restore-last-verified", replanBrief: null, question: null,
          } : { object: "constal.horizon.reconciliation", version: 2, action: "complete",
            summary: "The clean repair is proven.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    await expect(runHorizon(plan.objective, ctx)).resolves.toMatchObject({ status: "complete" });
    expect(lifecycleState.restores).toBe(1);
  });

  it("restores the retained verified prefix and reruns only its failed dependent after replanning", async () => {
    lifecycleState.restores = 0;
    const prepareStep = { ...plan.steps[0]!, id: "prepare", title: "Prepare", dependsOn: [] };
    const implementStep = { ...plan.steps[0]!, id: "implement", dependsOn: ["prepare"] };
    const prepareResult = { ...stepResult, stepId: "prepare", summary: "Prepared the verified foundation." };
    const prepareAssertion = { ...plan.assertions[0]!, stepId: "prepare" };
    const twoStepPlan: HzPlan = { ...plan, steps: [prepareStep, implementStep],
      assertions: [prepareAssertion, plan.assertions[0]!] };
    const revisedPlan: HzPlan = { ...twoStepPlan, revision: 2,
      steps: [prepareStep, { ...implementStep, specification: "Use the live boundary observed by the failed attempt." }],
      assertions: twoStepPlan.assertions.map((assertion) => ({ ...assertion, revision: 2 })) };
    const continuityDecision: HzPlanContinuity["decisions"] = [{ priorStepId: "prepare", nextStepId: "prepare",
      disposition: "retain", reason: "The verified prerequisite remains valid.", evidence: ["prepare-verification"] }];
    const failed = { ...stepResult, status: "failed" as const, summary: "The dependent used a stale boundary." };
    const failedProof = { ...verification, verdict: "failed" as const, summary: "The dependent proof failed.",
      checks: [{ target: "dependent behavior", outcome: "failed" as const, evidence: "stale boundary" }],
      failureBrief: "Repair the dependent work specification." };
    const plannerInputs: Array<Record<string, unknown>> = []; const executedSteps: string[] = [];
    let sequence = 0; let plannerRuns = 0; let executorRuns = 0; let verifierRuns = 0; let reconcilerRuns = 0;
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.6.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: unknown) => ({ hash: `fact-${++sequence}`, artifact,
        artifactHash: `artifact-${sequence}` }) as unknown as Fact<unknown>,
      invoke: casRuntime((stored) => {
        if (stored && typeof stored === "object" && !Array.isArray(stored) && "restartAt" in stored) {
          plannerInputs.push(stored as Record<string, unknown>);
        }
      }),
      spawn: (task: { id: string }, envelope: unknown) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++; const selected = plannerRuns === 1 ? twoStepPlan : revisedPlan;
          return handle({ plan: selected, state: planningState(selected,
            plannerRuns === 1 ? [] : continuityDecision), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-executor") {
          executorRuns++;
          const selected = executorRuns === 1 ? prepareResult : executorRuns === 2 ? failed : stepResult;
          executedSteps.push(selected.stepId); return handle({ result: selected, toolEvidence: [] });
        }
        if (task.id === "horizon-verifier") {
          verifierRuns++;
          return handle({ verification: verifierRuns === 1 ? { ...verification, stepId: "prepare" }
            : verifierRuns === 2 ? failedProof : verification, toolEvidence: [] });
        }
        if (task.id === "horizon-reconciler") {
          reconcilerRuns++;
          const decision = reconcilerRuns === 1
            ? { action: "continue", summary: "The prerequisite is proven.", planningOwner: null,
              workspaceDisposition: "keep-current", replanBrief: null }
            : reconcilerRuns === 2
              ? { action: "replan", summary: "The dependent specification is stale.", planningOwner: "decomposition",
                workspaceDisposition: "restore-last-verified", replanBrief: "Repair only the failed dependent." }
              : { action: "complete", summary: "The repaired dependent is proven.", planningOwner: null,
                workspaceDisposition: "keep-current", replanBrief: null };
          return handle({ reconciliation: { object: "constal.horizon.reconciliation", version: 2,
            ...decision, remainingUnknowns: [], question: null }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}: ${String(envelope)}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);

    expect(result).toMatchObject({ status: "complete", plan: { revision: 2 } });
    expect(executedSteps).toEqual(["prepare", "implement", "implement"]);
    expect(lifecycleState.restores).toBe(1);
    expect(plannerInputs[1]).toMatchObject({ restartAt: "decomposition",
      completed: [{ stepId: "prepare", status: "complete" }],
      completedEvidence: [{ stepId: "prepare", verification: { verdict: "passed" } }],
      executionEvidence: { stepId: "implement", execution: { status: "failed" } } });
  });

  it("requires approval of the exact issue-work plan before spawning an executor", async () => {
    const sequence: string[] = []; const committed: Array<{ kind?: string; planFact?: string }> = []; let fact = 0;
    const handedOff: Array<{ request?: { context?: { review?: unknown } }; step?: unknown; planFact?: string }> = [];
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.3.37", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; planFact?: string }) => {
        committed.push(artifact); fact++;
        return { hash: `fact-${fact}`, artifact, artifactHash: `artifact-${fact}` } as unknown as Fact<unknown>;
      },
      invoke: async (resource: unknown, operation: string, args: { text?: string; ref?: string }) => operation === "repository.permission.get"
        ? { permission: "write" } : casRuntime((value) => handedOff.push(value as typeof handedOff[number]))(resource, operation, args),
      await: (label: string) => {
        sequence.push(`await:${label}`);
        return handle({ object: "constal.horizon.event", version: 1, behavior: "operate", eventClass: "github.issue.comment",
          objective: "This plan looks good. Please go ahead.", context: { repository: "constal-ai/horizon",
            sender: { login: "reviewer" }, approval: { permissions: ["write", "maintain", "admin"] } } });
      },
      spawn: (task: { id: string }) => {
        sequence.push(`spawn:${task.id}`);
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-approval-interpreter") {
          const planFact = committed.findLast(({ kind }) => kind === "horizon.approval-request")?.planFact;
          return handle({ object: "constal.horizon.plan-decision", version: 1, planFact, decision: "approve", guidance: null });
        }
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "All work is proven.",
          remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current",
          replanBrief: null, question: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon({ objective: plan.objective }, ctx, { requirePlanApproval: true });
    expect(result.status).toBe("complete");
    const approval = sequence.indexOf("await:horizon-approval-1-1");
    const execution = sequence.indexOf("spawn:horizon-executor");
    expect(approval).toBeGreaterThan(-1);
    expect(execution).toBeGreaterThan(approval);
    expect(committed.map(({ kind }) => kind)).toContain("horizon.approval-decision");
    const approvalIndex = committed.findIndex(({ kind }) => kind === "horizon.approval-decision");
    const workInputs = handedOff.filter((input) => input.step);
    expect(workInputs).toHaveLength(2);
    for (const input of workInputs) expect(input.request?.context?.review).toEqual({
      fact: `fact-${approvalIndex + 1}`, planFact: input.planFact,
      decision: { object: "constal.horizon.plan-decision", version: 1, planFact: input.planFact, decision: "approve", guidance: null },
      event: expect.objectContaining({ objective: "This plan looks good. Please go ahead.",
        context: expect.objectContaining({ sender: { login: "reviewer" } }) }),
    });
    const reconciliation = handedOff.find((input) => "restoreAvailable" in input);
    expect(reconciliation?.request?.context?.review).toEqual(workInputs[0]!.request?.context?.review);
  });

  it("does not report complete when the immutable final artifact cannot be created", async () => {
    const committed: Array<{ kind?: string }> = []; let sequence = 0;
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.2.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime(),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") return handle({ plan, state: planningState(plan), toolEvidence: [], planningRuns: 7 });
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "All work is proven.",
          remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current",
          replanBrief: null, question: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: (input: { cmd: string }) => input.cmd === "tar"
        ? handle({ status: "failed", exitCode: 2, outputs: [] })
        : handle({ status: "completed", exitCode: 0, outputs: [] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("could not create the immutable final artifact");
    expect(committed.map(({ kind }) => kind)).toContain("horizon.package-failed");
    expect(committed.map(({ kind }) => kind)).not.toContain("horizon.result");
  });

  it("preserves failed evidence and creates a new immutable plan revision before retrying", async () => {
    const committed: Array<{ kind?: string; plan?: HzPlan }> = []; let sequence = 0;
    let plannerRuns = 0; let executorRuns = 0; let reconcilerRuns = 0;
    const revisedPlan: HzPlan = { ...plan, revision: 2,
      assertions: plan.assertions.map((assertion) => ({ ...assertion, revision: 2 })),
      specification: "Preserve the first attempt as evidence and execute the corrected repository-native approach." };
    const failed: HzStepResult = { ...stepResult, status: "failed", summary: "The planned seam was stale.",
      changedFiles: [], verification: ["focused test exposed the stale seam"], unknowns: [{
        question: "Which live boundary replaces the planned seam?", state: "open", resolution: null, evidence: ["test failure"] }] };
    const failedVerification = { ...verification, verdict: "failed" as const, summary: "The focused proof failed.",
      checks: [{ target: "focused behavior", outcome: "failed" as const, evidence: "focused test failed" }],
      failureBrief: "Use the observed live seam and make the focused test pass." };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.2.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; plan?: HzPlan }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime(),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++;
          const selected = plannerRuns === 1 ? plan : revisedPlan;
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
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
            object: "constal.horizon.reconciliation", version: 2, action: "replan",
            summary: "The live seam invalidates the remaining implementation approach.", remainingUnknowns: failed.unknowns,
            planningOwner: "decomposition", workspaceDisposition: "keep-current",
            replanBrief: "Preserve the failed attempt as evidence and rewrite the work unit around the observed live boundary.",
            question: null,
          } : {
            object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "The revised work is proven.",
            remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current",
            replanBrief: null, question: null,
          }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("complete");
    expect(result.plan?.revision).toBe(2);
    expect(result.longHorizon).toMatchObject({ durablePlan: true, specialistRuns: 22, replans: 1 });
    expect(committed.filter(({ kind }) => kind === "horizon.plan").map(({ plan: committedPlan }) => committedPlan?.revision)).toEqual([1, 2]);
    expect(committed.filter(({ kind }) => kind === "horizon.step-result")).toHaveLength(2);
  });

  it("repairs an invalid assertion plan and reverifies without repeating implementation", async () => {
    const committed: Array<{ kind?: string; restartAt?: string; executionAttempt?: string }> = [];
    let sequence = 0; let plannerRuns = 0; let executorRuns = 0; let verifierRuns = 0; let reconcilerRuns = 0;
    const revised: HzPlan = { ...plan, revision: 2, assertions: [{ ...plan.assertions[0]!, revision: 2,
      assertions: [{ ...plan.assertions[0]!.assertions[0]!, evidenceRequired: ["Run the corrected proof command."] }] }] };
    const wrongProof = { ...verification, verdict: "failed" as const, summary: "The assertion targeted the wrong command.",
      checks: [{ target: "configured proof", outcome: "not-run" as const, evidence: "the command does not exist" }],
      failureBrief: "Correct the assertion without changing the implementation." };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.5.19", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; restartAt?: string; executionAttempt?: string }) => {
        committed.push(artifact); return { hash: `fact-${++sequence}`, artifact,
          artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime(),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++; const selected = plannerRuns === 1 ? plan : revised;
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-executor") { executorRuns++; return handle({ result: stepResult, toolEvidence: [] }); }
        if (task.id === "horizon-verifier") { verifierRuns++; return handle({ verification: verifierRuns === 1 ? wrongProof : verification, toolEvidence: [] }); }
        if (task.id === "horizon-reconciler") {
          reconcilerRuns++;
          return handle({ reconciliation: reconcilerRuns === 1 ? {
            object: "constal.horizon.reconciliation", version: 2, action: "replan",
            summary: "The proof contract is wrong, while implementation is complete.", remainingUnknowns: [],
            planningOwner: "assertions", workspaceDisposition: "keep-current",
            replanBrief: "Repair the assertion to use the repository's real proof command.", question: null,
          } : { object: "constal.horizon.reconciliation", version: 2, action: "complete",
            summary: "The corrected independent proof passed.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);

    expect(result).toMatchObject({ status: "complete", plan: { revision: 2 }, longHorizon: { replans: 1 } });
    expect(executorRuns).toBe(1);
    expect(verifierRuns).toBe(2);
    expect(committed).toContainEqual(expect.objectContaining({ kind: "horizon.plan", restartAt: "assertions",
      executionAttempt: expect.any(String) }));
    expect(committed.map(({ kind }) => kind)).toContain("horizon.execution-reused");
  });

  it("durably waits for a material user decision and synthesizes a new plan revision", async () => {
    const committed: Array<{ kind?: string; plan?: HzPlan }> = []; let sequence = 0; let plannerRuns = 0;
    const planningAnswers: Array<string | null> = [];
    const needsInput: HzPlan = { ...plan, status: "needs-input", revision: 1, steps: [], assertions: [],
      question: { prompt: "Which public contract should I implement?", options: [
        "Preserve v1 behavior for compatibility.", "Adopt v2 behavior as the new contract.",
        "Support both versions behind an explicit boundary.",
      ] },
      unknowns: [{ question: "Which public contract is intended?", state: "needs-input",
        resolution: null, evidence: ["Both versions exist in source."] }] };
    const revised: HzPlan = { ...plan, revision: 2,
      assertions: plan.assertions.map((assertion) => ({ ...assertion, revision: 2 })),
      specification: "Adopt v2 as explicitly selected by the user." };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.2.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string; plan?: HzPlan }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime((value) => {
        const stored = value && typeof value === "object" && !Array.isArray(value) ? value as { answer?: unknown } : null;
        if (stored && Object.hasOwn(stored, "answer")) planningAnswers.push(typeof stored.answer === "string" ? stored.answer : null);
      }),
      await: () => handle({ answer: "2" }),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++;
          const selected = plannerRuns === 1 ? needsInput : revised;
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "The v2 work is proven.",
          remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current",
          replanBrief: null, question: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("complete");
    expect(result.plan?.revision).toBe(2);
    expect(result.longHorizon).toMatchObject({ specialistRuns: 19, replans: 1 });
    expect(planningAnswers).toEqual([null, "Adopt v2 behavior as the new contract."]);
    expect(committed.map(({ kind }) => kind)).toContain("horizon.answer");
  });

  it("does not ask the same stable unknown twice after the user answered it", async () => {
    let plannerRuns = 0; let awaits = 0; let sequence = 0;
    const first: HzPlan = { ...plan, status: "needs-input", steps: [], assertions: [],
      question: { prompt: "Which public contract should I implement?", options: [
        "Preserve v1 behavior for compatibility.", "Adopt v2 behavior as the new contract.",
        "Support both versions behind an explicit boundary.",
      ] },
      unknowns: [{ question: "Which contract is intended?", state: "needs-input",
        resolution: null, evidence: ["Two contracts exist."] }] };
    const repeated: HzPlan = { ...first, revision: 2,
      question: { prompt: "Which contract version should I use?", options: [
        "Preserve v1 behavior for compatibility.", "Adopt v2 behavior as the new contract.",
        "Support both versions behind an explicit boundary.",
      ] } };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.2.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: unknown) => ({ hash: `fact-${++sequence}`, artifact,
        artifactHash: `artifact-${sequence}` }) as unknown as Fact<unknown>,
      invoke: casRuntime(),
      await: () => { awaits++; return handle({ answer: "Adopt v2." }); },
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++; const selected = plannerRuns === 1 ? first : plannerRuns === 2 ? repeated
            : { ...plan, revision: 3,
                assertions: plan.assertions.map((assertion) => ({ ...assertion, revision: 3 })) };
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-question-reconciliation") return handle({
          object: "constal.horizon.question-reconciliation", version: 1, decision: "answered",
          rationale: "The user already selected the contract behavior.",
        });
        if (task.id === "horizon-executor") return handle({ result: stepResult, toolEvidence: [] });
        if (task.id === "horizon-verifier") return handle({ verification, toolEvidence: [] });
        if (task.id === "horizon-reconciler") return handle({ reconciliation: {
          object: "constal.horizon.reconciliation", version: 2, action: "complete", summary: "The work is proven.",
          remainingUnknowns: [], planningOwner: null, workspaceDisposition: "keep-current",
          replanBrief: null, question: null,
        }, toolEvidence: [] });
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;
    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("complete");
    expect(awaits).toBe(1);
    expect(result.longHorizon.replans).toBe(2);
  });

  it.each(["decomposition", null] as const)("resumes an execution question with planning owner %s", async (planningOwner) => {
    const committed: Array<{ kind?: string }> = []; let sequence = 0; let plannerRuns = 0;
    const storedPlans: Array<{ restartAt: unknown }> = [];
    let executionRuns = 0; let reconciliationRuns = 0;
    const failedExecution: HzStepResult = { ...stepResult, status: "failed", summary: "Attempt failed.", changedFiles: [],
      verification: ["same failure"], observations: ["same evidence"], unknowns: [{
        question: "How can this path be repaired?", state: "open", resolution: null, evidence: ["same failure"] }] };
    const failedProof = { ...verification, verdict: "failed" as const, summary: "Same proof failed.",
      checks: [{ target: "focused behavior", outcome: "failed" as const, evidence: "same failure" }],
      failureBrief: "The same observable failure remains." };
    const ctx = { ledger: { view: async () => [] },
      resources: { model: "model", sandbox: "sandbox", cas: "cas", github: "github", web: "web", search: "search" },
      run: { id: "run", session: "session", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.2.0", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      commit: async (artifact: { kind?: string }) => {
        committed.push(artifact); sequence++;
        return { hash: `fact-${sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      invoke: casRuntime((value) => {
        if (value && typeof value === "object" && "restartAt" in value) storedPlans.push(value as { restartAt: unknown });
      }),
      await: () => handle({ answer: "Use the alternative implementation seam identified in the failure evidence." }),
      spawn: (task: { id: string }) => {
        if (task.id === "horizon-discovery-framer") return handle({ discoveryPlan, toolEvidence: [] });
        if (task.id === "horizon-investigator") return handle({ investigation, toolEvidence: [] });
        if (task.id === "horizon-planner") {
          plannerRuns++;
          const selected = { ...plan, revision: plannerRuns,
            assertions: plan.assertions.map((assertion) => ({ ...assertion, revision: plannerRuns })) };
          return handle({ plan: selected, state: planningState(selected), toolEvidence: [], planningRuns: 7 });
        }
        if (task.id === "horizon-executor") {
          executionRuns++; return handle({ result: executionRuns <= 3 ? failedExecution : stepResult, toolEvidence: [] });
        }
        if (task.id === "horizon-verifier") return handle({ verification: executionRuns <= 3 ? failedProof : verification,
          toolEvidence: [] });
        if (task.id === "horizon-reconciler") {
          reconciliationRuns++;
          if (reconciliationRuns === 3) return handle({ reconciliation: {
            object: "constal.horizon.reconciliation", version: 2, action: "ask",
            summary: "Repeated evidence requires one implementation decision.", remainingUnknowns: failedExecution.unknowns,
            planningOwner, workspaceDisposition: "keep-current",
            replanBrief: "Use the user's selected alternative rather than repeating the unchanged attempt.",
            question: { prompt: "How should I proceed after the repeated failure?", options: [
              "Use the alternative implementation seam.", "Narrow the requested behavior.",
              "Provide additional environment context.",
            ] },
          }, toolEvidence: [] });
          if (reconciliationRuns >= 4) return handle({ reconciliation: {
            object: "constal.horizon.reconciliation", version: 2, action: "complete",
            summary: "The alternative is proven.", remainingUnknowns: [], planningOwner: null,
            workspaceDisposition: "keep-current", replanBrief: null, question: null,
          }, toolEvidence: [] });
          return handle({ reconciliation: {
            object: "constal.horizon.reconciliation", version: 2, action: "replan",
            summary: "Change the implementation approach.", remainingUnknowns: failedExecution.unknowns,
            planningOwner: "decomposition", workspaceDisposition: "keep-current",
            replanBrief: "Use a materially different implementation approach.", question: null,
          }, toolEvidence: [] });
        }
        throw new Error(`unexpected task ${task.id}`);
      },
      sandboxPool: () => ({ createSandbox: async () => ({ exec: () => handle({ status: "completed", exitCode: 0,
        outputs: [{ path: "/workspace/.constal/horizon-final.tar.gz", ref: "artifact-ref", bytes: 42 }] }) }) }),
    } as unknown as Ctx;

    const result = await runHorizon(plan.objective, ctx);
    expect(result.status).toBe("complete");
    expect(result.plan?.revision).toBe(4);
    expect(result.longHorizon).toMatchObject({ replans: 3 });
    expect(storedPlans.at(-1)?.restartAt).toBe(planningOwner ?? "rubric");
    expect(committed.map(({ kind }) => kind)).toContain("horizon.plateau");
  });
});
