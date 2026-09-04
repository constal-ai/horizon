// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { CONSTAL_API_OPERATION_SCHEMAS, opTool, type Tool } from "@constal/sdk";

const tools = [
  opTool("api", "query", { name: "platform_query",
    description: "Query one exact lower-case Constal kind in the current authorized namespace. Select kind from the schema enum; do not guess abstract kinds, casing, or another namespace. Preserve evidence completeness and pagination warnings.",
    schema: CONSTAL_API_OPERATION_SCHEMAS.query }),
  opTool("api", "get", { name: "platform_get",
    description: "Read one exact authorized Constal object using a complete ref returned by a governed query or receipt; never synthesize a kind or id. For a Run, request a small bounded journal page and follow pagination only when needed.",
    schema: CONSTAL_API_OPERATION_SCHEMAS.get }),
];

export const PLATFORM_TOOLS: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
