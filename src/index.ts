import { agent } from "@constal/sdk";
import { assertionAgent, critiqueAgent, decompositionAgent, designAgent, discoveryFramer, executor, investigator,
  planFinalizer, planner, reconciler, rubricAgent, verifier, approvalInterpreter } from "./tasks/index.js";
import { sourceResolver } from "./tasks/source.js";
import { TOOLS } from "./tools/index.js";
import { horizonProgress } from "./views/progress.js";
import { runHorizon } from "./workflow.js";
import { horizonRoutedEvent, HORIZON_BEHAVIOR_CATALOG } from "./behaviors.js";
import { runHorizonOperational } from "./operational.js";
import { terminalMarkdown, waitPresentation } from "./github-conversation.js";
import { runHorizonSetup } from "./setup/workflow.js";
import { issueWorkAgent, startIssueWork } from "./tasks/issue-work.js";

async function routeHorizon(message: unknown, ctx: Parameters<typeof runHorizon>[1]) {
  if (message && typeof message === "object" && !Array.isArray(message)
    && (message as { object?: unknown }).object === "constal.setup.start") return runHorizonSetup(message, ctx);
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
  version: "0.5.8",
  model: "model",
  mode: "script",
  tools: TOOLS,
  views: [horizonProgress],
  subtasks: [sourceResolver, discoveryFramer, investigator, planner, rubricAgent, designAgent, decompositionAgent,
    assertionAgent, critiqueAgent, planFinalizer, executor, verifier, reconciler, approvalInterpreter, issueWorkAgent],
  onMessage: routeHorizon,
});

export { parseHzDesign, parseHzDiscoveryPlan, parseHzInvestigationResult, parseHzMilestoneWork, parseHzPlan, parseHzPlanCritique, parseHzPlanNarrative,
  parseHzReconciliation, parseHzRequest, parseHzRubric, parseHzStepAssertions, parseHzStepResult,
  parseHzVerification, parseHzWorkPlan } from "./contracts.js";
export { EvidencePlateauDetector } from "./react-loop.js";
export { runHorizon, type HorizonExecutionOptions, type HorizonPlanDecision } from "./workflow.js";
export { HORIZON_BEHAVIOR_CATALOG, horizonRoutedEvent } from "./behaviors.js";
export { parseHorizonOperationalResult, runHorizonOperational } from "./operational.js";
export { horizonProgress } from "./views/progress.js";
