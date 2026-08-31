import { subtask } from "@constal/sdk";
import { parseHzSourceResolution, type HzSourceResolverInput, type HzSourceResolverResult } from "../contracts.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";
import { SOURCE_RESOLVER_SYSTEM } from "../prompts/source.js";
import { runReactLoop } from "../react-loop.js";

export const sourceResolver = subtask<HzSourceResolverResult>({
  id: "horizon-source-resolver",
  version: "1",
  async run(input: HzSourceResolverInput, ctx) {
    const conversation = await runReactLoop({
      role: "source-resolver", system: SOURCE_RESOLVER_SYSTEM,
      objective: "Resolve one authenticated repository and revision for this mission.",
      context: { request: input.request, answer: input.answer }, tools: input.tools, model: "model", stream: true,
      maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: parseHzSourceResolution,
    }, ctx);
    return { resolution: conversation.artifact, toolEvidence: conversation.evidence };
  },
});
