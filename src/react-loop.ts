// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { canonicalJson, type Ctx, type ToolCallRecord, type TurnDraft } from "@constal/sdk";
import type { HzToolEvidence } from "./contracts.js";
import { COMMON_RULES, composePrompt } from "./prompts/compose.js";

const PROGRESS_CHECKPOINT_INTERVAL = 8;

export const LOOP_CHECKPOINT_SYSTEM = composePrompt({
  role: "You are Horizon's working-memory specialist. Your checkpoint lets another specialist continue its work after older Tool observations leave its context.",
  task: "Produce a stable structured checkpoint of the questions this specialist still owns. Resolve an unknown only from supplied evidence. Identify the smallest exact evidence still needed; do not ask for generic additional inspection.",
  context: "Dynamic context supplies the specialist role, objective, original role context, complete observations since the previous checkpoint, an index of older evidence, and the prior checkpoint when one exists. Preserve established findings, their evidence, completed checks, and unresolved questions. Update prior conclusions when newer evidence changes them.",
  rules: `${COMMON_RULES}\n\nDescribe the current unknown frontier directly; do not invent identifiers for semantic questions. Evidence accumulation without a changed question, state, or resolution is not progress. Set ready only when no assigned unknown remains open, needs input, or blocked. Do not invent proof obligations beyond the supplied role objective, context, and stop condition. For a verifier role, the executor report remains a claim, while the execution Fact and supplied Tool receipts provide governed provenance. The verifier must still independently inspect semantic and final-workspace claims. Do not decide implementation or call Tools.`,
  tools: "No Tools are available. Judge progress only from supplied observations.",
  output: `Return exactly one JSON object:
{"object":"constal.horizon.loop-checkpoint","version":1,"role":"exact supplied role","ready":false,"summary":"what changed in the unknown frontier","unknowns":[{"question":"precise question","state":"open|resolved|assumed|needs-input|blocked","resolution":"answer or null","evidence":["exact evidence reference"]}],"nextEvidence":["smallest exact missing evidence"]}`,
});

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

