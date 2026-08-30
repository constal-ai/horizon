export type HzPlanStatus = "ready" | "needs-input" | "blocked";
export type HzUnknownState = "open" | "resolved" | "assumed" | "needs-input" | "blocked";

export interface HzUnknown {
  id: string;
  question: string;
  state: HzUnknownState;
  resolution: string | null;
  evidence: string[];
}

export interface HzDiscoveryFocus {
  id: string;
  title: string;
  mission: string;
  questions: string[];
  evidenceNeeded: string[];
  stopWhen: string;
}

export interface HzDiscoveryPlan {
  object: "constal.horizon.discovery-plan";
  version: 1;
  status: "ready" | "partial" | "blocked";
  summary: string;
  workspaceRoot: string | null;
  focuses: HzDiscoveryFocus[];
  unknowns: HzUnknown[];
  blockedReason: string | null;
}

export interface HzInvestigationResult {
  object: "constal.horizon.investigation";
  version: 1;
  focusId: string;
  status: "complete" | "partial" | "blocked";
  summary: string;
  findings: string[];
  evidence: string[];
  unknowns: HzUnknown[];
  planImplications: string[];
  blockedReason: string | null;
}

export interface HzPlanStep {
  id: string;
  title: string;
  responsibility: string;
  specification: string;
  dependsOn: string[];
  verification: string[];
  stopWhen: string;
}

export interface HzPlan {
  object: "constal.horizon.plan";
  version: 1;
  revision: number;
  status: HzPlanStatus;
  objective: string;
  summary: string;
  specification: string;
  workspaceRoot: string | null;
  unknowns: HzUnknown[];
  steps: HzPlanStep[];
  risks: string[];
  question: string | null;
  blockedReason: string | null;
}

export type HzStepStatus = "complete" | "failed" | "blocked";

export interface HzStepResult {
  object: "constal.horizon.step-result";
  version: 1;
  stepId: string;
  status: HzStepStatus;
  summary: string;
  changedFiles: string[];
  verification: string[];
  observations: string[];
  unknowns: HzUnknown[];
  blockedReason: string | null;
}

export type HzReconcileAction = "continue" | "replan" | "ask" | "complete" | "blocked";

export interface HzReconciliation {
  object: "constal.horizon.reconciliation";
  version: 1;
  action: HzReconcileAction;
  summary: string;
  remainingUnknowns: HzUnknown[];
  replanBrief: string | null;
  question: string | null;
  blockedReason: string | null;
}

export interface HzRequest {
  objective: string;
  context: unknown;
  constraints: string[];
}

export interface HzPlanInput {
  request: HzRequest;
  discoveryPlan: HzDiscoveryPlan;
  investigations: HzInvestigationResult[];
  revision: number;
  previousPlan: HzPlan | null;
  completed: HzStepResult[];
  replanBrief: string | null;
  answer: string | null;
  tools: string[];
}

export interface HzDiscoveryInput {
  request: HzRequest;
  tools: string[];
}

export interface HzDiscoveryResult {
  discoveryPlan: HzDiscoveryPlan;
  toolEvidence: HzToolEvidence[];
}

export interface HzInvestigatorInput {
  request: HzRequest;
  discoveryPlan: HzDiscoveryPlan;
  focus: HzDiscoveryFocus;
  tools: string[];
}

export interface HzInvestigatorOutput {
  investigation: HzInvestigationResult;
  toolEvidence: HzToolEvidence[];
}

export interface HzPlannerResult {
  plan: HzPlan;
  toolEvidence: HzToolEvidence[];
}

export interface HzExecutorInput {
  request: HzRequest;
  plan: HzPlan;
  planFact: string;
  step: HzPlanStep;
  completed: HzStepResult[];
  tools: string[];
}

export interface HzExecutorResult {
  result: HzStepResult;
  toolEvidence: HzToolEvidence[];
}

export interface HzReconcilerInput {
  request: HzRequest;
  plan: HzPlan;
  planFact: string;
  completed: HzStepResult[];
  latest: HzStepResult;
  plateau: HzPlateauState;
  tools: string[];
}

export interface HzReconcilerResult {
  reconciliation: HzReconciliation;
  toolEvidence: HzToolEvidence[];
}

export interface HzToolEvidence {
  name: string;
  status: string;
  args: unknown;
  ref: string | null;
  result: unknown;
}

export interface HzPlateauState {
  fingerprint: string | null;
  stableCycles: number;
}

export interface HzRunResult {
  object: "constal.horizon.result";
  version: 1;
  status: "complete" | "blocked";
  summary: string;
  plan: { revision: number; fact: string };
  completedSteps: Array<{ id: string; status: HzStepStatus; summary: string }>;
  remainingUnknowns: HzUnknown[];
  artifact: { ref: string; bytes: number; path: string } | null;
  longHorizon: {
    durablePlan: true;
    specialistRuns: number;
    replans: number;
    plateauCycles: number;
  };
}

