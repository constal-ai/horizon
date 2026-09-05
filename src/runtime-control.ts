// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

const RUNTIME_CONTROL_ERRORS = new Set([
  "AfterYield",
  "CommitConflict",
  "CommitYield",
  "InjectedEffectCrash",
  "LeaseLost",
  "NondeterministicReplay",
  "RunLimitReached",
  "RuntimeTransportUnavailable",
  "SessionDeleted",
  "SuspendYield",
  "SwallowedYield",
]);

export class DurableHandoffTooLarge extends RangeError {
  constructor() {
    super("Horizon handoff exceeds the bound CAS text-read contract");
    this.name = "DurableHandoffTooLarge";
  }
}

/** Never translate Constal's durable execution protocol into Agent-level failure. */
export function rethrowRuntimeControl(error: unknown): void {
  const source = error && typeof error === "object" ? error as { name?: unknown; durableSuspension?: unknown } : null;
  if (source?.durableSuspension === true || typeof source?.name === "string" && RUNTIME_CONTROL_ERRORS.has(source.name)) {
    throw error;
  }
}

export function applicationError(error: unknown): { name: string; message: string } {
  const source = error && typeof error === "object" ? error as { name?: unknown; message?: unknown } : null;
  const name = typeof source?.name === "string" && source.name ? source.name : "Error";
  const message = typeof source?.message === "string" && source.message
    ? source.message.slice(0, 4_096) : typeof error === "string" && error ? error.slice(0, 4_096) : "Unknown failure";
  return { name, message };
}

export function applicationFailureSummary(stage: string, error: unknown): string {
  const detail = applicationError(error);
  if (detail.name === "GateExhausted" || detail.name === "CommitGateRejected") {
    return `I couldn't produce a valid ${stage} result after correction attempts.`;
  }
  if (detail.name === "PolicyDecisionFailed" || detail.name === "PolicyConstraintFailed"
    || detail.name === "EffectCeilingExceeded" || detail.name === "DirectNetworkDenied") {
    return `I couldn't continue during ${stage}: ${detail.message}`;
  }
  if (detail.name === "ResourceDisabled" || detail.name === "ResourceUnbound"
    || detail.name === "ToolUnavailable" || detail.name === "CredentialUnavailable"
    || detail.name === "CredentialRevoked") {
    return `A required capability is unavailable during ${stage}: ${detail.message}`;
  }
  if (detail.name === "OutcomeUnknown" || detail.name === "DriverRecoveryFailed") {
    return `I stopped during ${stage} because an external effect could not be safely reconciled: ${detail.message}`;
  }
  if (detail.name === "DurableHandoffTooLarge") {
    return `I couldn't pass the task data to the next specialist during ${stage}: it exceeds the storage interface's supported size.`;
  }
  return `I stopped during ${stage}: ${detail.message}`;
}
