export const HORIZON_BEHAVIOR_CATALOG = {
  object: "constal.horizon.behavior-catalog",
  version: 1,
  modes: [{
    id: "issue-work",
    title: "Issue work",
    description: "Investigate an issue, produce an immutable plan, require approval for mutation, execute, verify, and publish the result.",
    eventClasses: ["github.issue.activated", "direct.coding-objective"],
    requiredBindings: ["model", "sandbox", "cas"],
    mutationApproval: "required",
    longHorizon: true,
  }, {
    id: "operate",
    title: "Operate",
    description: "Answer, inspect, explain, summarize, triage, or perform another bounded operational task without preparing a coding workspace.",
    eventClasses: ["github.issue.comment", "github.pull-request.comment", "github.status", "github.question"],
    requiredBindings: ["model"],
    mutationApproval: "policy",
    longHorizon: false,
  }],
} as const;

export type HorizonBehavior = typeof HORIZON_BEHAVIOR_CATALOG.modes[number]["id"];

export interface HorizonRoutedEvent {
  object: "constal.horizon.event";
  version: 1;
  behavior: HorizonBehavior;
  eventClass: string;
  objective: string;
  context?: unknown;
  constraints?: string[];
  source?: unknown;
  environment?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function horizonRoutedEvent(value: unknown): HorizonRoutedEvent | null {
  const source = record(value);
  if (!source || source.object !== "constal.horizon.event" || source.version !== 1
    || !HORIZON_BEHAVIOR_CATALOG.modes.some(({ id }) => id === source.behavior)
    || typeof source.eventClass !== "string" || !source.eventClass || source.eventClass.length > 256
    || typeof source.objective !== "string" || !source.objective.trim() || source.objective.length > 65_536
    || source.constraints !== undefined && (!Array.isArray(source.constraints) || source.constraints.length > 64
      || source.constraints.some((item) => typeof item !== "string" || !item.trim() || item.length > 8_192))) return null;
  return {
    object: "constal.horizon.event", version: 1, behavior: source.behavior as HorizonBehavior,
    eventClass: source.eventClass, objective: source.objective.trim(),
    ...(source.context === undefined ? {} : { context: source.context }),
    ...(source.constraints === undefined ? {} : { constraints: source.constraints as string[] }),
    ...(source.source === undefined ? {} : { source: source.source }),
    ...(source.environment === undefined ? {} : { environment: source.environment }),
  };
}
