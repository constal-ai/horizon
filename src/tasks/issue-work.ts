import { subtask, type Ctx } from "@constal/sdk";
import type { HzRunResult } from "../contracts.js";
import { waitPresentation } from "../github-conversation.js";
import { HORIZON_LOOP_WALL_MS } from "../limits.js";
import { runHorizon } from "../workflow.js";

export const issueWorkAgent = subtask<HzRunResult>({
  id: "horizon-issue-work",
  version: "1",
  run(input, ctx) {
    return runHorizon(input, ctx, { requirePlanApproval: true });
  },
});

export async function startIssueWork(input: unknown, ctx: Ctx): Promise<HzRunResult> {
  await ctx.commit({ kind: "horizon.channel-update", phase: "accepted" }, { tier: "audit",
    presentation: waitPresentation("accepted", "Horizon started", "Horizon has started investigating this issue. It will ask questions here when information is missing and will present an exact plan for approval before changing the repository.") });
  return ctx.spawn(issueWorkAgent, input, { retries: 1, dedupe: "specHash",
    budget: { turns: 2_048, microUsd: 500_000_000, wallMs: HORIZON_LOOP_WALL_MS } });
}
