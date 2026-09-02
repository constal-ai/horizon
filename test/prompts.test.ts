import { describe, expect, it } from "vitest";
import { EXECUTOR_SYSTEM } from "../src/prompts/executor.js";
import { DISCOVERY_SYSTEM, INVESTIGATOR_SYSTEM } from "../src/prompts/discovery.js";
import { PLANNER_SYSTEM } from "../src/prompts/planner.js";
import { RECONCILER_SYSTEM } from "../src/prompts/reconciler.js";
import { VERIFIER_SYSTEM } from "../src/prompts/verifier.js";
import { SOURCE_RESOLVER_SYSTEM } from "../src/prompts/source.js";
import { ASSERTION_PLAN_REPAIR_SYSTEM, ASSERTION_SYSTEM, CONTINUITY_SYSTEM, CRITIQUE_SYSTEM, DECOMPOSITION_SYSTEM, DESIGN_SYSTEM,
  RUBRIC_SYSTEM, WORK_PLAN_REPAIR_SYSTEM } from "../src/prompts/planning.js";
import { LOOP_CHECKPOINT_SYSTEM } from "../src/react-loop.js";
import { QUESTION_RECONCILIATION_SYSTEM } from "../src/prompts/question-reconciliation.js";

describe("Horizon role prompts", () => {
  it.each([SOURCE_RESOLVER_SYSTEM, DISCOVERY_SYSTEM, INVESTIGATOR_SYSTEM, RUBRIC_SYSTEM, DESIGN_SYSTEM, DECOMPOSITION_SYSTEM, ASSERTION_SYSTEM,
    WORK_PLAN_REPAIR_SYSTEM, ASSERTION_PLAN_REPAIR_SYSTEM, CONTINUITY_SYSTEM, CRITIQUE_SYSTEM, PLANNER_SYSTEM, EXECUTOR_SYSTEM,
    VERIFIER_SYSTEM, RECONCILER_SYSTEM, QUESTION_RECONCILIATION_SYSTEM,
    LOOP_CHECKPOINT_SYSTEM])("uses one stable six-section role contract", (prompt) => {
    const headings = ["# Role", "# Task", "# Context", "# Rules", "# Tools", "# Output"];
    expect(headings.map((heading) => prompt.indexOf(heading))).toEqual([...headings.map((heading) => prompt.indexOf(heading))].sort((a, b) => a - b));
    expect(prompt).toContain("natural-language");
    expect(prompt).toContain("evidence");
  });

  it.each([RUBRIC_SYSTEM, DESIGN_SYSTEM, DECOMPOSITION_SYSTEM, WORK_PLAN_REPAIR_SYSTEM, ASSERTION_SYSTEM,
    ASSERTION_PLAN_REPAIR_SYSTEM, CONTINUITY_SYSTEM, CRITIQUE_SYSTEM])(
    "keeps planning revision identity out of the semantic model contract", (prompt) => {
      expect(prompt).not.toContain('"revision":1');
      expect(prompt).not.toContain("Use the revision supplied in context");
    });

  it("makes planning immutable and execution responsibility-scoped", () => {
    expect(SOURCE_RESOLVER_SYSTEM).toContain("one exact GitHub repository");
    expect(DISCOVERY_SYSTEM).toContain("separate child Agent");
    expect(INVESTIGATOR_SYSTEM).toContain("one bounded software question set");
    expect(RUBRIC_SYSTEM).toContain("definition of success");
    expect(DESIGN_SYSTEM).toContain("software design agent");
    expect(DECOMPOSITION_SYSTEM).toContain("A semantic decision may be its own work unit");
    expect(WORK_PLAN_REPAIR_SYSTEM).toContain("complete execution frontier");
    expect(ASSERTION_SYSTEM).toContain("per-step assertion agent");
    expect(ASSERTION_PLAN_REPAIR_SYSTEM).toContain("complete accepted work plan");
    expect(CONTINUITY_SYSTEM).toContain("plan-continuity agent");
    expect(CRITIQUE_SYSTEM).toContain("cross-plan critique agent");
    expect(PLANNER_SYSTEM).toContain("plan finalization agent");
    expect(EXECUTOR_SYSTEM).toContain("exactly one responsibility");
    expect(VERIFIER_SYSTEM).toContain("independent verification specialist");
    expect(RECONCILER_SYSTEM).toContain("new immutable revision");
  });

  it("reconciles historical discovery unknowns without impossible artifact rewrites", () => {
    expect(DESIGN_SYSTEM).toContain("immutable discovery snapshot");
    expect(CRITIQUE_SYSTEM).toContain("historical snapshots, not mutable current-state records");
    expect(CRITIQUE_SYSTEM).toContain("Do not require an earlier artifact to be rewritten");
    expect(CRITIQUE_SYSTEM).toContain("Discovery is not a repair owner here");
  });

  it("keeps discovery missions inside their read-only authority", () => {
    expect(DISCOVERY_SYSTEM).toContain("Every mission must be completable with the read-only Tools");
    expect(DISCOVERY_SYSTEM).toContain("Leave repository health commands, final diff proof, and artifact packaging");
    expect(INVESTIGATOR_SYSTEM).toContain("do not search indefinitely for a substitute");
    expect(INVESTIGATOR_SYSTEM).toContain("execution-phase responsibility");
  });

  it("uses native Git and journal evidence instead of forensic over-proof", () => {
    expect(RUBRIC_SYSTEM).toContain("authority ceilings and non-goals");
    expect(RUBRIC_SYSTEM).toContain("must not make a bounded change harder to prove than to implement");
    expect(DESIGN_SYSTEM).toContain("Do not design a second baseline");
    expect(DECOMPOSITION_SYSTEM).toContain("Do not add pre-edit full-tree inventories");
    expect(ASSERTION_SYSTEM).toContain("do not require the verifier to recreate a pre-edit filesystem inventory");
    expect(CRITIQUE_SYSTEM).toContain("Over-proof is itself a blocking planning defect");
  });

  it("gives cross-boundary repair one complete graph and stable structural targets", () => {
    expect(WORK_PLAN_REPAIR_SYSTEM).toContain("merge, remove, move, split, or rewire");
    expect(WORK_PLAN_REPAIR_SYSTEM).toContain("exactly one owner");
    expect(ASSERTION_PLAN_REPAIR_SYSTEM).toContain("exactly one assertion set for every current work unit");
    expect(CRITIQUE_SYSTEM).toContain("affectedMilestones");
    expect(CRITIQUE_SYSTEM).toContain("Preserve the same finding id");
    expect(RECONCILER_SYSTEM).toContain("Operation-level retry is not your decision");
    expect(EXECUTOR_SYSTEM).toContain("previous governed attempt");
    expect(QUESTION_RECONCILIATION_SYSTEM).toContain("semantic choice and consequence");
  });
});
