// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@constal/sdk";
import { HORIZON_BEHAVIOR_CATALOG, horizonRoutedEvent } from "../src/behaviors.js";
import { HORIZON_PROCESS, runHorizonOperational } from "../src/operational.js";

vi.mock("@constal-ai/github", async (importOriginal) => ({
  ...await importOriginal<typeof import("@constal-ai/github")>(),
  invokeGitHub: (operation: string, args: unknown, ctx: Ctx) => ctx.invoke(ctx.resources.github!, operation, args),
}));

const sessions = { foreground: `github-${"a".repeat(48)}-front-${"b".repeat(16)}`,
  work: `github-${"a".repeat(48)}-work` };

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

function readFixture(options: { waits?: unknown[]; runs?: unknown[]; runStatus?: string; awaiting?: unknown[];
  issue?: unknown; comments?: unknown } = {}) {
  const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>, _options?: unknown) => {
    if (resource === "github" && operation === "issue.get") return options.issue ?? { issue: { number: 10, title: "Implement reactions" } };
    if (resource === "github" && operation === "issue.comments.list") return options.comments ?? { comments: [{ id: 1, body: "Progress?" }] };
    if (resource === "api" && operation === "query" && args.kind === "run") return query(options.runs ?? [runItem(options.runStatus)]);
    if (resource === "api" && operation === "get") return { object: "constal.api.object", ref: runItem(),
      value: { runId: "run-1", status: options.runStatus ?? "suspended", task: { id: "horizon-planner", version: "11" },
        awaiting: options.awaiting ?? [{ id: "spawn-1", label: "spawn:horizon-design", kind: "spawn", childRunId: "child-1" }] },
      evidence: { source: "coordinator" } };
    if (resource === "api" && operation === "query" && args.kind === "wait") return query(options.waits ?? []);
    throw new Error(`unexpected invocation ${resource}#${operation}`);
  });
  return invoke;
}

