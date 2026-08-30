import { subtask } from "@constal/sdk";
import { parseHzVerification, type HzVerifierInput, type HzVerifierResult } from "../contracts.js";
import { VERIFIER_SYSTEM } from "../prompts/verifier.js";
import { runReactLoop } from "../react-loop.js";

export const verifier = subtask<HzVerifierResult>({
  id: "horizon-verifier",
  version: "1",
  async run(input: HzVerifierInput, ctx) {
    const conversation = await runReactLoop({
      role: `verifier-${input.step.id}`, system: VERIFIER_SYSTEM,
      objective: `Verify work unit ${input.step.id}: ${input.step.stopWhen}`,
      context: { request: input.request, plan: input.plan, planFact: input.planFact,
        assignedStep: input.step, executorReport: input.execution },
      tools: input.tools, model: "model", maxRounds: 20,
      parse: (value) => parseHzVerification(value, input.step.id),
    }, ctx);
    return { verification: conversation.artifact, toolEvidence: conversation.evidence };
  },
});

