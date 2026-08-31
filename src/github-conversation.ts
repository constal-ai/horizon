import { hashValue, type AwaitPresentation, type Ctx } from "@constal/sdk";
import type { HorizonRoutedEvent } from "./behaviors.js";
import type { HzPlan, HzRequest, HzRunResult, HzStepResult } from "./contracts.js";
import type { HorizonOperationalResult } from "./operational.js";

interface GitHubConversation {
  owner: string;
  repository: string;
  issue: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function conversation(value: unknown): GitHubConversation | null {
  const source = record(value); const repository = typeof source?.repository === "string" ? source.repository.split("/") : [];
  const issue = Number(source?.issue);
  return repository.length === 2 && repository.every(Boolean) && Number.isSafeInteger(issue) && issue > 0
    ? { owner: repository[0]!, repository: repository[1]!, issue } : null;
}

export function routedConversation(event: HorizonRoutedEvent): GitHubConversation | null {
  return conversation(event.context);
}

export function requestConversation(request: HzRequest): GitHubConversation | null {
  const context = record(request.context);
  return conversation(context?.event);
}

function boundedMarkdown(value: string): string {
  const body = value.trim();
  if (body.length <= 60_000) return body;
  return `${body.slice(0, 59_900).trimEnd()}\n\n_The rendered update was truncated; the complete artifact remains in the Horizon Run._`;
}

export async function postConversation(ctx: Ctx, target: GitHubConversation | null, phase: string, body: string): Promise<void> {
  if (!target || !ctx.resources.github) return;
  const rendered = boundedMarkdown(body);
  const marker = await hashValue({ object: "constal.horizon.github-message", version: 1, run: ctx.run.id,
    phase, owner: target.owner, repository: target.repository, issue: target.issue });
  await ctx.invoke(ctx.resources.github, "issue.comment.create", {
    owner: target.owner, repository: target.repository, issue: target.issue, body: rendered, marker,
  }, { dedupeKey: marker });
}

export function waitPresentation(kind: string, title: string, body: string,
  metadata?: AwaitPresentation["metadata"]): AwaitPresentation {
  return { object: "constal.await.presentation", version: 1, kind, title, body: boundedMarkdown(body),
    ...(metadata ? { metadata } : {}) };
}

export function questionMarkdown(question: string): string {
  return `## Horizon needs input\n\n${question}\n\nReply on this issue and Horizon will continue the same durable Run.`;
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
    return `## Horizon completed the work\n\n${result.summary}${steps ? `\n\n### Completed work\n\n${steps}` : ""}`;
  }
  return `## Horizon is blocked\n\n${result.summary}`;
}
