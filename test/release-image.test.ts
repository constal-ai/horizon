import { execFile as callbackExecFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(callbackExecFile);

describe("Horizon Sandbox image release", () => {
  it("preflights an immutable base and exact runner source without publishing", async () => {
    const result = await execFile("node", [new URL("../scripts/release-sandbox-image.mjs", import.meta.url).pathname]);
    const value = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(value).toMatchObject({ version: "0.6.4", verified: true });
    expect(value.base).toMatch(/^docker\.io\/library\/node:24-bookworm-slim@sha256:[a-f0-9]{64}$/u);
    expect(value.sandboxApiBase).toMatch(/^ghcr\.io\/blaxel-ai\/sandbox@sha256:[a-f0-9]{64}$/u);
    expect(value.runnerSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(value.source).toMatch(/^[a-f0-9]{40}$/u);
  });
});
