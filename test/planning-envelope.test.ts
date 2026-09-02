import { describe, expect, it } from "vitest";
import { parseHzAssertionPlan, parseHzMilestoneWork, parseHzPlanNarrative, parseHzStepAssertions } from "../src/contracts.js";
import { assertionPlanArtifact, milestoneWorkArtifact, planningArtifact } from "../src/planning-envelope.js";

describe("runtime-owned planning envelopes", () => {
  it("replaces stale assertion identity without changing semantic content", () => {
    const semantic = {
      object: "constal.horizon.step-assertions", version: 1, revision: 1, stepId: "stale-step",
      assertions: [{ id: "proof", claim: "The behavior is observed.",
        evidenceRequired: ["A focused test passes."], negativePath: false }],
    };
    const artifact = planningArtifact(semantic,
      { object: "constal.horizon.step-assertions", revision: 2, stepId: "current-step" });
    expect(parseHzStepAssertions(artifact, 2, "current-step")).toEqual({
      object: "constal.horizon.step-assertions", version: 1, revision: 2, stepId: "current-step",
      assertions: semantic.assertions,
    });
  });

  it("adds omitted milestone identity to the artifact and every work unit", () => {
    const semantic = { steps: [{ id: "implement", title: "Implement", responsibility: "Implement the behavior.",
      specification: "Use the existing abstraction.", dependsOn: [], verification: ["The focused test passes."],
      stopWhen: "The behavior is proven." }] };
    const artifact = milestoneWorkArtifact(semantic, 3, "delivery");
    expect(parseHzMilestoneWork(artifact, 3, "delivery")).toEqual({
      object: "constal.horizon.milestone-work", version: 1, revision: 3, milestoneId: "delivery",
      steps: [{ ...semantic.steps[0], milestoneId: "delivery" }],
    });
  });

  it("adds runtime identity to a complete repaired assertion plan", () => {
    const semantic = { assertions: [{ stepId: "implement", assertions: [{ id: "proof",
      claim: "The behavior is observed.", evidenceRequired: ["A focused test passes."], negativePath: false }] }] };
    expect(parseHzAssertionPlan(assertionPlanArtifact(semantic, 4), 4, ["implement"])).toEqual({
      object: "constal.horizon.assertion-plan", version: 1, revision: 4,
      assertions: [{ object: "constal.horizon.step-assertions", version: 1, revision: 4, ...semantic.assertions[0] }],
    });
  });

  it("adds the finalizer transport identity while preserving semantic validation", () => {
    const semantic = { summary: "Deliver the behavior.", specification: "Implement and verify it.",
      unknowns: [], risks: [] };
    expect(parseHzPlanNarrative(planningArtifact(semantic,
      { object: "constal.horizon.plan-narrative" }))).toEqual({
      object: "constal.horizon.plan-narrative", version: 1, ...semantic,
    });
    expect(parseHzPlanNarrative(planningArtifact({ ...semantic, summary: "" },
      { object: "constal.horizon.plan-narrative" }))).toBeNull();
  });
});
