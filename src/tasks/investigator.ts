import { subtask } from "@constal/sdk";
import { loadArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzInvestigationResult, type HzInvestigatorInput, type HzInvestigatorOutput } from "../contracts.js";
import { INVESTIGATOR_SYSTEM } from "../prompts/discovery.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";

export const investigator = subtask<HzInvestigatorOutput>({
  id: "horizon-investigator",
  version: "4",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<HzInvestigatorInput>(ctx, envelope);
    const conversation = await runReactLoop({
      role: `investigator-${input.focus.id}`, system: INVESTIGATOR_SYSTEM, objective: input.focus.mission,
      context: { request: input.request, discoveryPlan: input.discoveryPlan,
        workspaceReceipt: input.workspaceReceipt, focus: input.focus,
        priorInvestigations: input.priorInvestigations },
      tools: input.tools, model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzInvestigationResult(value, input.focus.id),
    }, ctx);
    return { investigation: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
