import type { Ctx, Fact, Handle } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import type { HzDesign, HzExecutionAttempt, HzInvestigationResult, HzPlan, HzPlanInput, HzPlanCritique, HzPlanNarrative,
  HzPlanningState, HzRubric, HzStepAssertions, HzWorkPlan } from "../src/contracts.js";
import { planner, scopeMilestoneStepIds } from "../src/tasks/planner.js";

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
  stepId: step.id, assertions: [{ claim: "Replay does not duplicate effects.",
    evidenceRequired: ["Focused replay test."], negativePath: true }] };
const rubric: HzRubric = { object: "constal.horizon.rubric", version: 1, revision: 1,
  objective: "Implement durable behavior", successCriteria: ["Replay succeeds without duplication."],
  constraints: ["Reuse the runtime."], nonGoals: ["No new scheduler."], openQuestions: [],
  verificationPrinciples: ["Observe the replay outcome."] };
const design: HzDesign = { object: "constal.horizon.design", version: 1, revision: 1,
  summary: "Keep recovery in the runtime.", decisions: [{ question: "Who owns recovery?",
    decision: "The runtime.", rationale: "It owns durable state.", evidence: ["src/runtime.ts"] }],
  milestones: [{ id: "behavior", title: "Durable behavior", outcome: "Replay works.", dependsOn: [],
    responsibilities: [step.responsibility], risks: ["Duplicate effect."] }] };
const workPlan: HzWorkPlan = { object: "constal.horizon.work-plan", version: 1, revision: 1, steps: [step] };
const accepted: HzPlanCritique = { object: "constal.horizon.plan-critique", version: 1, revision: 1,
  verdict: "accepted", summary: "The plan converges.", findings: [], question: null };
const finalPlan: HzPlan = { object: "constal.horizon.plan", version: 1, revision: 1, status: "ready",
  objective: rubric.objective, summary: "Implement and prove durable behavior.", specification: "Reuse runtime recovery and prove replay.",
  workspaceRoot: "/workspace/repositories/source", unknowns: [], steps: [step], assertions: [assertions],
  risks: design.milestones[0]!.risks, question: null };

function narrative(plan: HzPlan): HzPlanNarrative {
  return { object: "constal.horizon.plan-narrative", version: 1,
    summary: plan.summary, specification: plan.specification, unknowns: plan.unknowns, risks: plan.risks };
}
const input: HzPlanInput = { request: { objective: rubric.objective, context: null, constraints: [], source: null,
  environment: { name: "default", cache: true, setup: [] } },
  discoveryPlan: { object: "constal.horizon.discovery-plan", version: 1, status: "ready",
    summary: "Source ready.", workspaceRoot: finalPlan.workspaceRoot,
    focuses: [{ id: "runtime", title: "Runtime", mission: "Trace recovery.", questions: ["Who owns recovery?"],
      evidenceNeeded: ["Source"], stopWhen: "Ownership is proven." }], unknowns: [] },
  investigations: [{ object: "constal.horizon.investigation", version: 1, focusId: "runtime", status: "complete",
    summary: "Runtime owns recovery.", findings: ["Runtime ownership."], evidence: ["src/runtime.ts"], unknowns: [],
    planImplications: ["Reuse runtime."] }], workspaceReceipt: "workspace-receipt",
  revision: 1, previousPlan: null, previousState: null,
  completed: [], completedEvidence: [], restartAt: null, executionEvidence: null, replanBrief: null, answer: null, tools: [] };

const priorState: HzPlanningState = { object: "constal.horizon.planning-state", version: 1, revision: 1,
  investigations: input.investigations, investigationObservationSignatures: [],
  rubric, design, workPlan, assertions: [assertions],
  continuity: { object: "constal.horizon.plan-continuity", version: 1, revision: 1, decisions: [] },
  critique: accepted };
