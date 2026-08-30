import { subtask } from "@constal/sdk";
import { parseHzReconciliation, type HzReconcilerInput, type HzReconcilerResult } from "../contracts.js";
import { RECONCILER_SYSTEM } from "../prompts/reconciler.js";
import { runReactLoop } from "../react-loop.js";

export const reconciler = subtask<HzReconcilerResult>({
  id: "horizon-reconciler",
  version: "1",
  async run(input: HzReconcilerInput, ctx) {
    const completedIds = new Set(input.completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
    const pending = input.plan.steps.filter(({ id }) => !completedIds.has(id));
    const conversation = await runReactLoop({
      role: "reconciler",
      system: RECONCILER_SYSTEM,
      objective: "Reconcile the latest specialist result with the immutable plan.",
      context: {
        request: input.request,
        plan: input.plan,
        planFact: input.planFact,
        completed: input.completed,
        latest: input.latest,
        verification: input.verification,
        pendingStepIds: pending.map(({ id }) => id),
        plateau: input.plateau,
      },
      tools: input.tools,
      model: "model",
      maxRounds: 10,
      parse(value) {
        const result = parseHzReconciliation(value);
        if (!result) return null;
        if (result.action === "complete" && pending.length > 0) return null;
        if (result.action === "complete" && result.remainingUnknowns.some(({ state }) => !["resolved", "assumed"].includes(state))) return null;
        if (result.action === "continue" && (pending.length === 0 || input.latest.status !== "complete"
          || input.verification.verdict !== "passed")) return null;
        return result;
      },
    }, ctx);
    return { reconciliation: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
