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
  return `${question.prompt}\n\n${options}\n4. **Write your own answer.**\n\nReply with an option number or describe what you'd prefer.`;
}

export function planMarkdown(plan: HzPlan): string {
  const steps = plan.steps.map((step, index) => {
    const checks = step.verification.length ? step.verification : [step.stopWhen];
    const indent = " ".repeat(String(index + 1).length + 2);
    const specification = step.specification.split("\n").map((line) => line ? `${indent}${line}` : "").join("\n");
    const verification = checks.map((check) => `${indent}- ${check.split("\n").join(`\n${indent}  `)}`).join("\n");
    return `${index + 1}. **${step.title}**\n\n${specification}\n\n${indent}Verification:\n\n${verification}`;
  }).join("\n\n");
  const risks = plan.risks.length > 0 ? `\n\n### Risks\n\n${plan.risks.map((risk) => `- ${risk}`).join("\n")}` : "";
  return `## Proposed plan\n\n${plan.summary}\n\n### Approach\n\n${plan.specification}\n\n### Changes and checks\n\n${steps}${risks}\n\nDoes this plan look right? Reply with your approval or tell me what you'd like changed. I won't change the repository until you approve.`;
}

export function milestoneMarkdown(step: HzPlan["steps"][number], result: HzStepResult, completed: number, total: number): string {
  return `### ${step.title}\n\n${result.summary}\n\n${completed} of ${total} steps complete; verification passed.`;
}

export function terminalMarkdown(result: HzRunResult | HorizonOperationalResult): string {
  if (result.object === "constal.horizon.operational-result") return result.question ? questionMarkdown(result.question) : result.message;
  if (result.status === "complete") {
    const steps = result.completedSteps.map((step) => `- ${step.summary}`).join("\n");
    const publication = result.publication ? `\n\n### Pull request\n\n[#${result.publication.pullRequest.number}](${result.publication.pullRequest.url}) · \`${result.publication.branch}\`` : "";
    return `## ${result.publication ? "Ready for review" : "Completed"}\n\n${result.summary}${steps ? `\n\n### What changed\n\n${steps}` : ""}${publication}`;
  }
  return `## I couldn't finish the change\n\n${result.summary}`;
}
