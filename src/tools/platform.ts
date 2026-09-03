import { opTool, type Tool } from "@constal/sdk";

const tools = [
  opTool("api", "query", { name: "platform_query",
    description: "Query authorized Constal objects when the supplied supervision snapshot does not contain enough exact state. Preserve evidence completeness and pagination warnings." }),
  opTool("api", "get", { name: "platform_get",
    description: "Read one exact authorized Constal object. Exact Run detail uses the top-level fields run, workflow, journal, lineage, and resourceInvocations; terminal status, result, and error are inside run. Omit fields for the full bounded detail or select those top-level fields. Use page.limit to bound the journal and follow a returned next cursor only when older evidence is needed. Never repeat a completed page." }),
];

export const PLATFORM_TOOLS: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
