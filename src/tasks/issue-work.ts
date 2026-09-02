import type { Ctx } from "@constal/sdk";
import type { HzRunResult } from "../contracts.js";
import { waitPresentation } from "../github-conversation.js";
import { runHorizon } from "../workflow.js";

export async function startIssueWork(input: unknown, ctx: Ctx): Promise<HzRunResult> {
  await ctx.commit({ kind: "horizon.channel-update", phase: "accepted" }, { tier: "audit",
    presentation: waitPresentation("accepted", "Horizon started", "Horizon has started investigating this issue. It will ask questions here when information is missing and will present an exact plan for approval before changing the repository.") });
  return runHorizon(input, ctx, { requirePlanApproval: true });
}