interface LoopCheckpoint {
  object: "constal.horizon.loop-checkpoint";
  version: 1;
  role: string;
  ready: boolean;
  summary: string;
  unknowns: Array<{ question: string; state: "open" | "resolved" | "assumed" | "needs-input" | "blocked";
    resolution: string | null; evidence: string[] }>;
  nextEvidence: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function checkpoint(value: unknown, role: string): LoopCheckpoint | null {
  const source = record(value);
  if (!source || source.object !== "constal.horizon.loop-checkpoint" || source.version !== 1 || source.role !== role
    || typeof source.ready !== "boolean" || typeof source.summary !== "string" || !source.summary.trim()
    || !Array.isArray(source.unknowns) || source.unknowns.length > 256
    || !Array.isArray(source.nextEvidence) || source.nextEvidence.length > 64
    || source.nextEvidence.some((item) => typeof item !== "string" || !item.trim() || item.length > 8_192)) return null;
  const unknowns: LoopCheckpoint["unknowns"] = [];
  for (const value of source.unknowns) {
    const item = record(value); const state = item?.state;
    if (!item || typeof item.question !== "string" || !item.question.trim() || item.question.length > 16_384
      || !["open", "resolved", "assumed", "needs-input", "blocked"].includes(String(state))
      || item.resolution !== null && (typeof item.resolution !== "string" || !item.resolution.trim() || item.resolution.length > 32_768)
      || !Array.isArray(item.evidence) || item.evidence.length > 64
      || item.evidence.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 8_192)) return null;
    unknowns.push({ question: item.question.trim(),
      state: state as LoopCheckpoint["unknowns"][number]["state"],
      resolution: item.resolution === null ? null : item.resolution.trim(),
      evidence: item.evidence.map((entry) => String(entry).trim()) });
  }
  if (source.ready && unknowns.some(({ state }) => !["resolved", "assumed"].includes(state))) return null;
  return { object: "constal.horizon.loop-checkpoint", version: 1, role, ready: source.ready,
    summary: source.summary.trim(), unknowns, nextEvidence: source.nextEvidence.map((item) => String(item).trim()) };
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

function durableCallValue(call: ToolCallRecord): unknown {
  if (call.preview !== undefined) return bounded(call.preview);
  if (call.result !== undefined) return bounded(call.result);
  if (call.ref !== undefined) return { ref: call.ref };
  if (call.error !== undefined) return { error: bounded(call.error) };
  return null;
}

function reasoningCallValue(call: ToolCallRecord): unknown {
  return Object.hasOwn(call, "result") ? call.result : durableCallValue(call);
}

function commandObservation(call: ToolCallRecord): Record<string, unknown> | null {
  if (!["workspace_exec", "workspace_diff", "workspace_search"].includes(call.name)) return null;
  const value = reasoningCallValue(call);
  const source = record(typeof value === "string" ? jsonMessage(value) : value);
  if (!source || typeof source.commandId !== "string" || typeof source.status !== "string"
    || !Object.hasOwn(source, "stdoutRef") || !Object.hasOwn(source, "stderrRef")
    || !Object.hasOwn(source, "exitCode") || !Array.isArray(source.outputs)) return null;
  // The command receipt changes per invocation, but its output hashes identify
  // the observed content. Strip only this known carrier's execution metadata;
  // identically named fields in arbitrary Tool payloads remain meaningful.
  const { commandId: _command, usage: _usage, sandbox: _sandbox, ...observation } = source;
  return observation;
}

function callSignature(call: ToolCallRecord): string {
  const value = commandObservation(call) ?? call.ref ?? durableCallValue(call);
  return canonicalJson({ name: call.name, status: call.status, value,
    ...(["error", "refused", "unknown", "outcome-unknown"].includes(call.status)
      ? {} : { args: call.args }) });
}

export class EvidencePlateauDetector {
  readonly #seen = new Set<string>();
  #stableRounds = 0;