const executionEvidence: HzExecutionAttempt = { object: "constal.horizon.execution-attempt", version: 1,
  id: "attempt-1", ordinal: 1, planFact: "plan-1", stepId: step.id, executionReused: false,
  previousAttemptRef: null, restorePoint: { kind: "prepared", stepId: null, receipt: "workspace",
    cacheKey: "c".repeat(64), image: "image", tree: "before", status: "" },
  workspaceBefore: { tree: "before", status: "" }, workspaceAfter: { tree: "after", status: " M src/index.ts" },
  stepFact: "step-fact", verificationFact: "verification-fact",
  execution: { object: "constal.horizon.step-result", version: 1, stepId: step.id, status: "failed",
    summary: "The planned seam was stale.", changedFiles: [], verification: ["Focused proof failed."],
    observations: ["The live seam differs."], unknowns: [], blockedReason: null },
  executionToolEvidence: [], verification: { object: "constal.horizon.verification", version: 1,
    stepId: step.id, verdict: "failed", summary: "The plan used a stale seam.",
    checks: [{ target: "Focused behavior", outcome: "failed", evidence: "Observed stale seam." }],
    unknowns: [], failureBrief: "Repair the owning work unit.", blockedReason: null }, verificationToolEvidence: [] };

function planningContext(critics: HzPlanCritique[], designs: HzDesign[] = [design], options: {
  planningInput?: HzPlanInput;
  rubrics?: HzRubric[];
  workByMilestone?: Record<string, typeof workPlan.steps>;
  workPlanRepairs?: HzWorkPlan[];
  assertionsByStep?: Record<string, HzStepAssertions>;
  assertionPlanRepairs?: HzStepAssertions[][];
  continuityRepairs?: Array<HzPlanningState["continuity"]["decisions"]>;
  investigationResults?: HzInvestigationResult[];
  finalPlan?: HzPlan;
} = {}) {
  const planningInput = options.planningInput ?? input;
  const spawned: string[] = []; const committed: Array<Record<string, unknown>> = [];
  const artifacts = new Map<string, string>([["planning-input", JSON.stringify(planningInput)]]); let artifactSequence = 0;
  const decompositionInputs: Array<{ milestoneId: string; acceptedSteps: typeof workPlan.steps }> = [];
  let rubricIndex = 0; let designIndex = 0; let criticIndex = 0; let workRepairIndex = 0; let assertionRepairIndex = 0;
  let continuityIndex = 0; let investigationIndex = 0;
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
      if (task.id === "horizon-rubric") return handle({
        artifact: options.rubrics?.[Math.min(rubricIndex++, options.rubrics.length - 1)] ?? rubric, toolEvidence: [],
      });
      if (task.id === "horizon-design") return handle({ artifact: designs[Math.min(designIndex++, designs.length - 1)]!, toolEvidence: [] });
      if (task.id === "horizon-milestone-decomposition") {
        const phase = JSON.parse(artifacts.get(envelope.ref!)!) as { milestoneId: string; acceptedSteps: typeof workPlan.steps };
        decompositionInputs.push({ milestoneId: phase.milestoneId, acceptedSteps: phase.acceptedSteps });
        return handle({ artifact: { object: "constal.horizon.milestone-work", version: 1, revision: planningInput.revision,
          milestoneId: phase.milestoneId, steps: options.workByMilestone?.[phase.milestoneId] ?? [step] }, toolEvidence: [] });
      }
      if (task.id === "horizon-work-plan-repair") return handle({
        artifact: options.workPlanRepairs?.[Math.min(workRepairIndex++, options.workPlanRepairs.length - 1)] ?? workPlan,
        toolEvidence: [],
      });
      if (task.id === "horizon-assertions") {
        const phase = JSON.parse(artifacts.get(envelope.ref!)!) as { stepId: string };
        return handle({ artifact: options.assertionsByStep?.[phase.stepId] ?? assertions, toolEvidence: [] });
      }
      if (task.id === "horizon-assertion-plan-repair") return handle({ artifact: {
        object: "constal.horizon.assertion-plan", version: 1, revision: planningInput.revision,
        assertions: options.assertionPlanRepairs?.[Math.min(assertionRepairIndex++, options.assertionPlanRepairs.length - 1)]
          ?? [assertions],
      }, toolEvidence: [] });
      if (task.id === "horizon-plan-continuity") return handle({ artifact: {
        object: "constal.horizon.plan-continuity", version: 1, revision: planningInput.revision,
        decisions: options.continuityRepairs?.[Math.min(continuityIndex++, options.continuityRepairs.length - 1)] ?? [],
      }, toolEvidence: [] });
      if (task.id === "horizon-investigator") {
        const result = options.investigationResults?.[Math.min(investigationIndex++,
          options.investigationResults.length - 1)]!;
        const focus = envelope as unknown as { focus: { id: string } };
        return handle({ investigation: { ...result, focusId: focus.focus.id }, toolEvidence: [] });
      }
      if (task.id === "horizon-plan-critique") return handle({ artifact: critics[Math.min(criticIndex++, critics.length - 1)]!, toolEvidence: [] });
      if (task.id === "horizon-plan-finalizer") return handle({ artifact: narrative(options.finalPlan ?? finalPlan), toolEvidence: [] });
      throw new Error(`unexpected task ${task.id}`);
    },
    commit: async (artifact: Record<string, unknown>) => {
      committed.push(artifact);
      return { hash: `fact-${committed.length}`, artifact, artifactHash: `artifact-${committed.length}` } as unknown as Fact<unknown>;
    },
  } as unknown as Ctx;
  return { ctx, spawned, committed, decompositionInputs, envelope: { ref: "planning-input" } };
}

