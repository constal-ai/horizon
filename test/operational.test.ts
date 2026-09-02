import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@constal/sdk";
import { HORIZON_BEHAVIOR_CATALOG, horizonRoutedEvent } from "../src/behaviors.js";
import { HORIZON_PROCESS, runHorizonOperational } from "../src/operational.js";

const sessions = { foreground: `github-${"a".repeat(48)}-front`, work: `github-${"a".repeat(48)}-work` };

function event(objective: string) {
  return horizonRoutedEvent({ object: "constal.horizon.event", version: 1, behavior: "operate",
    eventClass: "github.issue.comment", objective,
    context: { provider: "github", repository: "constal-ai/horizon", issue: 10, delivery: "delivery-10", sessions,
      approval: { permissions: ["write", "admin"] } },
    constraints: ["Work only in constal-ai/horizon."],
    source: { kind: "github", owner: "constal-ai", repository: "horizon", ref: "main" } })!;
}

function runItem(status = "suspended") {
  return { kind: "run", id: `horizon/${sessions.work}/run-1`, crn: null, hash: null, namespace: "default", version: null,
    state: status, fields: { id: "run-1", status, agent_id: "horizon", session_id: sessions.work } };
}

function query(items: unknown[]) {
  return { object: "constal.api.query", items, next: null,
    evidence: { source: "coordinator", observedAt: 1, authoritativeFor: [], lagMs: 0, complete: true, warnings: [], queryHash: "a".repeat(64) } };
}

