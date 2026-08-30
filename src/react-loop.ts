import { ToolUnavailable, canonicalJson, type Ctx, type ToolCallRecord, type TurnDraft } from "@constal/sdk";
import type { HzToolEvidence } from "./contracts.js";

export interface ReactLoopSpec<T> {
  role: string;
  system: string;
  objective: unknown;
  context: unknown;
  tools: string[];
  parse(value: unknown): T | null;
  maxRounds: number;
  model?: string;
  stream?: boolean;
}

export interface ReactLoopResult<T> {
  artifact: T;
  evidence: HzToolEvidence[];
  plateaued: boolean;
  rounds: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bounded(value: unknown, depth = 0): unknown {
  if (depth >= 6) return "[depth omitted]";
  if (typeof value === "string") return value.length <= 16_384 ? value : `${value.slice(0, 16_384)}…`;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 96).map((entry) => bounded(entry, depth + 1));
  const source = record(value);
  if (!source) return String(value);
  return Object.fromEntries(Object.entries(source).slice(0, 96).map(([key, entry]) => [key, bounded(entry, depth + 1)]));
}

function callValue(call: ToolCallRecord): unknown {
  if (call.preview !== undefined) return bounded(call.preview);
  if (call.result !== undefined) return bounded(call.result);
  if (call.ref !== undefined) return { ref: call.ref };
  if (call.error !== undefined) return { error: bounded(call.error) };
  return null;
}

function callSignature(call: ToolCallRecord): string {
  return canonicalJson({ name: call.name, args: bounded(call.args), status: call.status, ref: call.ref ?? null,
    value: callValue(call) });
}

export class EvidencePlateauDetector {
  readonly #seen = new Set<string>();
  #stableRounds = 0;

  observe(calls: readonly ToolCallRecord[]): { plateaued: boolean; stableRounds: number; added: number } {
    let added = 0;
    for (const call of calls) {
      const signature = callSignature(call);
      if (!this.#seen.has(signature)) { this.#seen.add(signature); added++; }
    }
    this.#stableRounds = calls.length > 0 && added === 0 ? this.#stableRounds + 1 : 0;
    return { plateaued: this.#stableRounds >= 2, stableRounds: this.#stableRounds, added };
  }
}

function jsonMessage(content: string): unknown {
  const text = content.trim();
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

function candidate(draft: Pick<TurnDraft, "artifact" | "message">): unknown {
  return draft.artifact ?? jsonMessage(draft.message.content);
}

function evidence(calls: readonly ToolCallRecord[]): HzToolEvidence[] {
  return calls.map((call) => ({
    name: call.name, status: call.status, args: bounded(call.args), ref: call.ref ?? null, result: callValue(call),
  }));
}

function roundContext(calls: readonly ToolCallRecord[]): unknown[] {
  return calls.map((call) => ({ name: call.name, status: call.status, args: bounded(call.args), ref: call.ref ?? null,
    result: callValue(call) }));
}

export async function runReactLoop<T>(spec: ReactLoopSpec<T>, ctx: Ctx): Promise<ReactLoopResult<T>> {
  const maximum = Math.max(1, Math.min(spec.maxRounds, 64));
  let enabledTools = [...new Set(spec.tools)];
  const calls: ToolCallRecord[] = [];
  const recentRounds: unknown[][] = [];
  const compacted: Array<{ fact: string; rounds: number }> = [];
  const plateau = new EvidencePlateauDetector();
  let forcedPlateau = false;

  for (let ordinal = 0; ordinal < maximum; ordinal++) {
    const offered = forcedPlateau || ordinal === maximum - 1 ? [] : enabledTools;
    let turn;
    for (;;) {
      try {
        turn = await ctx.turn({
          system: spec.system,
          objective: spec.objective,
          context: ordinal === 0
            ? spec.context
            : { request: spec.context, compacted, recentRounds,
              ...(forcedPlateau ? { plateau: "Repeated Tool observations produced no new evidence. Resolve, ask, or block without another Tool call." } : {}) },
          tools: offered,
          ...(spec.model ? { model: spec.model } : {}),
          ...(spec.stream ? { stream: true } : {}),
          gate: {
            id: `horizon-${spec.role}`,
            version: "1",
            retries: 3,
            before: (draft) => draft.toolCalls.length > 0 || spec.parse(candidate(draft)) !== null,
            feedback: () => "Return only the required JSON transport object, with every required field present and no prose wrapper.",
          },
        });
        break;
      } catch (error) {
        if (!(error instanceof ToolUnavailable) || !enabledTools.includes(error.tool)) throw error;
        enabledTools = enabledTools.filter((name) => name !== error.tool);
      }
    }

    if (turn.toolCalls.length === 0) {
      const artifact = spec.parse(candidate(turn));
      if (!artifact) throw new TypeError(`${spec.role} returned an invalid final transport object`);
      return { artifact, evidence: evidence(calls), plateaued: forcedPlateau, rounds: ordinal + 1 };
    }

    calls.push(...turn.toolCalls);
    recentRounds.push(roundContext(turn.toolCalls));
    const observation = plateau.observe(turn.toolCalls);
    if (observation.plateaued) forcedPlateau = true;

    if (recentRounds.length > 6) {
      const older = recentRounds.splice(0, recentRounds.length - 3);
      const fact = await ctx.commit({ kind: "horizon.react-compaction", role: spec.role, rounds: older.length,
        observations: older.flat().slice(-128) }, { tier: "audit" });
      compacted.push({ fact: fact.hash, rounds: older.length });
    }
  }
  throw new TypeError(`${spec.role} exhausted its ReAct safety ceiling without a final artifact`);
}
