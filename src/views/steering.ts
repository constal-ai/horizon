// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Ctx, LedgerEvent, SteerEvent, ViewDef } from "@constal/sdk";
import type { HzRequest } from "../contracts.js";

// Fold the existing ledger events, rather than relying on the bounded history
// preview. The runtime owns paging, fenced snapshots, and durable view caching.
export const horizonSteering: ViewDef<SteerEvent[], LedgerEvent> = {
  id: "horizon-steering", version: "1", over: "events",
  init: () => [],
  apply: (state, event) => event.kind === "steer" ? [...state, event] : state,
};

export async function pendingSteering(ctx: Ctx, after: number): Promise<SteerEvent[]> {
  const events = await ctx.ledger.view<SteerEvent[]>(horizonSteering.id);
  return events.filter((event) => event.seq > after && (event.run === null || event.run === ctx.run.id))
    .sort((left, right) => left.seq - right.seq);
}

export function requestWithContext(request: HzRequest, update: Record<string, unknown>): HzRequest {
  const context = request.context && typeof request.context === "object" && !Array.isArray(request.context)
    ? request.context : { original: request.context };
  return { ...request, context: { ...context, ...update } };
}
