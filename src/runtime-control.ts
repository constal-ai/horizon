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
