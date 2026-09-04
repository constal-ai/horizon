// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applicationError, applicationFailureSummary, rethrowRuntimeControl } from "../src/runtime-control.js";

describe("Horizon runtime control boundaries", () => {
  it.each(["CommitYield", "SuspendYield", "AfterYield", "NondeterministicReplay", "LeaseLost", "CommitConflict"])(
    "never swallows %s", (name) => {
      const error = Object.assign(new Error("control"), { name });
      expect(() => rethrowRuntimeControl(error)).toThrow(error);
    });

  it("recognizes durable suspension structurally and leaves application failures available", () => {
    const suspension = Object.assign(new Error("pause"), { durableSuspension: true });
    expect(() => rethrowRuntimeControl(suspension)).toThrow(suspension);
    expect(() => rethrowRuntimeControl(new TypeError("bad artifact"))).not.toThrow();
    expect(applicationError(new TypeError("bad artifact"))).toEqual({ name: "TypeError", message: "bad artifact" });
  });

  it("turns known application failures into user-facing recovery explanations", () => {
    expect(applicationFailureSummary("planning", Object.assign(new Error("turn gate exhausted"), { name: "GateExhausted" })))
      .toBe("Horizon could not produce a valid planning result after correction attempts.");
    expect(applicationFailureSummary("publication", Object.assign(new Error("effect outcome is unknown"), { name: "OutcomeUnknown" })))
      .toContain("could not be safely reconciled");
  });
});
