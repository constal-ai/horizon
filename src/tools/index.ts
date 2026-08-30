import type { Ctx, Tool } from "@constal/sdk";
import { GITHUB_TOOLS } from "./github.js";
import { WEB_TOOLS } from "./web.js";
import { WORKSPACE_TOOLS } from "./workspace.js";

export const TOOLS: Record<string, Tool> = { ...GITHUB_TOOLS, ...WORKSPACE_TOOLS, ...WEB_TOOLS };

export const PLANNER_TOOL_NAMES = [
  "github_repositories", "github_repository", "github_tree", "github_file", "github_archive",
  "workspace_open", "workspace_import", "workspace_list", "workspace_search", "workspace_read",
  "web_search", "web_fetch",
] as const;

export const EXECUTOR_TOOL_NAMES = [
  "github_repository", "github_tree", "github_file",
  "workspace_open", "workspace_list", "workspace_search", "workspace_read", "workspace_exec", "workspace_write",
  "workspace_patch", "workspace_diff", "workspace_package", "web_search", "web_fetch",
] as const;

export const RECONCILER_TOOL_NAMES = ["workspace_list", "workspace_search", "workspace_read", "workspace_diff"] as const;

export function availableTools(names: readonly string[], ctx: Pick<Ctx, "resources">): string[] {
  return names.filter((name) => {
    const tool = TOOLS[name];
    return tool !== undefined && (tool.needs ?? []).every(({ binding }) => typeof ctx.resources[binding] === "string");
  });
}

export function bindingsForTools(names: readonly string[], ctx: Pick<Ctx, "resources">): string[] {
  const bindings = new Set<string>(["model"]);
  for (const name of names) for (const need of TOOLS[name]?.needs ?? []) {
    if (typeof ctx.resources[need.binding] === "string") bindings.add(need.binding);
  }
  return [...bindings].sort();
}
