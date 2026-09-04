// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { channel, hashValue, type ChannelContext, type ChannelRequest } from "@constal/sdk";
import { HORIZON_BEHAVIOR_CATALOG } from "../behaviors.js";
import { HORIZON_GITHUB_EVENT_CATALOG, HORIZON_GITHUB_MENTIONS } from "../github-events.js";

const provider = { kind: "local", resourceKind: "auth-provider", id: "horizon-github" } as const;
const CONSTAL_COMMENT_MARKER = /<!--\s*constal:[a-f0-9]{64}\s*-->/u;

interface HorizonGitHubConfig {
  repositories: string[];
  events: string[];
  routes: Record<string, "issue-work" | "operate">;
  mentions: string[];
  label: string;
  approverPermissions: Array<"write" | "maintain" | "admin">;
  semanticApproval: true;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("GitHub webhook value must be an object");
  return value as Record<string, unknown>;
}

function decode(bodyBase64: string | null): Record<string, unknown> {
  if (!bodyBase64) throw new TypeError("GitHub webhook body is required");
  const bytes = Uint8Array.from(atob(bodyBase64), (character) => character.charCodeAt(0));
  return record(JSON.parse(new TextDecoder().decode(bytes)));
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value)); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32_768, bytes.length)));
  }
  return btoa(binary);
}

function config(value: unknown): HorizonGitHubConfig {
  const source = record(value); const routes = record(source.routes);
  const mentions = Array.isArray(source.mentions) ? source.mentions
    : typeof source.mention === "string" ? [...HORIZON_GITHUB_MENTIONS, source.mention] : null;
  const eventIds = HORIZON_GITHUB_EVENT_CATALOG.events.map(({ id }) => id);
  if (!Array.isArray(source.repositories) || source.repositories.length < 1 || source.repositories.length > 500
    || source.repositories.some((item) => typeof item !== "string" || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(item))
    || !Array.isArray(source.events) || source.events.length < 1 || source.events.some((item) => !eventIds.includes(item as never))
    || !mentions || mentions.length < 1 || mentions.length > 8
    || mentions.some((item) => typeof item !== "string" || !/^@[A-Za-z0-9-]{1,100}$/u.test(item))
    || typeof source.label !== "string" || source.label.length > 64
    || !Array.isArray(source.approverPermissions) || source.approverPermissions.length < 1
    || source.approverPermissions.some((item) => !["write", "maintain", "admin"].includes(String(item)))
    || source.semanticApproval !== true) throw new TypeError("Horizon GitHub Channel configuration is invalid");
  const normalizedRoutes: HorizonGitHubConfig["routes"] = {};
  for (const event of source.events as string[]) {
    const declaration = HORIZON_GITHUB_EVENT_CATALOG.events.find(({ id }) => id === event);
    const behavior = routes[event];
    if (!declaration || typeof behavior !== "string" || !(declaration.behaviors as readonly string[]).includes(behavior)
      || !HORIZON_BEHAVIOR_CATALOG.modes.some(({ id }) => id === behavior)) throw new TypeError(`Horizon route ${event} is invalid`);
    normalizedRoutes[event] = behavior as "issue-work" | "operate";
  }
  return { repositories: [...new Set(source.repositories as string[])], events: [...new Set(source.events as string[])],
    routes: normalizedRoutes, mentions: [...new Set(mentions as string[])], label: source.label,
    approverPermissions: [...new Set(source.approverPermissions as HorizonGitHubConfig["approverPermissions"])], semanticApproval: true };
}

function ignored(delivery: string, reason: string) {
  return { ignored: true as const, reason, response: { status: 202,
    headers: { "content-type": "application/json" }, bodyBase64: encode({ accepted: true, delivery, ignored: reason }) } };
}

function boundedText(value: unknown, maximum = 65_536): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

