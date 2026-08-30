import { describe, expect, it } from "vitest";
import { EXECUTOR_SYSTEM } from "../src/prompts/executor.js";
import { DISCOVERY_SYSTEM, INVESTIGATOR_SYSTEM } from "../src/prompts/discovery.js";
import { PLANNER_SYSTEM } from "../src/prompts/planner.js";
import { RECONCILER_SYSTEM } from "../src/prompts/reconciler.js";
import { VERIFIER_SYSTEM } from "../src/prompts/verifier.js";
import { ASSERTION_SYSTEM, CRITIQUE_SYSTEM, DECOMPOSITION_SYSTEM, DESIGN_SYSTEM, RUBRIC_SYSTEM } from "../src/prompts/planning.js";

describe("Horizon role prompts", () => {
  it.each([DISCOVERY_SYSTEM, INVESTIGATOR_SYSTEM, RUBRIC_SYSTEM, DESIGN_SYSTEM, DECOMPOSITION_SYSTEM, ASSERTION_SYSTEM,
    CRITIQUE_SYSTEM, PLANNER_SYSTEM, EXECUTOR_SYSTEM, VERIFIER_SYSTEM, RECONCILER_SYSTEM])("uses one stable six-section role contract", (prompt) => {
    const headings = ["# Role", "# Task", "# Context", "# Rules", "# Tools", "# Output"];
    expect(headings.map((heading) => prompt.indexOf(heading))).toEqual([...headings.map((heading) => prompt.indexOf(heading))].sort((a, b) => a - b));
    expect(prompt).toContain("natural-language");
    expect(prompt).toContain("evidence");
  });

  it("makes planning immutable and execution responsibility-scoped", () => {
    expect(DISCOVERY_SYSTEM).toContain("separate child Agent");
    expect(INVESTIGATOR_SYSTEM).toContain("one bounded software question set");
    expect(RUBRIC_SYSTEM).toContain("definition of success");
    expect(DESIGN_SYSTEM).toContain("software design agent");
    expect(DECOMPOSITION_SYSTEM).toContain("A semantic decision may be its own work unit");
    expect(ASSERTION_SYSTEM).toContain("per-step assertion agent");
    expect(CRITIQUE_SYSTEM).toContain("cross-plan critique agent");
    expect(PLANNER_SYSTEM).toContain("plan finalization agent");
    expect(EXECUTOR_SYSTEM).toContain("exactly one responsibility");
    expect(VERIFIER_SYSTEM).toContain("independent verification specialist");
    expect(RECONCILER_SYSTEM).toContain("new immutable revision");
  });
});
