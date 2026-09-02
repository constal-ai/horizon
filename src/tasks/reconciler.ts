import { subtask } from "@constal/sdk";
import { loadArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzReconciliation, type HzReconcilerInput, type HzReconcilerResult } from "../contracts.js";
import { RECONCILER_SYSTEM } from "../prompts/reconciler.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";

export const reconciler = subtask<HzReconcilerResult>({
  id: "horizon-reconciler",
  version: "2",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<HzReconcilerInput>(ctx, envelope);
    const completedIds = new Set(input.completed.filter(({ status }) => status === "complete").map(({ stepId }) => stepId));
    const pending = input.plan.steps.filter(({ id }) => !completedIds.has(id));
    const latest = input.attempt.execution; const verification = input.attempt.verification;
    const conversation = await runReactLoop({
      role: "reconciler",
      system: RECONCILER_SYSTEM,
      objective: "Reconcile the latest specialist result with the immutable plan.",
      context: {
        request: input.request,
        plan: input.plan,
        planFact: input.planFact,
        completed: input.completed,
        attempt: input.attempt,
        restoreAvailable: input.restoreAvailable,
        pendingStepIds: pending.map(({ id }) => id),
        plateau: input.plateau,
      },
      tools: input.tools,
      model: "model",
      maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse(value) {
        const result = parseHzReconciliation(value);
        if (!result) return null;
        if (result.workspaceDisposition === "restore-last-verified" && !input.restoreAvailable) return null;
        if (result.action === "complete" && pending.length > 0) return null;
        if (result.action === "complete" && result.remainingUnknowns.some(({ state }) => !["resolved", "assumed"].includes(state))) return null;
        if (result.action === "continue" && (pending.length === 0 || latest.status !== "complete"
          || verification.verdict !== "passed")) return null;
        if (result.action === "repair-step" && latest.status === "complete" && verification.verdict === "passed") return null;
        if (result.action === "reverify" && (latest.status !== "complete" || verification.verdict === "passed")) return null;
        return result;
      },
    }, ctx);
    return { reconciliation: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
