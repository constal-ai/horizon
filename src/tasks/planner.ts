import { canonicalJson, hashValue, subtask, type Ctx, type Handle, type SpawnAttenuation } from "@constal/sdk";
import { loadArtifact, storeArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzMilestoneWork, parseHzPlan, parseHzWorkPlan, type HzCritiqueFinding, type HzCritiqueOwner, type HzDesign,
  type HzMilestone, type HzPlanContinuity, type HzPlanCritique, type HzPlanInput, type HzPlannerResult, type HzPlanningOwner,
  type HzPlanningState, type HzRubric,
  type HzStepAssertions, type HzToolEvidence, type HzWorkPlan } from "../contracts.js";
import { bindingsForTools } from "../tools/index.js";
import { HORIZON_LOOP_MICRO_USD, HORIZON_LOOP_WALL_MS, HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";
import { assertionAgent, assertionPlanRepairAgent, continuityAgent, critiqueAgent, decompositionAgent, designAgent, planFinalizer, rubricAgent,
  workPlanRepairAgent,
  type PlanningPhaseResult } from "./planning-phases.js";

const PLATEAU_CONFIRMATIONS = 2;
type RepairOwner = Exclude<HzCritiqueOwner, "user">;
const REPAIR_ORDER: readonly RepairOwner[] = ["rubric", "design", "decomposition", "assertions", "continuity"];

function attenuation(tools: readonly string[], ctx: Pick<Ctx, "resources">): SpawnAttenuation {
  return { bindings: [...new Set([...bindingsForTools(tools, ctx), "cas"])].sort(), tools: [...tools].sort() };
}

function blockedCritique(input: HzPlanInput, summary: string): HzPlanCritique {
  return { object: "constal.horizon.plan-critique", version: 1, revision: input.revision,
    verdict: "blocked", summary, findings: [], question: null, blockedReason: summary };
}

function planningFingerprint(rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
  assertions: HzStepAssertions[], continuity: HzPlanContinuity | null = null): Promise<string> {
  return hashValue({ rubric, design, workPlan,
    assertions: [...assertions].sort((left, right) => left.stepId.localeCompare(right.stepId)), continuity });
}

function emptyContinuity(revision: number): HzPlanContinuity {
  return { object: "constal.horizon.plan-continuity", version: 1, revision, decisions: [] };
}

function executionCritique(input: HzPlanInput, owner: HzPlanningOwner): HzPlanCritique {
  const attempt = input.executionEvidence;
  if (!input.replanBrief) throw new TypeError("Phase-local replanning requires a correction brief");
  const step = attempt ? input.previousState?.workPlan.steps.find(({ id }) => id === attempt.stepId) : null;
  return { object: "constal.horizon.plan-critique", version: 1, revision: input.revision, verdict: "repair",
    summary: input.replanBrief, findings: [{ owner, severity: "blocking",
      affectedMilestones: step ? [step.milestoneId] : [], affectedSteps: step ? [step.id] : [],
      issue: input.replanBrief, evidence: attempt ? [attempt.stepFact, attempt.verificationFact] : [], repair: input.replanBrief }],
    question: null, blockedReason: null };
}

function rebasePlanningArtifacts(state: HzPlanningState, revision: number): {
  rubric: HzRubric; design: HzDesign; workPlan: HzWorkPlan; assertions: HzStepAssertions[];
} {
  return {
    rubric: { ...state.rubric, revision }, design: { ...state.design, revision },
    workPlan: { ...state.workPlan, revision },
    assertions: state.assertions.map((assertion) => ({ ...assertion, revision })),
  };
}

function earliestRepairOwner(findings: readonly HzCritiqueFinding[]): RepairOwner | null {
  return REPAIR_ORDER.find((owner) => findings.some((finding) => finding.owner === owner)) ?? null;
}

function repairFindingKey(finding: HzCritiqueFinding): string {
  const milestones = [...finding.affectedMilestones].sort();
  const steps = [...finding.affectedSteps].sort();
  const scope = milestones.length > 0 || steps.length > 0
    ? canonicalJson({ milestones, steps }) : "global";
  return `${finding.owner}:${scope}`;
}

function critiqueForOwner(critique: HzPlanCritique, owner: RepairOwner): HzPlanCritique {
  return { ...critique, findings: critique.findings.filter((finding) => finding.owner === owner) };
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
  version: "13",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<HzPlanInput>(ctx, envelope);
    const tools = input.tools; const childAttenuation = attenuation(tools, ctx);
    const evidence: HzToolEvidence[] = []; let planningRuns = 1; let repairCycle = 0;
    let critique: HzPlanCritique | null = null;
    const repairAttempts = new Map<string, number>();

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
    const runWorkPlanRepair = async (rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
      repairCritique: HzPlanCritique): Promise<HzWorkPlan> => {
      const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan,
        critique: repairCritique, tools });
      const result = await ctx.spawn(workPlanRepairAgent, phaseInput, {
        retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
          microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
        attenuation: childAttenuation,
      });
      planningRuns++; evidence.push(...result.toolEvidence);
      await commitPhase(ctx, "repair:work-plan", input.revision, result, repairCycle);
      return result.artifact;
    };
    const runAssertionPlanRepair = async (rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
      assertions: HzStepAssertions[], repairCritique: HzPlanCritique): Promise<HzStepAssertions[]> => {
      const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan,
        assertions, critique: repairCritique, tools });
      const result = await ctx.spawn(assertionPlanRepairAgent, phaseInput, {
        retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
          microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
        attenuation: childAttenuation,
      });
      planningRuns++; evidence.push(...result.toolEvidence);
      await commitPhase(ctx, "repair:assertions", input.revision, result, repairCycle);
      return result.artifact.assertions;
    };
    const runContinuity = async (rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
      assertions: HzStepAssertions[], repairCritique: HzPlanCritique): Promise<HzPlanContinuity> => {
      if (input.completed.length === 0) return emptyContinuity(input.revision);
      const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan,
        assertions, critique: repairCritique, tools: [] });
      const result = await ctx.spawn(continuityAgent, phaseInput, {
        retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
          microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
        attenuation: { bindings: ["cas", "model"], tools: [] },
      });
      planningRuns++; evidence.push(...result.toolEvidence);
      await commitPhase(ctx, "continuity", input.revision, result, repairCycle);
      return result.artifact;
    };
    const runCritique = async (rubric: HzRubric, design: HzDesign, workPlan: HzWorkPlan,
      assertions: HzStepAssertions[], continuity: HzPlanContinuity,
      stage: "structure" | "complete"): Promise<HzPlanCritique> => {
      const phaseInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan,
        assertions, continuity, critiqueStage: stage, prior: critique, tools });
      const result = await ctx.spawn(critiqueAgent, phaseInput, { retries: 1, dedupe: "specHash",
        budget: { turns: HORIZON_STANDARD_LOOP_TURNS, microUsd: HORIZON_LOOP_MICRO_USD,
          wallMs: HORIZON_LOOP_WALL_MS }, attenuation: childAttenuation });
      planningRuns++; evidence.push(...result.toolEvidence); await commitPhase(ctx, `critique:${stage}`, input.revision, result, repairCycle);
      return result.artifact;
    };

    const beginRepair = (owner: RepairOwner, findings: readonly HzCritiqueFinding[]): {
      findingKeys: string[]; attempts: Record<string, number>;
    } | null => {
      const owned = findings.filter((finding) => finding.owner === owner);
      const findingKeys = [...new Set(owned.map(repairFindingKey))].sort();
      if (findingKeys.some((key) => (repairAttempts.get(key) ?? 0) >= PLATEAU_CONFIRMATIONS)) return null;
      const attempts: Record<string, number> = {};
      for (const key of findingKeys) {
        const attempt = (repairAttempts.get(key) ?? 0) + 1;
        repairAttempts.set(key, attempt); attempts[key] = attempt;
      }
      return { findingKeys, attempts };
    };

    const commitRepair = async (stage: "structure" | "complete", owner: RepairOwner,
      repair: NonNullable<ReturnType<typeof beginRepair>>, beforeHash: string, afterHash: string): Promise<void> => {
      await ctx.commit({ kind: "horizon.planning-repair", revision: input.revision, stage, repairCycle, owner,
        findingKeys: repair.findingKeys, attempts: repair.attempts,
        beforeHash, afterHash }, { tier: "audit" });
    };

    const commitPlateau = async (stage: "structure" | "complete", reason: string,
      findingKeys: string[], fingerprint: string): Promise<void> => {
      await ctx.commit({ kind: "horizon.planning-plateau", revision: input.revision, stage,
        repairCycle, findingKeys, fingerprint, reason }, { tier: "audit" });
    };

    let rubric: HzRubric; let design: HzDesign; let workPlan: HzWorkPlan;
    let assertions: HzStepAssertions[] = []; let continuity = emptyContinuity(input.revision);
    if (!input.previousState) {
      if (input.restartAt !== null || input.executionEvidence !== null) {
        throw new TypeError("Initial planning cannot begin from an execution repair owner");
      }
      rubric = await runRubric(null); design = await runDesign(rubric, null);
      workPlan = await runDecomposition(rubric, design, null);
    } else {
      if (!input.previousPlan || input.previousState.revision !== input.previousPlan.revision || !input.restartAt) {
        throw new TypeError("Replanning requires the previous immutable planning state and one owning layer");
      }
      ({ rubric, design, workPlan, assertions } = rebasePlanningArtifacts(input.previousState, input.revision));
      critique = executionCritique(input, input.restartAt);
      if (input.restartAt === "rubric") {
        rubric = await runRubric(rubric); design = await runDesign(rubric, design);
        workPlan = await runDecomposition(rubric, design, null); assertions = [];
      } else if (input.restartAt === "design") {
        design = await runDesign(rubric, design); workPlan = await runDecomposition(rubric, design, null); assertions = [];
      } else if (input.restartAt === "decomposition") {
        workPlan = await runWorkPlanRepair(rubric, design, workPlan, critique); assertions = [];
      } else {
        assertions = await runAssertionPlanRepair(rubric, design, workPlan, assertions, critique);
      }
      await ctx.commit({ kind: "horizon.execution-replan-entry", revision: input.revision,
        owner: input.restartAt, attempt: input.executionEvidence?.id ?? null,
        stepFact: input.executionEvidence?.stepFact ?? null,
        verificationFact: input.executionEvidence?.verificationFact ?? null }, { tier: "audit" });
    }

    const seenFingerprints = new Set<string>([await planningFingerprint(rubric, design, workPlan, [])]);

    // Reconcile architecture, scope, proportionality, and work boundaries
    // before multiplying the plan into one assertion Agent per work unit.
    for (;;) {
      critique = await runCritique(rubric, design, workPlan, [], emptyContinuity(input.revision), "structure");
      if (critique.verdict !== "repair") break;
      const blocking = critique.findings.filter(({ severity }) => severity === "blocking");
      const userFinding = blocking.find(({ owner }) => owner === "user");
      if (userFinding) {
        if (!critique.question) throw new TypeError("A user-owned planning finding requires one structured decision question");
        critique = { ...critique, verdict: "needs-input" };
        await ctx.commit({ kind: "horizon.planning-route", revision: input.revision,
          from: "repair", to: "needs-input", finding: repairFindingKey(userFinding) }, { tier: "audit" });
        break;
      }
      if (blocking.some(({ owner }) => owner === "assertions" || owner === "continuity")) {
        critique = blockedCritique(input, "Structural critique required repair of an artifact that does not exist at this stage."); break;
      }
      const owner = earliestRepairOwner(blocking);
      if (!owner) throw new TypeError("Structural critique did not identify a repairable planning owner");
      const findingKeys = [...new Set(blocking.filter((finding) => finding.owner === owner).map(repairFindingKey))].sort();
      const repair = beginRepair(owner, blocking);
      if (!repair) {
        const reason = `Structural planning did not converge after ${PLATEAU_CONFIRMATIONS} repairs of the same ${owner} scope.`;
        critique = blockedCritique(input, reason);
        await commitPlateau("structure", reason, findingKeys, await planningFingerprint(rubric, design, workPlan, []));
        break;
      }
      const beforeHash = await planningFingerprint(rubric, design, workPlan, []);
      repairCycle++;
      if (owner === "rubric") {
        rubric = await runRubric(rubric); design = await runDesign(rubric, design);
        workPlan = await runDecomposition(rubric, design, null);
      } else if (owner === "design") {
        design = await runDesign(rubric, design); workPlan = await runDecomposition(rubric, design, null);
      } else if (owner === "decomposition") {
        workPlan = await runWorkPlanRepair(rubric, design, workPlan, critiqueForOwner(critique, owner));
      } else {
        throw new TypeError("Structural critique cannot route to assertion or continuity repair");
      }
      const nextFingerprint = await planningFingerprint(rubric, design, workPlan, []);
      await commitRepair("structure", owner, repair, beforeHash, nextFingerprint);
      if (seenFingerprints.has(nextFingerprint)) {
        const reason = "Structural planning repair returned to an already-observed artifact state.";
        critique = blockedCritique(input, reason);
        await commitPlateau("structure", reason, repair.findingKeys, nextFingerprint);
        break;
      }
      seenFingerprints.add(nextFingerprint);
    }

    if (critique.verdict === "accepted" && assertions.length === 0) {
      assertions = await runAssertions(rubric, design, workPlan, []);
    }
    if (critique.verdict === "accepted") {
      continuity = await runContinuity(rubric, design, workPlan, assertions, critique);
    }
    seenFingerprints.add(await planningFingerprint(rubric, design, workPlan, assertions, continuity));

    if (critique.verdict === "accepted") for (;;) {
      critique = await runCritique(rubric, design, workPlan, assertions, continuity, "complete");
      if (critique.verdict !== "repair") break;
      const blocking = critique.findings.filter(({ severity }) => severity === "blocking");
      const userFinding = blocking.find(({ owner }) => owner === "user");
      if (userFinding) {
        if (!critique.question) throw new TypeError("A user-owned planning finding requires one structured decision question");
        critique = { ...critique, verdict: "needs-input" };
        await ctx.commit({ kind: "horizon.planning-route", revision: input.revision,
          from: "repair", to: "needs-input", finding: repairFindingKey(userFinding) }, { tier: "audit" });
        break;
      }
      const owner = earliestRepairOwner(blocking);
      if (!owner) throw new TypeError("Complete critique did not identify a repairable planning owner");
      const findingKeys = [...new Set(blocking.filter((finding) => finding.owner === owner).map(repairFindingKey))].sort();
      const repair = beginRepair(owner, blocking);
      if (!repair) {
        const reason = `Planning did not converge after ${PLATEAU_CONFIRMATIONS} repairs of the same ${owner} scope.`;
        critique = blockedCritique(input, reason);
        await commitPlateau("complete", reason, findingKeys,
          await planningFingerprint(rubric, design, workPlan, assertions, continuity));
        break;
      }
      const beforeHash = await planningFingerprint(rubric, design, workPlan, assertions, continuity);
      repairCycle++;
      if (owner === "rubric") {
        rubric = await runRubric(rubric); design = await runDesign(rubric, design);
        workPlan = await runDecomposition(rubric, design, null);
        assertions = await runAssertions(rubric, design, workPlan, []);
        continuity = await runContinuity(rubric, design, workPlan, assertions, critique);
      } else if (owner === "design") {
        design = await runDesign(rubric, design); workPlan = await runDecomposition(rubric, design, null);
        assertions = await runAssertions(rubric, design, workPlan, []);
        continuity = await runContinuity(rubric, design, workPlan, assertions, critique);
      } else if (owner === "decomposition") {
        workPlan = await runWorkPlanRepair(rubric, design, workPlan, critiqueForOwner(critique, owner));
        assertions = await runAssertions(rubric, design, workPlan, []);
        continuity = await runContinuity(rubric, design, workPlan, assertions, critique);
      } else if (owner === "assertions") {
        assertions = await runAssertionPlanRepair(rubric, design, workPlan, assertions,
          critiqueForOwner(critique, owner));
        continuity = await runContinuity(rubric, design, workPlan, assertions, critique);
      } else {
        continuity = await runContinuity(rubric, design, workPlan, assertions, critiqueForOwner(critique, owner));
      }
      const nextFingerprint = await planningFingerprint(rubric, design, workPlan, assertions, continuity);
      await commitRepair("complete", owner, repair, beforeHash, nextFingerprint);
      if (seenFingerprints.has(nextFingerprint)) {
        const reason = "Planning repair returned to an already-observed artifact state.";
        critique = blockedCritique(input, reason);
        await commitPlateau("complete", reason, repair.findingKeys, nextFingerprint);
        break;
      }
      seenFingerprints.add(nextFingerprint);
    }

    if (critique.verdict === "accepted" && !input.discoveryPlan.workspaceRoot) {
      critique = blockedCritique(input, "Planning converged without a governed materialized repository workspace.");
    }

    const finalizerInput = await storeArtifact(ctx, { planning: input, rubric, design, workPlan, assertions, continuity,
      critiqueStage: "complete", prior: critique, critique, tools: [] });
    const finalized = await ctx.spawn(planFinalizer, finalizerInput, { retries: 1, dedupe: "specHash",
      budget: { turns: HORIZON_STANDARD_LOOP_TURNS, microUsd: HORIZON_LOOP_MICRO_USD,
        wallMs: HORIZON_LOOP_WALL_MS }, attenuation: { bindings: ["cas", "model"], tools: [] } });
    planningRuns++; await commitPhase(ctx, "finalization", input.revision, finalized, repairCycle);
    const expectedStatus = critique.verdict === "accepted" ? "ready"
      : critique.verdict === "needs-input" ? "needs-input" : "blocked";
    const plan = parseHzPlan({ ...finalized.artifact, object: "constal.horizon.plan", version: 1,
      revision: input.revision, status: expectedStatus, objective: input.request.objective,
      workspaceRoot: input.discoveryPlan.workspaceRoot, steps: workPlan.steps, assertions,
      question: expectedStatus === "needs-input" ? critique.question : null,
      blockedReason: expectedStatus === "blocked" ? critique.blockedReason ?? critique.summary : null });
    if (!plan) throw new TypeError("Horizon finalization did not produce one valid immutable plan");
    if (plan.status !== expectedStatus || canonicalJson(plan.steps) !== canonicalJson(workPlan.steps)
      || canonicalJson(plan.assertions) !== canonicalJson(assertions)
      || plan.workspaceRoot !== input.discoveryPlan.workspaceRoot
      || expectedStatus === "needs-input" && canonicalJson(plan.question) !== canonicalJson(critique.question)) {
      throw new TypeError("Horizon finalization changed or misrepresented the converged planning artifacts");
    }
    const state: HzPlanningState = { object: "constal.horizon.planning-state", version: 1,
      revision: input.revision, rubric, design, workPlan, assertions, continuity, critique };
    return { plan, state, toolEvidence: evidence, planningRuns };
  },
});
