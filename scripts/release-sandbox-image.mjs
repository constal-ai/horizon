#!/usr/bin/env node
// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const dockerfileUrl = new URL("sandbox/Dockerfile", root);
const runnerUrl = new URL("sandbox/constal-workspace-runner.mjs", root);
const packageUrl = new URL("package.json", root);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status ?? "unknown"}`);
  return String(result.stdout ?? "").trim();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }

const dockerfile = await readFile(dockerfileUrl, "utf8");
const runner = await readFile(runnerUrl, "utf8");
const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
const base = dockerfile.match(/^ARG BASE_IMAGE=(\S+@sha256:[a-f0-9]{64})$/mu)?.[1] ?? null;
if (!base) throw new Error("Horizon Sandbox Dockerfile does not pin an immutable base image digest");
const sandboxApiBase = dockerfile.match(/^ARG BLAXEL_SANDBOX_API_IMAGE=(\S+@sha256:[a-f0-9]{64})$/mu)?.[1] ?? null;
if (!sandboxApiBase) throw new Error("Horizon Sandbox Dockerfile does not pin the Blaxel sandbox API image digest");
if (!runner.startsWith("#!/usr/bin/env node\n") || !runner.includes('const PROTOCOL = "constal.workspace-runner";')) {
  throw new Error("Horizon workspace runner source is invalid");
}

const publish = argument("--publish");
const build = argument("--build");
if (publish && build) throw new Error("Choose either --build or --publish");
if ((publish !== null && !publish) || (build !== null && !build)) throw new Error("Image reference is missing");

const source = run("git", ["rev-parse", "HEAD"], { capture: true });
if (publish) {
  if (!publish.includes(":")) throw new Error("Published image requires an immutable release tag");
  const state = run("git", ["status", "--porcelain"], { capture: true });
  if (state) throw new Error("Refusing to publish a Sandbox image from a dirty worktree");
  run("docker", ["buildx", "build", "--platform", "linux/amd64", "--provenance=true", "--push", "--tag", publish, "sandbox"]);
  const inspection = run("docker", ["buildx", "imagetools", "inspect", publish], { capture: true });
  const remoteDigest = inspection.match(/^Digest:\s+(sha256:[a-f0-9]{64})$/mu)?.[1] ?? null;
  if (!remoteDigest) throw new Error("Published Sandbox image did not expose an immutable digest");
  process.stdout.write(`${JSON.stringify({ image: `${publish.split("@")[0]}@${remoteDigest}`, tag: publish,
    source, version: pkg.version, runnerSha256: digest(runner), base, sandboxApiBase }, null, 2)}\n`);
} else if (build) {
  run("docker", ["build", "--platform", "linux/amd64", "--tag", build, "sandbox"]);
  run("docker", ["run", "--rm", "--platform", "linux/amd64",
    "--entrypoint", "/usr/local/bin/constal-workspace-runner", build, "probe"]);
  process.stdout.write(`${JSON.stringify({ image: build, source, version: pkg.version,
    runnerSha256: digest(runner), base, sandboxApiBase, verified: true }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ source, version: pkg.version,
    runnerSha256: digest(runner), base, sandboxApiBase, verified: true }, null, 2)}\n`);
}
