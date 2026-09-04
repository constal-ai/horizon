// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { type Ctx, type Sandbox, type SandboxCommandResult, type Tool } from "@constal/sdk";
import { HORIZON_RUNNER_PATH, HORIZON_WORKSPACE_ROOT } from "../workspace/runner-source.js";

const TIMEOUT_MS = 600_000;
const WORKSPACE_READ_CEILING_BYTES = 1_048_576;
const WORKSPACE_LIST_OUTPUT_BYTES = 1_000_000;

export function normalizeWorkspacePath(path: string, cwd = "/workspace"): string {
  if (typeof path !== "string" || path.length === 0 || path.length > 4_096) throw new TypeError("workspace path is invalid");
  for (const character of path) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127) throw new TypeError("workspace path contains a control character");
  }
  const base = cwd.startsWith("/") ? cwd : `/workspace/${cwd}`;
  const segments: string[] = [];
  for (const segment of `${path.startsWith("/") ? "" : `${base}/`}${path}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const normalized = `/${segments.join("/")}`;
  if (normalized !== "/workspace" && !normalized.startsWith("/workspace/")) throw new TypeError("workspace path is outside /workspace");
  return normalized;
}

export function normalizeRepositoryPath(path: string, cwd: string): string {
  const root = normalizeWorkspacePath(cwd);
  const normalized = normalizeWorkspacePath(path, root);
  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    throw new TypeError("repository path is outside the selected repository");
  }
  return normalized === root ? "." : normalized.slice(root.length + 1);
}

function repositoryCwd(value?: string): string {
  const cwd = normalizeWorkspacePath(value ?? HORIZON_WORKSPACE_ROOT);
  if (cwd !== HORIZON_WORKSPACE_ROOT && !cwd.startsWith(`${HORIZON_WORKSPACE_ROOT}/`)) {
    throw new TypeError("repository working directory is outside /workspace/repo");
  }
  return cwd;
}

async function workspace(ctx: Ctx): Promise<Sandbox> {
  const resource = ctx.resources.sandbox;
  if (!resource) throw new TypeError("Horizon requires a bound Sandbox Pool");
  return ctx.sandboxPool(resource).createSandbox(ctx.run.agent.crn, ctx.run.session);
}

async function command(selected: Sandbox, cmd: string, args: string[], cwd = "/workspace",
  options: { stdin?: string; outputs?: string[]; timeoutMs?: number } = {}): Promise<SandboxCommandResult> {
  const root = normalizeWorkspacePath(cwd);
  return Promise.resolve(selected.exec({ cmd: "node", args: [HORIZON_RUNNER_PATH, "exec", "--cwd", root, "--", cmd, ...args],
    cwd: "/workspace", timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    ...(options.outputs === undefined ? {} : { outputs: options.outputs.map((path) => normalizeWorkspacePath(path, cwd)) }) },
  { timeoutMs: options.timeoutMs ?? TIMEOUT_MS }));
}

function succeeded(result: SandboxCommandResult): boolean {
  return result.status === "completed" && result.exitCode === 0;
}

export function workspaceReadMaximum(fileBytes: number): number | null {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) throw new TypeError("workspace file size is invalid");
  return fileBytes > WORKSPACE_READ_CEILING_BYTES ? null : Math.max(1, fileBytes);
}

export interface WorkspaceListEntry {
  path: string;
  kind: "file" | "directory" | "symlink" | "submodule" | "missing" | "other";
  bytes: number | null;
  permissions: string | null;
  gitMode: string | null;
  executable: boolean;
  tracked: boolean;
  status: "clean" | "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted";
  modifiedAt: number | null;
  symlinkTarget?: string;
}

export interface WorkspaceListing {
  protocol: "constal.workspace-runner";
  version: 2;
  root: string;
  entries: WorkspaceListEntry[];
  truncated: boolean;
  next: string | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseWorkspaceListing(value: unknown): WorkspaceListing | null {
  const source = object(value);
  if (!source || source.protocol !== "constal.workspace-runner" || source.version !== 2
    || typeof source.root !== "string" || !Array.isArray(source.entries) || source.entries.length > 200
    || typeof source.truncated !== "boolean" || !(source.next === null || typeof source.next === "string")
    || source.truncated !== (typeof source.next === "string")) return null;
  const kinds = new Set(["file", "directory", "symlink", "submodule", "missing", "other"]);
  const statuses = new Set(["clean", "modified", "added", "deleted", "renamed", "copied", "untracked", "conflicted"]);
  const entries: WorkspaceListEntry[] = [];
  for (const candidate of source.entries) {
    const entry = object(candidate);
    if (!entry || typeof entry.path !== "string" || !entry.path || entry.path.length > 4_096
      || typeof entry.kind !== "string" || !kinds.has(entry.kind)
      || !(entry.bytes === null || Number.isSafeInteger(entry.bytes) && Number(entry.bytes) >= 0)
      || !(entry.permissions === null || typeof entry.permissions === "string" && /^[0-7]{4}$/u.test(entry.permissions))
      || !(entry.gitMode === null || typeof entry.gitMode === "string" && /^[0-7]{6}$/u.test(entry.gitMode))
      || typeof entry.executable !== "boolean" || typeof entry.tracked !== "boolean"
      || typeof entry.status !== "string" || !statuses.has(entry.status)
      || !(entry.modifiedAt === null || Number.isSafeInteger(entry.modifiedAt) && Number(entry.modifiedAt) >= 0)
      || !(entry.symlinkTarget === undefined || typeof entry.symlinkTarget === "string")
      || (entry.kind === "symlink") !== (typeof entry.symlinkTarget === "string")) return null;
    entries.push(entry as unknown as WorkspaceListEntry);
  }
  return { protocol: "constal.workspace-runner", version: 2, root: source.root,
    entries, truncated: source.truncated, next: source.next as string | null };
}

async function commandText(result: SandboxCommandResult, ctx: Ctx): Promise<string> {
  if (!succeeded(result)) throw new Error(`workspace command failed (${result.status}, exit ${result.exitCode ?? "unknown"})`);
  if (!result.stdoutRef) return result.stdoutPreview;
  const loaded = await ctx.invoke<{ ref: string; text: string }>(ctx.resources.cas!, "getText",
    { ref: result.stdoutRef, maximumBytes: WORKSPACE_LIST_OUTPUT_BYTES });
  if (loaded.ref !== result.stdoutRef) throw new Error("workspace command output reference changed");
  return loaded.text;
}

function lineEnding(value: string): "\r\n" | "\n" {
  const crlf = value.split("\r\n").length - 1;
  const lf = value.split("\n").length - 1 - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

function normalizeLineEndings(value: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? value.replace(/\r?\n/gu, "\r\n") : value.replace(/\r\n/gu, "\n");
}

export function editWorkspaceText(current: string, oldText: string, newText: string): { text: string; replacements: 1 } {
  if (!oldText) throw new TypeError("workspace edit oldText must not be empty");
  const ending = lineEnding(current);
  const target = normalizeLineEndings(oldText, ending);
  const replacement = normalizeLineEndings(newText, ending);
  let count = 0; let offset = 0;
  while ((offset = current.indexOf(target, offset)) >= 0) { count++; offset += target.length; }
  if (count === 0) throw new TypeError("workspace edit target was not found; read the current file before retrying");
  if (count > 1) throw new TypeError(`workspace edit target matched ${count} times; provide more surrounding text`);
  return { text: current.replace(target, replacement), replacements: 1 };
}

async function requireCommand(selected: Sandbox, cmd: string, args: string[], cwd = "/workspace",
  options: { stdin?: string; outputs?: string[]; timeoutMs?: number } = {}): Promise<SandboxCommandResult> {
  const result = await command(selected, cmd, args, cwd, options);
  if (!succeeded(result)) throw new Error(`${cmd} failed (${result.status}, exit ${result.exitCode ?? "unknown"})`);
  return result;
}

const pathProperty = { type: "string", minLength: 1, maxLength: 4_096 } as const;
const pathsProperty = { type: "array", maxItems: 256, items: pathProperty } as const;

const list: Tool = {
  name: "workspace_list", version: "2",
  description: "List tracked and untracked repository files with exact size, kind, permissions, Git mode, executable bit, worktree status, and modification time. Follow next only when the returned page is truncated.",
  schema: { type: "object", properties: { cwd: pathProperty, paths: pathsProperty, after: pathProperty,
    maximumEntries: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false }, maxEffect: "reconcilable",
  needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] },
    { binding: "cas", kind: "cas", ops: ["getText"] }],
  async run(args: { cwd?: string; paths?: string[]; after?: string; maximumEntries?: number }, ctx) {
    const selected = await workspace(ctx); const cwd = repositoryCwd(args.cwd);
    const paths = (args.paths ?? []).map((path) => normalizeRepositoryPath(path, cwd));
    const result = await command(selected, "node", [HORIZON_RUNNER_PATH, "list", "--cwd", cwd,
      "--maximum-entries", String(args.maximumEntries ?? 100), ...(args.after ? ["--after", args.after] : []), "--", ...paths], cwd);
    const listing = parseWorkspaceListing(JSON.parse(await commandText(result, ctx)));
    if (!listing || listing.root !== cwd) throw new Error("workspace runner returned an invalid file listing");
    return listing;
  },
};

const search: Tool = {
  name: "workspace_search", version: "1",
  description: "Search repository text with ripgrep and return bounded line-numbered matches. Use a precise literal or expression and narrow paths when possible; inspect matching files with workspace_read before making decisions or edits.",
  schema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 2_048 }, cwd: pathProperty,
    paths: pathsProperty, maximumMatches: { type: "integer", minimum: 1, maximum: 500 } }, required: ["query"], additionalProperties: false },
  maxEffect: "reconcilable", needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] }],
  async run(args: { query: string; cwd?: string; paths?: string[]; maximumMatches?: number }, ctx) {
    const selected = await workspace(ctx); const maximum = args.maximumMatches ?? 200; const cwd = repositoryCwd(args.cwd);
    const paths = (args.paths ?? ["."]).map((path) => normalizeRepositoryPath(path, cwd));
    return command(selected, "rg", ["--line-number", "--no-heading", "--color", "never", "--max-count", String(maximum), "--", args.query, ...paths], cwd);
  },
};

const read: Tool = {
  name: "workspace_read", version: "2",
  description: "Read one UTF-8 repository file through CAS. Supply only an exact path discovered from workspace_list or workspace_search; file size and the internal read ceiling are handled automatically.",
  schema: { type: "object", properties: { path: pathProperty }, required: ["path"], additionalProperties: false },
  maxEffect: "idempotent", needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "getFile"] },
    { binding: "cas", kind: "cas", ops: ["getText"] }],
  preview(result) {
    const value = result as { path?: unknown; ref?: unknown; bytes?: unknown; text?: unknown; truncated?: unknown; reason?: unknown };
    const text = typeof value.text === "string" ? value.text : ""; const maximum = 65_536;
    const truncated = value.truncated === true || text.length > maximum;
    return { path: value.path, ref: value.ref, bytes: value.bytes, text: text.slice(0, maximum), truncated,
      ...(typeof value.reason === "string" ? { reason: value.reason } : truncated
        ? { reason: "The model preview is truncated; use workspace_search to locate additional relevant sections." } : {}) };
  },
  async run(args: { path: string }, ctx) {
    const selected = await workspace(ctx); const path = normalizeWorkspacePath(args.path, HORIZON_WORKSPACE_ROOT);
    if (path !== HORIZON_WORKSPACE_ROOT && !path.startsWith(`${HORIZON_WORKSPACE_ROOT}/`)) {
      throw new TypeError("workspace read path is outside /workspace/repo");
    }
    const file = await Promise.resolve(selected.getFile(path, { timeoutMs: TIMEOUT_MS }));
    const maximumBytes = workspaceReadMaximum(file.bytes);
    if (maximumBytes === null) return { path: file.path, ref: file.ref, bytes: file.bytes, text: null, truncated: true,
      reason: "The file exceeds the internal 1 MiB text-read ceiling; use workspace_search to locate relevant sections." };
    const value = await ctx.invoke<{ ref: string; text: string; bytes: number }>(ctx.resources.cas!, "getText",
      { ref: file.ref, maximumBytes });
    return { path: file.path, ref: value.ref, bytes: value.bytes, text: value.text };
  },
};

const exec: Tool = {
  name: "workspace_exec", version: "1",
  description: "Execute one argv-based repository command in the governed workspace for formatting, builds, tests, version-control inspection, or other work explicitly required by the assigned specialist. Supply cmd and args separately; do not embed shell pipelines or reusable secrets.",
  schema: { type: "object", properties: { cmd: { type: "string", minLength: 1, maxLength: 256 },
    args: { type: "array", maxItems: 256, items: { type: "string", maxLength: 16_384 } }, cwd: pathProperty,
    stdin: { type: "string", maxLength: 1_048_576 }, timeoutMs: { type: "integer", minimum: 1_000, maximum: TIMEOUT_MS } },
    required: ["cmd"], additionalProperties: false }, maxEffect: "reconcilable",
  needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] }],
  async run(args: { cmd: string; args?: string[]; cwd?: string; stdin?: string; timeoutMs?: number }, ctx) {
    const selected = await workspace(ctx);
    const cwd = repositoryCwd(args.cwd);
    return command(selected, args.cmd, args.args ?? [], cwd,
      { ...(args.stdin === undefined ? {} : { stdin: args.stdin }), timeoutMs: args.timeoutMs ?? TIMEOUT_MS });
  },
};

const write: Tool = {
  name: "workspace_write", version: "1",
  description: "Write one complete UTF-8 file through tenant-scoped CAS into the governed workspace. Use for new files or intentional whole-file replacement after inspecting the relevant current state; prefer workspace_edit for a bounded change to an existing file.",
  schema: { type: "object", properties: { path: pathProperty, text: { type: "string", maxLength: 2_097_152 },
    mode: { type: "integer", minimum: 0, maximum: 511 } }, required: ["path", "text"], additionalProperties: false },
  maxEffect: "idempotent", needs: [{ binding: "cas", kind: "cas", ops: ["putText"] },
    { binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "putFile"] }],
  async run(args: { path: string; text: string; mode?: number }, ctx) {
    const stored = await ctx.invoke<{ ref: string; created: boolean; bytes: number }>(ctx.resources.cas!, "putText", { text: args.text });
    const selected = await workspace(ctx); const path = normalizeWorkspacePath(args.path, HORIZON_WORKSPACE_ROOT);
    if (path !== HORIZON_WORKSPACE_ROOT && !path.startsWith(`${HORIZON_WORKSPACE_ROOT}/`)) {
      throw new TypeError("workspace write path is outside /workspace/repo");
    }
    await Promise.resolve(selected.putFile(path, stored.ref, { ...(args.mode === undefined ? {} : { mode: args.mode }),
      invoke: { timeoutMs: TIMEOUT_MS } }));
    return { path, ref: stored.ref, bytes: stored.bytes, created: stored.created };
  },
};

const edit: Tool = {
  name: "workspace_edit", version: "1",
  description: "Replace one unique exact text span in an existing governed workspace file. Include enough unchanged surrounding text in oldText to make the match unique. The Tool preserves line endings and returns before/after content references; use it for routine bounded edits instead of authoring a raw Git patch.",
  schema: { type: "object", properties: { path: pathProperty,
    oldText: { type: "string", minLength: 1, maxLength: 1_048_576 },
    newText: { type: "string", maxLength: 1_048_576 },
    expectedRef: { type: "string", pattern: "^[a-f0-9]{64}$" } },
  required: ["path", "oldText", "newText"], additionalProperties: false },
  maxEffect: "idempotent", once: "per-run-and-args",
  needs: [{ binding: "cas", kind: "cas", ops: ["getText", "putText"] },
    { binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "getFile", "putFile"] }],
  async run(args: { path: string; oldText: string; newText: string; expectedRef?: string }, ctx) {
    const selected = await workspace(ctx); const path = normalizeWorkspacePath(args.path, HORIZON_WORKSPACE_ROOT);
    if (path !== HORIZON_WORKSPACE_ROOT && !path.startsWith(`${HORIZON_WORKSPACE_ROOT}/`)) {
      throw new TypeError("workspace edit path is outside /workspace/repo");
    }
    const file = await Promise.resolve(selected.getFile(path, { timeoutMs: TIMEOUT_MS }));
    if (args.expectedRef !== undefined && args.expectedRef !== file.ref) {
      throw new TypeError("workspace edit expectedRef is stale; read the current file before retrying");
    }
    const maximumBytes = workspaceReadMaximum(file.bytes);
    if (maximumBytes === null) throw new TypeError("workspace file exceeds the supported edit ceiling");
    const current = await ctx.invoke<{ ref: string; text: string; bytes: number }>(ctx.resources.cas!, "getText",
      { ref: file.ref, maximumBytes });
    const edited = editWorkspaceText(current.text, args.oldText, args.newText);
    const stored = await ctx.invoke<{ ref: string; created: boolean; bytes: number }>(ctx.resources.cas!, "putText", { text: edited.text });
    await Promise.resolve(selected.putFile(path, stored.ref, { invoke: { timeoutMs: TIMEOUT_MS } }));
    return { path, beforeRef: file.ref, afterRef: stored.ref, bytes: stored.bytes, replacements: edited.replacements };
  },
};

const patch: Tool = {
  name: "workspace_patch", version: "1",
  description: "Validate and apply one bounded raw unified Git diff in the governed repository. The patch value must begin with standard ---/+++ file headers and must not contain apply_patch markers such as *** Begin Patch. Prefer workspace_edit for a routine exact replacement; use this Tool for a true multi-hunk diff.",
  schema: { type: "object", properties: { patch: { type: "string", minLength: 1, maxLength: 2_097_152 }, cwd: pathProperty },
    required: ["patch"], additionalProperties: false }, maxEffect: "reconcilable",
  needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] }],
  async run(args: { patch: string; cwd?: string }, ctx) {
    const selected = await workspace(ctx); const cwd = repositoryCwd(args.cwd);
    const check = await command(selected, "git", ["apply", "--check", "--whitespace=error-all", "-"], cwd, { stdin: args.patch });
    if (!succeeded(check)) throw new Error(`workspace patch validation failed (${check.status}, exit ${check.exitCode ?? "unknown"})`);
    const applied = await command(selected, "git", ["apply", "--whitespace=error-all", "-"], cwd, { stdin: args.patch });
    if (!succeeded(applied)) throw new Error(`workspace patch failed (${applied.status}, exit ${applied.exitCode ?? "unknown"})`);
    return { check, applied };
  },
};

const diff: Tool = {
  name: "workspace_diff", version: "1",
  description: "Read the exact bounded Git diff for the selected repository paths. Use after edits and before reporting completion so the specialist can catch accidental or unrelated changes.",
  schema: { type: "object", properties: { cwd: pathProperty, paths: pathsProperty }, additionalProperties: false },
  maxEffect: "reconcilable", needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] }],
  async run(args: { cwd?: string; paths?: string[] }, ctx) {
    const selected = await workspace(ctx); const cwd = repositoryCwd(args.cwd);
    const paths = (args.paths ?? []).map((path) => normalizeRepositoryPath(path, cwd));
    return command(selected, "git", ["diff", "--no-ext-diff", "--", ...paths], cwd);
  },
};

const pack: Tool = {
  name: "workspace_package", version: "1",
  description: "Create one immutable tar.gz CAS artifact from explicit workspace paths after implementation and verification. Use only when the assigned work unit owns packaging; this does not deploy or publish the artifact.",
  schema: { type: "object", properties: { cwd: pathProperty, paths: pathsProperty, output: pathProperty },
    required: ["paths"], additionalProperties: false }, maxEffect: "reconcilable",
  needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] }],
  async run(args: { cwd?: string; paths: string[]; output?: string }, ctx) {
    if (args.paths.length === 0) throw new TypeError("workspace_package requires at least one path");
    const selected = await workspace(ctx); const cwd = repositoryCwd(args.cwd);
    const output = normalizeWorkspacePath(args.output ?? "/workspace/.constal/horizon-artifact.tar.gz", cwd);
    const paths = args.paths.map((path) => normalizeRepositoryPath(path, cwd));
    await requireCommand(selected, "mkdir", ["-p", "--", output.slice(0, output.lastIndexOf("/"))]);
    const result = await command(selected, "tar", ["-czf", output, "--", ...paths], cwd, { outputs: [output] });
    if (!succeeded(result)) throw new Error(`workspace package failed (${result.status}, exit ${result.exitCode ?? "unknown"})`);
    const artifact = result.outputs.find(({ path }) => path === output);
    if (!artifact) throw new Error("workspace package completed without its declared output");
    return { sandbox: selected.id, artifact };
  },
};

export const WORKSPACE_TOOLS: Record<string, Tool> = Object.fromEntries([
  list, search, read, exec, write, edit, patch, diff, pack,
].map((tool) => [tool.name, tool]));
