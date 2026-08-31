import { subtask } from "@constal/sdk";
import { parseHzStepResult, type HzExecutorInput, type HzExecutorResult } from "../contracts.js";
import { EXECUTOR_SYSTEM } from "../prompts/executor.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_EXECUTION_LOOP_TURNS } from "../limits.js";

export const executor = subtask<HzExecutorResult>({
  id: "horizon-executor",
  version: "5",
  async run(input: HzExecutorInput, ctx) {
    const conversation = await runReactLoop({
      role: `executor-${input.step.id}`,
      system: EXECUTOR_SYSTEM,
      objective: `${input.step.responsibility}\n\nAssigned execution specification:\n${input.step.specification}\n\nStop condition:\n${input.step.stopWhen}`,
      context: {
        request: input.request,
        plan: input.plan,
        planFact: input.planFact,
        assignedStep: input.step,
        assertions: input.plan.assertions.find(({ stepId }) => stepId === input.step.id)?.assertions ?? [],
        completedDependencies: input.completed.filter(({ stepId }) => input.step.dependsOn.includes(stepId)),
      },
      tools: input.tools,
      model: "model",
      stream: true,
      maxRounds: HORIZON_EXECUTION_LOOP_TURNS,
      parse: (value) => parseHzStepResult(value, input.step.id),
    }, ctx);
    return { result: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