describe("Horizon behavior routing", () => {
  it.each([
    { action: { kind: "guide-work" }, waiting: true, operation: "run.wait.resolve" },
    { action: { kind: "guide-work" }, waiting: false, operation: "run.steer" },
    { action: { kind: "start-work", objective: "A model-authored paraphrase" }, waiting: true, operation: "run.wait.resolve" },
    { action: { kind: "start-work", objective: "A model-authored paraphrase" }, waiting: false, operation: "run.steer" },
  ])("delivers $action.kind as $operation from the observed work state", async ({ action, waiting, operation }) => {
    const reads = readFixture({ awaiting: waiting
      ? [{ id: "review", label: "horizon-approval-1-1", kind: "await" }]
      : [{ id: "child", label: "spawn:horizon-design", kind: "spawn" }] });
    const invoke = vi.fn(async (resource: string, op: string, args: Record<string, unknown>, options?: unknown) => {
      if (resource === "api" && op === "plan") return { object: "constal.change-plan", id: "plan", hash: "b".repeat(64) };
      return reads(resource, op, args, options);
    });
    const invokeAsync = vi.fn(async () => ({ object: "constal.change-receipt", id: "receipt", state: "succeeded" }));
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
      object: "constal.horizon.operational-result", version: 1, status: "complete", action,
      message: "I'll incorporate your correction.", evidence: [],
    } }));
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(), resources: { model: "model", github: "github", api: "api" },
      run: { id: "front", namespace: "default" } } as unknown as Ctx;
    const original = event("Revise the plan before editing.\n\nThese are examples, not an allowlist.");
    expect(await runHorizonOperational(original, ctx)).toMatchObject({ control: { operation, state: "succeeded" } });
    expect(invoke).toHaveBeenCalledWith("api", "plan", expect.objectContaining({ operations: [expect.objectContaining({
      operation, input: expect.objectContaining(waiting ? { promise: "review", value: original }
        : { text: original.objective, data: expect.objectContaining({ event: original }) }),
    })] }), expect.any(Object));
    expect(invokeAsync).toHaveBeenCalledOnce();
    expect(ctx.commit).toHaveBeenCalledOnce();
    expect(ctx.commit).toHaveBeenCalledWith(expect.objectContaining({ kind: "horizon.operational-result" }), { tier: "audit" });
  });

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
    expect(invoke).toHaveBeenCalledWith("api", "get", { ref: expect.objectContaining({ kind: "run" }),
      fields: ["runId", "session", "status", "scheduler", "createdAt", "updatedAt", "error", "result",
        "budget", "limits", "task", "parent", "awaiting"] });
  });

  it("keeps an on-demand test-progress report read-only while work continues", async () => {
    const invoke = readFixture(); const invokeAsync = vi.fn(); let turns = 0;
    const observed = { object: "constal.api.object", ref: runItem(), value: {
      run: { runId: "run-1", status: "complete", resultRef: "executor-result" }, journal: { entries: [{ kind: "turn", pos: "root/8",
        value: { message: { role: "assistant", content: JSON.stringify({ object: "constal.horizon.step-result",
          version: 1, status: "complete", verification: ["npm test: 351 tests passed"] }) } } }] },
    } };
    const turn = vi.fn(async (input: { tools: string[]; context: unknown }) => {
      turns++;
      if (turns === 1) {
        expect(input.tools).toContain("platform_get");
        return { toolCalls: [{ id: "read-checks", pos: "root/1", name: "platform_get", version: "1",
          status: "ok", maxEffect: "read-only", effectObserved: "read-only", args: { ref: runItem(), fields: ["run", "journal"] },
          ref: "check-results", result: observed }], message: { role: "assistant", content: "" }, artifact: null };
      }
      expect(input.context).toMatchObject({ recentGovernedToolObservations: [[{
        name: "platform_get", ref: "check-results", result: observed,
      }]] });
      return { toolCalls: [], message: { role: "assistant", content: "" }, artifact: {
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "The executor reports 351 tests passed. Independent verification is still running.",
        action: { kind: "respond" }, evidence: ["check-results"],
      } };
    });
    const commit = vi.fn(async () => ({ hash: "result" }));
    const ctx = { invoke, invokeAsync, turn, commit, resources: { model: "model", github: "github", api: "api" },
      run: { id: "front", namespace: "default" } } as unknown as Ctx;
    const result = await runHorizonOperational(event("How are the tests looking? Keep working."), ctx);
    expect(result).toMatchObject({ action: { kind: "respond" }, evidence: ["check-results"] });
    expect(result.control).toBeUndefined();
    expect(invoke.mock.calls.map(([, operation]) => operation)).not.toContain("plan");
    expect(invokeAsync).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "horizon.operational-result" }), { tier: "audit" });
  });

  it("exposes prior failed attempts as exact queryable work history", async () => {
    const failed = { ...runItem("failed"), id: `horizon/${sessions.work}/failed-run`,
      fields: { ...runItem("failed").fields, id: "failed-run", parent_run: "root-run",
        created_at: 10, updated_at: 30, duration_ms: 20, elapsed_ms: 20 } };
    const active = { ...runItem("leased"), fields: { ...runItem("leased").fields,
      created_at: 40, updated_at: 50, duration_ms: null, elapsed_ms: 10 } };
    const invoke = readFixture({ runs: [active, failed] });
    const observed: Array<{ tools: string[]; context: { supervision: { history: unknown } } }> = [];
    const turn = vi.fn(async (input: { tools: string[]; context: { supervision: { history: unknown } } }) => {
      observed.push(input);
      return { toolCalls: [], message: { role: "assistant", content: JSON.stringify({
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "The failed attempt is available for exact inspection.", action: { kind: "respond" },
        evidence: ["Work history contains failed-run."],
      }) }, artifact: null };
    });
    const ctx = { invoke, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("What failed previously?"), ctx)).resolves.toMatchObject({ status: "complete" });
    expect(observed[0]?.tools).toContain("platform_get");
    expect(observed[0]?.context.supervision.history).toMatchObject({ state: "available", complete: true, next: null,
      runs: [expect.objectContaining({ runId: "run-1", status: "leased" }), expect.objectContaining({
        runId: "failed-run", parentRun: "root-run", status: "failed", durationMs: 20,
        ref: expect.objectContaining({ kind: "run", id: `horizon/${sessions.work}/failed-run` }),
      })] });
  });

  it("starts idle issue work through the existing durable cross-Session commit", async () => {
    const issue = { issue: { number: 10, title: "Implement reactions", body: "Keep the public API unchanged.\n\nAdd regression tests." } };
    const comments = { comments: [{ id: 1, body: "Use the existing GitHub adapter; do not add a new driver." }] };
    const invoke = readFixture({ runs: [], issue, comments });
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "complete",
      message: "I am starting the requested issue work.", action: { kind: "start-work", objective: "Implement issue #10." },
      evidence: ["No active work Run exists."],
    }) }, artifact: null }));
    const commit = vi.fn(async () => ({ hash: "f".repeat(64) }));
    const ctx = { invoke, turn, commit, resources: { model: "model", github: "github", api: "api" },
      run: { id: "front", namespace: "default" } } as unknown as Ctx;

    await expect(runHorizonOperational(event("Start the work."), ctx)).resolves.toMatchObject({
      control: { operation: "session.deliver", fact: "f".repeat(64), state: "queued" },
    });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ object: "constal.horizon.event", behavior: "issue-work",
      objective: "Implement issue #10.", context: expect.objectContaining({ issue: 10, sessions,
        request: { trigger: "Start the work.", issue, comments } }) }),
    { tier: "audit", to: `session:${sessions.work}`, deliver: "queue" });
    expect(invoke).not.toHaveBeenCalledWith("api", "plan", expect.anything(), expect.anything());
  });

  it("starts new work when exact root state is terminal even if descendant projections are stale", async () => {
    const root = { ...runItem("stopped"), id: `horizon/${sessions.work}/root-run`,
      fields: { ...runItem("stopped").fields, id: "root-run", parent_run: null } };
    const staleChild = { ...runItem("leased"), id: `horizon/${sessions.work}/stale-child`,
      fields: { ...runItem("leased").fields, id: "stale-child", parent_run: "root-run" } };
    const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>) => {
      if (resource === "github" && operation === "issue.get") return { issue: { number: 10 } };
      if (resource === "github" && operation === "issue.comments.list") return { comments: [] };
      if (resource === "api" && operation === "query" && args.kind === "run") return query([staleChild, root]);
      if (resource === "api" && operation === "query" && args.kind === "wait") return query([]);
      if (resource === "api" && operation === "get") {
        const ref = args.ref as { id?: string };
        const selected = ref.id?.endsWith("/root-run") ? "stopped" : "leased";
        return { object: "constal.api.object", ref: args.ref,
          value: { runId: selected === "stopped" ? "root-run" : "stale-child", status: selected },
          evidence: { source: "coordinator" } };
      }
      throw new Error(`unexpected invocation ${resource}#${operation}`);
    });
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "complete",
      message: "I am starting current work.", action: { kind: "start-work", objective: "Implement issue #10." },
      evidence: ["The exact root Run is stopped."],
    }) }, artifact: null }));
    const commit = vi.fn(async () => ({ hash: "f".repeat(64) }));
    const ctx = { invoke, turn, commit, resources: { model: "model", github: "github", api: "api" },
      run: { id: "front", namespace: "default" } } as unknown as Ctx;

    await expect(runHorizonOperational(event("Start current work."), ctx)).resolves.toMatchObject({
      control: { operation: "session.deliver", state: "queued" },
    });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ objective: "Implement issue #10." }),
      { tier: "audit", to: `session:${sessions.work}`, deliver: "queue" });
    expect(invoke).not.toHaveBeenCalledWith("api", "plan", expect.anything(), expect.anything());
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
      message: "I have the decision and will continue the same work.", action: { kind: "guide-work" },
      evidence: ["One planning decision is open."],
    }) }, artifact: null }));
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    const reply = "Yes, use reactions only for acknowledgments.\n\nKeep text when answering a question.";
    await expect(runHorizonOperational(event(reply), ctx)).resolves.toMatchObject({
      control: { operation: "run.wait.resolve", plan: plan.hash, receipt: "receipt-1", state: "succeeded" },
    });
    expect(invoke).toHaveBeenCalledWith("api", "plan", expect.objectContaining({ operations: [expect.objectContaining({
      operation: "run.wait.resolve", input: expect.objectContaining({ session: sessions.work, promise: "promise-1",
        value: expect.objectContaining({ object: "constal.horizon.event", objective: reply }) }),
    })] }), expect.any(Object));
    expect(invokeAsync).toHaveBeenCalledOnce();
  });

  it("answers the exact Run wait when the open-waits collection is temporarily empty", async () => {
    const reads = readFixture({ waits: [], awaiting: [{ id: "promise-exact", label: "horizon-plan-1", kind: "await" }] });
    const plan = { object: "constal.change-plan", id: "plan-exact", hash: "b".repeat(64) };
    const invoke = vi.fn(async (resource: string, operation: string, args: Record<string, unknown>, options?: unknown) => {
      if (resource === "api" && operation === "plan") return plan;
      return reads(resource, operation, args, options);
    });
    const invokeAsync = vi.fn(async () => ({ object: "constal.change-receipt", id: "receipt-exact", state: "succeeded" }));
    const turn = vi.fn(async (input: { context: { supervision: { activity: { state: string } } } }) => {
      expect(input.context.supervision.activity.state).toBe("waiting-user");
      return { toolCalls: [], message: { role: "assistant", content: JSON.stringify({
        object: "constal.horizon.operational-result", version: 1, status: "complete",
        message: "I recorded option 3 and will continue the same work.", action: { kind: "guide-work" },
        evidence: ["The exact active Run contains one open planning decision."],
      }) }, artifact: null };
    });
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("3"), ctx)).resolves.toMatchObject({
      control: { operation: "run.wait.resolve", receipt: "receipt-exact", state: "succeeded" },
    });
    expect(invoke).toHaveBeenCalledWith("api", "plan", expect.objectContaining({ operations: [expect.objectContaining({
      operation: "run.wait.resolve", input: expect.objectContaining({ promise: "promise-exact" }),
    })] }), expect.any(Object));
  });

  it("does not reinterpret unavailable work state as an empty wait list", async () => {
    const invoke = vi.fn(async (resource: string, operation: string) => {
      if (resource === "github" && operation === "issue.get") return { issue: { number: 10, title: "Implement reactions" } };
      if (resource === "github" && operation === "issue.comments.list") return { comments: [{ id: 2, body: "2" }] };
      if (resource === "api") throw new Error("PolicyDenied: ConstalApiDelegationInvalid");
      throw new Error(`unexpected invocation ${resource}#${operation}`);
    });
    const turn = vi.fn(async () => ({ toolCalls: [], message: { role: "assistant", content: JSON.stringify({
      object: "constal.horizon.operational-result", version: 1, status: "complete",
      message: "Decision recorded.", action: { kind: "guide-work" },
      evidence: ["The reply semantically answers the presented decision."],
    }) }, artifact: null }));
    const invokeAsync = vi.fn();
    const ctx = { invoke, invokeAsync, turn, commit: vi.fn(async () => ({ hash: "a".repeat(64) })),
      resources: { model: "model", github: "github", api: "api" }, run: { id: "front", namespace: "default" } } as unknown as Ctx;
    await expect(runHorizonOperational(event("2"), ctx)).resolves.toMatchObject({
      status: "blocked", action: { kind: "respond" }, message: expect.stringContaining("temporarily unavailable"),
      evidence: expect.arrayContaining(["The work Run and wait observations were unavailable."]),
    });
    expect(invokeAsync).not.toHaveBeenCalled();
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
