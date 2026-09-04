import { canonicalJson, hashValue, type Ctx, type Handle, type SpawnAttenuation } from "@constal/sdk";
import { invokeGitHub } from "@constal-ai/github";
import { storeArtifact } from "./artifacts.js";
import { parseHzRequest, type HzDecisionQuestion, type HzDiscoveryPlan, type HzExecutionAttempt, type HzInvestigatorOutput,
  type HzInvestigationResult,
  type HzPlan, type HzPlanContinuity, type HzPlanInput, type HzPlanningState, type HzPlateauState, type HzRequest,
  type HzRunResult, type HzStepResult, type HzToolEvidence, type HzToolEvidenceSummary,
  type HzWorkspaceAnchor, type HzWorkspaceState } from "./contracts.js";
import { discoveryFramer, executor, investigator, planner, questionReconciler, reconciler, verifier } from "./tasks/index.js";
import { approvalInterpreter, parseApprovalDecision } from "./tasks/approval.js";
import { horizonRoutedEvent, type HorizonRoutedEvent } from "./behaviors.js";
import { availableTools, bindingsForTools, DISCOVERY_TOOL_NAMES, EXECUTOR_TOOL_NAMES, INVESTIGATOR_TOOL_NAMES,
  PLANNER_TOOL_NAMES, RECONCILER_TOOL_NAMES, VERIFIER_TOOL_NAMES } from "./tools/index.js";
import { HORIZON_EXECUTION_LOOP_TURNS, HORIZON_LOOP_MICRO_USD, HORIZON_LOOP_WALL_MS,
  HORIZON_STANDARD_LOOP_TURNS } from "./limits.js";
import { milestoneMarkdown, planMarkdown, questionMarkdown, waitPresentation } from "./github-conversation.js";
import { publishWorkspace } from "./github-publication.js";
import { applicationError, applicationFailureSummary, rethrowRuntimeControl } from "./runtime-control.js";
import { archiveWorkspace, captureWorkspaceCheckpoint, inspectWorkspaceState, prepareWorkspace, restoreWorkspaceAnchor,
  WorkspacePreparationError,
  type PreparedWorkspace } from "./workspace/lifecycle.js";

export interface HorizonPlanDecision {
  object: "constal.horizon.plan-decision";
  version: 1;
  planFact: string;
  decision: "approve" | "revise" | "cancel";
  guidance: string | null;
}

export interface HorizonExecutionOptions { requirePlanApproval?: boolean }

function eventContext(event: HorizonRoutedEvent): { owner: string; repository: string; sender: string; permissions: string[] } | null {
  const context = event.context && typeof event.context === "object" && !Array.isArray(event.context)
    ? event.context as Record<string, unknown> : null;
  const repository = typeof context?.repository === "string" ? context.repository.split("/") : [];
  const sender = context?.sender && typeof context.sender === "object" && !Array.isArray(context.sender)
    ? context.sender as Record<string, unknown> : null;
  const approval = context?.approval && typeof context.approval === "object" && !Array.isArray(context.approval)
    ? context.approval as Record<string, unknown> : null;
  const permissions = Array.isArray(approval?.permissions) ? approval.permissions.filter((item): item is string => typeof item === "string") : [];
  return repository.length === 2 && typeof sender?.login === "string" && sender.login && permissions.length > 0
    ? { owner: repository[0]!, repository: repository[1]!, sender: sender.login, permissions } : null;
}

async function approvalAuthorized(event: HorizonRoutedEvent, ctx: Ctx): Promise<{ authorized: boolean; permission: string }> {
  const target = eventContext(event);
  if (!target || !ctx.resources.github) return { authorized: false, permission: "unknown" };
  const result = await invokeGitHub("repository.permission.get",
    { owner: target.owner, repository: target.repository, username: target.sender }, ctx) as { permission?: unknown };
  const permission = typeof result.permission === "string" ? result.permission : "unknown";
  return { authorized: target.permissions.includes(permission), permission };
}

