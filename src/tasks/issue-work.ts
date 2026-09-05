// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Ctx } from "@constal/sdk";
import type { HzRunResult } from "../contracts.js";
import { waitPresentation } from "../github-conversation.js";
import { runHorizon } from "../workflow.js";

export async function startIssueWork(input: unknown, ctx: Ctx): Promise<HzRunResult> {
  await ctx.commit({ kind: "horizon.channel-update", phase: "accepted" }, { tier: "audit",
    presentation: waitPresentation("accepted", "Getting started", "I'll investigate the code and share a plan here before making changes. If I need a decision from you, I'll ask in this thread.") });
  return runHorizon(input, ctx, { requirePlanApproval: true });
}
