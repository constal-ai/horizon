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

  it("ignores volatile sandbox identity and metering fields when evidence is unchanged", () => {
    const detector = new EvidencePlateauDetector();
    const command = (ordinal: number) => call({
      commandId: `run:root/${ordinal}/tool/0`, status: "completed", exitCode: 0,
      stdoutRef: "same-content", stdoutPreview: "README.md\n", stderrRef: null, outputs: [],
      sandbox: { id: "session-sandbox", generation: 1, fresh: false },
      usage: { wallMs: 10 + ordinal, microUsd: 100 + ordinal, providerUnits: { active_memory_gib_ms: 500 + ordinal } },
    });
    expect(detector.observe([command(1)])).toEqual({ plateaued: false, stableRounds: 0, added: 1 });
    expect(detector.observe([command(2)])).toEqual({ plateaued: false, stableRounds: 1, added: 0 });
    expect(detector.observe([command(3)])).toEqual({ plateaued: true, stableRounds: 2, added: 0 });
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

  it("propagates Tool availability failures instead of silently degrading the role", async () => {
    const ctx = { turn: async () => { throw new ToolUnavailable("workspace_patch"); } } as unknown as Ctx;
    await expect(runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_patch"], maxRounds: 8, parse: () => null }, ctx)).rejects.toBeInstanceOf(ToolUnavailable);
  });

  it("keeps bounded compacted evidence available while committing complete older rounds", async () => {
    const contexts: unknown[] = []; const commits: unknown[] = []; let turns = 0;
    const ctx = {
      turn: async (spec: { context?: unknown }) => {
        contexts.push(spec.context); turns++;
        if (turns <= 7) return { toolCalls: [call({ ref: `evidence-${turns}` })],
          message: { role: "assistant", content: "Inspecting." }, artifact: null } as unknown as TurnRecord;
        return { toolCalls: [], message: { role: "assistant", content: "" },
          artifact: { status: "complete" } } as unknown as TurnRecord;
      },
      commit: async (artifact: unknown) => {
        commits.push(artifact);
        return { hash: `fact-${commits.length}`, artifact, artifactHash: `artifact-${commits.length}` } as unknown as Fact<unknown>;
      },
    } as unknown as Ctx;
    const result = await runReactLoop({ role: "test", system: "test", objective: "test", context: {},
      tools: ["workspace_read"], maxRounds: 10,
      parse: (value) => value && typeof value === "object" && (value as { status?: unknown }).status === "complete"
        ? value as { status: "complete" } : null }, ctx);
    expect(result.plateaued).toBe(false);
    expect(commits).toHaveLength(1);
    expect(contexts[7]).toMatchObject({ compacted: [{ fact: "fact-1", rounds: 4 }],
      compactedEvidence: expect.arrayContaining([expect.objectContaining({ result: { ref: "evidence-1" } })]) });
  });

  it("stops semantically unchanged unknowns even when Tool calls keep changing", async () => {
    const commits: unknown[] = []; let roleTurns = 0; let checkpoints = 0;
    const ctx = {
      turn: async (spec: { system?: string; tools?: string[] }) => {
        if (spec.system === LOOP_CHECKPOINT_SYSTEM) {
          checkpoints++;
          return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
            object: "constal.horizon.loop-checkpoint", version: 1, role: "test", ready: false,
            summary: "The same ownership question remains open.", unknowns: [{ id: "owner", question: "Who owns it?",
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
    expect(result.plateaued).toBe(true);
    expect(checkpoints).toBe(2);
    expect(roleTurns).toBe(17);
    expect(commits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "horizon.react-progress", toolRounds: 8 }),
      expect.objectContaining({ kind: "horizon.react-progress", toolRounds: 16 }),
    ]));
  });
});
