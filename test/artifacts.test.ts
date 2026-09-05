// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Ctx } from "@constal/sdk";
import { describe, expect, it, vi } from "vitest";
import { HORIZON_ARTIFACT_ENVELOPE_MAX_BYTES, loadArtifact, storeArtifact } from "../src/artifacts.js";
import { discoveryFramer } from "../src/tasks/discovery.js";
import { sourceResolver } from "../src/tasks/source.js";
import { approvalInterpreter } from "../src/tasks/approval.js";

describe("Horizon CAS handoffs", () => {
  it.each(["discovery", "source", "approval"])("loads the complete large %s handoff at the specialist boundary", async (role) => {
    const original = "Original discussion, with every qualification. ".repeat(2_000);
    const request = { objective: "Document this repository", context: { original } };
    const planFact = "f".repeat(64);
    const input = role === "approval" ? { plan: { specification: original }, planFact,
      event: { objective: "Please proceed with this plan." } }
      : { request, tools: [], answer: null, workspaceRoot: "/workspace/repo", workspaceReceipt: "receipt" };
    const output = role === "source" ? { object: "constal.horizon.source-resolution", version: 1, status: "ready",
      source: { kind: "github", owner: "constal-ai", repository: "const-alpha", ref: "main" }, evidence: [], question: null }
      : role === "approval" ? { object: "constal.horizon.plan-decision", version: 1, planFact, decision: "approve", guidance: null }
        : { object: "constal.horizon.discovery-plan", version: 1, status: "ready", summary: "Ready to investigate.",
          workspaceRoot: "/workspace/repo", unknowns: [], focuses: [{ id: "contract", title: "Contract",
            mission: "Find the existing contract.", questions: ["How does the handoff work?"],
            evidenceNeeded: ["Source"], stopWhen: "The contract is understood." }] };
    let stored = "";
    const ctx = { resources: { cas: "cas", model: "model" },
      invoke: async (_resource: unknown, operation: string, args: { text?: string; ref?: string }) => {
        if (operation === "putText") stored = args.text!;
        else expect(operation).toBe("getText");
        return { ref: "input-ref", text: stored, bytes: new TextEncoder().encode(stored).byteLength };
      },
      turn: async (spec: { context: Record<string, unknown> }) => {
        if (role === "approval") expect(spec.context).toEqual(input);
        else expect(spec.context.request).toEqual(request);
        return { artifact: output, message: { content: "" }, toolCalls: [] };
      },
    } as unknown as Ctx;
    const envelope = await storeArtifact(ctx, input);
    expect(envelope).toEqual({ ref: "input-ref" });
    expect(new TextEncoder().encode(stored).byteLength).toBeGreaterThan(65_536);
    const task = role === "discovery" ? discoveryFramer : role === "source" ? sourceResolver : approvalInterpreter;
    expect(await task.run(envelope, ctx)).toBeTruthy();
  });

  it("reads planning envelopes within the pinned getText contract", async () => {
    const invoke = vi.fn(async (_resource: unknown, operation: string, args: Record<string, unknown>) => {
      expect(operation).toBe("getText");
      expect(args).toEqual({ ref: "a".repeat(64), maximumBytes: 1_048_576 });
      return { ref: args.ref, text: "{\"ready\":true}", bytes: 14 };
    });
    const value = await loadArtifact<{ ready: boolean }>({ resources: { cas: "cas" }, invoke } as unknown as Ctx,
      { ref: "a".repeat(64) });
    expect(value).toEqual({ ready: true });
  });

  it("rejects an unreadable handoff before storing it", async () => {
    const ctx = { invoke: async () => { throw new Error("must not store"); } } as unknown as Ctx;
    await expect(storeArtifact(ctx, "x".repeat(HORIZON_ARTIFACT_ENVELOPE_MAX_BYTES + 1)))
      .rejects.toThrow("bound CAS text-read contract");
  });
});
