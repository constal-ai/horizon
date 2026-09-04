// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Generated from sandbox/constal-workspace-runner.mjs; kept inline for governed bootstrap during image rollouts. */
export const WORKSPACE_RUNNER_SOURCE = `#!/usr/bin/env node
// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROTOCOL = "constal.workspace-runner";
const VERSION = 2;
const ROOT = "/workspace";
const REPOSITORY = ROOT + "/repo";

function fail(message, code = 2) {
  process.stderr.write(\`${"${message}"}\\n\`);
  process.exit(code);
}

function workspacePath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) fail("workspace runner requires an absolute working directory");
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop(); else segments.push(segment);
  }
  const normalized = \`/${"${segments.join(\"/\")}"}\`;
  if (normalized !== ROOT && !normalized.startsWith(\`${"${ROOT}"}/\`)) fail("workspace runner working directory is outside /workspace");
  return normalized;
}

function git(cwd, args, env = process.env) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, env });
  if (result.status !== 0) fail(String(result.stderr || \`git ${"${args[0]}"} failed\`));
  return String(result.stdout).trim();
}

function gitRaw(cwd, args, env = process.env) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, env });
  if (result.status !== 0) fail(String(result.stderr || \`git ${"${args[0]}"} failed\`));
  return String(result.stdout);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

function worktreeStatus(code) {
  if (code === "??") return "untracked";
  if (code.includes("U") || ["AA", "DD"].includes(code)) return "conflicted";
  if (code.includes("R")) return "renamed";
  if (code.includes("C")) return "copied";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("M") || code.includes("T")) return "modified";
  return "clean";
}

function list(root, argv) {
  const separator = argv.indexOf("--");
  if (separator < 0) fail("workspace runner list requires -- before optional paths");
  const options = argv.slice(0, separator);
  const cwd = workspacePath(option(options, "--cwd") ?? root);
  if (cwd !== root && !cwd.startsWith(root + "/")) fail("workspace runner list directory is outside the repository");
  const maximumEntries = Number(option(options, "--maximum-entries") ?? 100);
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 200) {
    fail("workspace runner list maximum entries is invalid");
  }
  const after = option(options, "--after");
  if (after !== null && (!after || after.length > 4096 || after.includes("\\0"))) fail("workspace runner list cursor is invalid");
  const paths = argv.slice(separator + 1);
  const tracked = new Map();
  for (const row of gitRaw(cwd, ["ls-files", "--stage", "-z", "--", ...paths]).split("\\0").filter(Boolean)) {
    const tab = row.indexOf("\\t");
    if (tab < 0) continue;
    const [gitMode] = row.slice(0, tab).split(" ");
    tracked.set(row.slice(tab + 1), gitMode);
  }
  const statuses = new Map();
  const statusRows = gitRaw(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...paths]).split("\\0");
  for (let index = 0; index < statusRows.length; index++) {
    const row = statusRows[index];
    if (!row || row.length < 4) continue;
    const code = row.slice(0, 2); const path = row.slice(3);
    statuses.set(path, worktreeStatus(code));
    if (code.includes("R") || code.includes("C")) index++;
  }
  const candidates = gitRaw(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...paths])
    .split("\\0").filter((path) => path && (after === null || path > after)).sort((left, right) => left.localeCompare(right));
  const entries = []; let responseBytes = 256; let index = 0;
  for (; index < candidates.length && entries.length < maximumEntries; index++) {
    const path = candidates[index]; const gitMode = tracked.get(path) ?? null; const absolute = join(cwd, path);
    let stat = null;
    try { stat = lstatSync(absolute); } catch { /* A tracked file may be deleted from the worktree. */ }
    const kind = gitMode === "160000" ? "submodule" : stat?.isSymbolicLink() ? "symlink"
      : stat?.isFile() ? "file" : stat?.isDirectory() ? "directory" : stat ? "other" : "missing";
    const permissions = stat ? (stat.mode & 0o7777).toString(8).padStart(4, "0") : null;
    const entry = { path, kind, bytes: stat ? stat.size : null, permissions, gitMode,
      executable: stat ? (stat.mode & 0o111) !== 0 : gitMode === "100755", tracked: gitMode !== null,
      status: statuses.get(path) ?? "clean", modifiedAt: stat ? Math.trunc(stat.mtimeMs) : null,
      ...(kind === "symlink" ? { symlinkTarget: String(readlinkSync(absolute)) } : {}) };
    const entryBytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (entries.length > 0 && responseBytes + entryBytes > 900_000) break;
    entries.push(entry); responseBytes += entryBytes;
  }
  const truncated = index < candidates.length;
  return { protocol: PROTOCOL, version: VERSION, root: cwd, entries,
    truncated, next: truncated ? entries.at(-1)?.path ?? after : null };
}

function withWorktreeIndex(root, run) {
  const directory = mkdtempSync(join(tmpdir(), "constal-workspace-"));
  const index = join(directory, "index");
  try {
    copyFileSync(join(root, ".git", "index"), index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(root, ["add", "-A"], env);
    return run(env, git(root, ["write-tree"], env));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function inspect(root) {
  return withWorktreeIndex(root, (_env, tree) => ({ protocol: PROTOCOL, version: VERSION, root,
    commit: git(root, ["rev-parse", "HEAD"]), tree,
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) }));
}

function archive(root, output) {
  const target = workspacePath(output);
  return withWorktreeIndex(root, (env, tree) => {
    git(root, ["archive", "--format=tar.gz", \`--output=${"${target}"}\`, tree], env);
    return { protocol: PROTOCOL, version: VERSION, root, tree, output: target };
  });
}

async function execute(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) fail("workspace runner exec requires -- followed by argv");
  const options = argv.slice(0, separator);
  const cwdIndex = options.indexOf("--cwd");
  if (cwdIndex < 0 || cwdIndex === options.length - 1) fail("workspace runner exec requires --cwd");
  const cwd = workspacePath(options[cwdIndex + 1]);
  const [cmd, ...args] = argv.slice(separator + 1);
  const child = spawn(cmd, args, { cwd, env: process.env, shell: false, stdio: "inherit" });
  const forward = (signal) => { if (!child.killed) child.kill(signal); };
  process.on("SIGTERM", () => forward("SIGTERM")); process.on("SIGINT", () => forward("SIGINT"));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("exit", (status, signal) => resolve(status ?? (signal ? 128 : 1)));
  }).catch((error) => fail(error instanceof Error ? error.message : "workspace command failed", 127));
  process.exit(Number(code));
}

const [operation, ...args] = process.argv.slice(2);
if (operation === "probe") {
  process.stdout.write(\`${"${JSON.stringify({ protocol: PROTOCOL, version: VERSION, root: ROOT })}"}\\n\`);
} else if (operation === "inspect") {
  const root = workspacePath(args[0] ?? "/workspace/repo");
  process.stdout.write(\`${"${JSON.stringify(inspect(root))}"}\\n\`);
} else if (operation === "archive") {
  const root = workspacePath(args[0] ?? "/workspace/repo");
  if (!args[1]) fail("workspace runner archive requires an output path");
  process.stdout.write(\`${"${JSON.stringify(archive(root, args[1]))}"}\\n\`);
} else if (operation === "list") {
  process.stdout.write(\`${"${JSON.stringify(list(REPOSITORY, args))}"}\\n\`);
} else if (operation === "exec") {
  await execute(args);
} else {
  fail("workspace runner operation is invalid");
}
`;

export const WORKSPACE_RUNNER_PROTOCOL = "constal.workspace-runner" as const;
export const WORKSPACE_RUNNER_VERSION = 2 as const;
export const HORIZON_WORKSPACE_ROOT = "/workspace/repo" as const;
export const HORIZON_RUNNER_PATH = "/workspace/.constal/bin/constal-workspace-runner.mjs" as const;