function readFixture(options: { waits?: unknown[]; runStatus?: string } = {}) {
  const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>, _options?: unknown) => {
    if (resource === "github" && operation === "issue.get") return { issue: { number: 10, title: "Implement reactions" } };
    if (resource === "github" && operation === "issue.comments.list") return { comments: [{ id: 1, body: "Progress?" }] };
    if (resource === "api" && operation === "query" && args.kind === "run") return query([runItem(options.runStatus)]);
    if (resource === "api" && operation === "get") return { object: "constal.api.object", ref: runItem(),
      value: { runId: "run-1", status: options.runStatus ?? "suspended", task: { id: "horizon-planner", version: "11" },
        awaiting: [{ id: "spawn-1", label: "spawn:horizon-design", kind: "spawn", childRunId: "child-1" }] },
      evidence: { source: "coordinator" } };
    if (resource === "api" && operation === "query" && args.kind === "wait") return query(options.waits ?? []);
    throw new Error(`unexpected invocation ${resource}#${operation}`);
  });
  return invoke;
}

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

  it("offers issue reads but no workspace capability to the foreground supervisor", async () => {
    const turn = vi.fn(async (input: { tools: string[]; context: unknown }) => {
      expect(input.tools).toEqual(["github_repositories", "github_repository", "github_tree", "github_file",
        "github_issue", "github_issue_comments", "web_search", "web_fetch"]);
      expect(input.context).toEqual({ process: HORIZON_PROCESS, eventClass: "github.question",
        context: { repository: "constal-ai/horizon" }, constraints: [], supervision: null });
      return { toolCalls: [], message: { role: "assistant", content: JSON.stringify({
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "The module validates setup screens.", action: { kind: "respond" }, evidence: [],
      }) }, artifact: null };
    });
    const commit = vi.fn(async () => ({ hash: "a".repeat(64) }));
    const ctx = { turn, commit, resources: { model: "model", github: "github", web: "web", search: "search" },
      run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(horizonRoutedEvent({ object: "constal.horizon.event", version: 1,
      behavior: "operate", eventClass: "github.question", objective: "Explain it.",
      context: { repository: "constal-ai/horizon", approval: { permissions: ["write", "admin"] } } })!, ctx))
      .resolves.toMatchObject({ status: "complete", action: { kind: "respond" } });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("answers from private issue evidence and authoritative live work state while work remains active", async () => {
    const invoke = readFixture();
    const turn = vi.fn(async (input: { context: { supervision: Record<string, unknown> } }) => {
      expect(input.context.supervision).toMatchObject({ thread: { workSession: sessions.work },
        issue: { issue: { number: 10 } }, comments: { comments: [{ body: "Progress?" }] },
        currentRun: { value: { runId: "run-1", status: "suspended", task: { id: "horizon-planner" } } },
        rootRun: { value: { runId: "run-1" } },
        activity: { state: "running", phase: "horizon-planner", detail: expect.stringContaining("child agents") } });
      return { toolCalls: [], message: { role: "assistant", content: JSON.stringify({
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "I am currently planning the change.", action: { kind: "respond" },
        evidence: ["The work Run is suspended on node:planner."],
      }) }, artifact: null };
    });
    const ctx = { invoke, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("What is the progress?"), ctx)).resolves.toMatchObject({
      status: "complete", message: "I am currently planning the change.", action: { kind: "respond" },
    });
    expect(invoke).toHaveBeenCalledWith("github", "issue.get", { owner: "constal-ai", repository: "horizon", issue: 10 });
  });

  it("semantically answers the exact open work wait through a governed ChangePlan", async () => {
    const wait = { kind: "wait", id: `horizon/${sessions.work}/promise-1`, crn: null, hash: null, namespace: "default",
      state: "waiting", fields: { waitKind: "await", promise: "promise-1", label: "horizon-plan-1" } };
    const reads = readFixture({ waits: [wait] });
    const plan = { object: "constal.change-plan", id: "plan-1", hash: "b".repeat(64) };
    const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>, options?: unknown) => {
      if (resource === "api" && operation === "plan") return plan;
      return reads(resource, operation, args, options);
    });
    const invokeAsync = vi.fn(async () => ({ object: "constal.change-receipt", id: "receipt-1", state: "succeeded" }));
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "complete",
      message: "I have the decision and will continue the same work.", action: { kind: "answer-work", answer: "Use reactions only." },
      evidence: ["One planning decision is open."],
    }) }, artifact: null }));
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("Yes, use reactions only."), ctx)).resolves.toMatchObject({
      control: { operation: "run.wait.resolve", plan: plan.hash, receipt: "receipt-1", state: "succeeded" },
    });
    expect(invoke).toHaveBeenCalledWith("api", "plan", expect.objectContaining({ operations: [expect.objectContaining({
      operation: "run.wait.resolve", input: expect.objectContaining({ session: sessions.work, promise: "promise-1",
        value: expect.objectContaining({ object: "constal.horizon.event", objective: "Use reactions only." }) }),
    })] }), expect.any(Object));
    expect(invokeAsync).toHaveBeenCalledOnce();
  });

  it("applies an exact natural-language pause through the governed Run control", async () => {
    const reads = readFixture({ runStatus: "leased" });
    const plan = { object: "constal.change-plan", id: "plan-pause", hash: "b".repeat(64) };
    const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>, options?: unknown) => {
      if (resource === "api" && operation === "plan") return plan;
      return reads(resource, operation, args, options);
    });
    const invokeAsync = vi.fn(async () => ({ object: "constal.change-receipt", id: "receipt-pause", state: "succeeded" }));
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "complete",
      message: "I am pausing the active Run.", action: { kind: "pause-work", run: "run-1" },
      evidence: ["Run run-1 is the observed active leaf."],
    }) }, artifact: null }));
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("Pause the work."), ctx)).resolves.toMatchObject({
      control: { operation: "run.pause", receipt: "receipt-pause" },
    });
    expect(invoke).toHaveBeenCalledWith("api", "plan", expect.objectContaining({ operations: [{
      id: "pause", operation: "run.pause", input: { namespace: "default", agent: "horizon",
        session: sessions.work, run: "run-1", request: {} },
    }] }), expect.any(Object));
  });

  it("branches only from an exact observed root Run commit and carries steering", async () => {
    const checkpoint = "c".repeat(64);
    const reads = readFixture({ runStatus: "suspended" });
    const plan = { object: "constal.change-plan", id: "plan-restart", hash: "b".repeat(64) };
    const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>, options?: unknown) => {
      if (resource === "api" && operation === "plan") return plan;
      if (resource === "api" && operation === "get") return { object: "constal.api.object", ref: runItem(),
        value: { run: { runId: "run-1", status: "suspended", task: null }, journal: { entries: [
          { kind: "commit", value: { hash: checkpoint, artifact: { kind: "horizon.plan" } } },
        ] } }, evidence: { source: "coordinator" } };
      return reads(resource, operation, args, options);
    });
    const invokeAsync = vi.fn(async () => ({ object: "constal.change-receipt", id: "receipt-restart", state: "succeeded" }));
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "complete",
      message: "I am restarting from the selected planning Fact.",
      action: { kind: "restart-work", run: "run-1", checkpoint, text: "Reconsider the delivery boundary." },
      evidence: [`Commit ${checkpoint} is present on root Run run-1.`],
    }) }, artifact: null }));
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("Restart at the planning checkpoint and reconsider delivery."), ctx)).resolves.toMatchObject({
      control: { operation: "run.branch", receipt: "receipt-restart" },
    });
    expect(invoke).toHaveBeenCalledWith("api", "plan", expect.objectContaining({ operations: [{
      id: "restart", operation: "run.branch", input: expect.objectContaining({ run: "run-1", request: expect.objectContaining({
        at: checkpoint, text: "Reconsider the delivery boundary.",
      }) }),
    }] }), expect.any(Object));
  });
});
