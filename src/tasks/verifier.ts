import { subtask } from "@constal/sdk";
import { loadArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzVerification, type HzVerifierInput, type HzVerifierResult } from "../contracts.js";
import { VERIFIER_SYSTEM } from "../prompts/verifier.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";

export const verifier = subtask<HzVerifierResult>({
  id: "horizon-verifier",
  version: "6",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<HzVerifierInput>(ctx, envelope);
    const conversation = await runReactLoop({
      role: `verifier-${input.step.id}`, system: VERIFIER_SYSTEM,
      objective: `Verify work unit ${input.step.id}: ${input.step.stopWhen}`,
      context: { request: input.request, plan: input.plan, planFact: input.planFact,
        assignedStep: input.step,
        assertions: input.plan.assertions.find(({ stepId }) => stepId === input.step.id)?.assertions ?? [],
        executorReport: input.execution, executionToolEvidence: input.executionToolEvidence },
      tools: input.tools,
      plateauStages: [input.tools.filter((name) => name === "workspace_read")],
      model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: (value) => parseHzVerification(value, input.step.id),
    }, ctx);
    return { verification: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
