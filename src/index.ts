import { agent, type HistoryView } from "@constal/sdk";
import { assertionAgent, assertionPlanRepairAgent, continuityAgent, critiqueAgent, decompositionAgent, designAgent, discoveryFramer, executor,
  investigator, planFinalizer, planner, reconciler, rubricAgent, verifier, approvalInterpreter,
  questionReconciler, workPlanRepairAgent } from "./tasks/index.js";
import { sourceResolver } from "./tasks/source.js";
import { TOOLS } from "./tools/index.js";
import { horizonProgress } from "./views/progress.js";
import { runHorizon } from "./workflow.js";
import { horizonRoutedEvent, HORIZON_BEHAVIOR_CATALOG } from "./behaviors.js";
import { runHorizonOperational } from "./operational.js";
import { terminalMarkdown, waitPresentation } from "./github-conversation.js";
import { runHorizonSetup } from "./setup/workflow.js";
import { startIssueWork } from "./tasks/issue-work.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function restartRequest(message: unknown): { text: string; checkpoint: string; source: unknown; requestedBy: unknown } | null {
  const source = record(message); const data = record(source?.data);
  return typeof source?.text === "string" && source.text.trim() && source.text.length <= 32_768
    && data?.object === "constal.horizon.restart" && data.version === 1
    && typeof data.checkpoint === "string" && /^[a-f0-9]{64}$/u.test(data.checkpoint)
    ? { text: source.text.trim(), checkpoint: data.checkpoint, source: data.source ?? null,
      requestedBy: data.foregroundRun ?? null } : null;
}

async function routeHorizon(message: unknown, ctx: Parameters<typeof runHorizon>[1]) {
  if (message && typeof message === "object" && !Array.isArray(message)
    && (message as { object?: unknown }).object === "constal.setup.start") return runHorizonSetup(message, ctx);
  const restart = restartRequest(message);
  if (restart) {
    const history = await ctx.ledger.view<HistoryView>();
    const checkpoint = history.facts.find(({ hash }) => hash === restart.checkpoint);
    if (!checkpoint) throw new TypeError("Horizon restart Fact is not present in the branched ledger view");
    return startIssueWork({ objective: restart.text,
      context: { restart: { checkpoint, head: history.head, steers: history.steers, requestedBy: restart.requestedBy } },
      constraints: ["Continue from the supplied durable Fact and reconcile the additional steering with its exact recorded state."],
      ...(restart.source === null ? {} : { source: restart.source }) }, ctx);
  }
  const event = horizonRoutedEvent(message);
  if (!event) return runHorizon(message, ctx);
  if (event.behavior === "operate") {
    const result = await runHorizonOperational(event, ctx);
    await ctx.commit({ kind: "horizon.channel-update", phase: result.object === "constal.horizon.operational-result" ? "operational" : "terminal",
      status: result.status, result }, { tier: "audit", presentation: result.object === "constal.horizon.operational-result"
      ? waitPresentation("operational", "Horizon", terminalMarkdown(result))
      : waitPresentation("terminal", result.status === "complete" ? "Horizon completed" : "Horizon is blocked", terminalMarkdown(result)) });
    return result;
  }
  const result = await startIssueWork({ objective: event.objective, context: { eventClass: event.eventClass, event: event.context ?? null },
    constraints: event.constraints ?? [], ...(event.source === undefined ? {} : { source: event.source }),
    ...(event.environment === undefined ? {} : { environment: event.environment }) }, ctx);
  await ctx.commit({ kind: "horizon.channel-update", phase: "terminal", status: result.status }, { tier: "audit",
    presentation: waitPresentation("terminal", result.status === "complete" ? "Horizon completed" : "Horizon is blocked", terminalMarkdown(result)) });
  return result;
}

export default agent({
  id: "horizon",
  version: "0.6.0",
  model: "model",
  mode: "script",
  tools: TOOLS,
  views: [horizonProgress],
  subtasks: [sourceResolver, discoveryFramer, investigator, planner, rubricAgent, designAgent, decompositionAgent,
    workPlanRepairAgent, assertionAgent, assertionPlanRepairAgent, continuityAgent, critiqueAgent, planFinalizer,
    executor, verifier, reconciler, questionReconciler, approvalInterpreter],
  onMessage: routeHorizon,
});

export { parseHzAssertionPlan, parseHzDesign, parseHzDiscoveryPlan, parseHzInvestigationResult, parseHzMilestoneWork, parseHzPlan, parseHzPlanContinuity, parseHzPlanCritique, parseHzPlanNarrative,
  parseHzQuestionReconciliation, parseHzReconciliation, parseHzRequest, parseHzRubric, parseHzStepAssertions, parseHzStepResult,
  parseHzVerification, parseHzWorkPlan } from "./contracts.js";
export { EvidencePlateauDetector } from "./react-loop.js";
export { runHorizon, type HorizonExecutionOptions, type HorizonPlanDecision } from "./workflow.js";
export { HORIZON_BEHAVIOR_CATALOG, horizonRoutedEvent } from "./behaviors.js";
export { parseHorizonOperationalResult, runHorizonOperational } from "./operational.js";
export { horizonProgress } from "./views/progress.js";
