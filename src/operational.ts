import type { Ctx } from "@constal/sdk";
import { HORIZON_OPERATIONAL_SYSTEM } from "./prompts/operational.js";
import { runReactLoop } from "./react-loop.js";
import { availableTools, OPERATIONAL_TOOL_NAMES } from "./tools/index.js";
import type { HorizonRoutedEvent } from "./behaviors.js";

export interface HorizonOperationalResult {
  object: "constal.horizon.operational-result";
  version: 1;
  status: "complete" | "needs-input" | "blocked" | "handoff";
  message: string;
  handoff: "issue-work" | "none";
  evidence: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function operationalContext(value: unknown): unknown {
  const source = record(value);
  if (!source) return value ?? null;
  const { approval: _approval, ...context } = source;
  return context;
}

export function parseHorizonOperationalResult(value: unknown): HorizonOperationalResult | null {
  const source = record(value);
  if (!source || source.object !== "constal.horizon.operational-result" || source.version !== 1
    || !["complete", "needs-input", "blocked", "handoff"].includes(String(source.status))
    || typeof source.message !== "string" || !source.message.trim() || source.message.length > 65_536
    || !["issue-work", "none"].includes(String(source.handoff))
    || source.status === "handoff" && source.handoff !== "issue-work"
    || source.status !== "handoff" && source.handoff !== "none"
    || !Array.isArray(source.evidence) || source.evidence.length > 128
    || source.evidence.some((item) => typeof item !== "string" || !item.trim() || item.length > 8_192)) return null;
  return { object: "constal.horizon.operational-result", version: 1,
    status: source.status as HorizonOperationalResult["status"], message: source.message.trim(),
    handoff: source.handoff as HorizonOperationalResult["handoff"], evidence: source.evidence.map(String) };
}

export async function runHorizonOperational(event: HorizonRoutedEvent, ctx: Ctx): Promise<HorizonOperationalResult> {
  const tools = availableTools(OPERATIONAL_TOOL_NAMES, ctx);
  const loop = await runReactLoop({
    role: "operational", system: HORIZON_OPERATIONAL_SYSTEM, objective: event.objective,
    context: { eventClass: event.eventClass, context: operationalContext(event.context), constraints: event.constraints ?? [] },
    tools, model: "model", maxRounds: 64, parse: parseHorizonOperationalResult,
  }, ctx);
  const result = loop.artifact;
  await ctx.commit({ kind: "horizon.operational-result", eventClass: event.eventClass,
    result, toolEvidence: loop.evidence }, { tier: "audit" });
  return result;
}