function item(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown, maximum = 65_536): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value.trim() : null;
}

function nullableString(value: unknown, maximum = 65_536): string | null | undefined {
  if (value === null) return null;
  return string(value, maximum) ?? undefined;
}

function strings(value: unknown, maximumItems = 128, maximumLength = 16_384): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const parsed = value.map((entry) => string(entry, maximumLength));
  return parsed.every((entry): entry is string => entry !== null) ? parsed : null;
}

export function parseHzRequest(value: unknown): HzRequest {
  if (typeof value === "string") {
    const objective = string(value);
    if (!objective) throw new TypeError("Horizon requires a non-empty objective");
    return { objective, context: null, constraints: [] };
  }
  const source = item(value);
  const objective = string(source?.objective);
  if (!source || !objective) throw new TypeError("Horizon requires a non-empty objective");
  const constraints = source.constraints === undefined ? [] : strings(source.constraints, 64, 8_192);
  if (!constraints) throw new TypeError("Horizon constraints are invalid");
  return { objective, context: source.context ?? null, constraints };
}

export function parseHzUnknown(value: unknown): HzUnknown | null {
  const source = item(value);
  const id = string(source?.id, 256); const question = string(source?.question, 16_384);
  const state = source?.state;
  const resolution = nullableString(source?.resolution, 32_768);
  const evidence = strings(source?.evidence, 64, 8_192);
  if (!source || !id || !question || !["open", "resolved", "assumed", "needs-input", "blocked"].includes(String(state))
    || resolution === undefined || !evidence) return null;
  return { id, question, state: state as HzUnknownState, resolution, evidence };
}

function unknowns(value: unknown): HzUnknown[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed = value.map(parseHzUnknown);
  if (!parsed.every((entry): entry is HzUnknown => entry !== null)) return null;
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) return null;
  return parsed;
}

export function parseHzDiscoveryFocus(value: unknown): HzDiscoveryFocus | null {
  const source = item(value); const id = string(source?.id, 256); const title = string(source?.title, 1_024);
  const mission = string(source?.mission, 32_768); const questions = strings(source?.questions, 64, 8_192);
  const evidenceNeeded = strings(source?.evidenceNeeded, 64, 8_192); const stopWhen = string(source?.stopWhen, 8_192);
  if (!source || !id || !title || !mission || !questions || !evidenceNeeded || !stopWhen) return null;
  return { id, title, mission, questions, evidenceNeeded, stopWhen };
}

export function parseHzDiscoveryPlan(value: unknown): HzDiscoveryPlan | null {
  const source = item(value); const status = source?.status; const summary = string(source?.summary, 32_768);
  const workspaceRoot = nullableString(source?.workspaceRoot, 4_096); const parsedUnknowns = unknowns(source?.unknowns);
  const blockedReason = nullableString(source?.blockedReason, 16_384);
  if (!source || source.object !== "constal.horizon.discovery-plan" || source.version !== 1
    || !["ready", "partial", "blocked"].includes(String(status)) || !summary || workspaceRoot === undefined
    || !parsedUnknowns || blockedReason === undefined || !Array.isArray(source.focuses)
    || source.focuses.length === 0 || source.focuses.length > 16) return null;
  const focuses = source.focuses.map(parseHzDiscoveryFocus);
  if (!focuses.every((focus): focus is HzDiscoveryFocus => focus !== null)
    || new Set(focuses.map(({ id }) => id)).size !== focuses.length) return null;
  if (status === "ready" && !workspaceRoot || status === "blocked" && !blockedReason) return null;
  return { object: "constal.horizon.discovery-plan", version: 1,
    status: status as HzDiscoveryPlan["status"], summary, workspaceRoot, focuses,
    unknowns: parsedUnknowns, blockedReason };
}

export function parseHzInvestigationResult(value: unknown, expectedFocusId?: string): HzInvestigationResult | null {
  const source = item(value); const focusId = string(source?.focusId, 256); const status = source?.status;
  const summary = string(source?.summary, 32_768); const findings = strings(source?.findings, 128, 16_384);
  const evidence = strings(source?.evidence, 128, 16_384); const parsedUnknowns = unknowns(source?.unknowns);
  const planImplications = strings(source?.planImplications, 128, 16_384);
  const blockedReason = nullableString(source?.blockedReason, 16_384);
  if (!source || source.object !== "constal.horizon.investigation" || source.version !== 1 || !focusId
    || expectedFocusId !== undefined && focusId !== expectedFocusId
    || !["complete", "partial", "blocked"].includes(String(status)) || !summary || !findings || !evidence
    || !parsedUnknowns || !planImplications || blockedReason === undefined
    || status === "blocked" && !blockedReason) return null;
  return { object: "constal.horizon.investigation", version: 1, focusId,
    status: status as HzInvestigationResult["status"], summary, findings, evidence,
    unknowns: parsedUnknowns, planImplications, blockedReason };
}

