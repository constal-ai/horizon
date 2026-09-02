import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@constal/sdk";
import { HORIZON_BEHAVIOR_CATALOG, horizonRoutedEvent } from "../src/behaviors.js";
import { runHorizonOperational } from "../src/operational.js";
import { issueWorkAgent } from "../src/tasks/issue-work.js";
import type { HzRunResult } from "../src/contracts.js";

describe("Horizon behavior routing", () => {
  it("advertises issue work separately from lightweight operation", () => {
    expect(HORIZON_BEHAVIOR_CATALOG.modes.map(({ id, longHorizon }) => ({ id, longHorizon }))).toEqual([
      { id: "issue-work", longHorizon: true }, { id: "operate", longHorizon: false },
    ]);
    expect(HORIZON_BEHAVIOR_CATALOG.modes.find(({ id }) => id === "operate")?.requiredBindings).not.toContain("sandbox");
  });

  it("requires an explicit normalized behavior on Channel events", () => {
    expect(horizonRoutedEvent({ object: "constal.horizon.event", version: 1, behavior: "operate",
      eventClass: "github.question", objective: "What does this module do?" })).toMatchObject({ behavior: "operate" });
    expect(horizonRoutedEvent({ object: "constal.horizon.event", version: 1,
      eventClass: "github.question", objective: "What does this module do?" })).toBeNull();
  });

  it("offers no workspace capability to the operational loop", async () => {
    const turn = vi.fn(async (input: { tools: string[]; context: unknown }) => {
      expect(input.tools).toEqual(["github_repositories", "github_repository", "github_tree", "github_file", "web_search", "web_fetch"]);
      expect(input.context).toEqual({ eventClass: "github.question",
        context: { repository: "constal-ai/horizon" }, constraints: [] });
      return { toolCalls: [], message: { role: "assistant", content: JSON.stringify({
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "The module validates setup screens.", handoff: "none", evidence: [],
      }) }, artifact: null };
    });
    const commit = vi.fn(async () => ({ hash: "a".repeat(64) }));
    const ctx = { turn, commit, resources: { model: "model", github: "github", web: "web", search: "search" } } as unknown as Ctx;
    await expect(runHorizonOperational(horizonRoutedEvent({ object: "constal.horizon.event", version: 1,
      behavior: "operate", eventClass: "github.question", objective: "Explain it.",
      context: { repository: "constal-ai/horizon", approval: { permissions: ["write", "admin"] } } })!, ctx))
      .resolves.toMatchObject({ status: "complete" });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("spawns the durable issue-work Agent when the frontend chooses a handoff", async () => {
    const issueResult = { object: "constal.horizon.result", version: 1, status: "blocked",
      summary: "Planning needs input." } as unknown as HzRunResult;
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "handoff",
      message: "Implementation requires issue work.", handoff: "issue-work", evidence: [],
    }) }, artifact: null }));
    const spawn = vi.fn(async () => issueResult);
    const commit = vi.fn(async () => ({ hash: "a".repeat(64) }));
    const ctx = { turn, spawn, commit, resources: { model: "model", github: "github" } } as unknown as Ctx;
    const event = horizonRoutedEvent({ object: "constal.horizon.event", version: 1, behavior: "operate",
      eventClass: "github.issue.comment", objective: "Implement the fix.",
      context: { repository: "constal-ai/horizon", issue: 10 },
      constraints: ["Work only in constal-ai/horizon."],
      source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" } })!;

    await expect(runHorizonOperational(event, ctx)).resolves.toBe(issueResult);
    expect(spawn).toHaveBeenCalledWith(issueWorkAgent, {
      objective: "Implement the fix.",
      context: { eventClass: "github.issue.comment", event: { repository: "constal-ai/horizon", issue: 10 } },
      constraints: ["Work only in constal-ai/horizon."],
      source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" },
    }, { retries: 1, dedupe: "specHash",
      budget: { turns: 2_048, microUsd: 500_000_000, wallMs: 7 * 24 * 60 * 60_000 } });
  });
});
