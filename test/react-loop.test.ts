import type { Ctx, Fact, ToolCallRecord, TurnRecord } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import { EvidencePlateauDetector, runReactLoop } from "../src/react-loop.js";

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
});
