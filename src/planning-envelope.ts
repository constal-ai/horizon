type PlanningRecord = Record<string, unknown>;

function record(value: unknown): PlanningRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlanningRecord : null;
}

export function planningArtifact(value: unknown, identity: {
  object: string;
  revision?: number;
  milestoneId?: string;
  stepId?: string;
}): unknown {
  const source = record(value);
  if (!source) return value;
  return { ...source, ...identity, version: 1 };
}

export function milestoneWorkArtifact(value: unknown, revision: number, milestoneId: string): unknown {
  const source = record(value);
  if (!source) return value;
  return planningArtifact({ ...source,
    steps: Array.isArray(source.steps) ? source.steps.map((value) => {
      const step = record(value);
      return step ? { ...step, milestoneId } : value;
    }) : source.steps,
  }, { object: "constal.horizon.milestone-work", revision, milestoneId });
}
