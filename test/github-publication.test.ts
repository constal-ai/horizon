import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@constal/sdk";
import type { HzPlan, HzRequest } from "../src/contracts.js";
import { publishWorkspace } from "../src/github-publication.js";

vi.mock("@constal-ai/github", () => ({ invokeGitHub: (operation: string, args: unknown, ctx: Ctx) =>
  ctx.invoke(ctx.resources.github!, operation, args) }));

describe("Horizon GitHub publication", () => {
  it("does not publish a direct GitHub-backed Run without issue-work context", async () => {
    const request: HzRequest = { objective: "Inspect the repository", context: null,
      constraints: ["Do not publish."], source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
      environment: { name: "default", cache: true, setup: [] } };
    const invoke = vi.fn();
    await expect(publishWorkspace(request, { revision: 1 } as HzPlan, "plan-fact", {
      ref: "a".repeat(64), bytes: 100, path: "/workspace/final.tar.gz",
    }, { resources: { github: "github" }, invoke } as unknown as Ctx)).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("publishes the immutable artifact to a deterministic branch before creating a pull request", async () => {
    const request: HzRequest = { objective: "Fix the issue", context: { event: { issue: 42 } }, constraints: [],
      source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
      environment: { name: "default", cache: true, setup: [] } };
    const plan = { revision: 3, summary: "Repair Horizon setup", objective: request.objective } as HzPlan;
    const invoke = vi.fn(async (_resource: string, operation: string, input: { branch?: string }) => operation === "repository.branch.publish"
      ? { branch: input.branch, commit: "commit-sha", tree: "tree-sha", files: 3, duplicate: false }
      : { pullRequest: { number: 77, html_url: "https://github.com/constal-ai/horizon/pull/77" }, duplicate: false });
    const ctx = { resources: { github: "github" }, run: { id: "run-1" }, invoke } as unknown as Ctx;
    const result = await publishWorkspace(request, plan, "plan-fact-123456789", {
      ref: "a".repeat(64), bytes: 100, path: "/workspace/final.tar.gz",
    }, ctx);
    expect(result).toMatchObject({ repository: "constal-ai/horizon", branch: "constal/horizon-42-plan-fact-12",
      commit: "commit-sha", pullRequest: { number: 77, url: "https://github.com/constal-ai/horizon/pull/77" } });
    expect(invoke).toHaveBeenNthCalledWith(1, "github", "repository.branch.publish", expect.objectContaining({
      owner: "constal-ai", repository: "horizon", base: "main", archive: "a".repeat(64),
      branch: "constal/horizon-42-plan-fact-12",
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, "github", "pull-request.create", expect.objectContaining({
      head: "constal/horizon-42-plan-fact-12", base: "main",
    }));
  });
});
