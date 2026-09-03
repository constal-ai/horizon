import { opTool, type Tool } from "@constal/sdk";

const tools = [
  opTool("api", "query", { name: "platform_query",
    description: "Query authorized Constal objects when the supplied supervision snapshot does not contain enough exact state. Preserve evidence completeness and pagination warnings." }),
  opTool("api", "get", { name: "platform_get",
    description: "Read one exact authorized Constal object. For a Run, request a small bounded journal page and follow pagination only when the user's question requires older evidence." }),
];

export const PLATFORM_TOOLS: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
