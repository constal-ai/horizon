import { hashValue, type Ctx, type SpawnAttenuation } from "@constal/sdk";
import { parseHzRequest, type HzPlan, type HzPlanInput, type HzPlateauState, type HzRequest,
  type HzRunResult, type HzStepResult } from "./contracts.js";
import { executor, planner, reconciler } from "./tasks/index.js";
import { availableTools, bindingsForTools, EXECUTOR_TOOL_NAMES, PLANNER_TOOL_NAMES, RECONCILER_TOOL_NAMES } from "./tools/index.js";

const MAX_PLAN_REVISIONS = 8;
const MAX_WORKFLOW_TRANSITIONS = 384;

function attenuation(names: readonly string[], ctx: Pick<Ctx, "resources">): SpawnAttenuation {
  return { bindings: bindingsForTools(names, ctx), tools: [...names].sort() };
}

function nextStep(plan: HzPlan, completed: readonly HzStepResult[]): HzPlan["steps"][number] | null {
  const done = new Set(completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
  return plan.steps.find(({ id, dependsOn }) => !done.has(id) && dependsOn.every((dependency) => done.has(dependency))) ?? null;
}

function updateCompleted(completed: HzStepResult[], result: HzStepResult): HzStepResult[] {
  if (result.status !== "complete") return completed;
  return [...completed.filter(({ stepId }) => stepId !== result.stepId), result];
}

async function progressState(previous: HzPlateauState, completed: readonly HzStepResult[], evidenceFacts: readonly string[],
  remainingUnknowns: readonly unknown[]): Promise<HzPlateauState> {
  const fingerprint = await hashValue({
    completed: completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId).sort(),
    evidenceFacts: [...new Set(evidenceFacts)].sort(),
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

async function packageWorkspace(plan: HzPlan, ctx: Ctx): Promise<HzRunResult["artifact"]> {
  if (!plan.workspaceRoot || !ctx.resources.sandbox) return null;
  const selected = await ctx.sandboxPool(ctx.resources.sandbox).createSandbox(ctx.run.agent.crn, ctx.run.session);
  const output = "/workspace/.constal/horizon-final.tar.gz";
  const mkdir = await Promise.resolve(selected.exec({ cmd: "mkdir", args: ["-p", "/workspace/.constal"],
    cwd: "/workspace", timeoutMs: 600_000 }, { timeoutMs: 600_000 }));
  if (mkdir.status !== "completed" || mkdir.exitCode !== 0) return null;
  const packed = await Promise.resolve(selected.exec({ cmd: "tar", args: ["-czf", output, "--", "."],
    cwd: plan.workspaceRoot, outputs: [output], timeoutMs: 600_000 }, { timeoutMs: 600_000 }));
  if (packed.status !== "completed" || packed.exitCode !== 0) return null;
  const artifact = packed.outputs.find(({ path }) => path === output);
  return artifact ? { ref: artifact.ref, bytes: artifact.bytes, path: artifact.path } : null;
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

async function planRevision(input: HzPlanInput, ctx: Ctx): Promise<{ plan: HzPlan; fact: string }> {
  const tools = availableTools(PLANNER_TOOL_NAMES, ctx);
  const result = await ctx.spawn(planner, { ...input, tools }, {
    retries: 1, dedupe: "specHash", budget: { turns: 36, microUsd: 15_000_000, wallMs: 3_600_000 },
    attenuation: attenuation(tools, ctx),
  });
  const fact = await ctx.commit({ kind: "horizon.plan", plan: result.plan,
    previousRevision: input.previousPlan?.revision ?? null, toolEvidence: result.toolEvidence }, { tier: "audit" });
  return { plan: result.plan, fact: fact.hash };
}

export async function runHorizon(message: unknown, ctx: Ctx): Promise<HzRunResult> {
  const request: HzRequest = parseHzRequest(message);
  await ctx.commit({ kind: "horizon.request", request }, { tier: "audit" });
  let completed: HzStepResult[] = [];
  let evidenceFacts: string[] = [];
  let plateau: HzPlateauState = { fingerprint: null, stableCycles: 0 };
  let specialistRuns = 0; let replans = 0; let transitions = 0; let answer: string | null = null;

  let current = await planRevision({ request, revision: 1, previousPlan: null, completed, replanBrief: null, answer, tools: [] }, ctx);
  specialistRuns++;

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
      answer = await answerQuestion(current.plan.question!, current.plan.revision, ctx);
      const previous = current.plan;
      current = await planRevision({ request, revision: previous.revision + 1, previousPlan: previous, completed,
        replanBrief: "Reconcile the user answer with the prior immutable plan.", answer, tools: [] }, ctx);
      specialistRuns++; replans++;
      continue;
    }

    const step = nextStep(current.plan, completed);
    if (!step) {
      const done = new Set(completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
      if (current.plan.steps.every(({ id }) => done.has(id))) {
        const artifact = await packageWorkspace(current.plan, ctx);
        const result: HzRunResult = {
          object: "constal.horizon.result", version: 1, status: "complete", summary: current.plan.summary,
          plan: { revision: current.plan.revision, fact: current.fact },
          completedSteps: completed.map(({ stepId, status, summary }) => ({ id: stepId, status, summary })),
          remainingUnknowns: current.plan.unknowns.filter(({ state }) => !["resolved", "assumed"].includes(state)),
          artifact,
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
    evidenceFacts = [...new Set([...evidenceFacts, stepFact.hash])];
    completed = updateCompleted(completed, executed.result);

    plateau = await progressState(plateau, completed, evidenceFacts, executed.result.unknowns);
    await ctx.commit({ kind: "horizon.progress", planFact: current.fact, step: step.id, plateau }, { tier: "audit" });

    const reconcilerTools = availableTools(RECONCILER_TOOL_NAMES, ctx);
    const reconciled = await ctx.spawn(reconciler, { request, plan: current.plan, planFact: current.fact,
      completed, latest: executed.result, plateau, tools: reconcilerTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: 12, microUsd: 5_000_000, wallMs: 1_800_000 },
      attenuation: attenuation(reconcilerTools, ctx),
    });
    specialistRuns++;
    await ctx.commit({ kind: "horizon.reconciliation", planFact: current.fact, stepFact: stepFact.hash,
      reconciliation: reconciled.reconciliation, toolEvidence: reconciled.toolEvidence }, { tier: "audit" });

    const decision = reconciled.reconciliation;
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
    if (decision.action === "ask") answer = await answerQuestion(decision.question!, current.plan.revision, ctx);
    const previous = current.plan;
    current = await planRevision({ request, revision: previous.revision + 1, previousPlan: previous, completed,
      replanBrief: decision.replanBrief ?? decision.summary, answer, tools: [] }, ctx);
    specialistRuns++; replans++;
  }
  return blockedResult(current.plan, current.fact, completed, "Horizon reached its durable workflow transition safety ceiling.",
    current.plan.unknowns, specialistRuns, replans, plateau.stableCycles);
}

