/** Generated from sandbox/constal-workspace-runner.mjs; kept inline for governed bootstrap during image rollouts. */
export const WORKSPACE_RUNNER_SOURCE = `#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROTOCOL = "constal.workspace-runner";
const VERSION = 1;
const ROOT = "/workspace";

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
} else if (operation === "exec") {
  await execute(args);
} else {
  fail("workspace runner operation is invalid");
}
`;

export const WORKSPACE_RUNNER_PROTOCOL = "constal.workspace-runner" as const;
export const WORKSPACE_RUNNER_VERSION = 1 as const;
export const HORIZON_WORKSPACE_ROOT = "/workspace/repo" as const;
export const HORIZON_RUNNER_PATH = "/workspace/.constal/bin/constal-workspace-runner.mjs" as const;
