import { describe, expect, it, vi } from "vitest";
import { availableTools, bindingsForTools, EXECUTOR_MUTATION_TOOL_NAMES, EXECUTOR_PROOF_TOOL_NAMES } from "../src/tools/index.js";
import { platformGetPreview } from "../src/tools/platform.js";
import { editWorkspaceText, normalizeRepositoryPath, normalizeWorkspacePath, parseWorkspaceListing,
  workspaceReadMaximum, WORKSPACE_TOOLS } from "../src/tools/workspace.js";

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

  it("carries exact Run failure evidence into later reasoning without materializing the full trace", () => {
    const cursor = "cursor-".repeat(300);
    const preview = platformGetPreview({ object: "constal.api.object", ref: { kind: "run", id: "horizon/session/run" },
      next: cursor, evidence: { source: "coordinator", complete: false, warnings: ["older entries remain"], observedAt: 10 },
      value: { run: { runId: "run", status: "failed", error: "journal continuation does not match the dispatched snapshot",
        result: { explanation: "x".repeat(20_000) }, limits: { turnsUsed: 22, maxTurns: 500 } },
      workflow: { currentNodeId: "node:10", nodes: Array.from({ length: 100 }, (_, index) => ({
        id: `node:${index}`, status: index === 99 ? "failed" : "complete", summary: "work".repeat(100),
      })) },
      journal: { head: 300, before: 200, hasOlder: true, entries: Array.from({ length: 100 }, (_, index) => ({
        seq: index, pos: `root/${index}`, kind: "turn", status: index === 98 ? "failed" : "completed",
        error: index === 98 ? { message: "model failed" } : undefined, value: { body: "y".repeat(10_000) },
      })) },
      resourceInvocations: Array.from({ length: 100 }, (_, index) => ({ id: String(index), terminalStatus: "completed" })) } });
    expect(preview).toMatchObject({ next: cursor, value: { run: { runId: "run", status: "failed",
      error: "journal continuation does not match the dispatched snapshot" },
    journal: { entries: expect.arrayContaining([expect.objectContaining({ pos: "root/98", status: "failed" })]) } } });
    expect(new TextEncoder().encode(JSON.stringify(preview)).byteLength).toBeLessThanOrEqual(16_384);
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

  it("keeps workspace read limits internal instead of asking the model to guess bytes", () => {
    const schema = WORKSPACE_TOOLS.workspace_read!.schema as { properties: Record<string, unknown> };
    expect(schema.properties).toEqual({ path: expect.any(Object) });
    expect(workspaceReadMaximum(9_420)).toBe(9_420);
    expect(workspaceReadMaximum(0)).toBe(1);
    expect(workspaceReadMaximum(1_048_577)).toBeNull();
    expect(() => workspaceReadMaximum(-1)).toThrow("file size is invalid");
  });

  it("discovers the exact file size before reading through CAS", async () => {
    const ref = "a".repeat(64); const getFile = vi.fn(async () => ({ path: "/workspace/repo/src/contracts.ts", ref, bytes: 36_408 }));
    const invoke = vi.fn(async () => ({ ref, bytes: 36_408, text: "contract" }));
    const ctx = { resources: { sandbox: "sandbox", cas: "cas" }, run: { agent: { crn: "agent" }, session: "session" },
      sandboxPool: () => ({ createSandbox: async () => ({ getFile }) }), invoke } as never;
    await expect(WORKSPACE_TOOLS.workspace_read!.run({ path: "/workspace/repo/src/contracts.ts" }, ctx))
      .resolves.toMatchObject({ bytes: 36_408, text: "contract" });
    expect(invoke).toHaveBeenCalledWith("cas", "getText", { ref, maximumBytes: 36_408 });
  });

  it("returns actionable metadata instead of failing when a file exceeds the internal ceiling", async () => {
    const ref = "b".repeat(64); const getFile = vi.fn(async () => ({ path: "/workspace/repo/large.txt", ref, bytes: 1_048_577 }));
    const invoke = vi.fn();
    const ctx = { resources: { sandbox: "sandbox", cas: "cas" }, run: { agent: { crn: "agent" }, session: "session" },
      sandboxPool: () => ({ createSandbox: async () => ({ getFile }) }), invoke } as never;
    await expect(WORKSPACE_TOOLS.workspace_read!.run({ path: "/workspace/repo/large.txt" }, ctx)).resolves.toEqual({
      path: "/workspace/repo/large.txt", ref, bytes: 1_048_577, text: null, truncated: true,
      reason: "The file exceeds the internal 1 MiB text-read ceiling; use workspace_search to locate relevant sections.",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts structured bounded workspace listings with exact file metadata", () => {
    expect(parseWorkspaceListing({ protocol: "constal.workspace-runner", version: 2, root: "/workspace/repo",
      entries: [{ path: "src/index.ts", kind: "file", bytes: 1200, permissions: "0644", gitMode: "100644",
        executable: false, tracked: true, status: "modified", modifiedAt: 123 }], truncated: false, next: null }))
      .toMatchObject({ entries: [{ path: "src/index.ts", bytes: 1200, permissions: "0644", status: "modified" }] });
    expect(parseWorkspaceListing({ protocol: "constal.workspace-runner", version: 2, root: "/workspace/repo",
      entries: [], truncated: true, next: null })).toBeNull();
  });
});