  reset(): void {
    this.#seen.clear();
    this.#stableRounds = 0;
  }

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
  return calls.map((call) => {
    const item: HzToolEvidence = {
      name: call.name, status: call.status, args: bounded(call.args), ref: call.ref ?? null, result: durableCallValue(call),
    };
    if (Object.hasOwn(call, "result")) Object.defineProperty(item, "value",
      { value: call.result, enumerable: false, configurable: false, writable: false });
    return item;
  });
}

function roundContext(calls: readonly ToolCallRecord[]) {
  return calls.map((call) => ({ name: call.name, status: call.status, args: call.args, ref: call.ref ?? null,
    result: reasoningCallValue(call) }));
}

export async function runReactLoop<T>(spec: ReactLoopSpec<T>, ctx: Ctx): Promise<ReactLoopResult<T>> {
  if (!Number.isSafeInteger(spec.maxRounds) || spec.maxRounds < 1) throw new TypeError("ReAct maxRounds must be a positive integer");
  const maximum = spec.maxRounds;
  const enabledTools = [...new Set(spec.tools)];
  const usesPlatformTools = enabledTools.some((name) => name === "platform_query" || name === "platform_get");
  const initialContext = usesPlatformTools ? {
    ...(record(spec.context) ?? { request: spec.context }),
    platformToolContract: {
      queryScope: { kind: "namespace", namespace: ctx.run.namespace },
      rules: [
        "Use queryScope unchanged; it is the namespace guaranteed to this delegated Run.",
        "Select platform_query.kind only from its exact lower-case schema enum; do not guess or pluralize kinds.",
        "Pass platform_get refs unchanged from governed context or prior platform results; do not synthesize refs.",
      ],
    },
  } : spec.context;
  const calls: ToolCallRecord[] = [];
  const recentRounds: ReturnType<typeof roundContext>[] = [];
  const compacted: Array<{ fact: string; rounds: number }> = [];
  const progressCheckpoints: Array<{ fact: string; ready: boolean; summary: string }> = [];
  let compactedEvidence: unknown[] = [];
  const plateau = new EvidencePlateauDetector();
  let evidenceProgress = { plateaued: false, stableRounds: 0, added: 0 };
  let toolRounds = 0;
  let priorCheckpoint: LoopCheckpoint | null = null;

  for (let ordinal = 0; ordinal < maximum; ordinal++) {
    const offered = ordinal === maximum - 1 ? [] : enabledTools;
    const turn = await ctx.turn({
      system: spec.system,
      objective: spec.objective,
      context: ordinal === 0
        ? initialContext
        : { request: initialContext, compacted, compactedGovernedToolObservations: compactedEvidence,
          recentGovernedToolObservations: recentRounds,
          progressCheckpoints, progressCheckpoint: priorCheckpoint, evidenceProgress,
          ...(evidenceProgress.stableRounds > 0 ? {
            plateau: "Recent Tool calls repeat evidence already recorded. Use the retained findings and choose an action that resolves a remaining unknown, or finish when the assigned stop condition is satisfied. Repetition does not make the role's Tools unavailable.",
          } : {}) },
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

    if (turn.toolCalls.length === 0) {
      const artifact = spec.parse(candidate(turn));
      if (!artifact) throw new TypeError(`${spec.role} returned an invalid final transport object`);
      return { artifact, evidence: evidence(calls), plateaued: evidenceProgress.plateaued, rounds: ordinal + 1 };
    }

    calls.push(...turn.toolCalls);
    toolRounds++;
    recentRounds.push(roundContext(turn.toolCalls));
    evidenceProgress = plateau.observe(turn.toolCalls);

    if (toolRounds % PROGRESS_CHECKPOINT_INTERVAL === 0) {
      const progress = await ctx.turn({
        system: LOOP_CHECKPOINT_SYSTEM,
        objective: "Checkpoint the assigned unknown frontier from observed evidence.",
        context: { role: spec.role, objective: spec.objective, request: initialContext,
          priorCheckpoint, compactedGovernedToolObservations: compactedEvidence,
          recentGovernedToolObservations: recentRounds },
        tools: [],
        gate: {
          id: `horizon-${spec.role}-progress`, version: "1", retries: 3,
          before: (draft) => checkpoint(candidate(draft), spec.role) !== null,
          feedback: () => "Return only the required loop-checkpoint JSON object with the current semantic questions and no invented ids.",
        },
      });
      const current = checkpoint(candidate(progress), spec.role);
      if (!current) throw new TypeError(`${spec.role} returned an invalid progress checkpoint`);
      const fact = await ctx.commit({ kind: "horizon.react-progress", role: spec.role,
        toolRounds, checkpoint: current }, { tier: "audit" });
      progressCheckpoints.push({ fact: fact.hash, ready: current.ready, summary: current.summary });
      if (progressCheckpoints.length > 32) progressCheckpoints.splice(0, progressCheckpoints.length - 32);
      priorCheckpoint = current;

      // Compact only after the memory specialist has seen the complete results.
      // Keep recent rounds verbatim and older receipts as an explicit index, not
      // depth-limited prefixes that could be mistaken for complete observations.
      const older = recentRounds.splice(0, recentRounds.length - 3);
      const projected = older.flat().map(({ result: _result, ...receipt }) => ({
        ...receipt, resultCompactedInto: fact.hash,
      }));
      const unique = new Map<string, unknown>();
      for (const observation of [...compactedEvidence, ...projected]) unique.set(canonicalJson(observation), observation);
      compactedEvidence = [...unique.values()].slice(-128);
      const compaction = await ctx.commit({ kind: "horizon.react-compaction", role: spec.role,
        rounds: older.length, checkpoint: fact.hash, observations: projected }, { tier: "audit" });
      compacted.push({ fact: compaction.hash, rounds: older.length });
      if (compacted.length > 32) compacted.splice(0, compacted.length - 32);
    }
  }
  throw new TypeError(`${spec.role} exhausted its ReAct safety ceiling without a final artifact`);
}