async function awaitPlanDecision(plan: HzPlan, planFact: string, request: HzRequest, ctx: Ctx): Promise<HorizonPlanDecision> {
  await ctx.commit({ kind: "horizon.approval-request", planFact, plan,
    instruction: "Approve this exact plan revision, request a revision, or cancel before repository mutation begins." }, { tier: "audit" });
  const body = planMarkdown(plan, planFact);
  for (let attempt = 1; ; attempt++) {
    const response = await ctx.await<unknown>(`horizon-approval-${plan.revision}-${attempt}`, {
      maxBytes: 65_536, afterRun: "message",
      presentation: waitPresentation("approval", `Approve Horizon plan revision ${plan.revision}`, body,
        { planFact, revision: plan.revision, attempt }),
      schema: { anyOf: [
        { type: "object", additionalProperties: false,
          required: ["object", "version", "planFact", "decision", "guidance"], properties: {
            object: { const: "constal.horizon.plan-decision" }, version: { const: 1 }, planFact: { const: planFact },
            decision: { enum: ["approve", "revise", "cancel"] },
            guidance: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 65_536 }] },
          } },
        { type: "object", required: ["object", "version", "behavior", "eventClass", "objective"],
          properties: { object: { const: "constal.horizon.event" }, version: { const: 1 },
            behavior: { enum: ["operate", "issue-work"] }, eventClass: { type: "string" }, objective: { type: "string" } } },
      ] },
    });
    let decision = parseApprovalDecision(response, planFact);
    const event = decision ? null : horizonRoutedEvent(response);
    if (!decision && event) decision = await ctx.spawn(approvalInterpreter, { plan, planFact, event }, {
      retries: 1, dedupe: "specHash", budget: { turns: 8, microUsd: 1_000_000, wallMs: 600_000 },
      attenuation: { bindings: ["model"], tools: [] },
    });
    if (!decision) throw new TypeError("Horizon plan approval response is invalid or stale");
    if (decision.decision === "approve" && event) {
      const authorization = await approvalAuthorized(event, ctx);
      if (!authorization.authorized) {
        const denied = `Horizon did not accept this approval because the sender has repository permission \`${authorization.permission}\`, which is not in the configured approver permissions. An authorized reviewer can reply to this issue.`;
        await ctx.commit({ kind: "horizon.approval-denied", planFact, eventClass: event.eventClass,
          permission: authorization.permission, reason: "The GitHub sender does not have a configured approval permission." }, { tier: "audit",
          presentation: waitPresentation("approval-denied", "Approval was not accepted", denied) });
        continue;
      }
    }
    await ctx.commit({ kind: "horizon.approval-decision", planFact, decision }, { tier: "audit" });
    return decision;
  }
}

function attenuation(names: readonly string[], ctx: Pick<Ctx, "resources">): SpawnAttenuation {
  return { bindings: bindingsForTools(names, ctx), tools: [...names].sort() };
}

function nextStep(plan: HzPlan, completed: readonly HzStepResult[], reserved = new Set<string>()): HzPlan["steps"][number] | null {
  const done = new Set(completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
  return plan.steps.find(({ id, dependsOn }) => !done.has(id) && !reserved.has(id)
    && dependsOn.every((dependency) => done.has(dependency))) ?? null;
}

function updateCompleted(completed: HzStepResult[], result: HzStepResult, verified: boolean): HzStepResult[] {
  if (result.status !== "complete" || !verified) return completed;
  return [...completed.filter(({ stepId }) => stepId !== result.stepId), result];
}

export function applyPlanContinuity(next: HzPlan, completed: HzStepResult[], continuity: HzPlanContinuity): {
  completed: HzStepResult[]; reverify: string[]; invalidated: string[];
} {
  const nextSteps = new Map(next.steps.map((step) => [step.id, step]));
  const decisions = new Map(continuity.decisions.map((decision) => [decision.priorStepId, decision]));
  const retained = new Map<string, HzStepResult>(); const reverify = new Set<string>(); const invalidated = new Set<string>();
  for (const result of completed) {
    const decision = decisions.get(result.stepId);
    if (!decision || decision.disposition === "dropped" || decision.disposition === "rerun") {
      invalidated.add(result.stepId); continue;
    }
    if (!decision.nextStepId || !nextSteps.has(decision.nextStepId)) {
      throw new TypeError(`Horizon continuity references an unknown successor for ${result.stepId}`);
    }
    if (decision.disposition === "retain") retained.set(decision.nextStepId, { ...result, stepId: decision.nextStepId });
    else reverify.add(decision.nextStepId);
  }
  // A retained result whose new prerequisites are not themselves retained must be
  // reverified after those prerequisites complete; it cannot satisfy readiness yet.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [stepId] of retained) {
      const step = nextSteps.get(stepId)!;
      if (step.dependsOn.some((dependency) => !retained.has(dependency))) {
        retained.delete(stepId); reverify.add(stepId); changed = true;
      }
    }
  }
  for (const stepId of reverify) invalidated.add(stepId);
  return { completed: [...retained.values()], reverify: [...reverify].sort(), invalidated: [...invalidated].sort() };
}

function unknownFrontier(unknowns: readonly HzPlan["unknowns"][number][]): unknown[] {
  return [...unknowns].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))).map((unknown) => ({
    question: unknown.question, state: unknown.state, resolution: unknown.resolution,
    evidence: [...unknown.evidence].sort(),
  }));
}

