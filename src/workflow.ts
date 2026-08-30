import { canonicalJson, hashValue, type Ctx, type SpawnAttenuation } from "@constal/sdk";
import { storeArtifact } from "./artifacts.js";
import { parseHzRequest, type HzDiscoveryPlan, type HzInvestigationResult, type HzPlan, type HzPlanInput, type HzPlateauState, type HzRequest,
  type HzRunResult, type HzStepResult } from "./contracts.js";
import { discoveryFramer, executor, investigator, planner, reconciler, verifier } from "./tasks/index.js";
import { availableTools, bindingsForTools, DISCOVERY_TOOL_NAMES, EXECUTOR_TOOL_NAMES, INVESTIGATOR_TOOL_NAMES,
  PLANNER_TOOL_NAMES, RECONCILER_TOOL_NAMES, VERIFIER_TOOL_NAMES } from "./tools/index.js";

const MAX_PLAN_REVISIONS = 64;
const MAX_WORKFLOW_TRANSITIONS = 1_024;

function attenuation(names: readonly string[], ctx: Pick<Ctx, "resources">): SpawnAttenuation {
  return { bindings: bindingsForTools(names, ctx), tools: [...names].sort() };
}

function nextStep(plan: HzPlan, completed: readonly HzStepResult[]): HzPlan["steps"][number] | null {
  const done = new Set(completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
  return plan.steps.find(({ id, dependsOn }) => !done.has(id) && dependsOn.every((dependency) => done.has(dependency))) ?? null;
}

function updateCompleted(completed: HzStepResult[], result: HzStepResult, verified: boolean): HzStepResult[] {
  if (result.status !== "complete" || !verified) return completed;
  return [...completed.filter(({ stepId }) => stepId !== result.stepId), result];
}

export function reconcileCompletedForPlan(previous: HzPlan, next: HzPlan, completed: HzStepResult[]): {
  completed: HzStepResult[];
  invalidated: string[];
} {
  const previousSteps = new Map(previous.steps.map((step) => [step.id, step]));
  const nextSteps = new Map(next.steps.map((step) => [step.id, step]));
  const previousAssertions = new Map(previous.assertions.map((entry) => [entry.stepId, entry]));
  const nextAssertions = new Map(next.assertions.map((entry) => [entry.stepId, entry]));
  const invalidated: string[] = [];
  const retained = completed.filter((result) => {
    const nextStep = nextSteps.get(result.stepId);
    if (!nextStep) return true;
    const priorStep = previousSteps.get(result.stepId);
    const previousAssertion = previousAssertions.get(result.stepId); const nextAssertion = nextAssertions.get(result.stepId);
    const unchanged = priorStep !== undefined && canonicalJson({ step: priorStep,
      assertions: previousAssertion ? { stepId: previousAssertion.stepId, assertions: previousAssertion.assertions } : null })
      === canonicalJson({ step: nextStep,
        assertions: nextAssertion ? { stepId: nextAssertion.stepId, assertions: nextAssertion.assertions } : null });
    if (!unchanged) invalidated.push(result.stepId);
    return unchanged;
  });
  return { completed: retained, invalidated: [...new Set(invalidated)].sort() };
}

function unknownFrontier(unknowns: readonly HzPlan["unknowns"][number][]): unknown[] {
  return [...unknowns].sort((left, right) => left.id.localeCompare(right.id)).map((unknown) => ({
    id: unknown.id, question: unknown.question, state: unknown.state, resolution: unknown.resolution,
    evidence: [...unknown.evidence].sort(),
  }));
}

export async function attemptProgressDigest<V extends {
  verdict: string;
  checks: readonly { target: string; outcome: string }[];
  unknowns: HzPlan["unknowns"];
}>(input: {
  execution: HzStepResult;
  executionTools: readonly unknown[];
  verification: V;
  verificationTools: readonly unknown[];
}): Promise<string> {
  return hashValue({
    execution: { status: input.execution.status, changedFiles: [...input.execution.changedFiles].sort(),
      unknowns: unknownFrontier(input.execution.unknowns) },
    executionTools: input.executionTools,
    verification: { verdict: input.verification.verdict,
      checks: [...input.verification.checks].map(({ target, outcome }) => ({ target, outcome }))
        .sort((left, right) => left.target.localeCompare(right.target) || left.outcome.localeCompare(right.outcome)),
      unknowns: unknownFrontier(input.verification.unknowns) },
    verificationTools: input.verificationTools,
  });
}

async function progressState(previous: HzPlateauState, completed: readonly HzStepResult[], resultDigests: readonly string[],
  remainingUnknowns: readonly unknown[]): Promise<HzPlateauState> {
  const fingerprint = await hashValue({
    completed: completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId).sort(),
    resultDigests: [...new Set(resultDigests)].sort(),
    remainingUnknowns,
  });
  return { fingerprint, stableCycles: previous.fingerprint === fingerprint ? previous.stableCycles + 1 : 0 };
}

