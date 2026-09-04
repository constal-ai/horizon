// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { subtask } from "@constal/sdk";
import { parseHzDiscoveryPlan, type HzDiscoveryInput, type HzDiscoveryResult } from "../contracts.js";
import { DISCOVERY_SYSTEM } from "../prompts/discovery.js";
import { runReactLoop } from "../react-loop.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";

export const discoveryFramer = subtask<HzDiscoveryResult>({
  id: "horizon-discovery-framer",
  version: "3",
  async run(input: HzDiscoveryInput, ctx) {
    const conversation = await runReactLoop({
      role: "discovery-framer", system: DISCOVERY_SYSTEM,
      objective: "Establish the repository and frame focused software investigations.",
      context: { request: input.request, workspaceRoot: input.workspaceRoot, workspaceReceipt: input.workspaceReceipt },
      tools: input.tools, model: "model", stream: true,
      maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: parseHzDiscoveryPlan,
    }, ctx);
    if (conversation.artifact.workspaceRoot !== input.workspaceRoot) {
      throw new TypeError("Horizon discovery plan did not preserve the deterministically prepared workspace root");
    }
    return { discoveryPlan: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