function summarizeToolEvidence(evidence: readonly HzToolEvidence[]): HzToolEvidenceSummary[] {
  return evidence.map(({ name, status, ref }) => ({ name, status, ref }));
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
  workspaceBefore: HzWorkspaceState;
  workspaceAfter: HzWorkspaceState;
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
    workspace: { before: input.workspaceBefore, after: input.workspaceAfter },
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

interface StoredAttempt { attempt: HzExecutionAttempt; ref: string }

async function recordExecutionAttempt(input: Omit<HzExecutionAttempt, "object" | "version" | "id">,
  ctx: Ctx): Promise<StoredAttempt> {
  const id = await hashValue(input);
  const attempt: HzExecutionAttempt = { object: "constal.horizon.execution-attempt", version: 1, id, ...input };
  const stored = await storeArtifact(ctx, attempt);
  await ctx.commit({ kind: "horizon.execution-attempt", id, step: attempt.stepId, ordinal: attempt.ordinal,
    planFact: attempt.planFact, stepFact: attempt.stepFact, verificationFact: attempt.verificationFact,
    executionReused: attempt.executionReused, workspaceBefore: attempt.workspaceBefore,
    workspaceAfter: attempt.workspaceAfter, ref: stored.ref }, { tier: "audit" });
  return { attempt, ref: stored.ref };
}

function preparedAnchor(workspace: PreparedWorkspace): HzWorkspaceAnchor {
  return { kind: "prepared", stepId: null, receipt: workspace.receiptRef,
    cacheKey: workspace.receipt.cache.key, image: workspace.receipt.cache.image,
    tree: workspace.receipt.baseline.tree, status: "" };
}

function verifiedAnchor(stepId: string, receipt: string, checkpoint: {
  cacheKey: string; image: string | null; tree: string; status: string;
}): HzWorkspaceAnchor {
  return { kind: "verified", stepId, receipt, cacheKey: checkpoint.cacheKey,
    image: checkpoint.image, tree: checkpoint.tree, status: checkpoint.status };
}

function retainedPrefixAnchor(lineage: readonly HzWorkspaceAnchor[], retained: ReadonlySet<string>): {
  anchor: HzWorkspaceAnchor; retainedAtAnchor: Set<string>;
} {
  const retainedAtAnchor = new Set<string>(); let anchor = lineage[0]!;
  for (const candidate of lineage.slice(1)) {
    if (!candidate.stepId || !retained.has(candidate.stepId)) break;
    retainedAtAnchor.add(candidate.stepId); anchor = candidate;
  }
  return { anchor, retainedAtAnchor };
}

async function answerQuestion(question: HzDecisionQuestion, revision: number, ctx: Ctx): Promise<string> {
  const body = questionMarkdown(question);
  const response = await ctx.await<unknown>(`horizon-plan-${revision}`, {
    schema: { anyOf: [
      { type: "object", properties: { answer: { type: "string", minLength: 1, maxLength: 65_536 } },
        required: ["answer"], additionalProperties: false },
      { type: "object", required: ["object", "version", "objective"], properties: {
        object: { const: "constal.horizon.event" }, version: { const: 1 }, objective: { type: "string", minLength: 1, maxLength: 65_536 },
      } },
    ] }, maxBytes: 65_536, afterRun: "message",
    presentation: waitPresentation("question", "I need one decision", body, { revision }),
  });
  const direct = response && typeof response === "object" && !Array.isArray(response) && typeof (response as { answer?: unknown }).answer === "string"
    ? (response as { answer: string }).answer : horizonRoutedEvent(response)?.objective;
  const supplied = direct?.trim() ?? "";
  const selected = supplied.match(/^(?:option\s*)?([1-3])\.?$/iu);
  const answer = selected ? question.options[Number(selected[1]) - 1]! : supplied;
  if (!answer) throw new TypeError("Horizon question was resolved without an answer");
  await ctx.commit({ kind: "horizon.answer", revision, question, answer }, { tier: "audit" });
  return answer;
}

async function priorAnswer(candidate: HzDecisionQuestion,
  history: Array<{ question: HzDecisionQuestion; answer: string }>, ctx: Ctx): Promise<string | null> {
  if (history.length === 0) return null;
  const input = await storeArtifact(ctx, { candidate, history });
  const result = await ctx.spawn(questionReconciler, input, {
    retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
      microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
    attenuation: { bindings: ["cas", "model"], tools: [] },
  });
  await ctx.commit({ kind: "horizon.question-reconciliation", candidate,
    priorQuestions: history.length, result }, { tier: "audit" });
  return result.decision === "answered" ? history[history.length - 1]!.answer : null;
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
    const packed = await archiveWorkspace(selected, output);
    if (packed.status !== "completed" || packed.exitCode !== 0) {
      return { artifact: null, error: `Workspace packaging failed (${packed.status}, exit ${packed.exitCode ?? "unknown"}).` };
    }
    const artifact = packed.outputs.find(({ path }) => path === output);
    return artifact
      ? { artifact: { ref: artifact.ref, bytes: artifact.bytes, path: artifact.path }, error: null }
      : { artifact: null, error: "Workspace packaging completed without its declared artifact." };
  } catch (error) {
    rethrowRuntimeControl(error);
    return { artifact: null, error: error instanceof Error ? error.message.slice(0, 4_096) : "Workspace packaging failed." };
  }
}

