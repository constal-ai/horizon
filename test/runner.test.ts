import { execFile as callbackExecFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(callbackExecFile);
const runner = new URL("../sandbox/constal-workspace-runner.mjs", import.meta.url).pathname;
const directories: string[] = [];

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("Constal workspace runner", () => {
  it("supervises argv commands and hashes the real worktree without mutating Git's index", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "horizon-runner-")); directories.push(workspace);
    const repository = join(workspace, "repo");
    await execFile("mkdir", ["-p", repository]);
    await writeFile(join(repository, "file.txt"), "baseline\n");
    await writeFile(join(repository, ".gitignore"), "node_modules/\n");
    await execFile("git", ["init", "--initial-branch=main"], { cwd: repository });
    await execFile("git", ["add", "-A"], { cwd: repository });
    await execFile("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"], { cwd: repository });

    // The production root is /workspace. Replace only that prefix in a temporary copy so the same runner protocol is exercised locally.
    const localRunner = join(workspace, "runner.mjs");
    await writeFile(localRunner, (await readFile(runner, "utf8")).replace('const ROOT = "/workspace";', `const ROOT = ${JSON.stringify(workspace)};`));
    const baseline = JSON.parse((await execFile("node", [localRunner, "inspect", repository])).stdout) as { tree: string; status: string };
    await execFile("node", [localRunner, "exec", "--cwd", repository, "--", "node", "-e",
      "require('node:fs').writeFileSync('file.txt', 'changed\\n')"]);
    const changed = JSON.parse((await execFile("node", [localRunner, "inspect", repository])).stdout) as { tree: string; status: string };
    expect(changed.tree).not.toBe(baseline.tree);
    expect(changed.status).toContain("file.txt");
    expect((await execFile("git", ["diff", "--cached", "--name-only"], { cwd: repository })).stdout).toBe("");

    await writeFile(join(repository, "new.txt"), "new\n");
    await mkdir(join(repository, "node_modules"));
    await writeFile(join(repository, "node_modules", "ignored.js"), "ignored\n");
    const archive = join(workspace, "result.tar.gz");
    const archived = JSON.parse((await execFile("node", [localRunner, "archive", repository, archive])).stdout) as { tree: string };
    expect(archived.tree).not.toBe(baseline.tree);
    const entries = (await execFile("tar", ["-tzf", archive])).stdout.split("\n");
    expect(entries).toEqual(expect.arrayContaining(["file.txt", "new.txt"]));
    expect(entries.some((entry) => entry.startsWith("node_modules/"))).toBe(false);
  });

  it("rejects command working directories outside its workspace root", async () => {
    await expect(execFile("node", [runner, "exec", "--cwd", "/tmp", "--", "pwd"]))
      .rejects.toMatchObject({ code: 2 });
  });
});
