import type { ToolCallRecord } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import { EvidencePlateauDetector } from "../src/react-loop.js";

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
});