function blockedResult(plan: HzPlan, planFact: string, completed: HzStepResult[], summary: string,
  remainingUnknowns = plan.unknowns, specialistRuns = 0, replans = 0, plateauCycles = 0,
  workspace: PreparedWorkspace | null = null, checkpoints: HzRunResult["checkpoints"] = []): HzRunResult {
  return {
    object: "constal.horizon.result", version: 1, status: "blocked", summary,
    plan: { revision: plan.revision, fact: planFact },
    workspace: workspace ? { receipt: workspace.receiptRef, cacheHit: workspace.receipt.cache.hit,
      image: workspace.receipt.cache.image } : null, checkpoints,
    completedSteps: completed.map(({ stepId, status, summary: stepSummary }) => ({ id: stepId, status, summary: stepSummary })),
    remainingUnknowns, artifact: null, publication: null,
    longHorizon: { durablePlan: true, specialistRuns, replans, plateauCycles },
  };
}

function unplannedBlockedResult(summary: string, workspace: PreparedWorkspace | null = null,
  specialistRuns = 0): HzRunResult {
  return { object: "constal.horizon.result", version: 1, status: "blocked", summary, plan: null,
    workspace: workspace ? { receipt: workspace.receiptRef, cacheHit: workspace.receipt.cache.hit,
      image: workspace.receipt.cache.image } : null,
    checkpoints: [], completedSteps: [], remainingUnknowns: [], artifact: null, publication: null,
    longHorizon: { durablePlan: true, specialistRuns, replans: 0, plateauCycles: 0 } };
}

async function recordApplicationFailure(ctx: Ctx, stage: string, error: unknown): Promise<string> {
  rethrowRuntimeControl(error);
  const detail = applicationError(error);
  const summary = applicationFailureSummary(stage, error);
  try { await ctx.commit({ kind: "horizon.application-failure", stage, error: detail }, { tier: "audit" }); }
  catch (commitError) { rethrowRuntimeControl(commitError); throw commitError; }
  return summary;
}

async function planRevision(input: HzPlanInput, ctx: Ctx): Promise<{
  plan: HzPlan; state: HzPlanningState; fact: string; planningRuns: number;
}> {
  const tools = availableTools(PLANNER_TOOL_NAMES, ctx);
  const planningInput = await storeArtifact(ctx, { ...input, tools });
  const baseAttenuation = attenuation(tools, ctx);
  const plannerAttenuation = { ...baseAttenuation,
    bindings: [...new Set([...baseAttenuation.bindings, "cas"])].sort() };
  const result = await ctx.spawn(planner, planningInput, {
    retries: 1, dedupe: "specHash", budget: { turns: HORIZON_EXECUTION_LOOP_TURNS,
      microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
    attenuation: plannerAttenuation,
  });
  const planningState = await storeArtifact(ctx, result.state);
  const fact = await ctx.commit({ kind: "horizon.plan", plan: result.plan, planningState,
    previousRevision: input.previousPlan?.revision ?? null, restartAt: input.restartAt,
    executionAttempt: input.executionEvidence?.id ?? null, toolEvidence: result.toolEvidence }, { tier: "audit" });
  return { plan: result.plan, state: result.state, fact: fact.hash, planningRuns: result.planningRuns };
}

async function discover(request: HzRequest, workspace: PreparedWorkspace, ctx: Ctx): Promise<{
  discoveryPlan: HzDiscoveryPlan;
  investigations: HzInvestigationResult[];
  specialistRuns: number;
}> {
  const discoveryTools = availableTools(DISCOVERY_TOOL_NAMES, ctx);
  const framed = await ctx.spawn(discoveryFramer, { request, workspaceRoot: workspace.receipt.root,
    workspaceReceipt: workspace.receiptRef, tools: discoveryTools }, {
    retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
      microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
    attenuation: attenuation(discoveryTools, ctx),
  });
  const discoveryFact = await ctx.commit({ kind: "horizon.discovery-plan", discoveryPlan: framed.discoveryPlan,
    toolEvidence: framed.toolEvidence }, { tier: "audit" });
  const investigationTools = availableTools(INVESTIGATOR_TOOL_NAMES, ctx);
  const handles: Array<{ focus: typeof framed.discoveryPlan.focuses[number];
    handle: Handle<HzInvestigatorOutput> }> = [];
  for (const focus of framed.discoveryPlan.focuses) {
    const input = await storeArtifact(ctx, { request, discoveryPlan: framed.discoveryPlan,
      workspaceReceipt: workspace.receiptRef, focus, priorInvestigations: [], tools: investigationTools });
    handles.push({ focus, handle: ctx.spawn(investigator, input, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
      attenuation: attenuation(investigationTools, ctx),
    }) });
  }
  const investigations: HzInvestigationResult[] = [];
  for (const { focus, handle } of handles) {
    const result = await Promise.resolve(handle);
    investigations.push(result.investigation);
    await ctx.commit({ kind: "horizon.investigation", discoveryFact: discoveryFact.hash,
      focus: focus.id, investigation: result.investigation, toolEvidence: result.toolEvidence }, { tier: "audit" });
  }
  return { discoveryPlan: framed.discoveryPlan, investigations, specialistRuns: 1 + investigations.length };
}

