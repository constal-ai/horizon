// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

export type HzPlanStatus = "ready" | "needs-input";
export type HzUnknownState = "open" | "resolved" | "assumed" | "needs-input" | "blocked";

export interface HzUnknown {
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
  status: "ready" | "partial";
  summary: string;
  workspaceRoot: string | null;
  focuses: HzDiscoveryFocus[];
  unknowns: HzUnknown[];
}

export interface HzInvestigationResult {
  object: "constal.horizon.investigation";
  version: 1;
  focusId: string;
  status: "complete" | "partial";
  summary: string;
  findings: string[];
  evidence: string[];
  unknowns: HzUnknown[];
  planImplications: string[];
}

export interface HzRubric {
  object: "constal.horizon.rubric";
  version: 1;
  revision: number;
  objective: string;
  successCriteria: string[];
  constraints: string[];
  nonGoals: string[];
  openQuestions: HzUnknown[];
  verificationPrinciples: string[];
}

export interface HzDesignDecision {
  question: string;
  decision: string;
  rationale: string;
  evidence: string[];
}

export interface HzMilestone {
  id: string;
  title: string;
  outcome: string;
  dependsOn: string[];
  responsibilities: string[];
  risks: string[];
}

export interface HzDesign {
  object: "constal.horizon.design";
  version: 1;
  revision: number;
  summary: string;
  decisions: HzDesignDecision[];
  milestones: HzMilestone[];
}

export interface HzWorkPlan {
  object: "constal.horizon.work-plan";
  version: 1;
  revision: number;
  steps: HzPlanStep[];
}

export interface HzMilestoneWork {
  object: "constal.horizon.milestone-work";
  version: 1;
  revision: number;
  milestoneId: string;
  steps: HzPlanStep[];
}

export interface HzAssertion {
  claim: string;
  evidenceRequired: string[];
  negativePath: boolean;
}

export interface HzStepAssertions {
  object: "constal.horizon.step-assertions";
  version: 1;
  revision: number;
  stepId: string;
  assertions: HzAssertion[];
}

export type HzPlanningOwner = "investigation" | "rubric" | "design" | "decomposition" | "assertions";

export type HzContinuityDisposition = "retain" | "reverify" | "rerun" | "dropped";

export interface HzContinuityDecision {
  priorStepId: string;
  nextStepId: string | null;
  disposition: HzContinuityDisposition;
  reason: string;
  evidence: string[];
}

export interface HzPlanContinuity {
  object: "constal.horizon.plan-continuity";
  version: 1;
  revision: number;
  decisions: HzContinuityDecision[];
}

export interface HzAssertionPlan {
  object: "constal.horizon.assertion-plan";
  version: 1;
  revision: number;
  assertions: HzStepAssertions[];
}

export type HzCritiqueOwner = HzPlanningOwner | "continuity" | "user";

export interface HzCritiqueFinding {
  owner: HzCritiqueOwner;
  severity: "blocking" | "advisory";
  affectedMilestones: string[];
  affectedSteps: string[];
  issue: string;
  evidence: string[];
  repair: string;
}

export interface HzDecisionQuestion {
  prompt: string;
  options: [string, string, string];
}

export interface HzQuestionReconciliation {
  object: "constal.horizon.question-reconciliation";
  version: 1;
  decision: "new" | "answered";
  rationale: string;
}

export interface HzPlanCritique {
  object: "constal.horizon.plan-critique";
  version: 1;
  revision: number;
  verdict: "accepted" | "repair" | "needs-input";
  summary: string;
  findings: HzCritiqueFinding[];
  question: HzDecisionQuestion | null;
}

export interface HzPlanStep {
  id: string;
  milestoneId: string;
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
  assertions: HzStepAssertions[];
  risks: string[];
  question: HzDecisionQuestion | null;
}

