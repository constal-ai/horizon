// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Ctx, LedgerEvent, SteerEvent } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import agent from "../src/index.js";
import { horizonSteering, pendingSteering, requestWithSteering } from "../src/views/steering.js";
import { parseHzRequest } from "../src/contracts.js";

function steer(seq: number, run: string | null = "work"): SteerEvent {
  return { kind: "steer", seq, run, eventId: `event-${seq}`, hash: `hash-${seq}`, prev: null, at: seq,
    tenant: "tenant", ledger: "main", branch: "main", actor: { kind: "operator", id: "user" }, ref: null,
    payload: { text: `Keep all qualifications for ${seq}.\n\nDo not replace the existing implementation.`,
      data: { comment: seq } } };
}

describe("Horizon work steering", () => {
  it("folds raw events without a preview limit and reads only new guidance for this Run", async () => {
    const events: LedgerEvent[] = [...Array.from({ length: 240 }, (_, index) => steer(index + 1)),
      steer(241, "other-run"), steer(242, null),
      { ...steer(243), kind: "anchor", fromSeq: 1, toSeq: 242, root: "root", prevAnchor: null, keyId: "key", signature: "signature" }];
    const state = events.reduce(horizonSteering.apply, horizonSteering.init());
    expect(state).toHaveLength(242);
    const ctx = { run: { id: "work" }, ledger: { view: async (name: string) => {
      expect(name).toBe(horizonSteering.id); return state;
    } } } as unknown as Ctx;
    expect(await pendingSteering(ctx, 238)).toEqual([events[238], events[239], events[241]]);
    expect(await pendingSteering(ctx, 242)).toEqual([]);
    expect(agent.views).toContain(horizonSteering);
  });

  it("preserves the original issue context, raw message, actor, and prior guidance", () => {
    const original = parseHzRequest({ objective: "Fix search", context: { event: { issue: 2 } } });
    const events = [steer(1), steer(2)];
    expect(requestWithSteering(original, events)).toMatchObject({ objective: "Fix search",
      context: { event: { issue: 2 }, steering: events } });
    expect(original.context).toEqual({ event: { issue: 2 } });
    const textContext = parseHzRequest({ objective: "Fix search", context: "Original background" });
    expect(requestWithSteering(textContext, events).context).toEqual({ original: "Original background", steering: events });
  });
});
