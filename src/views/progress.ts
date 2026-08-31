import type { Fact, Hash, ViewDef } from "@constal/sdk";

export interface HorizonProgressState {
  status: "idle" | "preparing" | "discovering" | "planning" | "executing" | "waiting" | "blocked" | "complete";
  workspaceReceipt: string | null;
  workspaceCacheHit: boolean | null;
  checkpoints: number;
  planRevision: number | null;
  planningPhase: string | null;
  currentStep: string | null;
  verifiedSteps: string[];
  replans: number;
  plateauCycles: number;
  artifactRef: string | null;
  lastFact: Hash | null;
  updatedAt: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function unique(values: string[]): string[] { return [...new Set(values)].slice(-256); }

export const horizonProgress: ViewDef<HorizonProgressState, Fact> = {
  id: "horizon-progress",
  version: "2",
  over: "facts",
  init: () => ({ status: "idle", workspaceReceipt: null, workspaceCacheHit: null, checkpoints: 0,
    planRevision: null, planningPhase: null, currentStep: null,
    verifiedSteps: [], replans: 0, plateauCycles: 0, artifactRef: null, lastFact: null, updatedAt: null }),
  apply(state, fact) {
    const artifact = record(fact.artifact); const kind = typeof artifact?.kind === "string" ? artifact.kind : "";
    const next = { ...state, lastFact: fact.hash, updatedAt: fact.at };
    if (kind === "horizon.request" || kind === "horizon.source-resolution" || kind === "horizon.source"
      || kind === "horizon.workspace-cache-invalid") return { ...next, status: "preparing" as const };
    if (kind === "horizon.workspace-failed") return { ...next, status: "blocked" as const };
    if (kind === "horizon.workspace-ready") {
      const receipt = record(artifact?.receipt); const cache = record(receipt?.cache);
      return { ...next, status: "discovering" as const,
        workspaceReceipt: typeof artifact?.receiptRef === "string" ? artifact.receiptRef : state.workspaceReceipt,
        workspaceCacheHit: typeof cache?.hit === "boolean" ? cache.hit : state.workspaceCacheHit };
    }
    if (kind === "horizon.discovery-plan" || kind === "horizon.investigation") {
      return { ...next, status: "discovering" as const };
    }
    if (kind === "horizon.planning-phase") {
      return { ...next, status: "planning" as const,
        planningPhase: typeof artifact?.phase === "string" ? artifact.phase : state.planningPhase };
    }
    if (kind === "horizon.answer") return { ...next, status: "planning" as const };
    if (kind === "horizon.plan") {
      const plan = record(artifact?.plan); const planStatus = plan?.status;
      return { ...next,
        status: planStatus === "needs-input" ? "waiting" as const : planStatus === "blocked" ? "blocked" as const : "executing" as const,
        planRevision: typeof plan?.revision === "number" ? plan.revision : state.planRevision,
        planningPhase: null,
        replans: typeof artifact?.previousRevision === "number" ? state.replans + 1 : state.replans,
      };
    }
    if (kind === "horizon.step-result") {
      const result = record(artifact?.result);
      return { ...next, status: "executing" as const,
        currentStep: typeof result?.stepId === "string" ? result.stepId : state.currentStep };
    }
    if (kind === "horizon.verification") {
      const verification = record(artifact?.verification); const stepId = verification?.stepId;
      return { ...next, status: "executing" as const,
        currentStep: typeof stepId === "string" ? stepId : state.currentStep,
        verifiedSteps: verification?.verdict === "passed" && typeof stepId === "string"
          ? unique([...state.verifiedSteps, stepId]) : state.verifiedSteps };
    }
    if (kind === "horizon.workspace-checkpoint") {
      return { ...next, status: "executing" as const, checkpoints: state.checkpoints + 1 };
    }
    if (kind === "horizon.plan-invalidation") {
      const invalidated = new Set(Array.isArray(artifact?.steps)
        ? artifact.steps.filter((value): value is string => typeof value === "string") : []);
      return { ...next, status: "planning" as const,
        verifiedSteps: state.verifiedSteps.filter((step) => !invalidated.has(step)) };
    }
    if (kind === "horizon.progress") {
      const plateau = record(artifact?.plateau);
      return { ...next, status: "executing" as const,
        currentStep: typeof artifact?.step === "string" ? artifact.step : state.currentStep,
        plateauCycles: typeof plateau?.stableCycles === "number" ? plateau.stableCycles : state.plateauCycles };
    }
    if (kind === "horizon.reconciliation") {
      const reconciliation = record(artifact?.reconciliation); const action = reconciliation?.action;
      return { ...next,
        status: action === "replan" ? "planning" as const : action === "ask" ? "waiting" as const
          : action === "blocked" ? "blocked" as const : "executing" as const };
    }
    if (kind === "horizon.plateau" || kind === "horizon.package-failed" || kind === "horizon.workspace-checkpoint-failed") {
      return { ...next, status: "blocked" as const };
    }
    if (kind === "horizon.result") {
      const result = record(artifact?.result); const packaged = record(result?.artifact);
      return { ...next, status: result?.status === "complete" ? "complete" as const : "blocked" as const,
        artifactRef: typeof packaged?.ref === "string" ? packaged.ref : state.artifactRef, currentStep: null };
    }
    return next;
  },
};
