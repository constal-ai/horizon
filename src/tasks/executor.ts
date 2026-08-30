import { subtask } from "@constal/sdk";
import { parseHzStepResult, type HzExecutorInput, type HzExecutorResult } from "../contracts.js";
import { EXECUTOR_SYSTEM } from "../prompts/executor.js";
import { runReactLoop } from "../react-loop.js";

export const executor = subtask<HzExecutorResult>({
  id: "horizon-executor",
  version: "1",
  async run(input: HzExecutorInput, ctx) {
    const conversation = await runReactLoop({
      role: `executor-${input.step.id}`,
      system: EXECUTOR_SYSTEM,
      objective: input.step.responsibility,
      context: {
        request: input.request,
        plan: input.plan,
        planFact: input.planFact,
        assignedStep: input.step,
        completedDependencies: input.completed.filter(({ stepId }) => input.step.dependsOn.includes(stepId)),
      },
      tools: input.tools,
      model: "model",
      stream: true,
      maxRounds: 40,
      parse: (value) => parseHzStepResult(value, input.step.id),
    }, ctx);
    return { result: conversation.artifact, toolEvidence: conversation.evidence };
  },
});

