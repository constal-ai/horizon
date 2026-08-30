import { agent } from "@constal/sdk";
import { discoveryFramer, executor, investigator, planner, reconciler, verifier } from "./tasks/index.js";
import { TOOLS } from "./tools/index.js";
import { runHorizon } from "./workflow.js";

export default agent({
  id: "horizon",
  version: "0.1.0",
  model: "model",
  mode: "script",
  tools: TOOLS,
  subtasks: [discoveryFramer, investigator, planner, executor, verifier, reconciler],
  onMessage: runHorizon,
});

export { parseHzDiscoveryPlan, parseHzInvestigationResult, parseHzPlan, parseHzReconciliation, parseHzRequest,
  parseHzStepResult, parseHzVerification } from "./contracts.js";
export { EvidencePlateauDetector } from "./react-loop.js";
export { runHorizon } from "./workflow.js";
