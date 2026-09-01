import { agent } from "@constal/sdk";
import { assertionAgent, critiqueAgent, decompositionAgent, designAgent, discoveryFramer, executor, investigator,
  planFinalizer, planner, reconciler, rubricAgent, verifier, approvalInterpreter } from "./tasks/index.js";
import { sourceResolver } from "./tasks/source.js";
import { TOOLS } from "./tools/index.js";
import { horizonProgress } from "./views/progress.js";
import { runHorizon } from "./workflow.js";
import { horizonRoutedEvent, HORIZON_BEHAVIOR_CATALOG } from "./behaviors.js";
import { runHorizonOperational } from "./operational.js";
import { postConversation, routedConversation, terminalMarkdown } from "./github-conversation.js";
import { runHorizonSetup } from "./setup/workflow.js";

async function routeHorizon(message: unknown, ctx: Parameters<typeof runHorizon>[1]) {
  if (message && typeof message === "object" && !Array.isArray(message)
    && (message as { object?: unknown }).object === "constal.setup.start") return runHorizonSetup(message, ctx);
  const event = horizonRoutedEvent(message);
  if (!event) return runHorizon(message, ctx);
  const conversation = routedConversation(event);
  if (event.behavior === "operate") {
    const result = await runHorizonOperational(event, ctx);
    await postConversation(ctx, conversation, `operational:${event.context && typeof event.context === "object" && "delivery" in event.context
      ? String((event.context as { delivery?: unknown }).delivery ?? ctx.run.id) : ctx.run.id}`, terminalMarkdown(result));
    return result;
  }
  await postConversation(ctx, conversation, "accepted", "Horizon has started investigating this issue. It will ask questions here when information is missing and will present an exact plan for approval before changing the repository.");
  const result = await runHorizon({ objective: event.objective, context: { eventClass: event.eventClass, event: event.context ?? null },
    constraints: event.constraints ?? [], ...(event.source === undefined ? {} : { source: event.source }),
    ...(event.environment === undefined ? {} : { environment: event.environment }) }, ctx, { requirePlanApproval: true });
  await postConversation(ctx, conversation, "terminal", terminalMarkdown(result));
  return result;
}

export default agent({
  id: "horizon",
  version: "0.4.1",
  model: "model",
  mode: "script",
  tools: TOOLS,
  views: [horizonProgress],
  subtasks: [sourceResolver, discoveryFramer, investigator, planner, rubricAgent, designAgent, decompositionAgent,
    assertionAgent, critiqueAgent, planFinalizer, executor, verifier, reconciler, approvalInterpreter],
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