export interface HzPlanNarrative {
  object: "constal.horizon.plan-narrative";
  version: 1;
  summary: string;
  specification: string;
  unknowns: HzUnknown[];
  risks: string[];
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

export interface HzVerificationCheck {
  target: string;
  outcome: "passed" | "failed" | "not-run";
  evidence: string;
}

export interface HzVerification {
  object: "constal.horizon.verification";
  version: 1;
  stepId: string;
  verdict: "passed" | "failed" | "blocked";
  summary: string;
  checks: HzVerificationCheck[];
  unknowns: HzUnknown[];
  failureBrief: string | null;
  blockedReason: string | null;
}

export type HzReconcileAction = "continue" | "repair-step" | "reverify" | "replan" | "ask" | "complete";
export type HzWorkspaceDisposition = "keep-current" | "restore-last-verified";

export interface HzReconciliation {
  object: "constal.horizon.reconciliation";
  version: 2;
  action: HzReconcileAction;
  summary: string;
  remainingUnknowns: HzUnknown[];
  planningOwner: HzPlanningOwner | null;
  workspaceDisposition: HzWorkspaceDisposition;
  replanBrief: string | null;
  question: HzDecisionQuestion | null;
}

export interface HzRequest {
  objective: string;
  context: unknown;
  constraints: string[];
  source: HzSourceInput | null;
  environment: HzEnvironmentSpec;
}

export type HzSourceInput = {
  kind: "github";
  owner: string;
  repository: string;
  ref: string;
} | {
  kind: "artifact";
  ref: string;
  format: "tar.gz";
};

export interface HzEnvironmentCommand {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface HzEnvironmentSpec {
  name: string;
  cache: boolean;
  setup: HzEnvironmentCommand[];
}

export interface HzSourceResolution {
  object: "constal.horizon.source-resolution";
  version: 1;
  status: "ready" | "needs-input";
  source: Extract<HzSourceInput, { kind: "github" }> | null;
  evidence: string[];
  question: string | null;
}

export interface HzSourceResolverInput {
  request: HzRequest;
  answer: string | null;
  tools: string[];
}

export interface HzSourceResolverResult {
  resolution: HzSourceResolution;
  toolEvidence: HzToolEvidence[];
}

export interface HzResolvedSource {
  kind: "github" | "artifact";
  archive: { ref: string; bytes: number | null; format: "tar.gz" };
  github: { owner: string; repository: string; requestedRef: string; sourceUrl: string | null } | null;
}

export interface HzWorkspaceReceipt {
  object: "constal.horizon.workspace-ready";
  version: 1;
  session: string;
  sandbox: string;
  root: "/workspace/repo";
  cache: { key: string; hit: boolean; image: string | null };
  runner: { protocol: "constal.workspace-runner"; version: 2; digest: string };
  source: HzResolvedSource;
  baseline: { commit: string; tree: string };
  setup: HzEnvironmentSpec;
}

export interface HzWorkspaceCheckpoint {
  object: "constal.horizon.workspace-checkpoint";
  version: 1;
  workspaceReceipt: string;
  planFact: string;
  stepFact: string;
  verificationFact: string;
  stepId: string;
  tree: string;
  status: string;
  image: string | null;
  cacheKey: string;
}

export interface HzWorkspaceAnchor {
  kind: "prepared" | "verified";
  stepId: string | null;
  receipt: string;
  cacheKey: string;
  image: string | null;
  tree: string;
  status: string;
}

export interface HzWorkspaceState {
  tree: string;
  status: string;
}

export interface HzExecutionAttempt {
  object: "constal.horizon.execution-attempt";
  version: 1;
  id: string;
  ordinal: number;
  planFact: string;
  stepId: string;
  executionReused: boolean;
  previousAttemptRef: string | null;
  restorePoint: HzWorkspaceAnchor;
  workspaceBefore: HzWorkspaceState;
  workspaceAfter: HzWorkspaceState;
  stepFact: string;
  verificationFact: string;
  execution: HzStepResult;
  executionToolEvidence: HzToolEvidenceSummary[];
  verification: HzVerification;
  verificationToolEvidence: HzToolEvidenceSummary[];
}

export interface HzPlanningState {
  object: "constal.horizon.planning-state";
  version: 1;
  revision: number;
  investigations: HzInvestigationResult[];
  investigationObservationSignatures: string[];
  rubric: HzRubric;
  design: HzDesign;
  workPlan: HzWorkPlan;
  assertions: HzStepAssertions[];
  continuity: HzPlanContinuity;
  critique: HzPlanCritique;
}

export interface HzPlanInput {
  request: HzRequest;
  discoveryPlan: HzDiscoveryPlan;
  investigations: HzInvestigationResult[];
  workspaceReceipt: string;
  revision: number;
  previousPlan: HzPlan | null;
  previousState: HzPlanningState | null;
  completed: HzStepResult[];
  completedEvidence: HzExecutionAttempt[];
  restartAt: HzPlanningOwner | null;
  executionEvidence: HzExecutionAttempt | null;
  replanBrief: string | null;
  answer: string | null;
  tools: string[];
}

export interface HzDiscoveryInput {
  request: HzRequest;
  workspaceRoot: string;
  workspaceReceipt: string;
  tools: string[];
}

export interface HzDiscoveryResult {
  discoveryPlan: HzDiscoveryPlan;
  toolEvidence: HzToolEvidence[];
}

export interface HzInvestigatorInput {
  request: HzRequest;
  discoveryPlan: HzDiscoveryPlan;
  workspaceReceipt: string;
  focus: HzDiscoveryFocus;
  priorInvestigations: HzInvestigationResult[];
  tools: string[];
}

export interface HzInvestigatorOutput {
  investigation: HzInvestigationResult;
  toolEvidence: HzToolEvidence[];
}

export interface HzPlannerResult {
  plan: HzPlan;
  state: HzPlanningState;
  toolEvidence: HzToolEvidence[];
  planningRuns: number;
}

export interface HzExecutorInput {
  request: HzRequest;
  plan: HzPlan;
  planFact: string;
  step: HzPlanStep;
  completed: HzStepResult[];
  previousAttempt: HzExecutionAttempt | null;
  tools: string[];
}

export interface HzExecutorResult {
  result: HzStepResult;
  toolEvidence: HzToolEvidence[];
}

export interface HzVerifierInput {
  request: HzRequest;
  plan: HzPlan;
  planFact: string;
  step: HzPlanStep;
  execution: HzStepResult;
  stepFact: string;
  executionToolEvidence: HzToolEvidenceSummary[];
  tools: string[];
}

export interface HzVerifierResult {
  verification: HzVerification;
  toolEvidence: HzToolEvidence[];
}

export interface HzReconcilerInput {
  request: HzRequest;
  plan: HzPlan;
  planFact: string;
  completed: HzStepResult[];
  attempt: HzExecutionAttempt;
  restoreAvailable: boolean;
  plateau: HzPlateauState;
  attemptedPlateauReplan: boolean;
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
  /** Complete in-memory Tool value for same-invocation decisions; intentionally omitted from durable serialization. */
  value?: unknown;
}

export interface HzToolEvidenceSummary {
  name: string;
  status: string;
  ref: string | null;
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
  plan: { revision: number; fact: string } | null;
  workspace: { receipt: string; cacheHit: boolean; image: string | null } | null;
  checkpoints: Array<{ stepId: string; receipt: string; image: string | null; tree: string }>;
  completedSteps: Array<{ id: string; status: HzStepStatus; summary: string }>;
  remainingUnknowns: HzUnknown[];
  artifact: { ref: string; bytes: number; path: string } | null;
  publication: { provider: "github"; repository: string; branch: string; commit: string;
    pullRequest: { number: number; url: string }; marker: string } | null;
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

export function parseHzDecisionQuestion(value: unknown): HzDecisionQuestion | null | undefined {
  if (value === null) return null;
  const source = item(value); const prompt = string(source?.prompt, 16_384);
  const options = strings(source?.options, 3, 8_192);
  if (!source || !prompt || !options || options.length !== 3 || new Set(options).size !== 3
    || Object.keys(source).some((key) => !["prompt", "options"].includes(key))) return undefined;
  return { prompt, options: options as [string, string, string] };
}

function strings(value: unknown, maximumItems = 128, maximumLength = 16_384): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const parsed = value.map((entry) => string(entry, maximumLength));
  return parsed.every((entry): entry is string => entry !== null) ? parsed : null;
}

function parseSourceInput(value: unknown): HzSourceInput | null {
  const source = item(value); const kind = source?.kind;
  if (source && kind === "github") {
    const owner = string(source.owner, 100); const repository = string(source.repository, 100); const ref = string(source.ref, 256);
    if (!owner || !repository || !ref) return null;
    return { kind, owner, repository, ref };
  }
  if (source && kind === "artifact") {
    const ref = string(source.ref, 1_024);
    return ref && source.format === "tar.gz" ? { kind, ref, format: "tar.gz" } : null;
  }
  return null;
}

function parseEnvironmentCommand(value: unknown): HzEnvironmentCommand | null {
  const source = item(value); const cmd = string(source?.cmd, 256);
  const args = source?.args === undefined ? [] : strings(source.args, 256, 16_384);
  const cwd = source?.cwd === undefined ? "/workspace/repo" : string(source.cwd, 4_096);
  const timeoutMs = source?.timeoutMs === undefined ? 600_000 : Number(source.timeoutMs);
  if (!source || !cmd || !args || !cwd || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) return null;
  return { cmd, args, cwd, timeoutMs };
}

function parseEnvironmentSpec(value: unknown): HzEnvironmentSpec | null {
  if (value === undefined) return { name: "default", cache: true, setup: [] };
  const source = item(value); const name = source?.name === undefined ? "default" : string(source.name, 128);
  if (!source || !name || source.cache !== undefined && typeof source.cache !== "boolean"
    || source.setup !== undefined && (!Array.isArray(source.setup) || source.setup.length > 32)) return null;
  const setup = (source.setup ?? []).map(parseEnvironmentCommand);
  if (!setup.every((entry): entry is HzEnvironmentCommand => entry !== null)) return null;
  return { name, cache: source.cache !== false, setup };
}

export function parseHzRequest(value: unknown): HzRequest {
  if (typeof value === "string") {
    const objective = string(value);
    if (!objective) throw new TypeError("Horizon requires a non-empty objective");
    return { objective, context: null, constraints: [], source: null,
      environment: { name: "default", cache: true, setup: [] } };
  }
  const source = item(value);
  const objective = string(source?.objective);
  if (!source || !objective) throw new TypeError("Horizon requires a non-empty objective");
  const constraints = source.constraints === undefined ? [] : strings(source.constraints, 64, 8_192);
  if (!constraints) throw new TypeError("Horizon constraints are invalid");
  const requestedSource = source.source === undefined ? null : parseSourceInput(source.source);
  if (source.source !== undefined && !requestedSource) throw new TypeError("Horizon source is invalid");
  const environment = parseEnvironmentSpec(source.environment);
  if (!environment) throw new TypeError("Horizon environment is invalid");
  return { objective, context: source.context ?? null, constraints, source: requestedSource, environment };
}

export function parseHzSourceResolution(value: unknown): HzSourceResolution | null {
  const source = item(value); const status = source?.status;
  const selected = source?.source === null ? null : parseSourceInput(source?.source);
  const evidence = strings(source?.evidence, 64, 8_192); const question = nullableString(source?.question, 16_384);
  if (!source || source.object !== "constal.horizon.source-resolution" || source.version !== 1
    || !["ready", "needs-input"].includes(String(status)) || !evidence || question === undefined
    || selected?.kind === "artifact") return null;
  if (status === "ready" && !selected || status === "needs-input" && !question) return null;
  return { object: "constal.horizon.source-resolution", version: 1,
    status: status as HzSourceResolution["status"], source: selected, evidence, question };
}

export function parseHzUnknown(value: unknown): HzUnknown | null {
  const source = item(value);
  const question = string(source?.question, 16_384);
  const state = source?.state;
  const resolution = nullableString(source?.resolution, 32_768);
  const evidence = strings(source?.evidence, 64, 8_192);
  if (!source || !question || !["open", "resolved", "assumed", "needs-input", "blocked"].includes(String(state))
    || resolution === undefined || !evidence) return null;
  return { question, state: state as HzUnknownState, resolution, evidence };
}

function unknowns(value: unknown): HzUnknown[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed = value.map(parseHzUnknown);
  if (!parsed.every((entry): entry is HzUnknown => entry !== null)) return null;
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
  if (!source || source.object !== "constal.horizon.discovery-plan" || source.version !== 1
    || !["ready", "partial"].includes(String(status)) || !summary || workspaceRoot === undefined
    || !parsedUnknowns || !Array.isArray(source.focuses)
    || source.focuses.length === 0 || source.focuses.length > 16) return null;
  const focuses = source.focuses.map(parseHzDiscoveryFocus);
  if (!focuses.every((focus): focus is HzDiscoveryFocus => focus !== null)
    || new Set(focuses.map(({ id }) => id)).size !== focuses.length) return null;
  if (status === "ready" && !workspaceRoot) return null;
  return { object: "constal.horizon.discovery-plan", version: 1,
    status: status as HzDiscoveryPlan["status"], summary, workspaceRoot, focuses,
    unknowns: parsedUnknowns };
}

export function parseHzInvestigationResult(value: unknown, expectedFocusId?: string): HzInvestigationResult | null {
  const source = item(value); const focusId = string(source?.focusId, 256); const status = source?.status;
  const summary = string(source?.summary, 32_768); const findings = strings(source?.findings, 128, 16_384);
  const evidence = strings(source?.evidence, 128, 16_384); const parsedUnknowns = unknowns(source?.unknowns);
  const planImplications = strings(source?.planImplications, 128, 16_384);
  if (!source || source.object !== "constal.horizon.investigation" || source.version !== 1 || !focusId
    || expectedFocusId !== undefined && focusId !== expectedFocusId
    || !["complete", "partial"].includes(String(status)) || !summary || !findings || !evidence
    || !parsedUnknowns || !planImplications) return null;
  return { object: "constal.horizon.investigation", version: 1, focusId,
    status: status as HzInvestigationResult["status"], summary, findings, evidence,
    unknowns: parsedUnknowns, planImplications };
}

function positiveRevision(value: unknown, expectedRevision?: number): number | null {
  if (!Number.isInteger(value) || Number(value) < 1 || expectedRevision !== undefined && value !== expectedRevision) return null;
  return Number(value);
}

export function parseHzRubric(value: unknown, expectedRevision?: number): HzRubric | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  const objective = string(source?.objective); const successCriteria = strings(source?.successCriteria, 128, 16_384);
  const constraints = strings(source?.constraints, 128, 16_384); const nonGoals = strings(source?.nonGoals, 128, 16_384);
  const openQuestions = unknowns(source?.openQuestions); const verificationPrinciples = strings(source?.verificationPrinciples, 128, 16_384);
  if (!source || source.object !== "constal.horizon.rubric" || source.version !== 1 || revision === null || !objective
    || !successCriteria || successCriteria.length === 0 || !constraints || !nonGoals || !openQuestions
    || !verificationPrinciples || verificationPrinciples.length === 0) return null;
  return { object: "constal.horizon.rubric", version: 1, revision, objective, successCriteria, constraints,
    nonGoals, openQuestions, verificationPrinciples };
}

function parseHzDesignDecision(value: unknown): HzDesignDecision | null {
  const source = item(value); const question = string(source?.question, 16_384);
  const decision = string(source?.decision, 32_768); const rationale = string(source?.rationale, 32_768);
  const evidence = strings(source?.evidence, 128, 16_384);
  return source && question && decision && rationale && evidence ? { question, decision, rationale, evidence } : null;
}

function parseHzMilestone(value: unknown): HzMilestone | null {
  const source = item(value); const id = string(source?.id, 256); const title = string(source?.title, 1_024);
  const outcome = string(source?.outcome, 32_768); const dependsOn = strings(source?.dependsOn, 64, 256);
  const responsibilities = strings(source?.responsibilities, 128, 16_384); const risks = strings(source?.risks, 128, 16_384);
  return source && id && title && outcome && dependsOn && responsibilities && responsibilities.length > 0 && risks
    ? { id, title, outcome, dependsOn, responsibilities, risks } : null;
}

function graphIsAcyclic(nodes: readonly { id: string; dependsOn: string[] }[]): boolean {
  const ids = new Set(nodes.map(({ id }) => id));
  if (nodes.some(({ id, dependsOn }) => dependsOn.includes(id) || dependsOn.some((dependency) => !ids.has(dependency)))) return false;
  const remaining = new Map(nodes.map((node) => [node.id, new Set(node.dependsOn)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, dependencies] of remaining) {
      if (dependencies.size > 0) continue;
      remaining.delete(id); for (const unresolved of remaining.values()) unresolved.delete(id); changed = true;
    }
  }
  return remaining.size === 0;
}

export function parseHzDesign(value: unknown, expectedRevision?: number): HzDesign | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  const summary = string(source?.summary, 65_536);
  if (!source || source.object !== "constal.horizon.design" || source.version !== 1 || revision === null || !summary
    || !Array.isArray(source.decisions) || source.decisions.length > 128
    || !Array.isArray(source.milestones) || source.milestones.length === 0 || source.milestones.length > 64) return null;
  const decisions = source.decisions.map(parseHzDesignDecision); const milestones = source.milestones.map(parseHzMilestone);
  if (!decisions.every((entry): entry is HzDesignDecision => entry !== null)
    || !milestones.every((entry): entry is HzMilestone => entry !== null)
    || new Set(milestones.map(({ id }) => id)).size !== milestones.length || !graphIsAcyclic(milestones)) return null;
  return { object: "constal.horizon.design", version: 1, revision, summary, decisions, milestones };
}

