// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { hashValue, type Ctx } from "@constal/sdk";
import { invokeGitHub } from "@constal-ai/github";
import type { HzPlan, HzRequest, HzRunResult } from "./contracts.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function issueNumber(request: HzRequest): number | null {
  const context = record(request.context); const event = record(context?.event); const issue = Number(event?.issue);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}

export async function publishWorkspace(request: HzRequest, plan: HzPlan, planFact: string,
  artifact: NonNullable<HzRunResult["artifact"]>, ctx: Ctx): Promise<HzRunResult["publication"]> {
  if (request.source?.kind !== "github") return null;
  if (!ctx.resources.github) throw new TypeError("GitHub publication requires the accepted GitHub Resource binding");
  const issue = issueNumber(request);
  if (issue === null) return null;
  const marker = await hashValue({ object: "constal.horizon.publication", version: 1, run: ctx.run.id,
    planFact, artifact: artifact.ref, repository: `${request.source.owner}/${request.source.repository}`, issue });
  const branchName = `constal/horizon-${issue}-${planFact.slice(0, 12)}`;
  const branch = await invokeGitHub("repository.branch.publish", {
      owner: request.source.owner, repository: request.source.repository, base: request.source.ref,
      branch: branchName, archive: artifact.ref, message: `Implement approved Horizon plan for #${issue}`, marker,
    }, ctx) as { branch: string; commit: string; tree: string; files: number; duplicate: boolean };
  const body = [`Implements the approved Horizon plan for #${issue}.`, "", plan.summary, "",
    `Plan fact: \`${planFact}\``, `Workspace artifact: \`${artifact.ref}\``, "", `Closes #${issue}`].join("\n");
  const created = await invokeGitHub("pull-request.create", {
      owner: request.source.owner, repository: request.source.repository, base: request.source.ref, head: branch.branch,
      title: plan.summary.slice(0, 256), body, marker,
    }, ctx) as { pullRequest?: { number?: unknown; html_url?: unknown }; duplicate?: boolean };
  const number = Number(created.pullRequest?.number); const url = created.pullRequest?.html_url;
  if (!Number.isSafeInteger(number) || number < 1 || typeof url !== "string" || !url.startsWith("https://github.com/")) {
    throw new TypeError("GitHub pull request publication returned an invalid receipt");
  }
  return { provider: "github", repository: `${request.source.owner}/${request.source.repository}`,
    branch: branch.branch, commit: branch.commit, pullRequest: { number, url }, marker };
}
