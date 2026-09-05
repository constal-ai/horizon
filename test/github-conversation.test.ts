// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { operationalPresentation, planMarkdown, questionMarkdown, terminalMarkdown } from "../src/github-conversation.js";
import type { HzPlan, HzRunResult } from "../src/contracts.js";
import { parseHorizonOperationalResult, type HorizonOperationalResult } from "../src/operational.js";

describe("GitHub decision questions", () => {
  it("renders one first-person question, three choices, and a free-form path", () => {
    const body = questionMarkdown({ prompt: "When should I use a reaction-only acknowledgment?", options: [
      "Only when acknowledgment fully satisfies the request.",
      "Use a reaction together with a short textual response.",
      "Always use a textual response and never react alone.",
    ] });
    expect(body.startsWith("When should I use a reaction-only acknowledgment?")).toBe(true);
    expect(body).toContain("1. Only when acknowledgment fully satisfies the request.");
    expect(body).toContain("2. Use a reaction together with a short textual response.");
    expect(body).toContain("3. Always use a textual response and never react alone.");
    expect(body).toContain("4. **Write your own answer.**");
    expect(body).not.toContain("Horizon");
    expect(body).not.toContain("same Run");
  });

  it("preserves the question's explanation and Markdown instead of rewriting its prose", () => {
    const prompt = "Should existing files be replaced?\n\nThe command currently leaves them untouched. `--force` is already available.";
    const body = questionMarkdown({ prompt, options: ["Keep existing files.", "Replace only with --force.", "Always replace."] });
    expect(body.startsWith(`${prompt}\n\n1.`)).toBe(true);
  });

  it("presents an actionable proposal while keeping execution identity out of the comment", () => {
    const plan: HzPlan = { object: "constal.horizon.plan", version: 1, revision: 2, status: "ready",
      objective: "Handle missing files", summary: "I'll preserve existing files unless replacement is requested.",
      specification: "Use the current command and its existing options.", workspaceRoot: "/workspace/repo",
      unknowns: [], assertions: [], risks: [], question: null, steps: [{ id: "internal-work-id", milestoneId: "files",
        title: "Preserve existing files", responsibility: "Existing-file behavior", specification: "Update the command.\n\nKeep the current flags.",
        dependsOn: [], verification: ["Run command tests.", "Check the existing-file case."], stopWhen: "Behavior is tested." }] };
    const body = planMarkdown(plan);
    expect(body).toContain("## Proposed plan");
    expect(body).toContain("1. **Preserve existing files**\n\n   Update the command.\n\n   Keep the current flags.");
    expect(body).toContain("   Verification:\n\n   - Run command tests.\n   - Check the existing-file case.");
    expect(body).toContain("I won't change the repository until you approve.");
    expect(body).not.toContain("internal-work-id");
    expect(body).not.toContain("Plan fact");
    expect(body).not.toContain("interprets the meaning");
    const [review, details] = body.split("<details>");
    expect(review).toContain(plan.summary);
    expect(review).toContain("1. **Preserve existing files**\n\n   Existing-file behavior");
    expect(review).not.toContain(plan.specification);
    expect(details).toContain("<summary>Implementation details and checks</summary>");
    expect(details).toContain(plan.specification);
    expect(details).toContain("Update the command.\n\n   Keep the current flags.");
    expect(body.indexOf("I won't change")).toBeGreaterThan(body.indexOf("</details>"));
  });

  it("leaves the supervisor's actual answer intact", () => {
    const message = "I'm checking the command's existing-file behavior.\n\nThe tests cover replacement; I'm now checking the default path.";
    expect(terminalMarkdown({ object: "constal.horizon.operational-result", version: 1,
      status: "complete", message, action: { kind: "respond" }, evidence: [] })).toBe(message);
  });

  it("reports completed work and a review link without exposing execution hashes", () => {
    const result: HzRunResult = { object: "constal.horizon.result", version: 1, status: "complete",
      summary: "I've completed the approved changes and opened a pull request for review.",
      plan: { revision: 2, fact: "private-plan-fact" }, workspace: null, checkpoints: [],
      completedSteps: [{ id: "internal-work-id", status: "complete", summary: "Added the contributor guide and checked its links." }],
      remainingUnknowns: [], artifact: { path: "/workspace/final.tar.gz", ref: "private-artifact-ref", bytes: 42 },
      publication: { provider: "github", repository: "constal-ai/const-alpha", branch: "constal/guide", commit: "private-commit",
        pullRequest: { number: 5, url: "https://github.com/constal-ai/const-alpha/pull/5" }, marker: "private-marker" },
      longHorizon: { durablePlan: true, specialistRuns: 10, replans: 0, plateauCycles: 0 } };
    const body = terminalMarkdown(result);
    expect(body).toContain("## Ready for review");
    expect(body).toContain(result.summary);
    expect(body).toContain("- Added the contributor guide and checked its links.");
    expect(body).toContain("[#5](https://github.com/constal-ai/const-alpha/pull/5)");
    expect(body).not.toContain("private-");
    expect(body).not.toContain("internal-work-id");
  });

  it("uses the same question contract for conversational and planning questions", () => {
    const question = { prompt: "How should dotted initialisms behave?", options: [
      "Match their undotted forms.", "Keep punctuation significant.", "Try exact matches before a normalized fallback.",
    ] as [string, string, string] };
    const result = parseHorizonOperationalResult({ object: "constal.horizon.operational-result", version: 1,
      status: "needs-input", message: "", question, action: { kind: "respond" }, evidence: [] });
    expect(result).not.toBeNull();
    expect(terminalMarkdown(result!)).toBe(questionMarkdown(question));
    expect(terminalMarkdown(result!)).toContain("4. **Write your own answer.**");
    expect(parseHorizonOperationalResult({ ...result, question: { prompt: "Choose?", options: ["One"] } })).toBeNull();
  });

  it("publishes one start acknowledgment without suppressing questions or failed handoffs", () => {
    const result: HorizonOperationalResult = { object: "constal.horizon.operational-result", version: 1,
      status: "complete", message: "I'll start the investigation.", action: { kind: "start-work", objective: "Fix search." },
      evidence: [], control: { operation: "session.deliver", fact: "f".repeat(64), state: "queued" } };
    expect(operationalPresentation(result)).toBeNull();
    const question = { prompt: "Which behavior do you prefer?", options: ["Preserve.", "Normalize.", "Support both."] as [string, string, string] };
    expect(operationalPresentation({ ...result, question })?.body).toBe(questionMarkdown(question));
    const { control: _control, ...withoutReceipt } = result;
    expect(operationalPresentation({ ...withoutReceipt, status: "blocked",
      message: "I couldn't start the investigation." })?.body).toBe("I couldn't start the investigation.");
  });
});
