import { describe, expect, it } from "vitest";
import type { ConstalApiChangePlan, ConstalApiChangeReceipt, Ctx, Fact, Handle, SetupScreen, SetupSubmission } from "@constal/sdk";
import { runHorizonSetup } from "../src/setup/workflow.js";

function handle<T>(value: T): Handle<T> {
  const promise = Promise.resolve(value) as Promise<T> & Partial<Handle<T>>;
  Object.assign(promise, { id: "handle", resolved: true, seq: 1, outcome: null, result: value, error: undefined,
    cancel: async () => undefined });
  return promise as Handle<T>;
}

describe("Horizon durable setup workflow", () => {
  it("builds routing from advertised catalogs and applies only the reviewed ChangePlan", async () => {
    const screens: SetupScreen[] = []; let active: SetupScreen | null = null; let sequence = 0;
    const plan: ConstalApiChangePlan = { object: "constal.change-plan", id: "plan-1", hash: "a".repeat(64),
      catalogRevision: "b".repeat(64), tenant: "tenant", principal: "crn:constal:production:tenant:identity:principal/operator" as never,
      authorityHash: "c".repeat(64), createdAt: 1, expiresAt: 2, objective: "Install Horizon", operations: [], diff: [],
      impact: { resources: [], policies: [], bindings: [] }, estimatedCost: null, approvals: [], validation: [], rollback: null, warnings: [] };
    const receipt: ConstalApiChangeReceipt = { object: "constal.change-receipt", id: "receipt-1",
      plan: { id: plan.id, hash: plan.hash }, eventId: "event", state: "succeeded", operations: [], createdAt: 1, updatedAt: 2 };
    const values: Record<string, unknown> = {
      introduction: {},
      github: { credential: { crn: "crn:constal:production:tenant:default:credential/horizon-github", hash: "d".repeat(64) },
        principal: "crn:constal:production:tenant:identity:principal/github-installation", accountLogin: "constal-ai",
        repositories: ["constal-ai/horizon", "constal-ai/coreagents"] },
      repositories: { repositories: ["constal-ai/horizon"] },
      routing: { events: ["github.issue.activated", "github.issue.comment"], routes: {
        "github.issue.activated": "issue-work", "github.issue.comment": "operate",
        "github.pull-request.comment": "operate", "github.status": "operate",
      }, mention: "@constalai", label: "horizon" },
      approval: { approverPermissions: ["write", "maintain", "admin"], semanticApproval: true, requireApproval: true },
      review: {},
    };
    const ctx = {
      resources: { model: "model", api: "api" },
      run: { id: "run", session: "setup-horizon", tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon-setup", version: "0.1.0", crn: "crn:constal:production:tenant:default:agent/horizon-setup" }, mode: "script" },
      commit: async (artifact: unknown) => {
        if (artifact && typeof artifact === "object" && (artifact as { object?: string }).object === "constal.setup.screen") {
          active = artifact as SetupScreen; screens.push(active);
        }
        return { hash: `fact-${++sequence}`, artifact, artifactHash: `artifact-${sequence}` } as unknown as Fact<unknown>;
      },
      await: () => {
        const screen = active!;
        return handle({ object: "constal.setup.submission", version: 1, workflow: screen.workflow.id,
          revision: screen.revision, step: screen.current.id,
          action: screen.current.actions.find(({ intent }) => intent === "primary")!.id,
          values: values[screen.current.id] as Record<string, unknown> } satisfies SetupSubmission);
      },
      invoke: async (_resource: string, operation: string, args: unknown) => {
        if (operation === "plan") {
          expect(args).toMatchObject({ operations: [{ operation: "channel.install", input: { configuration: {
            routes: { "github.issue.activated": "issue-work", "github.issue.comment": "operate" },
          } } }] });
          return plan;
        }
        if (operation === "apply") {
          expect(args).toMatchObject({ plan: { id: plan.id, hash: plan.hash } });
          return receipt;
        }
        throw new Error(`unexpected operation ${operation}`);
      },
    } as unknown as Ctx;

    const result = await runHorizonSetup({}, ctx);
    expect(result.status).toBe("complete");
    expect(screens.map(({ current }) => current.id)).toEqual([
      "introduction", "github", "repositories", "routing", "approval", "review", "complete",
    ]);
  });
});
