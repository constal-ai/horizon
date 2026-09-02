import { subtask } from "@constal/sdk";
import { loadArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzAssertionPlan, parseHzDesign, parseHzMilestoneWork, parseHzPlanContinuity, parseHzPlanCritique,
  parseHzPlanNarrative, parseHzRubric, parseHzStepAssertions, parseHzWorkPlan, type HzAssertionPlan, type HzDesign,
  type HzMilestoneWork, type HzPlanContinuity, type HzPlanCritique, type HzPlanInput, type HzPlanNarrative, type HzPlanStep,
  type HzRubric, type HzStepAssertions, type HzToolEvidence, type HzWorkPlan } from "../contracts.js";
import { ASSERTION_PLAN_REPAIR_SYSTEM, ASSERTION_SYSTEM, CONTINUITY_SYSTEM, CRITIQUE_SYSTEM, DECOMPOSITION_SYSTEM, DESIGN_SYSTEM,
  RUBRIC_SYSTEM, WORK_PLAN_REPAIR_SYSTEM } from "../prompts/planning.js";
import { PLANNER_SYSTEM } from "../prompts/planner.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";
import { assertionPlanArtifact, milestoneWorkArtifact, planningArtifact } from "../planning-envelope.js";

export interface PlanningPhaseResult<T> {
  artifact: T;
  toolEvidence: HzToolEvidence[];
}

interface RubricInput { planning: HzPlanInput; prior: HzRubric | null; critique: HzPlanCritique | null; tools: string[] }
interface DesignInput { planning: HzPlanInput; rubric: HzRubric; prior: HzDesign | null; critique: HzPlanCritique | null; tools: string[] }
interface DecompositionInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; milestoneId: string;
  acceptedSteps: HzPlanStep[]; requiredPrerequisiteStepIds: string[];
  prior: HzPlanStep[]; critique: HzPlanCritique | null; tools: string[] }
interface AssertionInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; workPlan: HzWorkPlan;
  stepId: string; prior: HzStepAssertions | null; critique: HzPlanCritique | null; tools: string[] }
interface WorkPlanRepairInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; workPlan: HzWorkPlan;
  critique: HzPlanCritique; tools: string[] }
interface AssertionPlanRepairInput extends WorkPlanRepairInput { assertions: HzStepAssertions[] }
interface ContinuityInput extends AssertionPlanRepairInput {}
interface CritiqueInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; workPlan: HzWorkPlan;
  assertions: HzStepAssertions[]; continuity: HzPlanContinuity; critiqueStage: "structure" | "complete";
  prior: HzPlanCritique | null; tools: string[] }
export interface FinalizerInput extends CritiqueInput { critique: HzPlanCritique; tools: [] }

function context(planning: HzPlanInput): Record<string, unknown> {
  return {
    request: planning.request, revision: planning.revision, discoveryPlan: planning.discoveryPlan,
    investigations: planning.investigations, previousPlan: planning.previousPlan, completed: planning.completed,
    replanBrief: planning.replanBrief, restartAt: planning.restartAt, executionEvidence: planning.executionEvidence,
    answer: planning.answer,
  };
}