async function answerQuestion(question: string, revision: number, ctx: Ctx): Promise<string> {
  const response = await ctx.await<{ answer: string }>(`horizon-plan-${revision}`, {
    schema: { type: "object", properties: { answer: { type: "string", minLength: 1, maxLength: 65_536 } },
      required: ["answer"], additionalProperties: false },
    maxBytes: 65_536,
    afterRun: "ignore",
  });
  const answer = response.answer.trim();
  if (!answer) throw new TypeError("Horizon question was resolved without an answer");
  await ctx.commit({ kind: "horizon.answer", revision, question, answer }, { tier: "audit" });
  return answer;
}

function questionKey(question: string, unknowns: readonly HzPlan["unknowns"][number][]): string {
  const ids = unknowns.filter(({ state }) => state === "needs-input").map(({ id }) => id).sort();
  return ids.length > 0 ? `unknowns:${ids.join("|")}` : `question:${question.trim()}`;
}

async function packageWorkspace(plan: HzPlan, ctx: Ctx): Promise<{ artifact: HzRunResult["artifact"]; error: string | null }> {
  if (!plan.workspaceRoot || !ctx.resources.sandbox) return { artifact: null, error: "A governed workspace is unavailable." };
  try {
    const selected = await ctx.sandboxPool(ctx.resources.sandbox).createSandbox(ctx.run.agent.crn, ctx.run.session);
    const output = "/workspace/.constal/horizon-final.tar.gz";
    const mkdir = await Promise.resolve(selected.exec({ cmd: "mkdir", args: ["-p", "/workspace/.constal"],
      cwd: "/workspace", timeoutMs: 600_000 }, { timeoutMs: 600_000 }));
    if (mkdir.status !== "completed" || mkdir.exitCode !== 0) {
      return { artifact: null, error: `Artifact directory creation failed (${mkdir.status}, exit ${mkdir.exitCode ?? "unknown"}).` };
    }
    const packed = await Promise.resolve(selected.exec({ cmd: "tar", args: ["-czf", output, "--", "."],
      cwd: plan.workspaceRoot, outputs: [output], timeoutMs: 600_000 }, { timeoutMs: 600_000 }));
    if (packed.status !== "completed" || packed.exitCode !== 0) {
      return { artifact: null, error: `Workspace packaging failed (${packed.status}, exit ${packed.exitCode ?? "unknown"}).` };
    }
    const artifact = packed.outputs.find(({ path }) => path === output);
    return artifact
      ? { artifact: { ref: artifact.ref, bytes: artifact.bytes, path: artifact.path }, error: null }
      : { artifact: null, error: "Workspace packaging completed without its declared artifact." };
  } catch (error) {
    return { artifact: null, error: error instanceof Error ? error.message.slice(0, 4_096) : "Workspace packaging failed." };
  }
}

function blockedResult(plan: HzPlan, planFact: string, completed: HzStepResult[], summary: string,
  remainingUnknowns = plan.unknowns, specialistRuns = 0, replans = 0, plateauCycles = 0): HzRunResult {
  return {
    object: "constal.horizon.result", version: 1, status: "blocked", summary,
    plan: { revision: plan.revision, fact: planFact },
    completedSteps: completed.map(({ stepId, status, summary: stepSummary }) => ({ id: stepId, status, summary: stepSummary })),
    remainingUnknowns, artifact: null,
    longHorizon: { durablePlan: true, specialistRuns, replans, plateauCycles },
  };
}

