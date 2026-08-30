import { subtask } from "@constal/sdk";
import { parseHzPlan, type HzPlanInput, type HzPlannerResult } from "../contracts.js";
import { PLANNER_SYSTEM } from "../prompts/planner.js";
import { runReactLoop } from "../react-loop.js";

function observedWorkspaceRoot(result: Awaited<ReturnType<typeof runReactLoop>>): string | null {
  for (const evidence of [...result.evidence].reverse()) {
    if (evidence.name !== "workspace_import" || !["ok", "repeated", "substituted"].includes(evidence.status)) continue;
    const item = evidence.result && typeof evidence.result === "object" && !Array.isArray(evidence.result)
      ? evidence.result as Record<string, unknown> : null;
    if (typeof item?.path === "string" && item.path.length > 0) return item.path;
  }
  return null;
}

export const planner = subtask<HzPlannerResult>({
  id: "horizon-planner",
  version: "1",
  async run(input: HzPlanInput, ctx) {
    const conversation = await runReactLoop({
      role: "planner",
      system: PLANNER_SYSTEM,
      objective: input.previousPlan ? "Reconcile the immutable execution plan with new evidence." : "Create the immutable execution plan.",
      context: {
        request: input.request,
        discoveryPlan: input.discoveryPlan,
        investigations: input.investigations,
        revision: input.revision,
        previousPlan: input.previousPlan,
        completed: input.completed,
        replanBrief: input.replanBrief,
        answer: input.answer,
      },
      tools: input.tools,
      model: "model",
      stream: true,
      maxRounds: 32,
      parse(value) {
        const plan = parseHzPlan(value);
        return plan?.revision === input.revision && plan.objective === input.request.objective ? plan : null;
      },
    }, ctx);
    const workspaceRoot = observedWorkspaceRoot(conversation) ?? input.discoveryPlan.workspaceRoot
      ?? input.previousPlan?.workspaceRoot ?? null;
    if (conversation.artifact.status === "ready" && conversation.artifact.workspaceRoot !== workspaceRoot) {
      throw new TypeError("ready Horizon plan did not use the workspace root established by governed evidence");
    }
    return { plan: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
