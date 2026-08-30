import { canonicalJson, subtask } from "@constal/sdk";
import { loadArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzDesign, parseHzMilestoneWork, parseHzPlan, parseHzPlanCritique, parseHzRubric, parseHzStepAssertions,
  type HzDesign, type HzMilestoneWork, type HzPlan, type HzPlanCritique, type HzPlanInput, type HzPlanStep,
  type HzRubric, type HzStepAssertions, type HzToolEvidence, type HzWorkPlan } from "../contracts.js";
import { ASSERTION_SYSTEM, CRITIQUE_SYSTEM, DECOMPOSITION_SYSTEM, DESIGN_SYSTEM, RUBRIC_SYSTEM } from "../prompts/planning.js";
import { PLANNER_SYSTEM } from "../prompts/planner.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";

export interface PlanningPhaseResult<T> {
  artifact: T;
  toolEvidence: HzToolEvidence[];
}

interface RubricInput { planning: HzPlanInput; prior: HzRubric | null; critique: HzPlanCritique | null; tools: string[] }
interface DesignInput { planning: HzPlanInput; rubric: HzRubric; prior: HzDesign | null; critique: HzPlanCritique | null; tools: string[] }
interface DecompositionInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; milestoneId: string;
  acceptedSteps: HzPlanStep[]; prior: HzPlanStep[]; critique: HzPlanCritique | null; tools: string[] }
interface AssertionInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; workPlan: HzWorkPlan;
  stepId: string; prior: HzStepAssertions | null; critique: HzPlanCritique | null; tools: string[] }
interface CritiqueInput { planning: HzPlanInput; rubric: HzRubric; design: HzDesign; workPlan: HzWorkPlan;
  assertions: HzStepAssertions[]; prior: HzPlanCritique | null; tools: string[] }
export interface FinalizerInput extends CritiqueInput { critique: HzPlanCritique; tools: [] }

function context(planning: HzPlanInput): Record<string, unknown> {
  return {
    request: planning.request, revision: planning.revision, discoveryPlan: planning.discoveryPlan,
    investigations: planning.investigations, previousPlan: planning.previousPlan, completed: planning.completed,
    replanBrief: planning.replanBrief, answer: planning.answer,
  };
}

export const rubricAgent = subtask<PlanningPhaseResult<HzRubric>>({
  id: "horizon-rubric", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<RubricInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "rubric", system: RUBRIC_SYSTEM,
      objective: "Define the evidence-grounded success rubric.",
      context: { ...context(input.planning), priorRubric: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzRubric(value, input.planning.revision) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const designAgent = subtask<PlanningPhaseResult<HzDesign>>({
  id: "horizon-design", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<DesignInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "design", system: DESIGN_SYSTEM,
      objective: "Close architecture decisions and define delivery milestones.",
      context: { ...context(input.planning), rubric: input.rubric, priorDesign: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzDesign(value, input.planning.revision) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const decompositionAgent = subtask<PlanningPhaseResult<HzMilestoneWork>>({
  id: "horizon-milestone-decomposition", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<DecompositionInput>(ctx, envelope);
    const milestone = input.design.milestones.find(({ id }) => id === input.milestoneId);
    if (!milestone) throw new TypeError("milestone decomposition received an unknown milestone");
    const loop = await runReactLoop({ role: "decomposition", system: DECOMPOSITION_SYSTEM,
      objective: `Decompose milestone ${milestone.id} into ordered specialist agentic loops.`,
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        assignedMilestone: milestone,
        acceptedPrerequisiteSteps: input.acceptedSteps, priorMilestoneSteps: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzMilestoneWork(value, input.planning.revision, input.milestoneId) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const assertionAgent = subtask<PlanningPhaseResult<HzStepAssertions>>({
  id: "horizon-assertions", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<AssertionInput>(ctx, envelope);
    const step = input.workPlan.steps.find(({ id }) => id === input.stepId);
    if (!step) throw new TypeError("assertion phase received an unknown work unit");
    const loop = await runReactLoop({ role: `assertions-${input.stepId}`, system: ASSERTION_SYSTEM,
      objective: `Define independent proof for ${step.title}.`,
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assignedStep: step, priorAssertions: input.prior, critique: input.critique },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzStepAssertions(value, input.planning.revision, input.stepId) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const critiqueAgent = subtask<PlanningPhaseResult<HzPlanCritique>>({
  id: "horizon-plan-critique", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<CritiqueInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "plan-critique", system: CRITIQUE_SYSTEM,
      objective: "Reconcile all planning artifacts and decide whether the plan can become immutable.",
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assertions: input.assertions, priorCritique: input.prior },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzPlanCritique(value, input.planning.revision) }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});

export const planFinalizer = subtask<PlanningPhaseResult<HzPlan>>({
  id: "horizon-plan-finalizer", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<FinalizerInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "plan-finalizer", system: PLANNER_SYSTEM,
      objective: "Render the converged immutable execution specification.",
      context: { ...context(input.planning), rubric: input.rubric, design: input.design,
        workPlan: input.workPlan, assertions: input.assertions, critique: input.critique },
      tools: [], model: "model", stream: true, maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse(value) {
        const plan = parseHzPlan(value);
        const expectedStatus = input.critique.verdict === "accepted" ? "ready"
          : input.critique.verdict === "needs-input" ? "needs-input" : "blocked";
        return plan?.revision === input.planning.revision && plan.objective === input.planning.request.objective
          && plan.status === expectedStatus && canonicalJson(plan.steps) === canonicalJson(input.workPlan.steps)
          && canonicalJson(plan.assertions) === canonicalJson(input.assertions)
          && plan.workspaceRoot === input.planning.discoveryPlan.workspaceRoot
          && (expectedStatus !== "needs-input" || plan.question === input.critique.question) ? plan : null;
      } }, ctx);
    return { artifact: loop.artifact, toolEvidence: loop.evidence };
  },
});