export function parseHzWorkPlan(value: unknown, expectedRevision?: number): HzWorkPlan | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  if (!source || source.object !== "constal.horizon.work-plan" || source.version !== 1 || revision === null
    || !Array.isArray(source.steps) || source.steps.length === 0 || source.steps.length > 128) return null;
  const steps = source.steps.map(parseHzPlanStep);
  if (!steps.every((entry): entry is HzPlanStep => entry !== null)
    || new Set(steps.map(({ id }) => id)).size !== steps.length || !graphIsAcyclic(steps)) return null;
  return { object: "constal.horizon.work-plan", version: 1, revision, steps };
}

export function parseHzMilestoneWork(value: unknown, expectedRevision?: number,
  expectedMilestoneId?: string): HzMilestoneWork | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  const milestoneId = string(source?.milestoneId, 256);
  if (!source || source.object !== "constal.horizon.milestone-work" || source.version !== 1 || revision === null
    || !milestoneId || expectedMilestoneId !== undefined && milestoneId !== expectedMilestoneId
    || !Array.isArray(source.steps) || source.steps.length === 0 || source.steps.length > 128) return null;
  const steps = source.steps.map(parseHzPlanStep);
  if (!steps.every((entry): entry is HzPlanStep => entry !== null)
    || steps.some((step) => step.milestoneId !== milestoneId)
    || new Set(steps.map(({ id }) => id)).size !== steps.length) return null;
  return { object: "constal.horizon.milestone-work", version: 1, revision, milestoneId, steps };
}

