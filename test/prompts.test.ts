import { describe, expect, it } from "vitest";
import { EXECUTOR_SYSTEM } from "../src/prompts/executor.js";
import { PLANNER_SYSTEM } from "../src/prompts/planner.js";
import { RECONCILER_SYSTEM } from "../src/prompts/reconciler.js";

describe("Horizon role prompts", () => {
  it.each([PLANNER_SYSTEM, EXECUTOR_SYSTEM, RECONCILER_SYSTEM])("uses one stable six-section role contract", (prompt) => {
    const headings = ["# Role", "# Task", "# Context", "# Rules", "# Tools", "# Output"];
    expect(headings.map((heading) => prompt.indexOf(heading))).toEqual([...headings.map((heading) => prompt.indexOf(heading))].sort((a, b) => a - b));
    expect(prompt).toContain("natural-language");
    expect(prompt).toContain("evidence");
  });

  it("makes planning immutable and execution responsibility-scoped", () => {
    expect(PLANNER_SYSTEM).toContain("immutable natural-language execution specification");
    expect(PLANNER_SYSTEM).toContain("A semantic decision can be its own specialist");
    expect(EXECUTOR_SYSTEM).toContain("exactly one responsibility");
    expect(RECONCILER_SYSTEM).toContain("new immutable revision");
  });
});

