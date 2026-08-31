import { canonicalJson, hashValue, type Ctx, type SpawnAttenuation } from "@constal/sdk";
import { storeArtifact } from "./artifacts.js";
import { parseHzRequest, type HzDiscoveryPlan, type HzInvestigationResult, type HzPlan, type HzPlanInput, type HzPlateauState, type HzRequest,
  type HzRunResult, type HzStepResult } from "./contracts.js";
import { discoveryFramer, executor, investigator, planner, reconciler, verifier } from "./tasks/index.js";
import { approvalInterpreter, parseApprovalDecision } from "./tasks/approval.js";
import { horizonRoutedEvent, type HorizonRoutedEvent } from "./behaviors.js";
import { availableTools, bindingsForTools, DISCOVERY_TOOL_NAMES, EXECUTOR_TOOL_NAMES, INVESTIGATOR_TOOL_NAMES,
  PLANNER_TOOL_NAMES, RECONCILER_TOOL_NAMES, VERIFIER_TOOL_NAMES } from "./tools/index.js";
import { HORIZON_EXECUTION_LOOP_TURNS, HORIZON_LOOP_MICRO_USD, HORIZON_LOOP_WALL_MS,
  HORIZON_STANDARD_LOOP_TURNS } from "./limits.js";
import { milestoneMarkdown, planMarkdown, postConversation, questionMarkdown, requestConversation, waitPresentation } from "./github-conversation.js";
import { publishWorkspace } from "./github-publication.js";
import { archiveWorkspace, captureWorkspaceCheckpoint, prepareWorkspace, WorkspacePreparationError,
  type PreparedWorkspace } from "./workspace/lifecycle.js";

const MAX_PLAN_REVISIONS = 64;
const MAX_WORKFLOW_TRANSITIONS = 1_024;

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
  const result = await ctx.invoke<{ permission?: unknown }>(ctx.resources.github, "repository.permission.get",
    { owner: target.owner, repository: target.repository, username: target.sender });
  const permission = typeof result.permission === "string" ? result.permission : "unknown";
  return { authorized: target.permissions.includes(permission), permission };
}

async function awaitPlanDecision(plan: HzPlan, planFact: string, request: HzRequest, ctx: Ctx): Promise<HorizonPlanDecision> {
  await ctx.commit({ kind: "horizon.approval-request", planFact, plan,
    instruction: "Approve this exact plan revision, request a revision, or cancel before repository mutation begins." }, { tier: "audit" });
  const body = planMarkdown(plan, planFact);
  await postConversation(ctx, requestConversation(request), `plan:${planFact}`, body);
  for (let attempt = 1; attempt <= 64; attempt++) {
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
        await ctx.commit({ kind: "horizon.approval-denied", planFact, eventClass: event.eventClass,
          permission: authorization.permission, reason: "The GitHub sender does not have a configured approval permission." }, { tier: "audit" });
        await postConversation(ctx, requestConversation(request), `approval-denied:${planFact}:${attempt}`,
          `Horizon did not accept this approval because the sender has repository permission \`${authorization.permission}\`, which is not in the configured approver permissions. An authorized reviewer can reply to this issue.`);
        continue;
      }
    }
    await ctx.commit({ kind: "horizon.approval-decision", planFact, decision }, { tier: "audit" });
    return decision;
  }
  throw new TypeError("Horizon plan approval remained unresolved after the bounded conversation limit");
}

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