function parseHzAssertion(value: unknown): HzAssertion | null {
  const source = item(value); const claim = string(source?.claim, 16_384);
  const evidenceRequired = strings(source?.evidenceRequired, 64, 16_384);
  return source && claim && evidenceRequired && evidenceRequired.length > 0 && typeof source.negativePath === "boolean"
    ? { claim, evidenceRequired, negativePath: source.negativePath } : null;
}

export function parseHzStepAssertions(value: unknown, expectedRevision?: number, expectedStepId?: string): HzStepAssertions | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  const stepId = string(source?.stepId, 256);
  if (!source || source.object !== "constal.horizon.step-assertions" || source.version !== 1 || revision === null || !stepId
    || expectedStepId !== undefined && stepId !== expectedStepId || !Array.isArray(source.assertions)
    || source.assertions.length === 0 || source.assertions.length > 64) return null;
  const assertions = source.assertions.map(parseHzAssertion);
  if (!assertions.every((entry): entry is HzAssertion => entry !== null)) return null;
  return { object: "constal.horizon.step-assertions", version: 1, revision, stepId, assertions };
}

export function parseHzAssertionPlan(value: unknown, expectedRevision?: number,
  expectedStepIds?: readonly string[]): HzAssertionPlan | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  if (!source || source.object !== "constal.horizon.assertion-plan" || source.version !== 1 || revision === null
    || !Array.isArray(source.assertions) || source.assertions.length === 0 || source.assertions.length > 128) return null;
  const assertions = source.assertions.map((entry) => parseHzStepAssertions(entry, revision));
  if (!assertions.every((entry): entry is HzStepAssertions => entry !== null)
    || new Set(assertions.map(({ stepId }) => stepId)).size !== assertions.length) return null;
  if (expectedStepIds) {
    const expected = [...new Set(expectedStepIds)].sort();
    const actual = assertions.map(({ stepId }) => stepId).sort();
    if (expected.length !== expectedStepIds.length || expected.length !== actual.length
      || expected.some((stepId, index) => stepId !== actual[index])) return null;
  }
  return { object: "constal.horizon.assertion-plan", version: 1, revision, assertions };
}

