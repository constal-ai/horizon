// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { ToolUnavailable, type Ctx, type Fact, type ToolCallRecord, type TurnRecord } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import { EvidencePlateauDetector, LOOP_CHECKPOINT_SYSTEM, runReactLoop } from "../src/react-loop.js";

function call(result: unknown): ToolCallRecord {
  return { id: "call", pos: "1", name: "workspace_read", version: "1", args: { path: "src/index.ts" },
    maxEffect: "read-only", effectObserved: "read-only", status: "ok", result,
  };
}

describe("EvidencePlateauDetector", () => {
  it("plateaus only after two repeated evidence rounds", () => {
    const detector = new EvidencePlateauDetector();
    expect(detector.observe([call({ ref: "one" })])).toEqual({ plateaued: false, stableRounds: 0, added: 1 });
    expect(detector.observe([call({ ref: "one" })])).toEqual({ plateaued: false, stableRounds: 1, added: 0 });
    expect(detector.observe([call({ ref: "one" })])).toEqual({ plateaued: true, stableRounds: 2, added: 0 });
  });

  it("treats a changed observation as progress without classifying prose", () => {
    const detector = new EvidencePlateauDetector();
    detector.observe([call({ ref: "one" })]);
    detector.observe([call({ ref: "one" })]);
    expect(detector.observe([call({ ref: "two" })])).toEqual({ plateaued: false, stableRounds: 0, added: 1 });
  });

  it.each([false, true])("compares command output rather than unique receipt hashes (JSON carrier: %s)", (encoded) => {
    const detector = new EvidencePlateauDetector();
    const command = (ordinal: number) => ({ ...call(encoded ? JSON.stringify(result(ordinal)) : result(ordinal)),
      name: "workspace_diff", ref: `receipt-${ordinal}` });
    const result = (ordinal: number) => ({
      commandId: `run:root/${ordinal}/tool/0`, status: "completed", exitCode: 0,
      stdoutRef: "same-content", stdoutPreview: "README.md\n", stderrRef: null, outputs: [],
      sandbox: { id: "session-sandbox", generation: 1, fresh: false },
      usage: { wallMs: 10 + ordinal, microUsd: 100 + ordinal, providerUnits: { active_memory_gib_ms: 500 + ordinal } },
    });
    expect(detector.observe([command(1)])).toEqual({ plateaued: false, stableRounds: 0, added: 1 });
    expect(detector.observe([command(2)])).toEqual({ plateaued: false, stableRounds: 1, added: 0 });
    expect(detector.observe([command(3)])).toEqual({ plateaued: true, stableRounds: 2, added: 0 });
  });

  it("retains changed command output and exit status as new evidence", () => {
    const detector = new EvidencePlateauDetector();
    const command = (stdoutRef: string, exitCode: number) => ({ ...call({ commandId: "command",
      status: "completed", stdoutRef, stderrRef: null, exitCode, outputs: [] }), name: "workspace_exec" });
    detector.observe([command("first", 0)]);
    expect(detector.observe([command("second", 0)]).added).toBe(1);
    expect(detector.observe([command("second", 1)]).added).toBe(1);
  });

  it("preserves business payload fields named usage, sandbox, and commandId", () => {
    const detector = new EvidencePlateauDetector();
    detector.observe([call({ usage: 1, sandbox: "a", commandId: "a" })]);
    expect(detector.observe([call({ usage: 2, sandbox: "a", commandId: "a" })]).added).toBe(1);
    expect(detector.observe([call({ usage: 2, sandbox: "b", commandId: "a" })]).added).toBe(1);
    expect(detector.observe([call({ usage: 2, sandbox: "b", commandId: "b" })]).added).toBe(1);
  });

  it("removes Tools after a plateau and requires the role to terminate honestly", async () => {
    const offered: string[][] = []; let turns = 0;
    const ctx = {
      turn: async (spec: { tools?: string[] }) => {
        offered.push(spec.tools ?? []); turns++;
        if (turns <= 3) return { toolCalls: [call({ ref: "unchanged" })], message: { role: "assistant", content: "Inspecting." },
          artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: { status: "blocked" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => ({ hash: "fact", artifact, artifactHash: "artifact" }) as unknown as Fact<unknown>,
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_read"], maxRounds: 8,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "blocked"
        ? value as { status: "blocked" } : null }, ctx);
    expect(result.plateaued).toBe(true);
    expect(offered).toEqual([["workspace_read"], ["workspace_read"], ["workspace_read"], []]);
  });

  it("narrows an executor inspection plateau to action Tools before forcing termination", async () => {
    const offered: string[][] = []; let turns = 0;
    const patchCall = { ...call({ applied: true }), name: "workspace_patch", maxEffect: "reconcilable" as const,
      effectObserved: "reconcilable" as const, args: { patch: "change" } };
    const ctx = {
      turn: async (spec: { tools?: string[] }) => {
        offered.push(spec.tools ?? []); turns++;
        if (turns <= 3) return { toolCalls: [call({ ref: "unchanged" })],
          message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        if (turns === 4) return { toolCalls: [patchCall],
          message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" },
          artifact: { status: "complete" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => ({ hash: "fact", artifact, artifactHash: "artifact" }) as unknown as Fact<unknown>,
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "executor", system: "test", objective: "test", context: {},
      tools: ["workspace_read", "workspace_patch"], plateauStages: [["workspace_patch"]], maxRounds: 8,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(result.plateaued).toBe(false);
    expect(offered).toEqual([
      ["workspace_read", "workspace_patch"],
      ["workspace_read", "workspace_patch"],
      ["workspace_read", "workspace_patch"],
      ["workspace_patch"],
      ["workspace_read", "workspace_patch"],
    ]);
  });

  it("treats unchanged Tool failures as plateau evidence even when the model changes invalid arguments", async () => {
    const offered: string[][] = []; let turns = 0;
    const ctx = {
      turn: async (spec: { tools?: string[] }) => {
        offered.push(spec.tools ?? []); turns++;
        if (turns <= 3) return { toolCalls: [{ ...call(null), id: `failed-${turns}`, args: { kind: `guess-${turns}` },
          status: "error", result: undefined, error: "invalid platform kind" }],
        message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" },
          artifact: { status: "blocked" } } as unknown as TurnRecord;
      },
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_read"], maxRounds: 12,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "blocked"
        ? value as { status: "blocked" } : null }, ctx);
    expect(result.plateaued).toBe(true);
    expect(offered).toEqual([["workspace_read"], ["workspace_read"], ["workspace_read"], []]);
  });

  it("honors the declared loop budget without a hidden one-thousand-round clamp", async () => {
    let roleTurns = 0; let facts = 0;
    const ctx = { turn: async (spec: { system?: string }) => {
      if (spec.system === LOOP_CHECKPOINT_SYSTEM) return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
        object: "constal.horizon.loop-checkpoint", version: 1, role: "test", ready: false,
        summary: "Evidence continues to change.", unknowns: [{ question: "What remains?", state: "open",
          resolution: null, evidence: ["Changing observations"] }], nextEvidence: ["Continue inspection"],
      } } as unknown as TurnRecord;
      roleTurns++;
      if (roleTurns <= 1_000) return { toolCalls: [call({ ref: `evidence-${roleTurns}` })],
        message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
      return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: { status: "complete" } } as unknown as TurnRecord;
    }, commit: async (artifact: unknown) => ({ hash: `fact-${++facts}`, artifact,
      artifactHash: `artifact-${facts}` }) as unknown as Fact<unknown> } as unknown as Ctx;
    await runReactLoop({ role: "test", system: "test", objective: "test", context: {}, tools: [], maxRounds: 1_001,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(roleTurns).toBe(1_001);
  });

  it("advances through mutation and proof plateaus before forcing resolution", async () => {
    const offered: string[][] = []; let turns = 0;
    const tool = (name: string, maxEffect: ToolCallRecord["maxEffect"]): ToolCallRecord => ({
      ...call({ name, ok: true }), name, maxEffect, effectObserved: maxEffect, args: { name },
    });
    const ctx = {
      turn: async (spec: { tools?: string[]; system?: string }) => {
        if (spec.system === LOOP_CHECKPOINT_SYSTEM) return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
          object: "constal.horizon.loop-checkpoint", version: 1, role: "executor", ready: false,
          summary: "Proof is complete; final transport remains.", unknowns: [{ question: "Can the role return its result?",
            state: "open", resolution: null, evidence: ["mutation and proof Tools completed"] }], nextEvidence: ["Final transport object"],
        } } as unknown as TurnRecord;
        offered.push(spec.tools ?? []); turns++;
        if (turns <= 3) return { toolCalls: [call({ ref: "before" })], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        if (turns === 4) return { toolCalls: [tool("workspace_edit", "idempotent")], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        if (turns <= 7) return { toolCalls: [call({ ref: "after" })], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        if (turns === 8) return { toolCalls: [tool("workspace_exec", "reconcilable")], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: { status: "complete" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => ({ hash: "fact", artifact, artifactHash: "artifact" }) as unknown as Fact<unknown>,
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "executor", system: "test", objective: "test", context: {},
      tools: ["workspace_read", "workspace_edit", "workspace_exec"],
      plateauStages: [["workspace_edit"], ["workspace_exec"]], maxRounds: 12,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(result.plateaued).toBe(false);
    expect(offered[3]).toEqual(["workspace_edit"]);
    expect(offered[7]).toEqual(["workspace_exec"]);
    expect(offered[8]).toEqual(["workspace_read", "workspace_edit", "workspace_exec"]);
  });

  it("does not let a ready checkpoint change the controller's Tool route", async () => {
    const offered: string[][] = []; let roleTurns = 0; let toolRounds = 0;
    const edit = { ...call({ edited: true }), name: "workspace_edit", maxEffect: "idempotent" as const,
      effectObserved: "idempotent" as const };
    const exec = { ...call({ exitCode: 0 }), name: "workspace_exec", maxEffect: "reconcilable" as const,
      effectObserved: "reconcilable" as const };
    const ctx = {
      turn: async (spec: { tools?: string[]; system?: string }) => {
        if (spec.system === LOOP_CHECKPOINT_SYSTEM) return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
          object: "constal.horizon.loop-checkpoint", version: 1, role: "executor", ready: true,
          summary: "The semantic unknowns are resolved.", unknowns: [], nextEvidence: [],
        } } as unknown as TurnRecord;
        offered.push(spec.tools ?? []); roleTurns++;
        if (roleTurns === 1) { toolRounds++; return { toolCalls: [edit], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord; }
        if (toolRounds < 8) { toolRounds++; return { toolCalls: [call({ ref: `evidence-${toolRounds}` })],
          message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord; }
        if (roleTurns === 9) return { toolCalls: [exec], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: { status: "complete" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => ({ hash: "fact", artifact, artifactHash: "artifact" }) as unknown as Fact<unknown>,
    } as unknown as Ctx;
    await runReactLoop({ role: "executor", system: "test", objective: "test", context: {},
      tools: ["workspace_read", "workspace_edit", "workspace_exec"],
      plateauStages: [["workspace_edit"], ["workspace_exec"]], maxRounds: 12,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(offered[8]).toEqual(["workspace_read", "workspace_edit", "workspace_exec"]);
  });

  it("propagates Tool availability failures instead of silently degrading the role", async () => {
    const ctx = { turn: async () => { throw new ToolUnavailable("workspace_patch"); } } as unknown as Ctx;
    await expect(runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_patch"], maxRounds: 8, parse: () => null }, ctx)).rejects.toBeInstanceOf(ToolUnavailable);
  });

  it("passes the complete Tool observation to the next reasoning turn while keeping durable evidence CAS-backed", async () => {
    const actual = { value: { run: { runId: "failed-run", status: "failed", error: "actual failure" } },
      journal: "x".repeat(20_000) };
    const observed = { ...call(null), ref: "result-ref", preview: "{\"object\":\"truncated\"}..." };
    Object.defineProperty(observed, "result", { value: actual, enumerable: false });
    const contexts: unknown[] = []; let turns = 0;
    const ctx = {
      turn: async (spec: { context?: unknown }) => {
        contexts.push(spec.context); turns++;
        if (turns === 1) return { toolCalls: [observed], message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: { status: "complete" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => ({ hash: "fact", artifact, artifactHash: "artifact" }) as unknown as Fact<unknown>,
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_read"], maxRounds: 4,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(contexts[1]).toMatchObject({ recentGovernedToolObservations: [[{ result: actual }]] });
    expect(result.evidence[0]).toMatchObject({ ref: "result-ref", result: "{\"object\":\"truncated\"}..." });
    expect(result.evidence[0]?.value).toBe(actual);
    expect(JSON.stringify(result.evidence)).not.toContain("actual failure");
  });

  it("supplies the exact delegated namespace whenever platform Tools are offered", async () => {
    const contexts: unknown[] = [];
    const ctx = {
      run: { namespace: "delegated-space" },
      turn: async (spec: { context?: unknown }) => {
        contexts.push(spec.context);
        return { toolCalls: [], message: { role: "assistant", content: "" },
          artifact: { status: "complete" } } as unknown as TurnRecord;
      },
    } as unknown as Ctx;
    await runReactLoop({ role: "test", system: "test", objective: "test", context: { request: "inspect" },
      tools: ["platform_query", "platform_get"], maxRounds: 2,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(contexts[0]).toMatchObject({ request: "inspect", platformToolContract: {
      queryScope: { kind: "namespace", namespace: "delegated-space" },
      rules: expect.arrayContaining([expect.stringContaining("Use queryScope unchanged")]),
    } });
  });

  it("checkpoints complete observations before compaction and restores the full working memory", async () => {
    const contexts: unknown[] = []; const commits: unknown[] = []; let turns = 0;
    const request = { plan: { step: { instructions: "instruction ".repeat(500) } } };
    const file = { ref: "file-content", text: "source ".repeat(4_000) };
    const memory = { object: "constal.horizon.loop-checkpoint", version: 1, role: "test", ready: false,
      summary: "Source inspection is complete; check repository status next.",
      unknowns: [{ question: "Does the source match?", state: "resolved", resolution: "The implementation matches.",
        evidence: ["receipt-1"] }], nextEvidence: ["git status --short --untracked-files=all"] };
    let memoryInput: unknown;
    const ctx = {
      turn: async (spec: { context?: unknown; system?: string }) => {
        if (spec.system === LOOP_CHECKPOINT_SYSTEM) {
          expect(commits).toHaveLength(0);
          memoryInput = structuredClone(spec.context);
          return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: memory } as unknown as TurnRecord;
        }
        contexts.push(structuredClone(spec.context)); turns++;
        if (turns <= 8) return { toolCalls: [{ ...call(turns === 1 ? file : { ref: `evidence-${turns}` }), ref: `receipt-${turns}` }],
          message: { role: "assistant", content: "Inspecting." }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" },
          artifact: { status: "complete" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => {
        commits.push(artifact);
        return { hash: `fact-${commits.length}`, artifact, artifactHash: `artifact-${commits.length}` } as unknown as Fact<unknown>;
      },
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "test", system: "test", objective: "test", context: request,
      tools: ["workspace_read"], maxRounds: 10,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(result.plateaued).toBe(false);
    expect(commits).toHaveLength(2);
    expect(memoryInput).toMatchObject({ request, recentGovernedToolObservations:
      expect.arrayContaining([[expect.objectContaining({ ref: "receipt-1", result: file })]]) });
    expect(contexts[7]).toMatchObject({ compacted: [], recentGovernedToolObservations:
      expect.arrayContaining([[expect.objectContaining({ result: file })]]) });
    expect(contexts[8]).toMatchObject({ progressCheckpoint: memory, compacted: [{ fact: "fact-2", rounds: 5 }],
      compactedGovernedToolObservations: expect.arrayContaining([
        { name: "workspace_read", status: "ok", args: { path: "src/index.ts" }, ref: "receipt-1", resultCompactedInto: "fact-1" },
      ]), recentGovernedToolObservations: [
        [expect.objectContaining({ ref: "receipt-6" })], [expect.objectContaining({ ref: "receipt-7" })],
        [expect.objectContaining({ ref: "receipt-8" })],
      ] });
    expect(JSON.stringify(contexts[8])).not.toContain("[depth omitted]");
    expect(commits[1]).toMatchObject({ kind: "horizon.react-compaction", checkpoint: "fact-1" });
  });

  it("records semantic progress observations without letting them control Tool availability", async () => {
    const commits: unknown[] = []; let roleTurns = 0; let checkpoints = 0;
    const ctx = {
      turn: async (spec: { system?: string; tools?: string[] }) => {
        if (spec.system === LOOP_CHECKPOINT_SYSTEM) {
          checkpoints++;
          return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
            object: "constal.horizon.loop-checkpoint", version: 1, role: "test", ready: false,
            summary: "The same ownership question remains open.", unknowns: [{ question: "Who owns it?",
              state: "open", resolution: null, evidence: [`round-${checkpoints}`] }], nextEvidence: ["Exact owner declaration"],
          } } as unknown as TurnRecord;
        }
        roleTurns++;
        if (roleTurns <= 16) return { toolCalls: [call({ ref: `different-evidence-${roleTurns}` })],
          message: { role: "assistant", content: "" }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" },
          artifact: { status: "blocked" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => {
        commits.push(artifact);
        return { hash: `fact-${commits.length}`, artifact, artifactHash: `artifact-${commits.length}` } as unknown as Fact<unknown>;
      },
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_read"], maxRounds: 20,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "blocked"
        ? value as { status: "blocked" } : null }, ctx);
    expect(result.plateaued).toBe(false);
    expect(checkpoints).toBe(2);
    expect(roleTurns).toBe(17);
    expect(commits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "horizon.react-progress", toolRounds: 8 }),
      expect.objectContaining({ kind: "horizon.react-progress", toolRounds: 16 }),
    ]));
  });
});
