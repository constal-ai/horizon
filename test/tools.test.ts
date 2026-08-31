import { describe, expect, it } from "vitest";
import { availableTools, bindingsForTools, EXECUTOR_MUTATION_TOOL_NAMES, EXECUTOR_PROOF_TOOL_NAMES } from "../src/tools/index.js";
import { editWorkspaceText, normalizeRepositoryPath, normalizeWorkspacePath, workspaceReadMaximum, WORKSPACE_TOOLS } from "../src/tools/workspace.js";

describe("Horizon Tool capability projection", () => {
  it("defines executor mutation Tools independently of Resource recovery effects", () => {
    expect(EXECUTOR_MUTATION_TOOL_NAMES).toEqual(["workspace_write", "workspace_edit", "workspace_patch"]);
    expect(EXECUTOR_MUTATION_TOOL_NAMES).not.toContain("workspace_list");
    expect(EXECUTOR_MUTATION_TOOL_NAMES).not.toContain("workspace_search");
    expect(EXECUTOR_MUTATION_TOOL_NAMES).not.toContain("workspace_read");
    expect(EXECUTOR_MUTATION_TOOL_NAMES).not.toContain("workspace_exec");
    expect(EXECUTOR_MUTATION_TOOL_NAMES).not.toContain("workspace_diff");
    expect(EXECUTOR_PROOF_TOOL_NAMES).toEqual(["workspace_exec", "workspace_diff"]);
  });

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
      workspace_exec: "reconcilable", workspace_write: "idempotent", workspace_edit: "idempotent", workspace_patch: "reconcilable",
      workspace_diff: "reconcilable", workspace_package: "reconcilable",
    });
  });

  it("edits exactly one current text span while preserving line endings", () => {
    expect(editWorkspaceText("before\nold\nafter\n", "old\n", "new\n")).toEqual({
      text: "before\nnew\nafter\n", replacements: 1,
    });
    expect(editWorkspaceText("before\r\nold\r\nafter\r\n", "old\n", "new\n")).toEqual({
      text: "before\r\nnew\r\nafter\r\n", replacements: 1,
    });
    expect(() => editWorkspaceText("same same", "same", "new")).toThrow("matched 2 times");
    expect(() => editWorkspaceText("current", "missing", "new")).toThrow("was not found");
  });

  it("rejects undersized workspace reads before invoking CAS", () => {
    expect(workspaceReadMaximum(9_420, 10_000)).toBe(9_420);
    expect(() => workspaceReadMaximum(12_000, 10_000)).toThrow("requested read limit");
    expect(() => workspaceReadMaximum(1_048_577)).toThrow("supported read ceiling");
  });
});