function parseHzContinuityDecision(value: unknown): HzContinuityDecision | null {
  const source = item(value); const priorStepId = string(source?.priorStepId, 256);
  const nextStepId = nullableString(source?.nextStepId, 256); const disposition = source?.disposition;
  const reason = string(source?.reason, 32_768); const evidence = strings(source?.evidence, 128, 16_384);
  if (!source || !priorStepId || nextStepId === undefined
    || !["retain", "reverify", "rerun", "dropped"].includes(String(disposition)) || !reason || !evidence) return null;
  if (disposition === "dropped" ? nextStepId !== null : nextStepId === null) return null;
  if ((disposition === "retain" || disposition === "reverify") && nextStepId !== priorStepId) return null;
  return { priorStepId, nextStepId, disposition: disposition as HzContinuityDisposition, reason, evidence };
}

export function parseHzPlanContinuity(value: unknown, expectedRevision?: number,
  expectedPriorStepIds?: readonly string[], nextStepIds?: readonly string[]): HzPlanContinuity | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision);
  if (!source || source.object !== "constal.horizon.plan-continuity" || source.version !== 1 || revision === null
    || !Array.isArray(source.decisions) || source.decisions.length > 128) return null;
  const decisions = source.decisions.map(parseHzContinuityDecision);
  if (!decisions.every((entry): entry is HzContinuityDecision => entry !== null)
    || new Set(decisions.map(({ priorStepId }) => priorStepId)).size !== decisions.length) return null;
  if (expectedPriorStepIds) {
    const expected = [...new Set(expectedPriorStepIds)].sort();
    const actual = decisions.map(({ priorStepId }) => priorStepId).sort();
    if (expected.length !== expectedPriorStepIds.length || expected.length !== actual.length
      || expected.some((stepId, index) => stepId !== actual[index])) return null;
  }
  if (nextStepIds) {
    const next = new Set(nextStepIds);
    if (decisions.some(({ nextStepId }) => nextStepId !== null && !next.has(nextStepId))) return null;
  }
  return { object: "constal.horizon.plan-continuity", version: 1, revision, decisions };
}

