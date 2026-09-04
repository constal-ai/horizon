// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Ctx } from "@constal/sdk";
import { describe, expect, it, vi } from "vitest";
import { HORIZON_ARTIFACT_ENVELOPE_MAX_BYTES, loadArtifact, storeArtifact } from "../src/artifacts.js";

describe("Horizon CAS handoffs", () => {
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
