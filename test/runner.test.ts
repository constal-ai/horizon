import { execFile as callbackExecFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    await writeFile(join(repository, "script.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(join(repository, "script.sh"), 0o755);
    await symlink("file.txt", join(repository, "link.txt"));
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

    const listed = JSON.parse((await execFile("node", [localRunner, "list", "--cwd", repository,
      "--maximum-entries", "200", "--"])).stdout) as { entries: Array<Record<string, unknown>>; truncated: boolean; next: string | null };
    expect(listed.truncated).toBe(false); expect(listed.next).toBeNull();
    expect(listed.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "file.txt", kind: "file", bytes: 8, permissions: "0644", gitMode: "100644",
        executable: false, tracked: true, status: "modified", modifiedAt: expect.any(Number) }),
      expect.objectContaining({ path: "script.sh", kind: "file", permissions: "0755", gitMode: "100755",
        executable: true, tracked: true, status: "clean" }),
      expect.objectContaining({ path: "link.txt", kind: "symlink", symlinkTarget: "file.txt", gitMode: "120000",
        tracked: true, status: "clean" }),
      expect.objectContaining({ path: "new.txt", kind: "file", tracked: false, status: "untracked" }),
    ]));
    const firstPage = JSON.parse((await execFile("node", [localRunner, "list", "--cwd", repository,
      "--maximum-entries", "2", "--"])).stdout) as { entries: Array<{ path: string }>; truncated: boolean; next: string };
    expect(firstPage).toMatchObject({ truncated: true, next: firstPage.entries[1]!.path });
    const secondPage = JSON.parse((await execFile("node", [localRunner, "list", "--cwd", repository,
      "--maximum-entries", "200", "--after", firstPage.next, "--"])).stdout) as { entries: Array<{ path: string }> };
    expect(secondPage.entries.every(({ path }) => path > firstPage.next)).toBe(true);
  });

  it("rejects command working directories outside its workspace root", async () => {
    await expect(execFile("node", [runner, "exec", "--cwd", "/tmp", "--", "pwd"]))
      .rejects.toMatchObject({ code: 2 });
  });
});
