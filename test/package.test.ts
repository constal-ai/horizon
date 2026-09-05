// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import agent from "../src/index.js";
import { HORIZON_EXECUTION_LOOP_TURNS, HORIZON_LOOP_MICRO_USD, HORIZON_STANDARD_LOOP_TURNS } from "../src/limits.js";

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
}

async function filesUnder(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter((entry) => ![".git", "node_modules", "dist", "coverage"].includes(entry.name))
    .map((entry) => entry.isDirectory() ? filesUnder(new URL(`${entry.name}/`, directory)) : [new URL(entry.name, directory)]))).flat();
}

describe("Horizon managed Agent package", () => {
  it("licenses the complete authored repository to Coresource AI under Apache-2.0", async () => {
    const root = new URL("../", import.meta.url);
    const [license, notice, readme, pkg, files] = await Promise.all([
      readFile(new URL("LICENSE", root), "utf8"), readFile(new URL("NOTICE", root), "utf8"),
      readFile(new URL("README.md", root), "utf8"), json("../package.json"), filesUnder(root),
    ]);
    expect(license).toContain("Apache License\n                           Version 2.0, January 2004");
    expect(notice).toContain("Copyright 2026 Coresource AI, Inc.");
    expect(readme).toContain("Licensed under the [Apache License, Version 2.0](LICENSE).");
    expect(pkg).toMatchObject({ license: "Apache-2.0", author: "Coresource AI, Inc." });
    const commentSafe = files.filter((file) => /(?:\.ts|\.mjs|\.md|\.toml|\/Dockerfile|\/\.gitignore)$/u.test(file.pathname));
    const missing = [];
    for (const file of commentSafe) {
      if (!(await readFile(file, "utf8")).includes("SPDX-License-Identifier: Apache-2.0")) missing.push(file.pathname);
    }
    expect(missing).toEqual([]);
  });

  it("keeps package, manifest, and executable identity aligned", async () => {
    const [manifest, pkg] = await Promise.all([json("../constal.agent.json"), json("../package.json")]);
    expect({ id: manifest.id, version: manifest.version, mode: manifest.mode })
      .toEqual({ id: agent.id, version: agent.version, mode: agent.mode });
    expect(pkg.version).toBe(agent.version);
    expect(pkg.dependencies).toEqual({ "@constal-ai/github": "2.0.5", "@constal/sdk": "2.5.0" });
    expect(manifest.labels).toEqual({ "channels.constal.ai/horizon-github": "enabled" });
  });

  it("explains issue creation without rendering a Quickstart action button", async () => {
    const guide = await readFile(new URL("../CONSTAL.md", import.meta.url), "utf8");
    expect(guide).toContain("@constal-ai Implement this feature:");
    expect(guide).not.toContain("constal:github-issue");
    expect(guide).not.toContain("github.com/constal-ai/horizon/issues/new");
  });

  it("declares every model-facing Tool and long-horizon subtask exactly once", async () => {
    const manifest = await json("../constal.agent.json");
    const tools = manifest.tools as string[];
    expect([...tools].sort()).toEqual(Object.keys(agent.tools ?? {}).sort());
    expect(new Set(tools).size).toBe(tools.length);
    expect(agent.subtasks?.map(({ id }) => id)).toEqual([
      "horizon-source-resolver", "horizon-discovery-framer", "horizon-investigator", "horizon-planner", "horizon-rubric", "horizon-design",
      "horizon-milestone-decomposition", "horizon-work-plan-repair", "horizon-assertions", "horizon-assertion-plan-repair",
      "horizon-plan-continuity", "horizon-plan-critique", "horizon-plan-finalizer",
      "horizon-executor", "horizon-verifier", "horizon-reconciler", "horizon-question-reconciliation",
      "horizon-approval-interpreter",
    ]);
    expect(agent.views?.map(({ id }) => id)).toEqual(["horizon-progress"]);
  });

  it("uses only existing platform catalog Resources and a long-horizon admission ceiling", async () => {
    const manifest = await json("../constal.agent.json");
    expect(manifest.bindings).toEqual({
      model: "crn:constal:production:platform:default:model/gpt-5.6-luna",
      sandbox: "crn:constal:production:platform:default:sandbox-pool/constal-code",
      cas: "crn:constal:production:platform:default:cas/constal",
      github: "crn:constal:production:platform:default:service/github-app",
      web: "crn:constal:production:platform:default:web/constal",
      search: "crn:constal:production:platform:default:service/constal-search",
      api: "crn:constal:production:platform:default:service/constal-api",
    });
    expect(manifest.limits).toEqual({ maxRunMicroUsd: 500_000_000, maxTurns: 2_048 });
    expect({ standard: HORIZON_STANDARD_LOOP_TURNS, execution: HORIZON_EXECUTION_LOOP_TURNS })
      .toEqual({ standard: 500, execution: 1_000 });
    expect(HORIZON_LOOP_MICRO_USD).toBe(20_000_000);
  });
});