export function parseHzPlanStep(value: unknown): HzPlanStep | null {
  const source = item(value);
  const id = string(source?.id, 256); const title = string(source?.title, 1_024);
  const responsibility = string(source?.responsibility, 8_192); const specification = string(source?.specification);
  const dependsOn = strings(source?.dependsOn, 64, 256); const verification = strings(source?.verification, 64, 8_192);
  const stopWhen = string(source?.stopWhen, 8_192);
  if (!source || !id || !title || !responsibility || !specification || !dependsOn || !verification || !stopWhen) return null;
  return { id, title, responsibility, specification, dependsOn, verification, stopWhen };
}

function dependenciesAreAcyclic(steps: readonly HzPlanStep[]): boolean {
  const remaining = new Map(steps.map((step) => [step.id, new Set(step.dependsOn)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, dependencies] of remaining) {
      if (dependencies.size > 0) continue;
      remaining.delete(id);
      for (const unresolved of remaining.values()) unresolved.delete(id);
      changed = true;
    }
  }
  return remaining.size === 0;
}

export function parseHzPlan(value: unknown): HzPlan | null {
  const source = item(value);
  const status = source?.status; const revision = source?.revision;
  const objective = string(source?.objective); const summary = string(source?.summary, 32_768);
  const specification = string(source?.specification, 262_144); const workspaceRoot = nullableString(source?.workspaceRoot, 4_096);
  const parsedUnknowns = unknowns(source?.unknowns); const risks = strings(source?.risks, 128, 8_192);
  const question = nullableString(source?.question, 16_384); const blockedReason = nullableString(source?.blockedReason, 16_384);
  if (!source || source.object !== "constal.horizon.plan" || source.version !== 1
    || !Number.isInteger(revision) || Number(revision) < 1
    || !["ready", "needs-input", "blocked"].includes(String(status))
    || !objective || !summary || !specification || workspaceRoot === undefined || !parsedUnknowns || !risks
    || question === undefined || blockedReason === undefined || !Array.isArray(source.steps) || source.steps.length > 128) return null;
  const steps = source.steps.map(parseHzPlanStep);
  if (!steps.every((entry): entry is HzPlanStep => entry !== null)) return null;
  if (new Set(steps.map(({ id }) => id)).size !== steps.length) return null;
  const ids = new Set(steps.map(({ id }) => id));
  if (steps.some(({ id, dependsOn }) => dependsOn.includes(id) || dependsOn.some((dependency) => !ids.has(dependency)))
    || !dependenciesAreAcyclic(steps)) return null;
  if (status === "ready" && (!workspaceRoot || steps.length === 0)) return null;
  if (status === "needs-input" && !question || status === "blocked" && !blockedReason) return null;
  return { object: "constal.horizon.plan", version: 1, revision: Number(revision), status: status as HzPlanStatus,
    objective, summary, specification, workspaceRoot, unknowns: parsedUnknowns, steps, risks, question, blockedReason };
}

export function parseHzStepResult(value: unknown, expectedStepId?: string): HzStepResult | null {
  const source = item(value); const stepId = string(source?.stepId, 256); const status = source?.status;
  const summary = string(source?.summary, 32_768); const changedFiles = strings(source?.changedFiles, 256, 4_096);
  const verification = strings(source?.verification, 128, 16_384); const observations = strings(source?.observations, 128, 16_384);
  const parsedUnknowns = unknowns(source?.unknowns); const blockedReason = nullableString(source?.blockedReason, 16_384);
  if (!source || source.object !== "constal.horizon.step-result" || source.version !== 1 || !stepId
    || expectedStepId !== undefined && stepId !== expectedStepId || !["complete", "failed", "blocked"].includes(String(status))
    || !summary || !changedFiles || !verification || !observations || !parsedUnknowns || blockedReason === undefined) return null;
  if (status === "blocked" && !blockedReason) return null;
  return { object: "constal.horizon.step-result", version: 1, stepId, status: status as HzStepStatus,
    summary, changedFiles, verification, observations, unknowns: parsedUnknowns, blockedReason };
}

export function parseHzReconciliation(value: unknown): HzReconciliation | null {
  const source = item(value); const action = source?.action; const summary = string(source?.summary, 32_768);
  const remainingUnknowns = unknowns(source?.remainingUnknowns); const replanBrief = nullableString(source?.replanBrief, 65_536);
  const question = nullableString(source?.question, 16_384); const blockedReason = nullableString(source?.blockedReason, 16_384);
  if (!source || source.object !== "constal.horizon.reconciliation" || source.version !== 1
    || !["continue", "replan", "ask", "complete", "blocked"].includes(String(action)) || !summary || !remainingUnknowns
    || replanBrief === undefined || question === undefined || blockedReason === undefined) return null;
  if (action === "replan" && !replanBrief || action === "ask" && !question || action === "blocked" && !blockedReason) return null;
  return { object: "constal.horizon.reconciliation", version: 1, action: action as HzReconcileAction,
    summary, remainingUnknowns, replanBrief, question, blockedReason };
}