export function parseHzQuestionReconciliation(value: unknown): HzQuestionReconciliation | null {
  const source = item(value); const decision = source?.decision; const rationale = string(source?.rationale, 32_768);
  return source?.object === "constal.horizon.question-reconciliation" && source.version === 1
    && ["new", "answered"].includes(String(decision)) && rationale
    ? { object: "constal.horizon.question-reconciliation", version: 1,
      decision: decision as HzQuestionReconciliation["decision"], rationale } : null;
}

function parseHzCritiqueFinding(value: unknown): HzCritiqueFinding | null {
  const source = item(value); const owner = source?.owner; const severity = source?.severity;
  const affectedMilestones = strings(source?.affectedMilestones, 64, 256);
  const affectedSteps = strings(source?.affectedSteps, 128, 256);
  const issue = string(source?.issue, 32_768); const evidence = strings(source?.evidence, 128, 16_384);
  const repair = string(source?.repair, 32_768);
  if (!source || !["investigation", "rubric", "design", "decomposition", "assertions", "continuity", "user"].includes(String(owner))
    || !["blocking", "advisory"].includes(String(severity)) || !affectedMilestones || !affectedSteps
    || new Set(affectedMilestones).size !== affectedMilestones.length || new Set(affectedSteps).size !== affectedSteps.length
    || !issue || !evidence || !repair) return null;
  return { owner: owner as HzCritiqueOwner, severity: severity as HzCritiqueFinding["severity"],
    affectedMilestones, affectedSteps, issue, evidence, repair };
}

