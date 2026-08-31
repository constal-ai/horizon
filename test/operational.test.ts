import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@constal/sdk";
import { HORIZON_BEHAVIOR_CATALOG, horizonRoutedEvent } from "../src/behaviors.js";
import { runHorizonOperational } from "../src/operational.js";

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
    const turn = vi.fn(async (input: { tools: string[] }) => {
      expect(input.tools).toEqual(["github_repositories", "github_repository", "github_tree", "github_file", "web_search", "web_fetch"]);
      return { toolCalls: [], message: { role: "assistant", content: JSON.stringify({
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "The module validates setup screens.", handoff: "none", evidence: [],
      }) }, artifact: null };
    });
    const commit = vi.fn(async () => ({ hash: "a".repeat(64) }));
    const ctx = { turn, commit, resources: { model: "model", github: "github", web: "web", search: "search" } } as unknown as Ctx;
    await expect(runHorizonOperational(horizonRoutedEvent({ object: "constal.horizon.event", version: 1,
      behavior: "operate", eventClass: "github.question", objective: "Explain it." })!, ctx))
      .resolves.toMatchObject({ status: "complete" });
    expect(commit).toHaveBeenCalledOnce();
  });
});