async function planRevision(input: HzPlanInput, ctx: Ctx): Promise<{ plan: HzPlan; fact: string; planningRuns: number }> {
  const tools = availableTools(PLANNER_TOOL_NAMES, ctx);
  const planningInput = await storeArtifact(ctx, { ...input, tools });
  const baseAttenuation = attenuation(tools, ctx);
  const plannerAttenuation = { ...baseAttenuation,
    bindings: [...new Set([...baseAttenuation.bindings, "cas"])].sort() };
  const result = await ctx.spawn(planner, planningInput, {
    retries: 1, dedupe: "specHash", budget: { turns: 64, microUsd: 100_000_000, wallMs: 14_400_000 },
    attenuation: plannerAttenuation,
  });
  const fact = await ctx.commit({ kind: "horizon.plan", plan: result.plan,
    previousRevision: input.previousPlan?.revision ?? null, toolEvidence: result.toolEvidence }, { tier: "audit" });
  return { plan: result.plan, fact: fact.hash, planningRuns: result.planningRuns };
}

async function discover(request: HzRequest, ctx: Ctx): Promise<{
  discoveryPlan: HzDiscoveryPlan;
  investigations: HzInvestigationResult[];
  specialistRuns: number;
}> {
  const discoveryTools = availableTools(DISCOVERY_TOOL_NAMES, ctx);
  const framed = await ctx.spawn(discoveryFramer, { request, tools: discoveryTools }, {
    retries: 1, dedupe: "specHash", budget: { turns: 32, microUsd: 12_000_000, wallMs: 3_600_000 },
    attenuation: attenuation(discoveryTools, ctx),
  });
  const discoveryFact = await ctx.commit({ kind: "horizon.discovery-plan", discoveryPlan: framed.discoveryPlan,
    toolEvidence: framed.toolEvidence }, { tier: "audit" });
  const investigationTools = availableTools(INVESTIGATOR_TOOL_NAMES, ctx);
  const handles = framed.discoveryPlan.focuses.map((focus) => ({ focus, handle: ctx.spawn(investigator, {
    request, discoveryPlan: framed.discoveryPlan, focus, tools: investigationTools,
  }, {
    retries: 1, dedupe: "specHash", budget: { turns: 32, microUsd: 8_000_000, wallMs: 3_600_000 },
    attenuation: attenuation(investigationTools, ctx),
  }) }));
  const investigations: HzInvestigationResult[] = [];
  for (const { focus, handle } of handles) {
    const result = await Promise.resolve(handle);
    investigations.push(result.investigation);
    await ctx.commit({ kind: "horizon.investigation", discoveryFact: discoveryFact.hash,
      focus: focus.id, investigation: result.investigation, toolEvidence: result.toolEvidence }, { tier: "audit" });
  }
  return { discoveryPlan: framed.discoveryPlan, investigations, specialistRuns: 1 + investigations.length };
}

