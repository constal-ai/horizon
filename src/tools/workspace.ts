import { type Ctx, type Sandbox, type SandboxCommandResult, type Tool } from "@constal/sdk";
import { HORIZON_RUNNER_PATH, HORIZON_WORKSPACE_ROOT } from "../workspace/runner-source.js";

const TIMEOUT_MS = 600_000;

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

export function workspaceReadMaximum(fileBytes: number, requested?: number): number {
  const maximum = requested ?? 262_144;
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0 || fileBytes > 1_048_576) {
    throw new TypeError("workspace file exceeds the supported read ceiling");
  }
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_048_576 || fileBytes > maximum) {
    throw new TypeError("workspace file exceeds the requested read limit");
  }
  return Math.max(1, fileBytes);
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
  name: "workspace_list", version: "1",
  description: "List a bounded set of tracked and untracked repository paths without reading file contents. Use this to discover real paths before workspace_read or workspace_search.",
  schema: { type: "object", properties: { cwd: pathProperty, paths: pathsProperty }, additionalProperties: false }, maxEffect: "reconcilable",
  needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "exec"] }],
  async run(args: { cwd?: string; paths?: string[] }, ctx) {
    const selected = await workspace(ctx); const cwd = repositoryCwd(args.cwd);
    const paths = (args.paths ?? []).map((path) => normalizeRepositoryPath(path, cwd));
    return command(selected, "git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...paths], cwd);
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
  name: "workspace_read", version: "1",
  description: "Read one bounded UTF-8 workspace file through CAS. Use an exact path discovered from the repository and request only the bytes needed for the current decision.",
  schema: { type: "object", properties: { path: pathProperty,
    maximumBytes: { type: "integer", minimum: 1, maximum: 1_048_576 } }, required: ["path"], additionalProperties: false },
  maxEffect: "idempotent", needs: [{ binding: "sandbox", kind: "sandbox-pool", ops: ["createSandbox", "getFile"] },
    { binding: "cas", kind: "cas", ops: ["getText"] }],
  preview(result) {
    const value = result as { path?: unknown; ref?: unknown; bytes?: unknown; text?: unknown };
    const text = typeof value.text === "string" ? value.text : ""; const maximum = 16_384;
    return { path: value.path, ref: value.ref, bytes: value.bytes, text: text.slice(0, maximum), truncated: text.length > maximum };
  },
  async run(args: { path: string; maximumBytes?: number }, ctx) {
    const selected = await workspace(ctx); const path = normalizeWorkspacePath(args.path, HORIZON_WORKSPACE_ROOT);
    if (path !== HORIZON_WORKSPACE_ROOT && !path.startsWith(`${HORIZON_WORKSPACE_ROOT}/`)) {
      throw new TypeError("workspace read path is outside /workspace/repo");
    }
    const file = await Promise.resolve(selected.getFile(path, { timeoutMs: TIMEOUT_MS }));
    const value = await ctx.invoke<{ ref: string; text: string; bytes: number }>(ctx.resources.cas!, "getText",
      { ref: file.ref, maximumBytes: workspaceReadMaximum(file.bytes, args.maximumBytes) });
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
  description: "Write one complete UTF-8 file through tenant-scoped CAS into the governed workspace. Use for new files or intentional whole-file replacement after inspecting the relevant current state; prefer workspace_patch for small edits.",
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

const patch: Tool = {
  name: "workspace_patch", version: "1",
  description: "Validate and apply one bounded Git patch in the governed repository. The patch must apply cleanly with no whitespace errors. Use after reading the target files; never include unrelated changes in the patch.",
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
  list, search, read, exec, write, patch, diff, pack,
].map((tool) => [tool.name, tool]));
