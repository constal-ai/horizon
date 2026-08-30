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

const step = { id: "implement", milestoneId: "behavior", title: "Implement", responsibility: "Implement durable behavior.",
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

function planningContext(critics: HzPlanCritique[], designs: HzDesign[] = [design], options: {
  workByMilestone?: Record<string, typeof workPlan.steps>;
  assertionsByStep?: Record<string, HzStepAssertions>;
  finalPlan?: HzPlan;
} = {}) {
  const spawned: string[] = []; const committed: Array<{ kind?: string; phase?: string }> = [];
  const artifacts = new Map<string, string>([["planning-input", JSON.stringify(input)]]); let artifactSequence = 0;
  const decompositionInputs: Array<{ milestoneId: string; acceptedSteps: typeof workPlan.steps }> = [];
  let designIndex = 0; let criticIndex = 0;
  const ctx = {
    resources: { model: "model", cas: "cas" },
    invoke: async (_resource: unknown, operation: string, args: { text?: string; ref?: string }) => {
      if (operation === "putText" && typeof args.text === "string") {
        const ref = `phase-${++artifactSequence}`; artifacts.set(ref, args.text);
        return { ref, bytes: new TextEncoder().encode(args.text).byteLength };
      }
      if (operation === "getText" && typeof args.ref === "string" && artifacts.has(args.ref)) {
        const text = artifacts.get(args.ref)!; return { ref: args.ref, text, bytes: new TextEncoder().encode(text).byteLength };
      }
      throw new Error(`unexpected CAS operation ${operation}`);
    },
    spawn: (task: { id: string }, envelope: { ref?: string }) => {
      spawned.push(task.id);
      if (task.id === "horizon-rubric") return handle({ artifact: rubric, toolEvidence: [] });
      if (task.id === "horizon-design") return handle({ artifact: designs[Math.min(designIndex++, designs.length - 1)]!, toolEvidence: [] });
      if (task.id === "horizon-milestone-decomposition") {
        const phase = JSON.parse(artifacts.get(envelope.ref!)!) as { milestoneId: string; acceptedSteps: typeof workPlan.steps };
        decompositionInputs.push({ milestoneId: phase.milestoneId, acceptedSteps: phase.acceptedSteps });
        return handle({ artifact: { object: "constal.horizon.milestone-work", version: 1, revision: 1,
          milestoneId: phase.milestoneId, steps: options.workByMilestone?.[phase.milestoneId] ?? [step] }, toolEvidence: [] });
      }
      if (task.id === "horizon-assertions") {
        const phase = JSON.parse(artifacts.get(envelope.ref!)!) as { stepId: string };
        return handle({ artifact: options.assertionsByStep?.[phase.stepId] ?? assertions, toolEvidence: [] });
      }
      if (task.id === "horizon-plan-critique") return handle({ artifact: critics[Math.min(criticIndex++, critics.length - 1)]!, toolEvidence: [] });
      if (task.id === "horizon-plan-finalizer") return handle({ artifact: options.finalPlan ?? finalPlan, toolEvidence: [] });
      throw new Error(`unexpected task ${task.id}`);
    },
    commit: async (artifact: { kind?: string; phase?: string }) => {
      committed.push(artifact);
      return { hash: `fact-${committed.length}`, artifact, artifactHash: `artifact-${committed.length}` } as unknown as Fact<unknown>;
    },
  } as unknown as Ctx;
  return { ctx, spawned, committed, decompositionInputs, envelope: { ref: "planning-input" } };
}

describe("Horizon multi-loop planner", () => {
  it("finalizes only after rubric, design, decomposition, assertions, and critique loops", async () => {
    const fixture = planningContext([accepted]);
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan).toEqual(finalPlan);
    expect(result.planningRuns).toBe(7);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-milestone-decomposition",
      "horizon-assertions", "horizon-plan-critique", "horizon-plan-finalizer"]);
    expect(fixture.committed.filter(({ kind }) => kind === "horizon.planning-phase").map(({ phase }) => phase))
      .toEqual(["rubric", "design", "decomposition:behavior", "assertions:implement", "critique", "finalization"]);
  });

  it("reruns the owning phase and every dependent planning loop before re-critique", async () => {
    const repair: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Design ownership is incomplete.",
      findings: [{ id: "ownership", owner: "design", severity: "blocking", issue: "Recovery ownership is incomplete.",
        evidence: ["src/runtime.ts"], repair: "Close the ownership and lifecycle decision." }] };
    const revisedDesign: HzDesign = { ...design, summary: "Runtime owns recovery and its complete lifecycle." };
    const fixture = planningContext([repair, accepted], [design, revisedDesign]);
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan.status).toBe("ready");
    expect(result.planningRuns).toBe(11);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-milestone-decomposition", "horizon-assertions",
      "horizon-plan-critique", "horizon-design", "horizon-milestone-decomposition", "horizon-assertions",
      "horizon-plan-critique", "horizon-plan-finalizer"]);
  });

  it("runs one decomposition loop per milestone and feeds accepted prerequisite steps forward", async () => {
    const proofStep = { ...step, id: "prove", milestoneId: "proof", title: "Prove",
      responsibility: "Prove the durable behavior independently.", dependsOn: [step.id] };
    const proofAssertions: HzStepAssertions = { ...assertions, stepId: proofStep.id,
      assertions: [{ ...assertions.assertions[0]!, id: "independent-proof", claim: "Independent proof passes." }] };
    const twoMilestones: HzDesign = { ...design, milestones: [design.milestones[0]!, {
      id: "proof", title: "Independent proof", outcome: "The behavior is independently proven.", dependsOn: ["behavior"],
      responsibilities: [proofStep.responsibility], risks: ["Incomplete negative-path proof."] }] };
    const twoStepPlan: HzPlan = { ...finalPlan, steps: [step, proofStep], assertions: [assertions, proofAssertions] };
    const fixture = planningContext([accepted], [twoMilestones], {
      workByMilestone: { behavior: [step], proof: [proofStep] },
      assertionsByStep: { [step.id]: assertions, [proofStep.id]: proofAssertions }, finalPlan: twoStepPlan,
    });
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.planningRuns).toBe(9);
    expect(fixture.spawned.filter((id) => id === "horizon-milestone-decomposition")).toHaveLength(2);
    expect(fixture.decompositionInputs).toEqual([
      { milestoneId: "behavior", acceptedSteps: [] },
      { milestoneId: "proof", acceptedSteps: [step] },
    ]);
  });
});
