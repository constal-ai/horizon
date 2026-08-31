import { describe, expect, it } from "vitest";
import { availableTools, bindingsForTools } from "../src/tools/index.js";
import { normalizeRepositoryPath, normalizeWorkspacePath, WORKSPACE_TOOLS } from "../src/tools/workspace.js";

describe("Horizon Tool capability projection", () => {
  it("requires catalog bindings as well as direct Tool needs", () => {
    const resources = { model: "model", sandbox: "sandbox", cas: "cas", web: "web" } as never;
    expect(availableTools(["workspace_read", "web_fetch", "web_search", "github_file"], { resources }))
      .toEqual(["workspace_read", "web_fetch"]);
    expect(bindingsForTools(["workspace_read", "web_fetch"], { resources })).toEqual(["cas", "model", "sandbox", "web"]);
  });

  it("confines every normalized Tool path to the governed workspace", () => {
    expect(normalizeWorkspacePath("src/../package.json", "/workspace/repository")).toBe("/workspace/repository/package.json");
    expect(() => normalizeWorkspacePath("../../../../etc/passwd", "/workspace/repository")).toThrow("outside /workspace");
    expect(() => normalizeWorkspacePath("src/\u0000secret", "/workspace/repository")).toThrow("control character");
    expect(normalizeRepositoryPath("src/index.ts", "/workspace/repository")).toBe("src/index.ts");
    expect(() => normalizeRepositoryPath("../other/file.ts", "/workspace/repository")).toThrow("outside the selected repository");
  });

  it("declares the highest nested Sandbox effect for every workspace Tool", () => {
    expect(Object.fromEntries(Object.entries(WORKSPACE_TOOLS).map(([name, tool]) => [name, tool.maxEffect]))).toEqual({
      workspace_list: "reconcilable", workspace_search: "reconcilable", workspace_read: "idempotent",
      workspace_exec: "reconcilable", workspace_write: "idempotent", workspace_patch: "reconcilable",
      workspace_diff: "reconcilable", workspace_package: "reconcilable",
    });
  });
});
