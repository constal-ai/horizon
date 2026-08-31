import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import agent from "../src/index.js";
import { HORIZON_EXECUTION_LOOP_TURNS, HORIZON_STANDARD_LOOP_TURNS } from "../src/limits.js";

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
}

describe("Horizon managed Agent package", () => {
  it("keeps package, manifest, and executable identity aligned", async () => {
    const [manifest, pkg] = await Promise.all([json("../constal.agent.json"), json("../package.json")]);
    expect({ id: manifest.id, version: manifest.version, mode: manifest.mode })
      .toEqual({ id: agent.id, version: agent.version, mode: agent.mode });
    expect(pkg.version).toBe(agent.version);
    expect(pkg.dependencies).toEqual({ "@constal/sdk": "2.0.0" });
  });

  it("declares every model-facing Tool and long-horizon subtask exactly once", async () => {
    const manifest = await json("../constal.agent.json");
    const tools = manifest.tools as string[];
    expect([...tools].sort()).toEqual(Object.keys(agent.tools ?? {}).sort());
    expect(new Set(tools).size).toBe(tools.length);
    expect(agent.subtasks?.map(({ id }) => id)).toEqual([
      "horizon-source-resolver", "horizon-discovery-framer", "horizon-investigator", "horizon-planner", "horizon-rubric", "horizon-design",
      "horizon-milestone-decomposition", "horizon-assertions", "horizon-plan-critique", "horizon-plan-finalizer",
      "horizon-executor", "horizon-verifier", "horizon-reconciler",
    ]);
    expect(agent.views?.map(({ id }) => id)).toEqual(["horizon-progress"]);
  });

  it("uses only existing platform catalog Resources and a long-horizon admission ceiling", async () => {
    const manifest = await json("../constal.agent.json");
    expect(manifest.bindings).toEqual({
      model: "crn:constal:production:platform:default:model/gpt-5.6-sol",
      sandbox: "crn:constal:production:platform:default:sandbox-pool/constal-code",
      cas: "crn:constal:production:platform:default:cas/constal",
      github: "crn:constal:production:platform:default:service/github",
      web: "crn:constal:production:platform:default:web/constal",
      search: "crn:constal:production:platform:default:service/constal-search",
    });
    expect(manifest.limits).toEqual({ maxRunMicroUsd: 500_000_000, maxTurns: 2_048 });
    expect({ standard: HORIZON_STANDARD_LOOP_TURNS, execution: HORIZON_EXECUTION_LOOP_TURNS })
      .toEqual({ standard: 500, execution: 1_000 });
  });
});
