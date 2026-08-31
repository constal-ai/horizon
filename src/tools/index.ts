import type { Ctx, Tool } from "@constal/sdk";
import { GITHUB_TOOLS } from "./github.js";
import { WEB_TOOLS } from "./web.js";
import { WORKSPACE_TOOLS } from "./workspace.js";

export const TOOLS: Record<string, Tool> = { ...GITHUB_TOOLS, ...WORKSPACE_TOOLS, ...WEB_TOOLS };

export const SOURCE_RESOLVER_TOOL_NAMES = [
  "github_repositories", "github_repository", "github_tree", "github_file",
] as const;

export const DISCOVERY_TOOL_NAMES = [
  "github_repository", "github_tree", "github_file",
  "workspace_list", "workspace_search", "workspace_read",
  "web_search", "web_fetch",
] as const;

export const INVESTIGATOR_TOOL_NAMES = [
  "github_repository", "github_tree", "github_file",
  "workspace_list", "workspace_search", "workspace_read", "web_search", "web_fetch",
] as const;

export const PLANNER_TOOL_NAMES = INVESTIGATOR_TOOL_NAMES;

export const EXECUTOR_TOOL_NAMES = [
  "github_repository", "github_tree", "github_file",
  "workspace_list", "workspace_search", "workspace_read", "workspace_exec", "workspace_write",
  "workspace_patch", "workspace_diff", "workspace_package", "web_search", "web_fetch",
] as const;

export const RECONCILER_TOOL_NAMES = ["workspace_list", "workspace_search", "workspace_read", "workspace_diff"] as const;

export const VERIFIER_TOOL_NAMES = [
  "workspace_list", "workspace_search", "workspace_read", "workspace_exec", "workspace_diff",
] as const;

function requiredBindings(tool: Tool): string[] {
  const catalog = tool as Tool & { catalog?: { binding?: unknown } };
  return [...new Set([
    ...(tool.needs ?? []).map(({ binding }) => binding),
    ...(typeof catalog.catalog?.binding === "string" ? [catalog.catalog.binding] : []),
  ])];
}

export function availableTools(names: readonly string[], ctx: Pick<Ctx, "resources">): string[] {
  return names.filter((name) => {
    const tool = TOOLS[name];
    return tool !== undefined && requiredBindings(tool).every((binding) => typeof ctx.resources[binding] === "string");
  });
}

export function bindingsForTools(names: readonly string[], ctx: Pick<Ctx, "resources">): string[] {
  const bindings = new Set<string>(["model"]);
  for (const name of names) for (const binding of requiredBindings(TOOLS[name]!)) {
    if (typeof ctx.resources[binding] === "string") bindings.add(binding);
  }
  return [...bindings].sort();
}