describe("Horizon multi-loop planner", () => {
  it("namespaces a step that borrows another milestone's identity", () => {
    const foreign = { ...step, id: "proof-run", milestoneId: "behavior", dependsOn: [] };
    const dependent = { ...step, id: "review", milestoneId: "behavior", dependsOn: [foreign.id] };
    expect(scopeMilestoneStepIds(design.milestones[0]!, [foreign, dependent],
      new Set(["behavior", "proof"]), new Set())).toEqual([
      { ...foreign, id: "behavior-proof-run" },
      { ...dependent, dependsOn: ["behavior-proof-run"] },
    ]);
  });

  it("finalizes only after rubric, design, decomposition, assertions, and critique loops", async () => {
    const fixture = planningContext([accepted]);
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan).toEqual(finalPlan);
    expect(result.planningRuns).toBe(8);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-milestone-decomposition",
      "horizon-plan-critique", "horizon-assertions", "horizon-plan-critique", "horizon-plan-finalizer"]);
    expect(fixture.committed.filter(({ kind }) => kind === "horizon.planning-phase").map(({ phase }) => phase))
      .toEqual(["rubric", "design", "decomposition:behavior", "critique:structure", "assertions:implement",
        "critique:complete", "finalization"]);
  });

  it("lets the initial rubric reopen investigation before design", async () => {
    const openRubric: HzRubric = { ...rubric, openQuestions: [{
      question: "Which existing Resource owns recovery?", state: "open", resolution: null,
      evidence: ["Authenticated Resource catalog."],
    }] };
    const additional: HzInvestigationResult = { object: "constal.horizon.investigation", version: 1,
      focusId: "placeholder", status: "complete", summary: "The runtime Resource owns recovery.",
      findings: ["The existing Resource is the owner."], evidence: ["platform_get Resource catalog"], unknowns: [],
      planImplications: ["Reuse the existing Resource."] };
    const fixture = planningContext([accepted], [design], {
      rubrics: [openRubric, rubric], investigationResults: [additional],
    });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan.status).toBe("ready");
    expect(result.state.investigations).toHaveLength(2);
    expect(fixture.spawned.slice(0, 4)).toEqual([
      "horizon-rubric", "horizon-investigator", "horizon-rubric", "horizon-design",
    ]);
  });

  it("enters execution replanning at whole-work-plan repair without rerunning upstream phases", async () => {
    const revisedStep = { ...step, specification: "Use the live seam observed by the failed execution attempt." };
    const revisedWork: HzWorkPlan = { ...workPlan, revision: 2, steps: [revisedStep] };
    const revisedAssertions: HzStepAssertions = { ...assertions, revision: 2 };
    const acceptedRevision: HzPlanCritique = { ...accepted, revision: 2 };
    const revisedFinal: HzPlan = { ...finalPlan, revision: 2, steps: [revisedStep], assertions: [revisedAssertions] };
    const planningInput: HzPlanInput = { ...input, revision: 2, previousPlan: finalPlan, previousState: priorState,
      restartAt: "decomposition", executionEvidence,
      replanBrief: "The failed attempt proved that the work unit owns a stale implementation seam." };
    const fixture = planningContext([acceptedRevision, acceptedRevision], [design], { planningInput,
      workPlanRepairs: [revisedWork], assertionsByStep: { [step.id]: revisedAssertions }, finalPlan: revisedFinal });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(revisedFinal);
    expect(result.state.workPlan).toEqual(revisedWork);
    expect(result.planningRuns).toBe(6);
    expect(fixture.spawned).toEqual(["horizon-work-plan-repair", "horizon-plan-critique", "horizon-assertions",
      "horizon-plan-critique", "horizon-plan-finalizer"]);
    expect(fixture.committed).toContainEqual(expect.objectContaining({ kind: "horizon.execution-replan-entry",
      owner: "decomposition", attempt: executionEvidence.id }));
  });

  it("enters assertion replanning without rerunning implementation planning", async () => {
    const revisedAssertions: HzStepAssertions = { ...assertions, revision: 2,
      assertions: [{ ...assertions.assertions[0]!, evidenceRequired: ["Reproduce the exact observed failure path."] }] };
    const acceptedRevision: HzPlanCritique = { ...accepted, revision: 2 };
    const revisedFinal: HzPlan = { ...finalPlan, revision: 2, assertions: [revisedAssertions] };
    const planningInput: HzPlanInput = { ...input, revision: 2, previousPlan: finalPlan, previousState: priorState,
      restartAt: "assertions", executionEvidence,
      replanBrief: "The implementation is complete, but the proof contract targeted the wrong observation." };
    const fixture = planningContext([acceptedRevision, acceptedRevision], [design], { planningInput,
      assertionPlanRepairs: [[revisedAssertions]], finalPlan: revisedFinal });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(revisedFinal);
    expect(result.planningRuns).toBe(5);
    expect(fixture.spawned).toEqual(["horizon-assertion-plan-repair", "horizon-plan-critique",
      "horizon-plan-critique", "horizon-plan-finalizer"]);
  });

  it.each([
    { owner: "design" as const, prefix: ["horizon-design", "horizon-milestone-decomposition"] },
    { owner: "rubric" as const, prefix: ["horizon-rubric", "horizon-design", "horizon-milestone-decomposition"] },
  ])("enters execution replanning at $owner and rebuilds only its downstream artifacts", async ({ owner, prefix }) => {
    const revisedAssertions: HzStepAssertions = { ...assertions, revision: 2 };
    const acceptedRevision: HzPlanCritique = { ...accepted, revision: 2 };
    const revisedFinal: HzPlan = { ...finalPlan, revision: 2, assertions: [revisedAssertions] };
    const planningInput: HzPlanInput = { ...input, revision: 2, previousPlan: finalPlan, previousState: priorState,
      restartAt: owner, executionEvidence, replanBrief: `Execution evidence invalidated the ${owner}.` };
    const revisedDesign: HzDesign = { ...design, revision: 2 };
    const fixture = planningContext([acceptedRevision, acceptedRevision], [revisedDesign], { planningInput,
      workByMilestone: { behavior: [step] }, assertionsByStep: { [step.id]: revisedAssertions }, finalPlan: revisedFinal });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(revisedFinal);
    expect(fixture.spawned.slice(0, prefix.length)).toEqual(prefix);
    if (owner === "design") expect(fixture.spawned).not.toContain("horizon-rubric");
  });

  it("subjects completed-work continuity to cross-plan critique and global repair", async () => {
    const revisedAssertions: HzStepAssertions = { ...assertions, revision: 2 };
    const acceptedRevision: HzPlanCritique = { ...accepted, revision: 2 };
    const continuityRepair: HzPlanCritique = { ...acceptedRevision, verdict: "repair",
      summary: "The changed proof contract requires fresh verification.", findings: [{
        owner: "continuity", severity: "blocking", affectedMilestones: ["behavior"], affectedSteps: [step.id],
        issue: "The completed result was retained despite a changed proof contract.", evidence: ["verification-fact"],
        repair: "Classify the result for reverification." }] };
    const revisedFinal: HzPlan = { ...finalPlan, revision: 2, assertions: [revisedAssertions] };
    const planningInput: HzPlanInput = { ...input, revision: 2, previousPlan: finalPlan, previousState: priorState,
      completed: [{ ...executionEvidence.execution, status: "complete" }], completedEvidence: [executionEvidence],
      restartAt: "assertions", executionEvidence,
      replanBrief: "The proof contract changed after the completed implementation." };
    const retain = [{ priorStepId: step.id, nextStepId: step.id, disposition: "retain" as const,
      reason: "The implementation is unchanged.", evidence: ["step-fact"] }];
    const reverify = [{ ...retain[0]!, disposition: "reverify" as const,
      reason: "The changed proof contract requires independent verification." }];
    const fixture = planningContext([acceptedRevision, continuityRepair, acceptedRevision], [design], { planningInput,
      assertionPlanRepairs: [[revisedAssertions]], continuityRepairs: [retain, reverify], finalPlan: revisedFinal });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(revisedFinal);
    expect(result.state.continuity.decisions).toEqual(reverify);
    expect(fixture.spawned.filter((id) => id === "horizon-plan-continuity")).toHaveLength(2);
    expect(fixture.spawned.filter((id) => id === "horizon-assertion-plan-repair")).toHaveLength(1);
    expect(fixture.committed).toContainEqual(expect.objectContaining({ kind: "horizon.planning-repair",
      owner: "continuity" }));
  });

  it("reruns the owning phase and every dependent planning loop before re-critique", async () => {
    const repair: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Design ownership is incomplete.",
      findings: [{ owner: "design", severity: "blocking", issue: "Recovery ownership is incomplete.",
        affectedMilestones: ["behavior"], affectedSteps: [], evidence: ["src/runtime.ts"],
        repair: "Close the ownership and lifecycle decision." },
      { owner: "decomposition", severity: "blocking", issue: "The current work reflects the incomplete design.",
        affectedMilestones: ["behavior"], affectedSteps: ["implement"], evidence: ["Current work plan."],
        repair: "Regenerate work after the design is closed." }] };
    const revisedDesign: HzDesign = { ...design, summary: "Runtime owns recovery and its complete lifecycle." };
    const fixture = planningContext([repair, accepted], [design, revisedDesign]);
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan.status).toBe("ready");
    expect(result.planningRuns).toBe(11);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-milestone-decomposition",
      "horizon-plan-critique", "horizon-design", "horizon-milestone-decomposition", "horizon-plan-critique",
      "horizon-assertions", "horizon-plan-critique", "horizon-plan-finalizer"]);
  });

  it("runs one decomposition loop per milestone and feeds accepted prerequisite steps forward", async () => {
    const proofStep = { ...step, id: "prove", milestoneId: "proof", title: "Prove",
      responsibility: "Prove the durable behavior independently.", dependsOn: [step.id] };
    const modelProofStep = { ...proofStep, dependsOn: ["behavior"] };
    const proofAssertions: HzStepAssertions = { ...assertions, stepId: proofStep.id,
      assertions: [{ ...assertions.assertions[0]!, claim: "Independent proof passes." }] };
    const twoMilestones: HzDesign = { ...design, milestones: [design.milestones[0]!, {
      id: "proof", title: "Independent proof", outcome: "The behavior is independently proven.", dependsOn: ["behavior"],
      responsibilities: [proofStep.responsibility], risks: ["Incomplete negative-path proof."] }] };
    const twoStepPlan: HzPlan = { ...finalPlan, steps: [step, proofStep], assertions: [assertions, proofAssertions] };
    const fixture = planningContext([accepted], [twoMilestones], {
      workByMilestone: { behavior: [step], proof: [modelProofStep] },
      assertionsByStep: { [step.id]: assertions, [proofStep.id]: proofAssertions }, finalPlan: twoStepPlan,
    });
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.planningRuns).toBe(10);
    expect(fixture.spawned.filter((id) => id === "horizon-milestone-decomposition")).toHaveLength(2);
    expect(fixture.decompositionInputs).toEqual([
      { milestoneId: "behavior", acceptedSteps: [] },
      { milestoneId: "proof", acceptedSteps: [step] },
    ]);
  });

  it("repairs a cross-milestone ownership defect once as a whole work plan", async () => {
    const deliveryStep = { ...step, id: "deliver", milestoneId: "delivery", title: "Deliver",
      responsibility: "Deliver the result and own another unavailable fallback.", dependsOn: [step.id] };
    const repairedBoundary = { ...step, id: "resolve-boundary",
      responsibility: "Own boundary availability and produce one explicit delivery status.",
      specification: "Resolve availability once and expose the status consumed by delivery." };
    const repairedDelivery = { ...deliveryStep, responsibility: "Deliver from the resolved boundary status.",
      specification: "Consume the boundary status and deliver without defining a second fallback.",
      dependsOn: [repairedBoundary.id] };
    const twoMilestones: HzDesign = { ...design, milestones: [design.milestones[0]!, {
      id: "delivery", title: "Delivery", outcome: "The result is delivered once.", dependsOn: ["behavior"],
      responsibilities: ["Deliver the result."], risks: ["Duplicate fallback ownership."] }] };
    const repairedPlan: HzWorkPlan = { ...workPlan, steps: [repairedBoundary, repairedDelivery] };
    const boundaryAssertions: HzStepAssertions = { ...assertions, stepId: repairedBoundary.id };
    const deliveryAssertions: HzStepAssertions = { ...assertions, stepId: repairedDelivery.id,
      assertions: [{ ...assertions.assertions[0]!, claim: "Delivery consumes one boundary status." }] };
    const repair: HzPlanCritique = { ...accepted, verdict: "repair",
      summary: "Fallback ownership and its handoff conflict across milestones.", findings: [
        { owner: "decomposition", severity: "blocking",
          affectedMilestones: ["behavior", "delivery"], affectedSteps: [step.id, deliveryStep.id],
          issue: "Two work units own the same unavailable fallback.", evidence: ["Current work plan."],
          repair: "Choose one owner and rewire the consumer." },
        { owner: "decomposition", severity: "blocking",
          affectedMilestones: ["behavior", "delivery"], affectedSteps: [step.id, deliveryStep.id],
          issue: "Delivery has no defined boundary status input.", evidence: ["Current dependency graph."],
          repair: "Define one status producer and consumer." },
      ] };
    const repairedFinal: HzPlan = { ...finalPlan, steps: repairedPlan.steps,
      assertions: [boundaryAssertions, deliveryAssertions] };
    const fixture = planningContext([repair, accepted, accepted], [twoMilestones], {
      workByMilestone: { behavior: [step], delivery: [deliveryStep] }, workPlanRepairs: [repairedPlan],
      assertionsByStep: { [repairedBoundary.id]: boundaryAssertions, [repairedDelivery.id]: deliveryAssertions },
      finalPlan: repairedFinal,
    });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(repairedFinal);
    expect(result.planningRuns).toBe(12);
    expect(fixture.spawned.filter((id) => id === "horizon-milestone-decomposition")).toHaveLength(2);
    expect(fixture.spawned.filter((id) => id === "horizon-work-plan-repair")).toHaveLength(1);
    expect(fixture.spawned).toEqual(["horizon-rubric", "horizon-design", "horizon-milestone-decomposition",
      "horizon-milestone-decomposition", "horizon-plan-critique", "horizon-work-plan-repair",
      "horizon-plan-critique", "horizon-assertions", "horizon-assertions", "horizon-plan-critique",
      "horizon-plan-finalizer"]);
    expect(fixture.committed).toContainEqual(expect.objectContaining({ kind: "horizon.planning-repair",
      owner: "decomposition", repairCycle: 1, beforeHash: expect.any(String), afterHash: expect.any(String) }));
  });

  it("repairs assertion ownership once without regenerating every per-step assertion loop", async () => {
    const repairedAssertions: HzStepAssertions = { ...assertions,
      assertions: [{ ...assertions.assertions[0]!, evidenceRequired: ["Replay and denial-path checks pass."] }] };
    const repair: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Negative-path proof is incomplete.",
      findings: [{ owner: "assertions", severity: "blocking",
        affectedMilestones: ["behavior"], affectedSteps: [step.id],
        issue: "The denial path has no independent proof.", evidence: ["Current assertion plan."],
        repair: "Add the executable denial-path observation." }] };
    const repairedFinal: HzPlan = { ...finalPlan, assertions: [repairedAssertions] };
    const fixture = planningContext([accepted, repair, accepted], [design], {
      assertionPlanRepairs: [[repairedAssertions]], finalPlan: repairedFinal,
    });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(repairedFinal);
    expect(result.planningRuns).toBe(10);
    expect(fixture.spawned.filter((id) => id === "horizon-assertions")).toHaveLength(1);
    expect(fixture.spawned.filter((id) => id === "horizon-assertion-plan-repair")).toHaveLength(1);
    expect(fixture.committed).toContainEqual(expect.objectContaining({ kind: "horizon.planning-repair",
      owner: "assertions" }));
  });

  it("repairs distinct defects at the same graph location without treating the location as semantic identity", async () => {
    const missingFailureProof: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Failure proof is missing.",
      findings: [{ owner: "assertions", severity: "blocking", affectedMilestones: ["behavior"], affectedSteps: [step.id],
        issue: "The denial path has no independent proof.", evidence: ["Current assertion plan."],
        repair: "Add the executable denial-path observation." }] };
    const disproportionalProof: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Proof is disproportionate.",
      findings: [{ owner: "assertions", severity: "blocking", affectedMilestones: ["behavior"], affectedSteps: [step.id],
        issue: "The same step now requires an unrelated full-tree inventory.", evidence: ["Repaired assertion plan."],
        repair: "Use the authoritative Git baseline and focused final diff." }] };
    const firstRepair: HzStepAssertions = { ...assertions, assertions: [{ ...assertions.assertions[0]!,
      evidenceRequired: ["Replay and denial-path checks pass."] }] };
    const secondRepair: HzStepAssertions = { ...assertions, assertions: [{ ...assertions.assertions[0]!,
      evidenceRequired: ["Focused final diff and denial-path checks pass."] }] };
    const repairedFinal: HzPlan = { ...finalPlan, assertions: [secondRepair] };
    const fixture = planningContext([accepted, missingFailureProof, disproportionalProof, accepted], [design], {
      assertionPlanRepairs: [[firstRepair], [secondRepair]], finalPlan: repairedFinal,
    });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan).toEqual(repairedFinal);
    expect(result.planningRuns).toBe(12);
    expect(fixture.spawned.filter((id) => id === "horizon-assertion-plan-repair")).toHaveLength(2);
    expect(fixture.committed.filter(({ kind }) => kind === "horizon.planning-repair")).toHaveLength(2);
  });

  it("routes a material evidence gap back through investigation and rebuilds the plan from accumulated evidence", async () => {
    const missingEvidence: HzPlanCritique = { ...accepted, verdict: "repair",
      summary: "The existing platform capability is not yet known.", findings: [{
        owner: "investigation", severity: "blocking", affectedMilestones: ["behavior"], affectedSteps: [step.id],
        issue: "Does the existing platform Resource expose the required operation?",
        evidence: ["Authenticated Platform Resource catalog."],
        repair: "Inspect the authenticated Resource and its operation contract before assigning implementation ownership.",
      }] };
    const additional: HzInvestigationResult = { object: "constal.horizon.investigation", version: 1,
      focusId: "planning-gap-placeholder", status: "complete", summary: "The existing Resource owns the operation.",
      findings: ["The operation belongs to the existing Resource adapter."], evidence: ["platform_get Resource catalog"],
      unknowns: [], planImplications: ["Extend the existing Resource; do not create a parallel integration."] };
    const fixture = planningContext([missingEvidence, accepted, accepted], [design], {
      investigationResults: [additional],
    });

    const result = await planner.run(fixture.envelope, fixture.ctx);

    expect(result.plan.status).toBe("ready");
    expect(result.state.investigations).toHaveLength(2);
    expect(result.state.investigations[1]).toEqual(expect.objectContaining({ summary: additional.summary,
      focusId: expect.stringMatching(/^planning-gap-/) }));
    expect(fixture.spawned).toContain("horizon-investigator");
    expect(fixture.committed).toContainEqual(expect.objectContaining({ kind: "horizon.investigation",
      source: "planning-critique" }));
  });

  it("routes an evidence-insoluble semantic decision to a durable user question", async () => {
    const question = { prompt: "Which public contract should the implementation use?", options: [
      "Preserve v1 behavior to maintain compatibility.",
      "Adopt v2 behavior and accept the compatibility change.",
      "Support both versions behind an explicit compatibility boundary.",
    ] as [string, string, string] };
    const userFinding: HzPlanCritique = { ...accepted, verdict: "repair", summary: "A product decision remains.",
      findings: [{ owner: "user", severity: "blocking",
        affectedMilestones: ["behavior"], affectedSteps: ["implement"],
        issue: "Should the public contract preserve v1 or adopt v2?", evidence: ["Both contracts exist."],
        repair: "Obtain the user's intended compatibility boundary." }], question };
    const needsInput: HzPlan = { ...finalPlan, status: "needs-input", question };
    const fixture = planningContext([userFinding], [design], { finalPlan: needsInput });
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan.status).toBe("needs-input");
    expect(result.plan.question).toEqual(question);
    expect(fixture.committed.map(({ kind }) => kind)).toContain("horizon.planning-route");
  });

  it("excludes a no-progress repair route and converges on a durable user decision", async () => {
    const repair: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Assertion proof is incomplete.",
      findings: [{ owner: "assertions", severity: "blocking",
        affectedMilestones: ["behavior"], affectedSteps: ["implement"],
        issue: "The negative path is not independently proven.", evidence: ["Current assertion set."],
        repair: "Add executable negative-path proof." }] };
    const question = { prompt: "How should the unresolved proof obligation be handled?", options: [
      "Provide the missing executable proof surface.",
      "Proceed with the limitation recorded as an explicit assumption.",
      "Revise the objective to remove the unsupported obligation.",
    ] as [string, string, string] };
    const needsDecision: HzPlanCritique = { ...accepted, verdict: "needs-input",
      summary: "The assertion repair route made no progress and needs a user decision.", findings: [], question };
    const waiting: HzPlan = { ...finalPlan, status: "needs-input", question };
    const fixture = planningContext([accepted, repair, needsDecision], [design], { finalPlan: waiting });
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan.status).toBe("needs-input");
    expect(result.plan.question).toEqual(question);
    expect(result.planningRuns).toBe(10);
    expect(fixture.committed.map(({ kind }) => kind)).toContain("horizon.planning-plateau");
  });

  it("detects an A to B to A planning cycle and changes route instead of terminating", async () => {
    const repair: HzPlanCritique = { ...accepted, verdict: "repair", summary: "Design remains inconsistent.",
      findings: [{ owner: "design", severity: "blocking", issue: "Ownership is inconsistent.",
        affectedMilestones: ["behavior"], affectedSteps: [],
        evidence: ["Design artifacts."], repair: "Reconcile ownership." }] };
    const alternate: HzDesign = { ...design, summary: "Alternate ownership design." };
    const question = { prompt: "Which ownership boundary should govern the implementation?", options: [
      "Keep runtime ownership and provide the missing contract.",
      "Move ownership to the caller and revise the design.",
      "Exclude the disputed behavior from this objective.",
    ] as [string, string, string] };
    const needsDecision: HzPlanCritique = { ...accepted, verdict: "needs-input",
      summary: "Both design routes returned to an observed state.", findings: [], question };
    const waiting: HzPlan = { ...finalPlan, status: "needs-input", question };
    const fixture = planningContext([repair, repair, needsDecision], [design, alternate, design], { finalPlan: waiting });
    const result = await planner.run(fixture.envelope, fixture.ctx);
    expect(result.plan.status).toBe("needs-input");
    expect(result.plan.question).toEqual(question);
    expect(result.planningRuns).toBe(12);
    expect(fixture.committed.map(({ kind }) => kind)).toContain("horizon.planning-plateau");
  });
});
