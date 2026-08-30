import type { Ctx, Fact, Handle } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import type { HzDesign, HzPlan, HzPlanInput, HzPlanCritique, HzRubric, HzStepAssertions, HzWorkPlan } from "../src/contracts.js";
import { planner } from "../src/tasks/planner.js";

function handle<T>(value: T): Handle<T> {
  const promise = Promise.resolve(value) as Promise<T> & Partial<Handle<T>>;
  Object.assign(promise, { id: "handle", resolved: true, seq: 1, outcome: null, result: value, error: undefined,
    cancel: async () => undefined });
  return promise as Handle<T>;
}

const step = { id: "implement", title: "Implement", responsibility: "Implement durable behavior.",
  specification: "Reuse the runtime seam and prove replay.", dependsOn: [], verification: ["Focused replay test passes."],
  stopWhen: "Replay is proven." };
const assertions: HzStepAssertions = { object: "constal.horizon.step-assertions", version: 1, revision: 1,
  stepId: step.id, assertions: [{ id: "replay", claim: "Replay does not duplicate effects.",
    evidenceRequired: ["Focused replay test."], negativePath: true }] };
const rubric: HzRubric = { object: "constal.horizon.rubric", version: 1, revision: 1,
  objective: "Implement durable behavior", successCriteria: ["Replay succeeds without duplication."],
  constraints: ["Reuse the runtime."], nonGoals: ["No new scheduler."], openQuestions: [],
  verificationPrinciples: ["Observe the replay outcome."] };
const design: HzDesign = { object: "constal.horizon.design", version: 1, revision: 1,
  summary: "Keep recovery in the runtime.", decisions: [{ id: "owner", question: "Who owns recovery?",
    decision: "The runtime.", rationale: "It owns durable state.", evidence: ["src/runtime.ts"] }],
  milestones: [{ id: "behavior", title: "Durable behavior", outcome: "Replay works.", dependsOn: [],
    responsibilities: [step.responsibility], risks: ["Duplicate effect."] }] };
const workPlan: HzWorkPlan = { object: "constal.horizon.work-plan", version: 1, revision: 1, steps: [step] };
const accepted: HzPlanCritique = { object: "constal.horizon.plan-critique", version: 1, revision: 1,
  verdict: "accepted", summary: "The plan converges.", findings: [], question: null, blockedReason: null };
const finalPlan: HzPlan = { object: "constal.horizon.plan", version: 1, revision: 1, status: "ready",
  objective: rubric.objective, summary: "Implement and prove durable behavior.", specification: "Reuse runtime recovery and prove replay.",
  workspaceRoot: "/workspace/repositories/source", unknowns: [], steps: [step], assertions: [assertions],
  risks: design.milestones[0]!.risks, question: null, blockedReason: null };
const input: HzPlanInput = { request: { objective: rubric.objective, context: null, constraints: [] },
  discoveryPlan: { object: "constal.horizon.discovery-plan", version: 1, status: "ready",
    summary: "Source ready.", workspaceRoot: finalPlan.workspaceRoot,
    focuses: [{ id: "runtime", title: "Runtime", mission: "Trace recovery.", questions: ["Who owns recovery?"],
      evidenceNeeded: ["Source"], stopWhen: "Ownership is proven." }], unknowns: [], blockedReason: null },
  investigations: [{ object: "constal.horizon.investigation", version: 1, focusId: "runtime", status: "complete",
    summary: "Runtime owns recovery.", findings: ["Runtime ownership."], evidence: ["src/runtime.ts"], unknowns: [],
    planImplications: ["Reuse runtime."], blockedReason: null }], revision: 1, previousPlan: null, completed: [],
  replanBrief: null, answer: null, tools: [] };

function planningContext(critics: HzPlanCritique[], designs: HzDesign[] = [design]) {
  const spawned: string[] = []; const committed: Array<{ kind?: string; phase?: string }> = [];
  let designIndex = 0; let criticIndex = 0;
  const ctx = {
    resources: { model: "model" },
    spawn: (task: { id: string }) => {
      spawned.push(task.id);
      if (task.id === "horizon-rubric") return handle({ artifact: rubric, toolEvidence: [] });
      if (task.id === "horizon-design") return handle({ artifact: designs[Math.min(designIndex++, designs.length - 1)]!, toolEvidence: [] });
      if (task.id === "horizon-decomposition") return handle({ artifact: workPlan, toolEvidence: [] });
      if (task.id === "horizon-assertions") return handle({ artifact: assertions, toolEvidence: [] });
      if (task.id === "horizon-plan-critique") return handle({ artifact: critics[Math.min(criticIndex++, critics.length - 1)]!, toolEvidence: [] });
      if (task.id === "horizon-plan-finalizer") return handle({ artifact: finalPlan, toolEvidence: [] });
      throw new Error(`unexpected task ${task.id}`);
    },
    commit: async (artifact: { kind?: string; phase?: string }) => {
      committed.push(artifact);
      return { hash: `fact-${committed.length}`, artifact, artifactHash: `artifact-${committed.length}` } as unknown as Fact<unknown>;
    },
  } as unknown as Ctx;
  return { ctx, spawned, committed };
}

describe("Horizon multi-loop planner", () => {
  it("finalizes only after rubric, design, decomposition, assertions, and critique loops", async () => {
    const fixture = planningContext([accepted]);
    const result = await planner.run(input, fixture.ctx);
    expect(result.plan).toEqual(finalPlan);
    expect(result.planningRuns).toBe(7);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-decomposition",
      "horizon-assertions", "horizon-plan-critique", "horizon-plan-finalizer"]);
    expect(fixture.committed.filter(({ kind }) => kind === "horizon.planning-phase").map(({ phase }) => phase))
      .toEqual(["rubric", "design", "decomposition", "assertions:implement", "critique", "finalization"]);
  });

  it("reruns the owning phase and every dependent planning loop before re-critique", async () => {
    const repair: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Design ownership is incomplete.",
      findings: [{ id: "ownership", owner: "design", severity: "blocking", issue: "Recovery ownership is incomplete.",
        evidence: ["src/runtime.ts"], repair: "Close the ownership and lifecycle decision." }] };
    const revisedDesign: HzDesign = { ...design, summary: "Runtime owns recovery and its complete lifecycle." };
    const fixture = planningContext([repair, accepted], [design, revisedDesign]);
    const result = await planner.run(input, fixture.ctx);
    expect(result.plan.status).toBe("ready");
    expect(result.planningRuns).toBe(11);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-decomposition", "horizon-assertions",
      "horizon-plan-critique", "horizon-design", "horizon-decomposition", "horizon-assertions",
      "horizon-plan-critique", "horizon-plan-finalizer"]);
  });
});