async function answerQuestion(question: string, revision: number, request: HzRequest, ctx: Ctx): Promise<string> {
  const body = questionMarkdown(question);
  await postConversation(ctx, requestConversation(request), `question:${revision}:${await hashValue(question)}`, body);
  const response = await ctx.await<unknown>(`horizon-plan-${revision}`, {
    schema: { anyOf: [
      { type: "object", properties: { answer: { type: "string", minLength: 1, maxLength: 65_536 } },
        required: ["answer"], additionalProperties: false },
      { type: "object", required: ["object", "version", "objective"], properties: {
        object: { const: "constal.horizon.event" }, version: { const: 1 }, objective: { type: "string", minLength: 1, maxLength: 65_536 },
      } },
    ] }, maxBytes: 65_536, afterRun: "message",
    presentation: waitPresentation("question", "Horizon needs input", body, { revision }),
  });
  const direct = response && typeof response === "object" && !Array.isArray(response) && typeof (response as { answer?: unknown }).answer === "string"
    ? (response as { answer: string }).answer : horizonRoutedEvent(response)?.objective;
  const answer = direct?.trim() ?? "";
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
    const packed = await archiveWorkspace(selected, output);
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

async function planRevision(input: HzPlanInput, ctx: Ctx): Promise<{ plan: HzPlan; fact: string; planningRuns: number }> {
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
  const fact = await ctx.commit({ kind: "horizon.plan", plan: result.plan,
    previousRevision: input.previousPlan?.revision ?? null, toolEvidence: result.toolEvidence }, { tier: "audit" });
  return { plan: result.plan, fact: fact.hash, planningRuns: result.planningRuns };
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
  const handles = framed.discoveryPlan.focuses.map((focus) => ({ focus, handle: ctx.spawn(investigator, {
    request, discoveryPlan: framed.discoveryPlan, workspaceReceipt: workspace.receiptRef, focus, tools: investigationTools,
  }, {
    retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
      microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
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

export async function runHorizon(message: unknown, ctx: Ctx, options: HorizonExecutionOptions = {}): Promise<HzRunResult> {
  const request: HzRequest = parseHzRequest(message);
  await ctx.commit({ kind: "horizon.request", request }, { tier: "audit" });
  let workspace: PreparedWorkspace;
  try { workspace = await prepareWorkspace(request, ctx); }
  catch (error) {
    const summary = error instanceof WorkspacePreparationError ? error.message
      : error instanceof Error ? error.message : "Horizon workspace preparation failed.";
    await ctx.commit({ kind: "horizon.workspace-failed", summary }, { tier: "audit" });
    return { object: "constal.horizon.result", version: 1, status: "blocked", summary, plan: null,
      workspace: null, checkpoints: [], completedSteps: [], remainingUnknowns: [], artifact: null, publication: null,
      longHorizon: { durablePlan: true, specialistRuns: 0, replans: 0, plateauCycles: 0 } };
  }
  let completed: HzStepResult[] = [];
  const checkpoints: HzRunResult["checkpoints"] = [];
  let resultDigests: string[] = [];
  let remainingUnknowns = [] as HzPlan["unknowns"];
  let plateau: HzPlateauState = { fingerprint: null, stableCycles: 0 };
  let specialistRuns = 0; let replans = 0; let transitions = 0; let answer: string | null = null;
  let approvedPlanFact: string | null = null;
  const answeredQuestions = new Map<string, string>();

  const discovery = await discover(request, workspace, ctx);
  specialistRuns += discovery.specialistRuns;
  let current = await planRevision({ request, discoveryPlan: discovery.discoveryPlan,
    investigations: discovery.investigations, revision: 1, previousPlan: null,
    completed, replanBrief: null, answer, tools: [] }, ctx);
  remainingUnknowns = current.plan.unknowns;
  specialistRuns += current.planningRuns;

  while (transitions++ < MAX_WORKFLOW_TRANSITIONS) {
    if (current.plan.status === "blocked") {
      return blockedResult(current.plan, current.fact, completed, current.plan.blockedReason ?? current.plan.summary,
        current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
    }
    if (current.plan.status === "needs-input") {
      if (current.plan.revision >= MAX_PLAN_REVISIONS) {
        return blockedResult(current.plan, current.fact, completed, "Horizon reached its immutable plan revision safety ceiling while user decisions remained open.",
          current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
      const key = questionKey(current.plan.question!, current.plan.unknowns);
      if (answeredQuestions.has(key)) {
        return blockedResult(current.plan, current.fact, completed,
          "Horizon stopped because planning requested a user decision that this Run already resolved.",
          current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
      answer = await answerQuestion(current.plan.question!, current.plan.revision, request, ctx);
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
            remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
        }
        let publication: HzRunResult["publication"] = null;
        try { publication = await publishWorkspace(request, current.plan, current.fact, packaged.artifact, ctx); }
        catch (error) {
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
      return blockedResult(current.plan, current.fact, completed, "No dependency-ready Horizon work unit remains; the immutable plan requires reconciliation.",
        current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
    }

    if (options.requirePlanApproval === true && approvedPlanFact !== current.fact) {
      const approval = await awaitPlanDecision(current.plan, current.fact, request, ctx);
      if (approval.decision === "cancel") {
        return blockedResult(current.plan, current.fact, completed, "Horizon execution was cancelled before repository mutation.",
          current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
      if (approval.decision === "revise") {
        if (current.plan.revision >= MAX_PLAN_REVISIONS) {
          return blockedResult(current.plan, current.fact, completed, "Horizon reached its immutable plan revision safety ceiling.",
            current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
        }
        const previous = current.plan;
        const next = await planRevision({ request, discoveryPlan: discovery.discoveryPlan, investigations: discovery.investigations,
          revision: previous.revision + 1, previousPlan: previous, completed,
          replanBrief: "Revise the plan according to the authorized review guidance before any further repository mutation.",
          answer: approval.guidance, tools: [] }, ctx);
        const reconciled = reconcileCompletedForPlan(previous, next.plan, completed);
        if (reconciled.invalidated.length > 0) await ctx.commit({ kind: "horizon.plan-invalidation",
          previousPlanFact: current.fact, nextPlanFact: next.fact, steps: reconciled.invalidated }, { tier: "audit" });
        completed = reconciled.completed; current = next; remainingUnknowns = current.plan.unknowns;
        specialistRuns += current.planningRuns; replans++; approvedPlanFact = null;
        continue;
      }
      approvedPlanFact = current.fact;
    }

    const executorTools = availableTools(EXECUTOR_TOOL_NAMES, ctx);
    const executed = await ctx.spawn(executor, { request, plan: current.plan, planFact: current.fact, step, completed,
      tools: executorTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_EXECUTION_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
      attenuation: attenuation(executorTools, ctx),
    });
    specialistRuns++;
    const stepFact = await ctx.commit({ kind: "horizon.step-result", planFact: current.fact, result: executed.result,
      toolEvidence: executed.toolEvidence }, { tier: "audit" });
    const verifierTools = availableTools(VERIFIER_TOOL_NAMES, ctx);
    const verified = await ctx.spawn(verifier, { request, plan: current.plan, planFact: current.fact, step,
      execution: executed.result, executionToolEvidence: executed.toolEvidence, tools: verifierTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
      attenuation: attenuation(verifierTools, ctx),
    });
    specialistRuns++;
    const verificationFact = await ctx.commit({ kind: "horizon.verification", planFact: current.fact,
      stepFact: stepFact.hash, verification: verified.verification, toolEvidence: verified.toolEvidence }, { tier: "audit" });
    if (executed.result.status === "complete" && verified.verification.verdict === "passed") {
      try {
        const captured = await captureWorkspaceCheckpoint({ workspace, planFact: current.fact, stepFact: stepFact.hash,
          verificationFact: verificationFact.hash, stepId: step.id }, ctx);
        checkpoints.push({ stepId: step.id, receipt: captured.receiptRef, image: captured.checkpoint.image,
          tree: captured.checkpoint.tree });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Workspace checkpoint capture failed.";
        await ctx.commit({ kind: "horizon.workspace-checkpoint-failed", planFact: current.fact,
          stepFact: stepFact.hash, verificationFact: verificationFact.hash, step: step.id, reason }, { tier: "audit" });
        return blockedResult(current.plan, current.fact, completed,
          `The work unit passed independent verification, but its durable workspace checkpoint could not be captured: ${reason}`,
          verified.verification.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
    }
    const resultDigest = await attemptProgressDigest({ execution: executed.result,
      executionTools: executed.toolEvidence, verification: verified.verification,
      verificationTools: verified.toolEvidence });
    resultDigests = [...new Set([...resultDigests, resultDigest])];
    completed = updateCompleted(completed, executed.result, verified.verification.verdict === "passed");
    if (executed.result.status === "complete" && verified.verification.verdict === "passed") {
      await postConversation(ctx, requestConversation(request), `milestone:${current.fact}:${step.id}`,
        milestoneMarkdown(step, executed.result, completed.length, current.plan.steps.length));
    }

    plateau = await progressState(plateau, completed, resultDigests,
      [...executed.result.unknowns, ...verified.verification.unknowns]);
    await ctx.commit({ kind: "horizon.progress", planFact: current.fact, step: step.id,
      verificationFact: verificationFact.hash, plateau }, { tier: "audit" });

    const reconcilerTools = availableTools(RECONCILER_TOOL_NAMES, ctx);
    const reconciled = await ctx.spawn(reconciler, { request, plan: current.plan, planFact: current.fact,
      completed, latest: executed.result, verification: verified.verification, plateau, tools: reconcilerTools }, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS },
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
        remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
    }
    if (decision.action === "continue") continue;
    if (decision.action === "blocked") {
      return blockedResult(current.plan, current.fact, completed, decision.blockedReason ?? decision.summary,
        decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
    }
    if (decision.action === "complete") continue;
    if (current.plan.revision >= MAX_PLAN_REVISIONS) {
      return blockedResult(current.plan, current.fact, completed, "Horizon reached its immutable plan revision safety ceiling.",
        decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
    }
    if (decision.action === "ask") {
      const key = questionKey(decision.question!, decision.remainingUnknowns);
      if (answeredQuestions.has(key)) {
        return blockedResult(current.plan, current.fact, completed,
          "Horizon stopped because reconciliation requested a user decision that this Run already resolved.",
          decision.remainingUnknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
      }
      answer = await answerQuestion(decision.question!, current.plan.revision, request, ctx);
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
    current.plan.unknowns, specialistRuns, replans, plateau.stableCycles, workspace, checkpoints);
}