export async function runHorizon(message: unknown, ctx: Ctx, options: HorizonExecutionOptions = {}): Promise<HzRunResult> {
  let activeStage = "request validation"; let request: HzRequest;
  try {
    request = parseHzRequest(message);
    await ctx.commit({ kind: "horizon.request", request }, { tier: "audit" });
  } catch (error) {
    return unplannedBlockedResult(await recordApplicationFailure(ctx, activeStage, error));
  }
  let workspace: PreparedWorkspace;
  activeStage = "workspace preparation";
  try { workspace = await prepareWorkspace(request, ctx); }
  catch (error) {
    rethrowRuntimeControl(error);
    const summary = error instanceof WorkspacePreparationError ? error.message
      : error instanceof Error ? error.message : "Horizon workspace preparation failed.";
    await ctx.commit({ kind: "horizon.workspace-failed", summary }, { tier: "audit" });
    return { object: "constal.horizon.result", version: 1, status: "blocked", summary, plan: null,
      workspace: null, checkpoints: [], completedSteps: [], remainingUnknowns: [], artifact: null, publication: null,
      longHorizon: { durablePlan: true, specialistRuns: 0, replans: 0, plateauCycles: 0 } };
  }
  let completed: HzStepResult[] = [];
  const checkpoints: HzRunResult["checkpoints"] = [];
  const checkpointLineage: HzWorkspaceAnchor[] = [preparedAnchor(workspace)];
  let restorePoint = checkpointLineage[0]!;
  const latestAttempts = new Map<string, StoredAttempt>();
  const successfulAttempts = new Map<string, StoredAttempt>();
  const pendingReverify = new Map<string, StoredAttempt>();
  let attemptOrdinal = 0;
  let resultDigests: string[] = [];
  let remainingUnknowns = [] as HzPlan["unknowns"];
  let plateau: HzPlateauState = { fingerprint: null, stableCycles: 0 };
  const replannedPlateaus = new Set<string>();
  let specialistRuns = 0; let replans = 0; let answer: string | null = null;
  let approvedPlanFact: string | null = null;
  const questionHistory: Array<{ question: HzDecisionQuestion; answer: string }> = [];
  const completedEvidence = (): HzExecutionAttempt[] => completed.flatMap(({ stepId }) => {
    const stored = successfulAttempts.get(stepId); return stored ? [stored.attempt] : [];
  });

  let discovery: Awaited<ReturnType<typeof discover>>;
  let current: Awaited<ReturnType<typeof planRevision>>;
  try {
    activeStage = "repository discovery";
    discovery = await discover(request, workspace, ctx);
    specialistRuns += discovery.specialistRuns;
    activeStage = "initial planning";
    current = await planRevision({ request, discoveryPlan: discovery.discoveryPlan,
      investigations: discovery.investigations, workspaceReceipt: workspace.receiptRef,
      revision: 1, previousPlan: null, previousState: null,
      completed, completedEvidence: [], restartAt: null, executionEvidence: null, replanBrief: null, answer, tools: [] }, ctx);
  } catch (error) {
    return unplannedBlockedResult(await recordApplicationFailure(ctx, activeStage, error), workspace, specialistRuns);
  }
  remainingUnknowns = current.plan.unknowns;
  specialistRuns += current.planningRuns;

  const adoptRevision = async (previous: typeof current, next: typeof current,
    disposition: "keep-current" | "restore-last-verified", reason: string): Promise<void> => {
    const reconciled = applyPlanContinuity(next.plan, completed, next.state.continuity);
    const invalidated = new Set(reconciled.invalidated);
    completed = reconciled.completed;
    pendingReverify.clear();
    if (disposition === "restore-last-verified") {
      const prefix = retainedPrefixAnchor(checkpointLineage, new Set(completed.map(({ stepId }) => stepId)));
      await restoreWorkspaceAnchor(prefix.anchor, reason, ctx);
      const physicallyRetained = prefix.retainedAtAnchor;
      for (const result of completed) if (!physicallyRetained.has(result.stepId)) invalidated.add(result.stepId);
      completed = completed.filter(({ stepId }) => physicallyRetained.has(stepId));
      const anchorIndex = checkpointLineage.findIndex(({ receipt }) => receipt === prefix.anchor.receipt);
      checkpointLineage.splice(Math.max(1, anchorIndex + 1));
      restorePoint = prefix.anchor;
    } else {
      const prefix = retainedPrefixAnchor(checkpointLineage, new Set(completed.map(({ stepId }) => stepId)));
      restorePoint = prefix.anchor;
      for (const stepId of reconciled.reverify) {
        const prior = successfulAttempts.get(stepId);
        if (prior) pendingReverify.set(stepId, prior);
        else invalidated.add(stepId);
      }
    }
    for (const stepId of invalidated) successfulAttempts.delete(stepId);
    if (invalidated.size > 0 || reconciled.reverify.length > 0) {
      await ctx.commit({ kind: "horizon.plan-invalidation", previousPlanFact: previous.fact,
        nextPlanFact: next.fact, invalidated: [...invalidated].sort(), reverify: [...pendingReverify.keys()].sort(),
        workspaceDisposition: disposition }, { tier: "audit" });
    }
    current = next; remainingUnknowns = current.plan.unknowns;
    specialistRuns += current.planningRuns; replans++; approvedPlanFact = null;
  };

  try { for (;;) {
    if (current.plan.status === "needs-input") {
      activeStage = "planning question";
      activeStage = "planning question reconciliation";
      const reconciledPriorQuestion = questionHistory.length > 0;
      const answered = await priorAnswer(current.plan.question!, questionHistory, ctx);
      if (reconciledPriorQuestion) specialistRuns++;
      answer = answered ?? await answerQuestion(current.plan.question!, current.plan.revision, ctx);
      if (answered) await ctx.commit({ kind: "horizon.answer-reused", revision: current.plan.revision,
        question: current.plan.question, answer }, { tier: "audit" });
      else questionHistory.push({ question: current.plan.question!, answer });
      const previous = current;
      activeStage = "planning revision";
      const next = await planRevision({ request, discoveryPlan: discovery.discoveryPlan, investigations: discovery.investigations,
        workspaceReceipt: workspace.receiptRef, revision: previous.plan.revision + 1,
        previousPlan: previous.plan, previousState: previous.state, completed,
        completedEvidence: completedEvidence(),
        restartAt: "rubric", executionEvidence: null,
        replanBrief: "Reconcile the user answer with the prior immutable plan.", answer, tools: [] }, ctx);
      await adoptRevision(previous, next, "keep-current", "Reconcile the user answer with the prior immutable plan.");
      continue;
    }

    const done = new Set(completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
    const reverifyEntry = [...pendingReverify.entries()].find(([stepId]) => {
      const candidate = current.plan.steps.find(({ id }) => id === stepId);
      return candidate?.dependsOn.every((dependency) => done.has(dependency));
    }) ?? null;
    const step = reverifyEntry
      ? current.plan.steps.find(({ id }) => id === reverifyEntry[0]) ?? null
      : nextStep(current.plan, completed, new Set(pendingReverify.keys()));
    if (!step) {
      if (pendingReverify.size === 0 && current.plan.steps.every(({ id }) => done.has(id))) {
        activeStage = "final workspace packaging";
        const packaged = await packageWorkspace(current.plan, ctx);
        if (!packaged.artifact) {
          await ctx.commit({ kind: "horizon.package-failed", planFact: current.fact,
            reason: packaged.error ?? "Workspace packaging failed." }, { tier: "audit" });
          return blockedResult(current.plan, current.fact, completed,
            `Every work unit passed independent verification, but Horizon could not create the immutable final artifact: ${packaged.error ?? "unknown packaging failure"}`,
            remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
        }
        let publication: HzRunResult["publication"] = null;
        activeStage = "repository publication";
        try { publication = await publishWorkspace(request, current.plan, current.fact, packaged.artifact, ctx); }
        catch (error) {
          rethrowRuntimeControl(error);
          const reason = error instanceof Error ? error.message : "GitHub publication failed.";
          await ctx.commit({ kind: "horizon.publication-failed", planFact: current.fact, artifact: packaged.artifact, reason }, { tier: "audit" });
          return blockedResult(current.plan, current.fact, completed,
            `Every work unit passed verification and the immutable artifact was created, but repository publication failed: ${reason}`,
            remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
        }
        const result: HzRunResult = {
          object: "constal.horizon.result", version: 1, status: "complete", summary: current.plan.summary,
          plan: { revision: current.plan.revision, fact: current.fact },
          workspace: { receipt: workspace.receiptRef, cacheHit: workspace.receipt.cache.hit,
            image: workspace.receipt.cache.image }, checkpoints,
          completedSteps: completed.map(({ stepId, status, summary }) => ({ id: stepId, status, summary })),
          remainingUnknowns: remainingUnknowns.filter(({ state }) => !["resolved", "assumed"].includes(state)),
          artifact: packaged.artifact,
          publication,
          longHorizon: { durablePlan: true, specialistRuns, replans, plateauCycles: plateau.stableCycles },
        };
        const final = await ctx.commit({ kind: "horizon.result", result }, { tier: "audit" });
        return { ...result, summary: `${result.summary}\n\nDurable result: ${final.hash}` };
      }
      return blockedResult(current.plan, current.fact, completed, "No dependency-ready execution or reverification unit remains; the immutable plan requires reconciliation.",
        current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
    }

    if (options.requirePlanApproval === true && approvedPlanFact !== current.fact) {
      activeStage = "plan approval";
      const approval = await awaitPlanDecision(current.plan, current.fact, request, ctx);
      if (approval.decision === "cancel") {
        return blockedResult(current.plan, current.fact, completed, "Horizon execution was cancelled before repository mutation.",
          current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
      if (approval.decision === "revise") {
        const previous = current;
        activeStage = "reviewed planning revision";
        const next = await planRevision({ request, discoveryPlan: discovery.discoveryPlan, investigations: discovery.investigations,
          workspaceReceipt: workspace.receiptRef, revision: previous.plan.revision + 1,
          previousPlan: previous.plan, previousState: previous.state, completed,
          completedEvidence: completedEvidence(),
          restartAt: "rubric", executionEvidence: null,
          replanBrief: "Revise the plan according to the authorized review guidance before any further repository mutation.",
          answer: approval.guidance, tools: [] }, ctx);
        await adoptRevision(previous, next, "keep-current",
          "Revise the plan according to the authorized review guidance before further mutation.");
        continue;
      }
      approvedPlanFact = current.fact;
    }

    activeStage = reverifyEntry ? "workspace reverification" : "execution preparation";
    const workspaceBefore = await inspectWorkspaceState(ctx);
    const reused = reverifyEntry?.[0] === step.id ? reverifyEntry[1] : null;
    let executed: { result: HzStepResult; toolEvidence: HzToolEvidence[] };
    let stepFactHash: string;
    if (reused) {
      executed = { result: reused.attempt.execution, toolEvidence: [] };
      stepFactHash = reused.attempt.stepFact;
      await ctx.commit({ kind: "horizon.execution-reused", planFact: current.fact, step: step.id,
        priorAttempt: reused.attempt.id, stepFact: stepFactHash }, { tier: "audit" });
    } else {
      activeStage = "work-unit execution";
      const executorTools = availableTools(EXECUTOR_TOOL_NAMES, ctx);
      const executorInput = await storeArtifact(ctx, { request, plan: current.plan, planFact: current.fact, step, completed,
        previousAttempt: latestAttempts.get(step.id)?.attempt ?? null, tools: executorTools });
      executed = await ctx.spawn(executor, executorInput, {
        retries: 1, dedupe: "specHash", budget: { turns: HORIZON_EXECUTION_LOOP_TURNS,
          microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
        attenuation: attenuation(executorTools, ctx),
      });
      specialistRuns++;
      const stepFact = await ctx.commit({ kind: "horizon.step-result", planFact: current.fact, result: executed.result,
        toolEvidence: executed.toolEvidence }, { tier: "audit" });
      stepFactHash = stepFact.hash;
    }
    activeStage = "independent verification";
    const verifierTools = availableTools(VERIFIER_TOOL_NAMES, ctx);
    const verifierInput = await storeArtifact(ctx, { request, plan: current.plan, planFact: current.fact, step,
      execution: executed.result, stepFact: stepFactHash,
      executionToolEvidence: summarizeToolEvidence(executed.toolEvidence), tools: verifierTools });
    const verified = await ctx.spawn(verifier, verifierInput, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
      attenuation: attenuation(verifierTools, ctx),
    });
    specialistRuns++;
    const verificationFact = await ctx.commit({ kind: "horizon.verification", planFact: current.fact,
      stepFact: stepFactHash, verification: verified.verification, toolEvidence: verified.toolEvidence,
      executionReused: !!reused }, { tier: "audit" });
    activeStage = "execution evidence capture";
    const workspaceAfter = await inspectWorkspaceState(ctx);
    const storedAttempt = await recordExecutionAttempt({ ordinal: ++attemptOrdinal, planFact: current.fact,
      stepId: step.id, executionReused: !!reused, previousAttemptRef: latestAttempts.get(step.id)?.ref ?? null,
      restorePoint, workspaceBefore, workspaceAfter, stepFact: stepFactHash,
      verificationFact: verificationFact.hash, execution: executed.result,
      executionToolEvidence: summarizeToolEvidence(executed.toolEvidence), verification: verified.verification,
      verificationToolEvidence: summarizeToolEvidence(verified.toolEvidence) }, ctx);
    latestAttempts.set(step.id, storedAttempt);
    if (executed.result.status === "complete" && verified.verification.verdict === "passed") {
      activeStage = "verified workspace checkpoint";
      try {
        const captured = await captureWorkspaceCheckpoint({ workspace, planFact: current.fact, stepFact: stepFactHash,
          verificationFact: verificationFact.hash, stepId: step.id }, ctx);
        checkpoints.push({ stepId: step.id, receipt: captured.receiptRef, image: captured.checkpoint.image,
          tree: captured.checkpoint.tree });
        restorePoint = verifiedAnchor(step.id, captured.receiptRef, captured.checkpoint);
        checkpointLineage.push(restorePoint);
        successfulAttempts.set(step.id, storedAttempt);
        pendingReverify.delete(step.id);
      } catch (error) {
        rethrowRuntimeControl(error);
        const reason = error instanceof Error ? error.message : "Workspace checkpoint capture failed.";
        await ctx.commit({ kind: "horizon.workspace-checkpoint-failed", planFact: current.fact,
          stepFact: stepFactHash, verificationFact: verificationFact.hash, step: step.id, reason }, { tier: "audit" });
        return blockedResult(current.plan, current.fact, completed,
          `The work unit passed independent verification, but its durable workspace checkpoint could not be captured: ${reason}`,
          verified.verification.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
    }
    const resultDigest = await attemptProgressDigest({ execution: executed.result,
      executionTools: executed.toolEvidence, verification: verified.verification,
      verificationTools: verified.toolEvidence, workspaceBefore, workspaceAfter });
    resultDigests = [...new Set([...resultDigests, resultDigest])];
    completed = updateCompleted(completed, executed.result, verified.verification.verdict === "passed");
    if (executed.result.status === "complete" && verified.verification.verdict === "passed") {
      await ctx.commit({ kind: "horizon.milestone", planFact: current.fact, step: step.id,
        completed: completed.length, total: current.plan.steps.length }, { tier: "audit",
        presentation: waitPresentation("milestone", `Milestone complete · ${step.title}`,
          milestoneMarkdown(step, executed.result, completed.length, current.plan.steps.length), { step: step.id }) });
    }

    plateau = await progressState(plateau, completed, resultDigests,
      [...executed.result.unknowns, ...verified.verification.unknowns]);
    await ctx.commit({ kind: "horizon.progress", planFact: current.fact, step: step.id,
      verificationFact: verificationFact.hash, plateau }, { tier: "audit" });

    const reconcilerTools = availableTools(RECONCILER_TOOL_NAMES, ctx);
    activeStage = "execution reconciliation";
    const reconcilerInput = await storeArtifact(ctx, { request, plan: current.plan, planFact: current.fact,
      completed, attempt: storedAttempt.attempt, restoreAvailable: restorePoint.image !== null,
      plateau, attemptedPlateauReplan: plateau.fingerprint !== null && replannedPlateaus.has(plateau.fingerprint),
      tools: reconcilerTools });
    const reconciled = await ctx.spawn(reconciler, reconcilerInput, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
      attenuation: attenuation(reconcilerTools, ctx),
    });
    specialistRuns++;
    await ctx.commit({ kind: "horizon.reconciliation", planFact: current.fact, stepFact: stepFactHash,
      verificationFact: verificationFact.hash, attempt: storedAttempt.ref, reconciliation: reconciled.reconciliation,
      toolEvidence: reconciled.toolEvidence }, { tier: "audit" });

    const decision = reconciled.reconciliation;
    remainingUnknowns = decision.remainingUnknowns;
    if (plateau.stableCycles >= 2) await ctx.commit({ kind: "horizon.plateau", planFact: current.fact, step: step.id,
      stableCycles: plateau.stableCycles, fingerprint: plateau.fingerprint,
      selectedTransition: decision.action, remainingUnknowns }, { tier: "audit" });
    if (decision.action === "continue") continue;
    if (decision.action === "complete") continue;
    if (decision.action === "repair-step") {
      pendingReverify.delete(step.id);
      if (decision.workspaceDisposition === "restore-last-verified") {
        activeStage = "verified workspace restoration";
        try { await restoreWorkspaceAnchor(restorePoint, decision.summary, ctx); }
        catch (error) {
          rethrowRuntimeControl(error);
          const reason = error instanceof Error ? error.message : "Workspace restoration failed.";
          return blockedResult(current.plan, current.fact, completed,
            `Horizon selected verified workspace restoration, but it could not be completed: ${reason}`,
            decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
        }
      }
      continue;
    }
    if (decision.action === "reverify") {
      pendingReverify.set(step.id, storedAttempt);
      continue;
    }
    if (decision.action === "ask") {
      activeStage = "execution question reconciliation";
      const reconciledPriorQuestion = questionHistory.length > 0;
      const answered = await priorAnswer(decision.question!, questionHistory, ctx);
      if (reconciledPriorQuestion) specialistRuns++;
      answer = answered ?? await answerQuestion(decision.question!, current.plan.revision, ctx);
      if (answered) await ctx.commit({ kind: "horizon.answer-reused", revision: current.plan.revision,
        question: decision.question, answer }, { tier: "audit" });
      else questionHistory.push({ question: decision.question!, answer });
      plateau = { fingerprint: null, stableCycles: 0 };
    }
    if (decision.action === "replan" && plateau.stableCycles >= 2 && plateau.fingerprint) {
      replannedPlateaus.add(plateau.fingerprint);
    }
    const previous = current;
    activeStage = `execution replanning from ${decision.planningOwner}`;
    const next = await planRevision({ request, discoveryPlan: discovery.discoveryPlan, investigations: discovery.investigations,
      workspaceReceipt: workspace.receiptRef, revision: previous.plan.revision + 1,
      previousPlan: previous.plan, previousState: previous.state, completed,
      completedEvidence: completedEvidence(),
      restartAt: decision.planningOwner!, executionEvidence: storedAttempt.attempt,
      replanBrief: decision.replanBrief ?? decision.summary, answer, tools: [] }, ctx);
    await adoptRevision(previous, next, decision.workspaceDisposition, decision.summary);
    if (decision.planningOwner === "assertions" && decision.workspaceDisposition === "keep-current"
      && storedAttempt.attempt.execution.status === "complete"
      && next.plan.steps.some(({ id }) => id === storedAttempt.attempt.stepId)) {
      pendingReverify.set(storedAttempt.attempt.stepId, storedAttempt);
    }
  }
  } catch (error) {
    const summary = await recordApplicationFailure(ctx, activeStage, error);
    return blockedResult(current.plan, current.fact, completed, summary,
      remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
  }
}