export const rubricAgent = subtask<PlanningPhaseResult<HzRubric>>({
  id: "horizon-rubric", version: "3",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<RubricInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "rubric", system: RUBRIC_SYSTEM,
      objective: "Define the evidence-grounded success rubric.",
      context: { ...context(input.planning), priorRubric: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzRubric(planningArtifact(value,
        { object: "constal.horizon.rubric", revision: input.planning.revision }), input.planning.revision) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const designAgent = subtask<PlanningPhaseResult<HzDesign>>({
  id: "horizon-design", version: "6",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<DesignInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "design", system: DESIGN_SYSTEM,
      objective: "Close architecture decisions and define delivery milestones.",
      context: { ...context(input.planning), rubric: input.rubric, priorDesign: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzDesign(planningArtifact(value,
        { object: "constal.horizon.design", revision: input.planning.revision }), input.planning.revision) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const decompositionAgent = subtask<PlanningPhaseResult<HzMilestoneWork>>({
  id: "horizon-milestone-decomposition", version: "6",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<DecompositionInput>(ctx, envelope);
    const milestone = input.design.milestones.find(({ id }) => id === input.milestoneId);
    if (!milestone) throw new TypeError("milestone decomposition received an unknown milestone");
    const loop = await runReactLoop({ role: "decomposition", system: DECOMPOSITION_SYSTEM,
      objective: `Decompose milestone ${milestone.id} into ordered specialist agentic loops.`,
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        assignedMilestone: milestone,
        acceptedPrerequisiteSteps: input.acceptedSteps, requiredPrerequisiteStepIds: input.requiredPrerequisiteStepIds,
        priorMilestoneSteps: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzMilestoneWork(milestoneWorkArtifact(value,
        input.planning.revision, input.milestoneId), input.planning.revision, input.milestoneId) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const assertionAgent = subtask<PlanningPhaseResult<HzStepAssertions>>({
  id: "horizon-assertions", version: "3",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<AssertionInput>(ctx, envelope);
    const step = input.workPlan.steps.find(({ id }) => id === input.stepId);
    if (!step) throw new TypeError("assertion phase received an unknown work unit");
    const loop = await runReactLoop({ role: `assertions-${input.stepId}`, system: ASSERTION_SYSTEM,
      objective: `Define independent proof for ${step.title}.`,
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assignedStep: step, priorAssertions: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzStepAssertions(planningArtifact(value,
        { object: "constal.horizon.step-assertions", revision: input.planning.revision, stepId: input.stepId }),
      input.planning.revision, input.stepId) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

function repairedWorkPlan(value: unknown, input: WorkPlanRepairInput): HzWorkPlan | null {
  const plan = parseHzWorkPlan(planningArtifact(value,
    { object: "constal.horizon.work-plan", revision: input.planning.revision }), input.planning.revision);
  if (!plan) return null;
  const milestoneIds = new Set(input.design.milestones.map(({ id }) => id));
  const represented = new Set(plan.steps.map(({ milestoneId }) => milestoneId));
  return plan.steps.some(({ milestoneId }) => !milestoneIds.has(milestoneId))
    || [...milestoneIds].some((milestoneId) => !represented.has(milestoneId)) ? null : plan;
}

export const workPlanRepairAgent = subtask<PlanningPhaseResult<HzWorkPlan>>({
  id: "horizon-work-plan-repair", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<WorkPlanRepairInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "work-plan-repair", system: WORK_PLAN_REPAIR_SYSTEM,
      objective: "Repair the complete work plan across milestone boundaries.",
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => repairedWorkPlan(value, input) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const assertionPlanRepairAgent = subtask<PlanningPhaseResult<HzAssertionPlan>>({
  id: "horizon-assertion-plan-repair", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<AssertionPlanRepairInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "assertion-plan-repair", system: ASSERTION_PLAN_REPAIR_SYSTEM,
      objective: "Repair proof ownership across the complete assertion plan.",
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assertions: input.assertions, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzAssertionPlan(assertionPlanArtifact(value, input.planning.revision),
        input.planning.revision, input.workPlan.steps.map(({ id }) => id)) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const continuityAgent = subtask<PlanningPhaseResult<HzPlanContinuity>>({
  id: "horizon-plan-continuity", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<ContinuityInput>(ctx, envelope);
    const completedIds = input.planning.completed.map(({ stepId }) => stepId);
    const loop = await runReactLoop({ role: "plan-continuity", system: CONTINUITY_SYSTEM,
      objective: "Reconcile previously verified work with the new immutable planning revision.",
      context: { ...context(input.planning), previousPlanningState: input.planning.previousState,
        rubric: input.rubric, design: input.design, workPlan: input.workPlan, assertions: input.assertions,
        completed: input.planning.completed, critique: input.critique },
      tools: [], model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzPlanContinuity(planningArtifact(value,
        { object: "constal.horizon.plan-continuity", revision: input.planning.revision }), input.planning.revision,
      completedIds, input.workPlan.steps.map(({ id }) => id)) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

function critiqueArtifact(value: unknown, input: CritiqueInput): HzPlanCritique | null {
  const critique = parseHzPlanCritique(planningArtifact(value,
    { object: "constal.horizon.plan-critique", revision: input.planning.revision }), input.planning.revision);
  if (!critique) return null;
  const milestones = new Set(input.design.milestones.map(({ id }) => id));
  const steps = new Set(input.workPlan.steps.map(({ id }) => id));
  return critique.findings.some((finding) => finding.affectedMilestones.some((id) => !milestones.has(id))
    || finding.affectedSteps.some((id) => !steps.has(id))) ? null : critique;
}

export const critiqueAgent = subtask<PlanningPhaseResult<HzPlanCritique>>({
  id: "horizon-plan-critique", version: "7",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<CritiqueInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "plan-critique", system: CRITIQUE_SYSTEM,
      objective: "Reconcile all planning artifacts and decide whether the plan can become immutable.",
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assertions: input.assertions, continuity: input.continuity,
        critiqueStage: input.critiqueStage,
        priorCritique: input.prior },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => critiqueArtifact(value, input) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const planFinalizer = subtask<PlanningPhaseResult<HzPlanNarrative>>({
  id: "horizon-plan-finalizer", version: "3",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<FinalizerInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "plan-finalizer", system: PLANNER_SYSTEM,
      objective: "Render the converged immutable execution specification.",
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assertions: input.assertions, continuity: input.continuity,
        critique: input.critique },
      tools: [], model: "model", stream: true, maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzPlanNarrative(planningArtifact(value,
        { object: "constal.horizon.plan-narrative" })) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});