export async function runHorizon(message: unknown, ctx: Ctx): Promise<HzRunResult> {
  const request: HzRequest = parseHzRequest(message);
  await ctx.commit({ kind: "horizon.request", request }, { tier: "audit" });
  let completed: HzStepResult[] = [];
  let resultDigests: string[] = [];
  let remainingUnknowns = [] as HzPlan["unknowns"];
  let plateau: HzPlateauState = { fingerprint: null, stableCycles: 0 };
  let specialistRuns = 0; let replans = 0; let transitions = 0; let answer: string | null = null;
  const answeredQuestions = new Map<string, string>();

  const discovery = await discover(request, ctx);
  specialistRuns += discovery.specialistRuns;
  let current = await planRevision({ request, discoveryPlan: discovery.discoveryPlan,
    investigations: discovery.investigations, revision: 1, previousPlan: null,
    completed, replanBrief: null, answer, tools: [] }, ctx);
  remainingUnknowns = current.plan.unknowns;
  specialistRuns += current.planningRuns;

  while (transitions++ < MAX_WORKFLOW_TRANSITIONS) {
    if (current.plan.status === "blocked") {
      return blockedResult(current.plan, current.fact, completed, current.plan.blockedReason ?? current.plan.summary,
        current.plan.unknowns, specialistRuns, replans, plateau.stableCycles);
    }
    if (current.plan.status === "needs-input") {
      if (current.plan.revision >= MAX_PLAN_REVISIONS) {
        return blockedResult(current.plan, current.fact, completed, "Horizon reached its immutable plan revision safety ceiling while user decisions remained open.",
          current.plan.unknowns, specialistRuns, replans, plateau.stableCycles);
      }
      const key = questionKey(current.plan.question!, current.plan.unknowns);
      if (answeredQuestions.has(key)) {
        return blockedResult(current.plan, current.fact, completed,
          "Horizon stopped because planning requested a user decision that this Run already resolved.",
          current.plan.unknowns, specialistRuns, replans, plateau.stableCycles);
      }
      answer = await answerQuestion(current.plan.question!, current.plan.revision, ctx);
      answeredQuestions.set(key, answer);
      const previous = current.plan;
      const next = await planRevision({ request, discoveryPlan: discovery.discoveryPlan, investigations: discovery.investigations,
        revision: previous.revision + 1, previousPlan: previous, completed,
        replanBrief: "Reconcile the user answer with the prior immutable plan.", answer, tools: [] }, ctx);
      const reconciled = reconcileCompletedForPlan(previous, next.plan, completed);
      if (reconciled.invalidated.length > 0) await ctx.commit({ kind: "horizon.plan-invalidation",
        previousPlanFact: current.fact, nextPlanFact: next.fact, steps: reconciled.invalidated }, { tier: "audit" });
      completed = reconciled.completed; current = next; remainingUnknowns = current.plan.unknowns;
      specialistRuns += current.planningRuns; replans++;
      continue;
    }

    const step = nextStep(current.plan, completed);
    if (!step) {
      const done = new Set(completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
      if (current.plan.steps.every(({ id }) => done.has(id))) {
        const packaged = await packageWorkspace(current.plan, ctx);
        if (!packaged.artifact) {
          await ctx.commit({ kind: "horizon.package-failed", planFact: current.fact,
            reason: packaged.error ?? "Workspace packaging failed." }, { tier: "audit" });
          return blockedResult(current.plan, current.fact, completed,
            `Every work unit passed independent verification, but Horizon could not create the immutable final artifact: ${packaged.error ?? "unknown packaging failure"}`,
            remainingUnknowns, specialistRuns, replans, plateau.stableCycles);
        }
        const result: HzRunResult = {
          object: "constal.horizon.result", version: 1, status: "complete", summary: current.plan.summary,
          plan: { revision: current.plan.revision, fact: current.fact },
          completedSteps: completed.map(({ stepId, status, summary }) => ({ id: stepId, status, summary })),
          remainingUnknowns: remainingUnknowns.filter(({ state }) => !["resolved", "assumed"].includes(state)),
          artifact: packaged.artifact,
          longHorizon: { durablePlan: true, specialistRuns, replans, plateauCycles: plateau.stableCycles },
        };
        const final = await ctx.commit({ kind: "horizon.result", result }, { tier: "audit" });
        return { ...result, summary: `${result.summary}\n\nDurable result: ${final.hash}` };
      }
      return blockedResult(current.plan, current.fact, completed, "No dependency-ready Horizon work unit remains; the immutable plan requires reconciliation.",
        current.plan.unknowns, specialistRuns, replans, plateau.stableCycles);
    }

    const executorTools = availableTools(EXECUTOR_TOOL_NAMES, ctx);
    const executed = await ctx.spawn(executor, { request, plan: current.plan, planFact: current.fact, step, completed,
      tools: executorTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: 44, microUsd: 20_000_000, wallMs: 7_200_000 },
      attenuation: attenuation(executorTools, ctx),
    });
    specialistRuns++;
    const stepFact = await ctx.commit({ kind: "horizon.step-result", planFact: current.fact, result: executed.result,
      toolEvidence: executed.toolEvidence }, { tier: "audit" });
    const verifierTools = availableTools(VERIFIER_TOOL_NAMES, ctx);
    const verified = await ctx.spawn(verifier, { request, plan: current.plan, planFact: current.fact, step,
      execution: executed.result, tools: verifierTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: 24, microUsd: 8_000_000, wallMs: 3_600_000 },
      attenuation: attenuation(verifierTools, ctx),
    });
    specialistRuns++;
    const verificationFact = await ctx.commit({ kind: "horizon.verification", planFact: current.fact,
      stepFact: stepFact.hash, verification: verified.verification, toolEvidence: verified.toolEvidence }, { tier: "audit" });
    const resultDigest = await attemptProgressDigest({ execution: executed.result,
      executionTools: executed.toolEvidence, verification: verified.verification,
      verificationTools: verified.toolEvidence });
    resultDigests = [...new Set([...resultDigests, resultDigest])];
    completed = updateCompleted(completed, executed.result, verified.verification.verdict === "passed");

    plateau = await progressState(plateau, completed, resultDigests,
      [...executed.result.unknowns, ...verified.verification.unknowns]);
    await ctx.commit({ kind: "horizon.progress", planFact: current.fact, step: step.id,
      verificationFact: verificationFact.hash, plateau }, { tier: "audit" });

    const reconcilerTools = availableTools(RECONCILER_TOOL_NAMES, ctx);
    const reconciled = await ctx.spawn(reconciler, { request, plan: current.plan, planFact: current.fact,
      completed, latest: executed.result, verification: verified.verification, plateau, tools: reconcilerTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: 12, microUsd: 5_000_000, wallMs: 1_800_000 },
      attenuation: attenuation(reconcilerTools, ctx),
    });
    specialistRuns++;
    await ctx.commit({ kind: "horizon.reconciliation", planFact: current.fact, stepFact: stepFact.hash,
      verificationFact: verificationFact.hash, reconciliation: reconciled.reconciliation,
      toolEvidence: reconciled.toolEvidence }, { tier: "audit" });

    const decision = reconciled.reconciliation;
    remainingUnknowns = decision.remainingUnknowns;
    if (plateau.stableCycles >= 2 && (decision.action === "continue" || decision.action === "replan")) {
      await ctx.commit({ kind: "horizon.plateau", planFact: current.fact, step: step.id,
        stableCycles: plateau.stableCycles, fingerprint: plateau.fingerprint,
        attemptedTransition: decision.action, remainingUnknowns }, { tier: "audit" });
      return blockedResult(current.plan, current.fact, completed,
        "Horizon stopped after repeated execution and verification produced no new evidence or resolved uncertainty.",
        remainingUnknowns, specialistRuns, replans, plateau.stableCycles);
    }
    if (decision.action === "continue") continue;
    if (decision.action === "blocked") {
      return blockedResult(current.plan, current.fact, completed, decision.blockedReason ?? decision.summary,
        decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles);
    }
    if (decision.action === "complete") continue;
    if (current.plan.revision >= MAX_PLAN_REVISIONS) {
      return blockedResult(current.plan, current.fact, completed, "Horizon reached its immutable plan revision safety ceiling.",
        decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles);
    }
    if (decision.action === "ask") {
      const key = questionKey(decision.question!, decision.remainingUnknowns);
      if (answeredQuestions.has(key)) {
        return blockedResult(current.plan, current.fact, completed,
          "Horizon stopped because reconciliation requested a user decision that this Run already resolved.",
          decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles);
      }
      answer = await answerQuestion(decision.question!, current.plan.revision, ctx);
      answeredQuestions.set(key, answer);
    }
    const previous = current.plan;
    const next = await planRevision({ request, discoveryPlan: discovery.discoveryPlan, investigations: discovery.investigations,
      revision: previous.revision + 1, previousPlan: previous, completed,
      replanBrief: decision.replanBrief ?? decision.summary, answer, tools: [] }, ctx);
    const planReconciliation = reconcileCompletedForPlan(previous, next.plan, completed);
    if (planReconciliation.invalidated.length > 0) await ctx.commit({ kind: "horizon.plan-invalidation",
      previousPlanFact: current.fact, nextPlanFact: next.fact, steps: planReconciliation.invalidated }, { tier: "audit" });
    completed = planReconciliation.completed; current = next; remainingUnknowns = current.plan.unknowns;
    specialistRuns += current.planningRuns; replans++;
  }
  return blockedResult(current.plan, current.fact, completed, "Horizon reached its durable workflow transition safety ceiling.",
    current.plan.unknowns, specialistRuns, replans, plateau.stableCycles);
}
