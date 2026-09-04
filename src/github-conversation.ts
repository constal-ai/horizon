// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AwaitPresentation } from "@constal/sdk";
import type { HzDecisionQuestion, HzPlan, HzRunResult, HzStepResult } from "./contracts.js";
import type { HorizonOperationalResult } from "./operational.js";

function boundedMarkdown(value: string): string {
  const body = value.trim();
  if (body.length <= 60_000) return body;
  return `${body.slice(0, 59_900).trimEnd()}\n\n_The rendered update was truncated; the complete artifact remains in the Horizon Run._`;
}

export function waitPresentation(kind: string, title: string, body: string,
  metadata?: AwaitPresentation["metadata"]): AwaitPresentation {
  return { object: "constal.await.presentation", version: 1, kind, title, body: boundedMarkdown(body),
    ...(metadata ? { metadata } : {}) };
}

export function questionMarkdown(question: HzDecisionQuestion): string {
  const options = question.options.map((option, index) => `${index + 1}. ${option}`).join("\n");
  return `## I need one decision\n\n**${question.prompt}**\n\n${options}\n4. **Write your own answer** — reply with the direction you want me to follow.\n\nReply with **1**, **2**, or **3**, or write your own answer. I’ll continue this same Run from your decision.`;
}

export function planMarkdown(plan: HzPlan, planFact: string): string {
  const steps = plan.steps.map((step, index) => `${index + 1}. **${step.title}** — ${step.specification}\n   - Verify: ${step.verification.join("; ") || step.stopWhen}`).join("\n");
  const risks = plan.risks.length > 0 ? `\n\n### Risks\n\n${plan.risks.map((risk) => `- ${risk}`).join("\n")}` : "";
  return `## Horizon plan · revision ${plan.revision}\n\n${plan.summary}\n\n### Specification\n\n${plan.specification}\n\n### Work plan\n\n${steps}${risks}\n\n**Plan fact:** \`${planFact}\`\n\nReply with your approval, requested changes, or cancellation. Horizon interprets the meaning of the reply and verifies the sender's repository permission before any mutation begins.`;
}

export function milestoneMarkdown(step: HzPlan["steps"][number], result: HzStepResult, completed: number, total: number): string {
  return `### Milestone ${completed} of ${total} complete · ${step.title}\n\n${result.summary}\n\nVerification passed and a durable workspace checkpoint was captured.`;
}

export function terminalMarkdown(result: HzRunResult | HorizonOperationalResult): string {
  if (result.object === "constal.horizon.operational-result") return result.message;
  if (result.status === "complete") {
    const steps = result.completedSteps.map((step) => `- **${step.id}:** ${step.summary}`).join("\n");
    const publication = result.publication ? `\n\n### Pull request\n\n[#${result.publication.pullRequest.number}](${result.publication.pullRequest.url}) · \`${result.publication.branch}\`` : "";
    return `## Horizon completed the work\n\n${result.summary}${steps ? `\n\n### Completed work\n\n${steps}` : ""}${publication}`;
  }
  return `## Horizon is blocked\n\n${result.summary}`;
}
