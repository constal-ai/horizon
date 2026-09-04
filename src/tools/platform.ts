import { CONSTAL_API_OPERATION_SCHEMAS, opTool, type Tool } from "@constal/sdk";

const queryKind = CONSTAL_API_OPERATION_SCHEMAS.query.properties.kind;
const querySchema = { ...CONSTAL_API_OPERATION_SCHEMAS.query, properties: {
  ...CONSTAL_API_OPERATION_SCHEMAS.query.properties,
  kind: "enum" in queryKind ? queryKind : { ...queryKind, pattern: "^[a-z][a-z0-9-]{0,63}$",
    description: "Exact lower-case queryable kind. Use a catalog kind such as run, service, tool, policy, agent, or deployment. Generic resource and operation are not queryable kinds." },
} } as const;

const tools = [
  opTool("api", "query", { name: "platform_query",
    description: "Query one exact lower-case Constal kind in the current authorized namespace. Select kind from the schema enum; do not guess abstract kinds, casing, or another namespace. Preserve evidence completeness and pagination warnings.",
    schema: querySchema }),
  opTool("api", "get", { name: "platform_get",
    description: "Read one exact authorized Constal object using a complete ref returned by a governed query or receipt; never synthesize a kind or id. For a Run, request a small bounded journal page and follow pagination only when needed.",
    schema: CONSTAL_API_OPERATION_SCHEMAS.get }),
];

export const PLATFORM_TOOLS: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
