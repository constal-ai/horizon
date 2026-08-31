import { subtask } from "@constal/sdk";
import type { HorizonPlanDecision } from "../workflow.js";
import type { HzPlan } from "../contracts.js";
import type { HorizonRoutedEvent } from "../behaviors.js";
import { HORIZON_APPROVAL_SYSTEM } from "../prompts/approval.js";

export interface HorizonApprovalInput { plan: HzPlan; planFact: string; event: HorizonRoutedEvent }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseApprovalDecision(value: unknown, planFact: string): HorizonPlanDecision | null {
  const source = record(value);
  if (!source || source.object !== "constal.horizon.plan-decision" || source.version !== 1 || source.planFact !== planFact
    || !["approve", "revise", "cancel"].includes(String(source.decision))
    || source.guidance !== null && (typeof source.guidance !== "string" || !source.guidance.trim() || source.guidance.length > 65_536)
    || source.decision === "revise" && source.guidance === null || source.decision !== "revise" && source.guidance !== null) return null;
  return { object: "constal.horizon.plan-decision", version: 1, planFact,
    decision: source.decision as HorizonPlanDecision["decision"],
    guidance: source.guidance === null ? null : source.guidance.trim() };
}

export const approvalInterpreter = subtask<HorizonPlanDecision>({
  id: "horizon-approval-interpreter", version: "1",
  async run(input: HorizonApprovalInput, ctx) {
    const result = await ctx.turn({ system: HORIZON_APPROVAL_SYSTEM,
      objective: "Interpret the authenticated comment against the exact plan revision.",
      context: { plan: input.plan, planFact: input.planFact, event: input.event }, tools: [],
      gate: { id: "horizon-approval-meaning", version: "1", retries: 3,
        before: (draft) => parseApprovalDecision(draft.artifact ?? (() => {
          try { return JSON.parse(draft.message.content); } catch { return null; }
        })(), input.planFact) !== null,
        feedback: () => "Return only the required plan-decision JSON object for the exact supplied plan Fact." },
    });
    const decision = parseApprovalDecision(result.artifact ?? (() => {
      try { return JSON.parse(result.message.content); } catch { return null; }
    })(), input.planFact);
    if (!decision) throw new TypeError("Horizon approval interpreter returned an invalid decision");
    return decision;
  },
});
