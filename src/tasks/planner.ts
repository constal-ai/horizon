import { canonicalJson, hashValue, subtask, type Ctx, type Handle, type SpawnAttenuation } from "@constal/sdk";
import { loadArtifact, storeArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzMilestoneWork, parseHzPlan, parseHzWorkPlan, type HzDesign, type HzMilestone, type HzPlanCritique, type HzPlanInput, type HzPlannerResult, type HzRubric,
  type HzStepAssertions, type HzToolEvidence, type HzWorkPlan } from "../contracts.js";
import { bindingsForTools } from "../tools/index.js";
import { HORIZON_LOOP_MICRO_USD, HORIZON_LOOP_WALL_MS, HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";
import { assertionAgent, critiqueAgent, decompositionAgent, designAgent, planFinalizer, rubricAgent,
  type PlanningPhaseResult } from "./planning-phases.js";

const MAX_REPAIR_CYCLES = 4;

function attenuation(tools: readonly string[], ctx: Pick<Ctx, "resources">): SpawnAttenuation {
  return { bindings: [...new Set([...bindingsForTools(tools, ctx), "cas"])].sort(), tools: [...tools].sort() };
}

function blockedCritique(input: HzPlanInput, summary: string): HzPlanCritique {
  return { object: "constal.horizon.plan-critique", version: 1, revision: input.revision,
    verdict: "blocked", summary, findings: [], question: null, blockedReason: summary };
}

function planningFingerprint(rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
  assertions: HzStepAssertions[]): Promise<string> {
  return hashValue({ rubric, design, workPlan,
    assertions: [...assertions].sort((left, right) => left.stepId.localeCompare(right.stepId)) });
}

function orderedMilestones(design: HzDesign): HzMilestone[] {
  const remaining = new Map(design.milestones.map((milestone) => [milestone.id, milestone]));
  const completed = new Set<string>(); const ordered: HzMilestone[] = [];
  while (remaining.size > 0) {
    const next = design.milestones.find((milestone) => remaining.has(milestone.id)
      && milestone.dependsOn.every((dependency) => completed.has(dependency)));
    if (!next) throw new TypeError("Horizon design milestone graph is not executable");
    ordered.push(next); completed.add(next.id); remaining.delete(next.id);
  }
  return ordered;
}

function terminalStepIds(steps: readonly HzWorkPlan["steps"][number][]): string[] {
  const ids = new Set(steps.map(({ id }) => id));
  const prerequisites = new Set(steps.flatMap(({ dependsOn }) => dependsOn.filter((id) => ids.has(id))));
  return steps.filter(({ id }) => !prerequisites.has(id)).map(({ id }) => id);
}

export function bindMilestoneDependencies(milestone: HzMilestone, steps: HzWorkPlan["steps"],
  completedMilestones: ReadonlyMap<string, HzWorkPlan["steps"]>): HzWorkPlan["steps"] {
  const prerequisiteByMilestone = new Map(milestone.dependsOn.map((id) => {
    const completed = completedMilestones.get(id);
    if (!completed) throw new TypeError(`Horizon milestone ${milestone.id} is missing prerequisite work for ${id}`);
    return [id, terminalStepIds(completed)] as const;
  }));
  const required = [...new Set([...prerequisiteByMilestone.values()].flat())].sort();
  const local = new Set(steps.map(({ id }) => id));
  return steps.map((step) => {
    const declared = step.dependsOn.flatMap((id) => prerequisiteByMilestone.get(id) ?? [id]);
    const dependencies = declared.some((id) => local.has(id)) ? declared : [...required, ...declared];
    return { ...step, dependsOn: [...new Set(dependencies)].sort() };
  });
}

export function scopeMilestoneStepIds(milestone: HzMilestone, steps: HzWorkPlan["steps"],
  milestoneIds: ReadonlySet<string>, acceptedStepIds: ReadonlySet<string>): HzWorkPlan["steps"] {
  const ids = new Map<string, string>();
  for (const step of steps) {
    const foreign = [...milestoneIds].some((id) => id !== milestone.id
      && (step.id === id || step.id.startsWith(`${id}-`)));
    const scoped = foreign || acceptedStepIds.has(step.id) ? `${milestone.id}-${step.id}` : step.id;
    if (acceptedStepIds.has(scoped) || [...ids.values()].includes(scoped)) {
      throw new TypeError(`Horizon milestone ${milestone.id} produced a duplicate step id ${scoped}`);
    }
    ids.set(step.id, scoped);
  }
  return steps.map((step) => ({ ...step, id: ids.get(step.id)!,
    dependsOn: step.dependsOn.map((id) => ids.get(id) ?? id) }));
}

async function commitPhase<T>(ctx: Ctx, phase: string, revision: number,
  result: PlanningPhaseResult<T>, repairCycle: number): Promise<void> {
  await ctx.commit({ kind: "horizon.planning-phase", phase, revision, repairCycle,
    artifact: result.artifact, toolEvidence: result.toolEvidence }, { tier: "audit" });
}

export const planner = subtask<HzPlannerResult>({
  id: "horizon-planner",
  version: "7",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<HzPlanInput>(ctx, envelope);
    const tools = input.tools; const childAttenuation = attenuation(tools, ctx);
    const evidence: HzToolEvidence[] = []; let planningRuns = 1; let repairCycle = 0;
    let critique: HzPlanCritique | null = null;

    const runRubric = async (prior: HzRubric | null): Promise<HzRubric> => {
      const phaseInput = await storeArtifact(ctx, { planning: input, prior, critique, tools });
      const result = await ctx.spawn(rubricAgent, phaseInput, {
        retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
          microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
        attenuation: childAttenuation,
      });
      planningRuns++; evidence.push(...result.toolEvidence); await commitPhase(ctx, "rubric", input.revision, result, repairCycle);
      return result.artifact;
    };
    const runDesign = async (rubric: HzRubric, prior: HzDesign | null): Promise<HzDesign> => {
      const phaseInput = await storeArtifact(ctx, { planning: input, rubric, prior, critique, tools });
      const result = await ctx.spawn(designAgent, phaseInput, {
        retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
          microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
        attenuation: childAttenuation,
      });
      planningRuns++; evidence.push(...result.toolEvidence); await commitPhase(ctx, "design", input.revision, result, repairCycle);
      return result.artifact;
    };
    const runDecomposition = async (rubric: HzRubric, design: HzDesign, prior: HzWorkPlan | null): Promise<HzWorkPlan> => {
      const acceptedSteps: HzWorkPlan["steps"] = [];
      const completedMilestones = new Map<string, HzWorkPlan["steps"]>();
      const milestoneIds = new Set(design.milestones.map(({ id }) => id));
      for (const milestone of orderedMilestones(design)) {
        const requiredPrerequisiteStepIds = milestone.dependsOn.flatMap((id) => {
          const completed = completedMilestones.get(id);
          if (!completed) throw new TypeError(`Horizon milestone ${milestone.id} is missing prerequisite work for ${id}`);
          return terminalStepIds(completed);
        });
        const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, milestoneId: milestone.id,
          acceptedSteps, requiredPrerequisiteStepIds,
          prior: prior?.steps.filter((step) => step.milestoneId === milestone.id) ?? [], critique, tools });
        const result = await ctx.spawn(decompositionAgent, phaseInput, {
          retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
            microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
          attenuation: childAttenuation,
        });
        planningRuns++; evidence.push(...result.toolEvidence);
        const scoped = scopeMilestoneStepIds(milestone, result.artifact.steps, milestoneIds,
          new Set(acceptedSteps.map(({ id }) => id)));
        const normalized = parseHzMilestoneWork({ ...result.artifact,
          steps: bindMilestoneDependencies(milestone, scoped, completedMilestones) }, input.revision, milestone.id);
        if (!normalized) throw new TypeError(`Horizon milestone ${milestone.id} dependency normalization failed`);
        await commitPhase(ctx, `decomposition:${milestone.id}`, input.revision,
          { ...result, artifact: normalized }, repairCycle);
        acceptedSteps.push(...normalized.steps); completedMilestones.set(milestone.id, normalized.steps);
      }
      const workPlan = parseHzWorkPlan({ object: "constal.horizon.work-plan", version: 1,
        revision: input.revision, steps: acceptedSteps }, input.revision);
      if (!workPlan) throw new TypeError("Horizon milestone work does not form one valid dependency-ordered plan");
      return workPlan;
    };
    const runAssertions = async (rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
      prior: HzStepAssertions[]): Promise<HzStepAssertions[]> => {
      const priorByStep = new Map(prior.map((item) => [item.stepId, item]));
      const handles: Array<{ step: HzWorkPlan["steps"][number]; handle: Handle<PlanningPhaseResult<HzStepAssertions>> }> = [];
      for (const step of workPlan.steps) {
        const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan, stepId: step.id,
          prior: priorByStep.get(step.id) ?? null, critique, tools });
        handles.push({ step, handle: ctx.spawn(assertionAgent, phaseInput,
          { retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
              microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
            attenuation: childAttenuation }) });
      }
      planningRuns += handles.length;
      const next: HzStepAssertions[] = [];
      for (const { step, handle } of handles) {
        const result = await Promise.resolve(handle); next.push(result.artifact); evidence.push(...result.toolEvidence);
        await commitPhase(ctx, `assertions:${step.id}`, input.revision, result, repairCycle);
      }
      return next;
    };
    const runCritique = async (rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
      assertions: HzStepAssertions[]): Promise<HzPlanCritique> => {
      const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan,
        assertions, prior: critique, tools });
      const result = await ctx.spawn(critiqueAgent, phaseInput, { retries: 1, dedupe: "specHash",
        budget: { turns: HORIZON_STANDARD_LOOP_TURNS, microUsd: HORIZON_LOOP_MICRO_USD,
          wallMs: HORIZON_LOOP_WALL_MS }, attenuation: childAttenuation });
      planningRuns++; evidence.push(...result.toolEvidence); await commitPhase(ctx, "critique", input.revision, result, repairCycle);
      return result.artifact;
    };

    let rubric = await runRubric(null);
    let design = await runDesign(rubric, null);
    let workPlan = await runDecomposition(rubric, design, null);
    let assertions = await runAssertions(rubric, design, workPlan, []);
    let fingerprint = await planningFingerprint(rubric, design, workPlan, assertions);
    const seenFingerprints = new Set<string>([fingerprint]);

    for (;;) {
      critique = await runCritique(rubric, design, workPlan, assertions);
      if (critique.verdict !== "repair") break;
      const blocking = critique.findings.filter(({ severity }) => severity === "blocking");
      const userFinding = blocking.find(({ owner }) => owner === "user");
      if (userFinding) {
        critique = { ...critique, verdict: "needs-input", question: userFinding.issue };
        await ctx.commit({ kind: "horizon.planning-route", revision: input.revision,
          from: "repair", to: "needs-input", finding: userFinding.id }, { tier: "audit" });
        break;
      }
      if (repairCycle >= MAX_REPAIR_CYCLES) {
        critique = blockedCritique(input, "Planning repair exceeded its convergence safety ceiling."); break;
      }
      repairCycle++;
      const owners = new Set(blocking.map(({ owner }) => owner));
      if (owners.has("rubric")) rubric = await runRubric(rubric);
      if (owners.has("rubric") || owners.has("design")) design = await runDesign(rubric, design);
      if (owners.has("rubric") || owners.has("design") || owners.has("decomposition")) {
        workPlan = await runDecomposition(rubric, design, workPlan);
      }
      assertions = await runAssertions(rubric, design, workPlan, assertions);
      const nextFingerprint = await planningFingerprint(rubric, design, workPlan, assertions);
      if (seenFingerprints.has(nextFingerprint)) {
        critique = blockedCritique(input, "Planning repair returned to an already-observed artifact state.");
        await ctx.commit({ kind: "horizon.planning-plateau", revision: input.revision,
          repairCycle, fingerprint: nextFingerprint, critique }, { tier: "audit" });
        break;
      }
      seenFingerprints.add(nextFingerprint); fingerprint = nextFingerprint;
    }

    if (critique.verdict === "accepted" && !input.discoveryPlan.workspaceRoot) {
      critique = blockedCritique(input, "Planning converged without a governed materialized repository workspace.");
    }

    const finalizerInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan, assertions,
      prior: critique, critique, tools: [] });
    const finalized = await ctx.spawn(planFinalizer, finalizerInput, { retries: 1, dedupe: "specHash",
      budget: { turns: HORIZON_STANDARD_LOOP_TURNS, microUsd: HORIZON_LOOP_MICRO_USD,
        wallMs: HORIZON_LOOP_WALL_MS }, attenuation: { bindings: ["cas", "model"], tools: [] } });
    planningRuns++; await commitPhase(ctx, "finalization", input.revision, finalized, repairCycle);
    const expectedStatus = critique.verdict === "accepted" ? "ready"
      : critique.verdict === "needs-input" ? "needs-input" : "blocked";
    const plan = parseHzPlan({ ...finalized.artifact, object: "constal.horizon.plan",
      revision: input.revision, status: expectedStatus, objective: input.request.objective,
      workspaceRoot: input.discoveryPlan.workspaceRoot, steps: workPlan.steps, assertions,
      question: expectedStatus === "needs-input" ? critique.question : null,
      blockedReason: expectedStatus === "blocked" ? critique.blockedReason ?? critique.summary : null });
    if (!plan) throw new TypeError("Horizon finalization did not produce one valid immutable plan");
    if (plan.status !== expectedStatus || canonicalJson(plan.steps) !== canonicalJson(workPlan.steps)
      || canonicalJson(plan.assertions) !== canonicalJson(assertions)
      || plan.workspaceRoot !== input.discoveryPlan.workspaceRoot
      || expectedStatus === "needs-input" && plan.question !== critique.question) {
      throw new TypeError("Horizon finalization changed or misrepresented the converged planning artifacts");
    }
    return { plan, toolEvidence: evidence, planningRuns };
  },
});
