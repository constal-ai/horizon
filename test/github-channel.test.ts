import { describe, expect, it, vi } from "vitest";
import type { ChannelContext, ChannelRequest } from "@constal/sdk";
import horizonGitHub from "../src/github-channel/index.js";

const config = {
  repositories: ["constal-ai/horizon"],
  events: ["github.issue.activated", "github.issue.comment", "github.pull-request.comment", "github.status"],
  routes: { "github.issue.activated": "issue-work", "github.issue.comment": "operate",
    "github.pull-request.comment": "operate", "github.status": "operate" },
  mention: "@constalai", label: "horizon", approverPermissions: ["write", "maintain", "admin"], semanticApproval: true,
};

function request(event: string, payload: unknown, delivery = "delivery-1"): ChannelRequest {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  return { method: "POST", url: "https://platform.constal.ai/v1/integrations/github",
    headers: { "x-github-event": event, "x-github-delivery": delivery },
    bodyBase64: btoa(String.fromCharCode(...encoded)) };
}

function payload(body = "@constalai fix the setup flow") {
  return { action: "opened", installation: { id: 123 }, sender: { id: 7, login: "wlan0" },
    repository: { id: 11, full_name: "constal-ai/horizon", default_branch: "main" },
    issue: { number: 42, title: "Setup is broken", body, labels: [] } };
}

function context(invoke = vi.fn()): ChannelContext {
  return { channel: "crn:constal:production:tenant:default:channel/horizon-github" as never,
    principal: {} as never, invocationId: "invocation", config, resources: { github: "github" as never },
    analytics: { emit() {} }, invoke };
}

describe("Horizon GitHub Channel", () => {
  it("routes activated issue work into the durable planning and approval pipeline", async () => {
    const event = await horizonGitHub.protocol.receive(request("issues", payload()), context());
    expect(event).toMatchObject({ type: "github.issues", reply: { destination: "constal-ai/horizon#42",
      metadata: { provider: "github", repository: "constal-ai/horizon", issue: 42 } }, data: {
      object: "constal.horizon.event", behavior: "issue-work", eventClass: "github.issue.activated",
      source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
    } });
    expect("ignored" in event).toBe(false);
  });

  it("acknowledges unconfigured or inactive events without creating an Agent Run", async () => {
    await expect(horizonGitHub.protocol.receive(request("issues", payload("ordinary issue")), context()))
      .resolves.toMatchObject({ ignored: true, reason: "event_not_configured", response: { status: 202 } });
  });

  it("continues an active issue conversation without requiring another mention", async () => {
    const invoke = vi.fn(async () => ({ comments: [{ body: "Working on it.\n\n<!-- constal:abc -->" }] }));
    const value = { ...payload("ordinary issue"), action: "created", comment: { body: "What is the current plan?" } };
    const event = await horizonGitHub.protocol.receive(request("issue_comment", value), context(invoke));
    expect(event).toMatchObject({ data: { behavior: "operate", eventClass: "github.issue.comment",
      objective: "What is the current plan?" } });
    expect(invoke).toHaveBeenCalledWith("github", "issue.comments.list",
      { owner: "constal-ai", repository: "horizon", issue: 42, page: 1, perPage: 100 });
  });

  it("delivers durable Run presentations through the GitHub Connection", async () => {
    const invoke = vi.fn(async () => ({ comment: { id: 99, html_url: "https://github.com/constal-ai/horizon/issues/42#issuecomment-99" }, duplicate: false }));
    const receipt = await horizonGitHub.protocol.send!({ id: "message-1", destination: "constal-ai/horizon#42",
      data: { object: "constal.run.presentation", version: 1,
        presentation: { object: "constal.await.presentation", version: 1, kind: "approval",
          title: "Plan ready", body: "The plan is ready." } } }, context(invoke));
    expect(receipt).toMatchObject({ status: "delivered", externalId: "99", metadata: { provider: "github", duplicate: false } });
    expect(invoke).toHaveBeenCalledWith("github", "issue.comment.create", expect.objectContaining({
      owner: "constal-ai", repository: "horizon", issue: 42, body: "The plan is ready.", marker: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }), { dedupeKey: "message-1" });
  });
});
