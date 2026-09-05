// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { availableTools, bindingsForTools, EXECUTOR_TOOL_NAMES, VERIFIER_TOOL_NAMES } from "../src/tools/index.js";
import { PLATFORM_TOOLS } from "../src/tools/platform.js";
import { WEB_TOOLS } from "../src/tools/web.js";
import { editWorkspaceText, normalizeRepositoryPath, normalizeWorkspacePath, parseWorkspaceListing,
  WORKSPACE_TOOLS } from "../src/tools/workspace.js";

describe("Horizon Tool capability projection", () => {
  it("keeps role capabilities independent of progress heuristics", () => {
    expect(EXECUTOR_TOOL_NAMES).toEqual(expect.arrayContaining(["workspace_write", "workspace_edit", "workspace_patch", "workspace_exec"]));
    expect(VERIFIER_TOOL_NAMES).toEqual(["workspace_list", "workspace_search", "workspace_read", "workspace_exec", "workspace_diff"]);
    expect(VERIFIER_TOOL_NAMES).not.toContain("workspace_write");
  });

  it("requires catalog bindings as well as direct Tool needs", () => {
    const resources = { model: "model", sandbox: "sandbox", cas: "cas", web: "web" } as never;
    expect(availableTools(["workspace_read", "web_fetch", "web_search", "github_file"], { resources }))
      .toEqual(["workspace_read", "web_fetch"]);
    expect(bindingsForTools(["workspace_read", "web_fetch"], { resources })).toEqual(["cas", "model", "sandbox", "web"]);
  });

  it("advertises only arguments supported by the bound platform Search provider", () => {
    const schema = WEB_TOOLS.web_search!.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual([
      "query", "searchQueries", "maximumResults", "maximumCharacters", "includeDomains", "excludeDomains", "afterDate",
    ]);
    expect(schema.properties).not.toHaveProperty("includeAnswer");
    expect(schema.properties).not.toHaveProperty("includeRawContent");
    expect(schema.properties).not.toHaveProperty("includeImages");
    expect(schema.properties).not.toHaveProperty("includeImageDescriptions");
    expect(schema.properties).not.toHaveProperty("searchDepth");
  });

  it("projects exact Constal API query and object-ref schemas to the model", () => {
    const query = PLATFORM_TOOLS.platform_query!.schema as { required: string[]; properties: Record<string, unknown> };
    const get = PLATFORM_TOOLS.platform_get!.schema as { required: string[]; properties: Record<string, unknown> };
    expect(query.required).toEqual(["kind", "scope"]);
    expect(query.properties.kind).toMatchObject({ enum: expect.arrayContaining(["agent", "run", "deployment"]) });
    expect((query.properties.kind as { enum: string[] }).enum).not.toContain("ledger");
    expect(get.required).toEqual(["ref"]);
    expect(get.properties.ref).toHaveProperty("anyOf");
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

  it("exposes continuation without imposing a Horizon-specific file ceiling", () => {
    const schema = WORKSPACE_TOOLS.workspace_read!.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(["path", "offset", "limit"]);
  });

  it("reads the requested workspace range directly from the Sandbox Resource", async () => {
    const contentHash = "a".repeat(64);
    const invoke = vi.fn(async () => ({ path: "/workspace/repo/src/contracts.ts", contentHash, bytes: 36_408,
      offset: 1_024, returnedBytes: 8, nextOffset: 1_032, content: "contract" }));
    const ctx = { resources: { sandbox: "sandbox", cas: "cas" }, run: { agent: { crn: "agent" }, session: "session" },
      sandboxPool: () => ({ createSandbox: async () => ({ id: "sbx" }) }), invoke } as never;
    await expect(WORKSPACE_TOOLS.workspace_read!.run({ path: "/workspace/repo/src/contracts.ts", offset: 1_024, limit: 8 }, ctx))
      .resolves.toMatchObject({ contentHash, bytes: 36_408, offset: 1_024, nextOffset: 1_032, text: "contract" });
    expect(invoke).toHaveBeenCalledWith("sandbox", "read_file", {
      sandbox: "sbx", path: "/workspace/repo/src/contracts.ts", offset: 1_024, limit: 8,
    }, { timeoutMs: 600_000 });
  });

  it("returns the native continuation for files larger than one response", async () => {
    const contentHash = "b".repeat(64);
    const invoke = vi.fn(async () => ({ path: "/workspace/repo/large.txt", contentHash, bytes: 20_000_000,
      offset: 0, returnedBytes: 16_777_216, nextOffset: 16_777_216, content: "page" }));
    const ctx = { resources: { sandbox: "sandbox", cas: "cas" }, run: { agent: { crn: "agent" }, session: "session" },
      sandboxPool: () => ({ createSandbox: async () => ({ id: "sbx" }) }), invoke } as never;
    await expect(WORKSPACE_TOOLS.workspace_read!.run({ path: "/workspace/repo/large.txt" }, ctx)).resolves.toEqual({
      path: "/workspace/repo/large.txt", contentHash, bytes: 20_000_000, offset: 0,
      returnedBytes: 16_777_216, nextOffset: 16_777_216, text: "page",
    });
    expect(invoke).toHaveBeenCalledOnce();
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