async function findDeliveredComment(context: ChannelContext, owner: string, repositoryName: string, issueNumber: number,
  marker: string): Promise<Record<string, unknown> | null> {
  const expected = `<!-- constal:${marker} -->`;
  for (let page = 1; page <= 10; page++) {
    const comments = await context.invoke<unknown[]>(context.resources.github!, "issue.comments.list",
      { owner, repository: repositoryName, issue: issueNumber, page, perPage: 100 });
    if (!Array.isArray(comments)) throw new TypeError("GitHub returned an invalid comment page");
    const found = comments.flatMap((value) => {
      try { const comment = record(value); return typeof comment.body === "string" && comment.body.includes(expected) ? [comment] : []; }
      catch { return []; }
    })[0];
    if (found) return found;
    if (comments.length < 100) return null;
  }
  throw new TypeError("GitHub comment reconciliation exceeded its bounded search");
}

function repository(payload: Record<string, unknown>) {
  const value = record(payload.repository); const fullName = boundedText(value.full_name, 256);
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9._-]+$/u.test(part))) throw new TypeError("GitHub repository identity is invalid");
  return { id: String(value.id ?? ""), fullName, owner: parts[0]!, name: parts[1]!, defaultBranch: boundedText(value.default_branch, 256) || "main" };
}

function issue(payload: Record<string, unknown>) {
  const value = record(payload.issue ?? payload.pull_request); const number = Number(value.number);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError("GitHub issue identity is invalid");
  return { number, title: boundedText(value.title, 1_024), body: boundedText(value.body),
    labels: Array.isArray(value.labels) ? value.labels.flatMap((raw) => {
      try { const item = record(raw); return typeof item.name === "string" ? [item.name] : []; } catch { return []; }
    }) : [] };
}

function objective(eventClass: string, payload: Record<string, unknown>, issueValue: ReturnType<typeof issue>): string {
  if (eventClass === "github.issue.comment") {
    const comment = record(payload.comment);
    return boundedText(comment.body) || `Respond to the latest conversation on issue #${issueValue.number}.`;
  }
  if (eventClass === "github.pull-request.comment") {
    const comment = record(payload.comment ?? payload.review);
    return boundedText(comment.body) || `Respond to the latest pull request conversation on #${issueValue.number}.`;
  }
  return [issueValue.title, issueValue.body].filter(Boolean).join("\n\n") || `Investigate issue #${issueValue.number}.`;
}

function route(event: string, payload: Record<string, unknown>, selected: HorizonGitHubConfig): string | null {
  const action = boundedText(payload.action, 128);
  const issueValue = issue(payload);
  if (event === "issues") {
    const activated = ["opened", "reopened", "edited"].includes(action)
      && selected.mentions.some((mention) => issueValue.body.includes(mention))
      || action === "labeled" && selected.label !== "" && issueValue.labels.includes(selected.label);
    return activated && selected.events.includes("github.issue.activated") ? "github.issue.activated" : null;
  }
  if (event === "issue_comment") return action === "created" && selected.events.includes("github.issue.comment")
    ? "github.issue.comment" : null;
  if (["pull_request_review_comment", "pull_request_review"].includes(event)) {
    return selected.events.includes("github.pull-request.comment") ? "github.pull-request.comment" : null;
  }
  return null;
}