export function parseHzPlanCritique(value: unknown, expectedRevision?: number): HzPlanCritique | null {
  const source = item(value); const revision = positiveRevision(source?.revision, expectedRevision); const verdict = source?.verdict;
  const summary = string(source?.summary, 32_768); const question = parseHzDecisionQuestion(source?.question);
  if (!source || source.object !== "constal.horizon.plan-critique" || source.version !== 1 || revision === null
    || !["accepted", "repair", "needs-input"].includes(String(verdict)) || !summary || question === undefined
    || !Array.isArray(source.findings) || source.findings.length > 128) return null;
  const findings = source.findings.map(parseHzCritiqueFinding);
  if (!findings.every((entry): entry is HzCritiqueFinding => entry !== null)) return null;
  const blocking = findings.some(({ severity }) => severity === "blocking");
  const userDecision = findings.some(({ owner, severity }) => owner === "user" && severity === "blocking");
  if (verdict === "accepted" && blocking || verdict === "repair" && !blocking
    || verdict === "needs-input" && (!question || !userDecision) || userDecision && !question) return null;
  return { object: "constal.horizon.plan-critique", version: 1, revision,
    verdict: verdict as HzPlanCritique["verdict"], summary, findings, question };
}

export function parseHzPlanStep(value: unknown): HzPlanStep | null {
  const source = item(value);
  const id = string(source?.id, 256); const milestoneId = string(source?.milestoneId, 256); const title = string(source?.title, 1_024);
  const responsibility = string(source?.responsibility, 8_192); const specification = string(source?.specification);
  const dependsOn = strings(source?.dependsOn, 64, 256); const verification = strings(source?.verification, 64, 8_192);
  const stopWhen = string(source?.stopWhen, 8_192);
  if (!source || !id || !milestoneId || !title || !responsibility || !specification || !dependsOn || !verification || !stopWhen) return null;
  return { id, milestoneId, title, responsibility, specification, dependsOn, verification, stopWhen };
}

export function parseHzPlan(value: unknown): HzPlan | null {
  const source = item(value);
  const status = source?.status; const revision = source?.revision;
  const objective = string(source?.objective); const summary = string(source?.summary, 32_768);
  const specification = string(source?.specification, 262_144); const workspaceRoot = nullableString(source?.workspaceRoot, 4_096);
  const parsedUnknowns = unknowns(source?.unknowns); const risks = strings(source?.risks, 128, 8_192);
  const question = parseHzDecisionQuestion(source?.question);
  if (!source || source.object !== "constal.horizon.plan" || source.version !== 1
    || !Number.isInteger(revision) || Number(revision) < 1
    || !["ready", "needs-input"].includes(String(status))
    || !objective || !summary || !specification || workspaceRoot === undefined || !parsedUnknowns || !risks
    || question === undefined || !Array.isArray(source.steps) || source.steps.length > 128
    || !Array.isArray(source.assertions) || source.assertions.length > 128) return null;
  const steps = source.steps.map(parseHzPlanStep);
  const assertions = source.assertions.map((entry) => parseHzStepAssertions(entry, Number(revision)));
  if (!steps.every((entry): entry is HzPlanStep => entry !== null)) return null;
  if (!assertions.every((entry): entry is HzStepAssertions => entry !== null)
    || new Set(assertions.map(({ stepId }) => stepId)).size !== assertions.length) return null;
  if (new Set(steps.map(({ id }) => id)).size !== steps.length) return null;
  const ids = new Set(steps.map(({ id }) => id));
  if (!graphIsAcyclic(steps)) return null;
  if (status === "ready" && (!workspaceRoot || steps.length === 0
    || assertions.length !== steps.length || assertions.some(({ stepId }) => !ids.has(stepId)))) return null;
  if (status === "needs-input" && !question) return null;
  return { object: "constal.horizon.plan", version: 1, revision: Number(revision), status: status as HzPlanStatus,
    objective, summary, specification, workspaceRoot, unknowns: parsedUnknowns, steps, assertions, risks, question };
}

