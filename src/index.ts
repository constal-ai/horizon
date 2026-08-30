import { agent } from "@constal/sdk";
import { assertionAgent, critiqueAgent, decompositionAgent, designAgent, discoveryFramer, executor, investigator,
  planFinalizer, planner, reconciler, rubricAgent, verifier } from "./tasks/index.js";
import { TOOLS } from "./tools/index.js";
import { runHorizon } from "./workflow.js";

export default agent({
  id: "horizon",
  version: "0.1.0",
  model: "model",
  mode: "script",
  tools: TOOLS,
  subtasks: [discoveryFramer, investigator, planner, rubricAgent, designAgent, decompositionAgent,
    assertionAgent, critiqueAgent, planFinalizer, executor, verifier, reconciler],
  onMessage: runHorizon,
});

export { parseHzDesign, parseHzDiscoveryPlan, parseHzInvestigationResult, parseHzPlan, parseHzPlanCritique,
  parseHzReconciliation, parseHzRequest, parseHzRubric, parseHzStepAssertions, parseHzStepResult,
  parseHzVerification, parseHzWorkPlan } from "./contracts.js";
export { EvidencePlateauDetector } from "./react-loop.js";
export { runHorizon } from "./workflow.js";
