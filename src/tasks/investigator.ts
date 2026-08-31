import { subtask } from "@constal/sdk";
import { parseHzInvestigationResult, type HzInvestigatorInput, type HzInvestigatorOutput } from "../contracts.js";
import { INVESTIGATOR_SYSTEM } from "../prompts/discovery.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";

export const investigator = subtask<HzInvestigatorOutput>({
  id: "horizon-investigator",
  version: "1",
  async run(input: HzInvestigatorInput, ctx) {
    const conversation = await runReactLoop({
      role: `investigator-${input.focus.id}`, system: INVESTIGATOR_SYSTEM, objective: input.focus.mission,
      context: { request: input.request, discoveryPlan: input.discoveryPlan,
        workspaceReceipt: input.workspaceReceipt, focus: input.focus },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzInvestigationResult(value, input.focus.id),
    }, ctx);
    return { investigation: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
