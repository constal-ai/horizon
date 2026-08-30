import { subtask } from "@constal/sdk";
import { parseHzDiscoveryPlan, type HzDiscoveryInput, type HzDiscoveryResult } from "../contracts.js";
import { DISCOVERY_SYSTEM } from "../prompts/discovery.js";
import { runReactLoop } from "../react-loop.js";

export const discoveryFramer = subtask<HzDiscoveryResult>({
  id: "horizon-discovery-framer",
  version: "1",
  async run(input: HzDiscoveryInput, ctx) {
    const conversation = await runReactLoop({
      role: "discovery-framer", system: DISCOVERY_SYSTEM,
      objective: "Establish the repository and frame focused software investigations.",
      context: { request: input.request }, tools: input.tools, model: "model", stream: true, maxRounds: 28,
      parse: parseHzDiscoveryPlan,
    }, ctx);
    const imported = [...conversation.evidence].reverse().find((entry) => {
      if (entry.name !== "workspace_import" || !["ok", "repeated", "substituted"].includes(entry.status)) return false;
      const result = entry.result && typeof entry.result === "object" && !Array.isArray(entry.result)
        ? entry.result as Record<string, unknown> : null;
      return typeof result?.path === "string" && result.path.length > 0;
    });
    const result = imported?.result && typeof imported.result === "object" && !Array.isArray(imported.result)
      ? imported.result as Record<string, unknown> : null;
    const workspaceRoot = typeof result?.path === "string" ? result.path : null;
    if (conversation.artifact.status === "ready" && conversation.artifact.workspaceRoot !== workspaceRoot) {
      throw new TypeError("ready Horizon discovery plan did not use the workspace root established by governed import evidence");
    }
    return { discoveryPlan: conversation.artifact, toolEvidence: conversation.evidence };
  },
});