export function parseHzPlanNarrative(value: unknown): HzPlanNarrative | null {
  const source = item(value); const summary = string(source?.summary, 32_768);
  const specification = string(source?.specification, 262_144);
  const parsedUnknowns = unknowns(source?.unknowns); const risks = strings(source?.risks, 128, 8_192);
  if (!source || source.object !== "constal.horizon.plan-narrative" || source.version !== 1
    || !summary || !specification || !parsedUnknowns || !risks) return null;
  return { object: "constal.horizon.plan-narrative", version: 1,
    summary, specification, unknowns: parsedUnknowns, risks };
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

function parseHzVerificationCheck(value: unknown): HzVerificationCheck | null {
  const source = item(value); const target = string(source?.target, 8_192); const outcome = source?.outcome;
  const evidence = string(source?.evidence, 16_384);
  if (!source || !target || !["passed", "failed", "not-run"].includes(String(outcome)) || !evidence) return null;
  return { target, outcome: outcome as HzVerificationCheck["outcome"], evidence };
}

export function parseHzVerification(value: unknown, expectedStepId?: string): HzVerification | null {
  const source = item(value); const stepId = string(source?.stepId, 256); const verdict = source?.verdict;
  const summary = string(source?.summary, 32_768); const parsedUnknowns = unknowns(source?.unknowns);
  const failureBrief = nullableString(source?.failureBrief, 32_768); const blockedReason = nullableString(source?.blockedReason, 16_384);
  if (!source || source.object !== "constal.horizon.verification" || source.version !== 1 || !stepId
    || expectedStepId !== undefined && stepId !== expectedStepId
    || !["passed", "failed", "blocked"].includes(String(verdict)) || !summary || !parsedUnknowns
    || failureBrief === undefined || blockedReason === undefined || !Array.isArray(source.checks) || source.checks.length > 128) return null;
  const checks = source.checks.map(parseHzVerificationCheck);
  if (!checks.every((check): check is HzVerificationCheck => check !== null)
    || verdict === "failed" && !failureBrief || verdict === "blocked" && !blockedReason) return null;
  return { object: "constal.horizon.verification", version: 1, stepId,
    verdict: verdict as HzVerification["verdict"], summary, checks, unknowns: parsedUnknowns, failureBrief, blockedReason };
}

export function parseHzReconciliation(value: unknown): HzReconciliation | null {
  const source = item(value); const action = source?.action; const summary = string(source?.summary, 32_768);
  const remainingUnknowns = unknowns(source?.remainingUnknowns); const replanBrief = nullableString(source?.replanBrief, 65_536);
  const planningOwner = source?.planningOwner === null ? null : source?.planningOwner;
  const workspaceDisposition = source?.workspaceDisposition;
  const question = parseHzDecisionQuestion(source?.question);
  if (!source || source.object !== "constal.horizon.reconciliation" || source.version !== 2
    || !["continue", "repair-step", "reverify", "replan", "ask", "complete"].includes(String(action))
    || !summary || !remainingUnknowns
    || planningOwner !== null && !["investigation", "rubric", "design", "decomposition", "assertions"].includes(String(planningOwner))
    || !["keep-current", "restore-last-verified"].includes(String(workspaceDisposition))
    || replanBrief === undefined || question === undefined) return null;
  if ((action === "replan" || action === "ask") && (!replanBrief || planningOwner === null)
    || action === "ask" && !question
    || action !== "replan" && action !== "ask" && planningOwner !== null
    || action === "reverify" && workspaceDisposition !== "keep-current") return null;
  return { object: "constal.horizon.reconciliation", version: 2, action: action as HzReconcileAction,
    summary, remainingUnknowns, planningOwner: planningOwner as HzPlanningOwner | null,
    workspaceDisposition: workspaceDisposition as HzWorkspaceDisposition, replanBrief, question };
}