export default channel({
  id: "horizon-github",
  version: "0.3.11",
  public: true,
  authProvider: provider,
  needs: [{ binding: "github", kind: "service", ops: ["issue.comment.create", "repository.permission.get"] }],
  protocol: {
    id: "horizon.github",
    version: "1",
    async receive(request: ChannelRequest, context) {
      const delivery = request.headers["x-github-delivery"] ?? "";
      const event = request.headers["x-github-event"] ?? "";
      if (!/^[A-Za-z0-9-]{1,128}$/u.test(delivery) || !/^[A-Za-z0-9_]{1,128}$/u.test(event)) {
        throw new TypeError("GitHub delivery and event headers are required");
      }
      if (event === "ping") return ignored(delivery, "ping");
      const selected = config(context.config); const payload = decode(request.bodyBase64); const repo = repository(payload);
      if (!selected.repositories.some((candidate) => candidate.toLowerCase() === repo.fullName.toLowerCase())) {
        return ignored(delivery, "repository_not_selected");
      }
      if (event === "issue_comment" && CONSTAL_COMMENT_MARKER.test(boundedText(record(payload.comment).body))) {
        return ignored(delivery, "constal_generated_comment");
      }
      const eventClass = route(event, payload, selected);
      if (!eventClass) return ignored(delivery, "event_not_configured");
      const issueValue = issue(payload);
      const behavior = selected.routes[eventClass];
      if (!behavior) return ignored(delivery, "behavior_not_configured");
      const installation = record(payload.installation); const sender = record(payload.sender);
      const thread = `github-${(await hashValue({ installation: installation.id, repository: repo.id, issue: issueValue.number })).slice(0, 48)}`;
      const foregroundDelivery = (await hashValue({ thread, delivery })).slice(0, 16);
      const sessions = { foreground: `${thread}-front-${foregroundDelivery}`, work: `${thread}-work` };
      const session = behavior === "issue-work" ? sessions.work : sessions.foreground;
      return {
        id: delivery, type: `github.${event}`, session, deliver: "queue",
        reply: { destination: `${repo.fullName}#${issueValue.number}`,
          metadata: { provider: "github", repository: repo.fullName, issue: issueValue.number } },
        data: { object: "constal.horizon.event", version: 1, behavior, eventClass,
          objective: objective(eventClass, payload, issueValue),
          context: { provider: "github", repository: repo.fullName, issue: issueValue.number,
            installation: String(installation.id ?? ""), sender: { id: String(sender.id ?? ""), login: boundedText(sender.login, 100) },
            approval: { permissions: selected.approverPermissions }, action: boundedText(payload.action, 128), delivery, sessions,
            ...(event === "issue_comment" ? { comment: { id: String(record(payload.comment).id ?? "") } } : {}) },
          source: { kind: "github", owner: repo.owner, repository: repo.name, ref: repo.defaultBranch },
          constraints: [`Work only in ${repo.fullName}.`, `Relate the result to GitHub issue #${issueValue.number}.`],
        },
      };
    },
    respond(result) {
      return { status: 202, headers: { "content-type": "application/json" },
        bodyBase64: encode({ accepted: true, delivery: result.event.id, session: result.event.session,
          runId: result.runId, status: result.status,
          ...(result.error ? { error: boundedText(result.error, 4_096) } : {}) }) };
    },
    async send(message, context) {
      const match = message.destination.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)#(\d+)$/u);
      const data = record(message.data);
      const presentation = data.presentation && typeof data.presentation === "object" && !Array.isArray(data.presentation)
        ? data.presentation as Record<string, unknown> : null;
      const body = typeof data.body === "string" ? data.body : typeof presentation?.body === "string" ? presentation.body : "";
      if (!match || !body.trim()) {
        return { id: message.id, status: "failed", error: "GitHub issue-comment destination or body is invalid" };
      }
      const marker = await hashValue({ channel: context.channel, id: message.id, destination: message.destination });
      const owner = match[1]!; const repositoryName = match[2]!; const issueNumber = Number(match[3]);
      let comment = await findDeliveredComment(context, owner, repositoryName, issueNumber, marker); let duplicate = comment !== null;
      if (!comment) {
        try {
          comment = record(await context.invoke(context.resources.github!, "issue.comment.create", {
            owner, repository: repositoryName, issue: issueNumber, body: `${body}\n\n<!-- constal:${marker} -->`,
          }, { dedupeKey: message.id }));
        } catch (error) {
          comment = await findDeliveredComment(context, owner, repositoryName, issueNumber, marker);
          if (!comment) throw error;
          duplicate = true;
        }
      }
      return { id: message.id, status: "delivered", externalId: String(comment.id ?? marker),
        metadata: { provider: "github", duplicate,
          ...(typeof comment.html_url === "string" ? { url: comment.html_url } : {}) } };
    },
  },
});

export { config as horizonGitHubConfig };
