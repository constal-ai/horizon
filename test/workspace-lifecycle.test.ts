import { readFile } from "node:fs/promises";
import type { Ctx, Fact, Handle, Sandbox, SandboxCommandResult, SandboxImage, SandboxPool } from "@constal/sdk";
import { describe, expect, it } from "vitest";
import type { HzRequest, HzWorkspaceReceipt } from "../src/contracts.js";
import { captureWorkspaceCheckpoint, prepareWorkspace } from "../src/workspace/lifecycle.js";
import { WORKSPACE_RUNNER_SOURCE } from "../src/workspace/runner-source.js";

function handle<T>(value: T): Handle<T> {
  const promise = Promise.resolve(value) as Promise<T> & Partial<Handle<T>>;
  Object.assign(promise, { id: "handle", resolved: true, seq: 1, outcome: null, result: value, error: undefined,
    cancel: async () => undefined });
  return promise as Handle<T>;
}

function command(status: "completed" | "failed" = "completed", stdoutPreview = "", outputs: unknown[] = []): SandboxCommandResult {
  return { commandId: "command", status, exitCode: status === "completed" ? 0 : 1, stdoutPreview,
    stdoutRef: null, stderrRef: null, outputs, sandbox: { id: "provider", generation: 1, fresh: false } } as SandboxCommandResult;
}

interface Snapshot { files: Map<string, string>; rootExists: boolean; commit: string; tree: string; status: string }

class FakeBackend {
  readonly cas = new Map<string, string>();
  readonly sandboxes = new Map<string, FakeSandbox>();
  readonly images = new Map<string, Snapshot>();
  readonly operations: Array<{ op: string; args: unknown }> = [];
  sequence = 0;
  snapshotsAvailable = true;
  current: FakeSandbox | null = null;

  readonly pool: SandboxPool = {
    resource: "crn:constal:production:platform:default:sandbox-pool/constal-code" as never,
    createImage: async () => { throw new Error("lifecycle publishes through the governed operation"); },
    createSandbox: async (agent, session, options) => {
      const existing = this.sandboxes.get(session);
      if (existing) return existing;
      const source = options?.image ? this.images.get(options.image.id) : undefined;
      const sandbox = new FakeSandbox(this, agent, session, source);
      this.sandboxes.set(session, sandbox); this.current = sandbox;
      return sandbox;
    },
  } as SandboxPool;

  context(session: string): Ctx {
    let facts = 0;
    return {
      resources: { sandbox: this.pool.resource, cas: "crn:constal:production:platform:default:cas/constal" as never },
      run: { id: `run-${session}`, session, tenant: "tenant", namespace: "default", identity: {},
        agent: { id: "horizon", version: "0.3.21", crn: "crn:constal:production:tenant:default:agent/horizon" }, mode: "script" },
      sandboxPool: () => this.pool,
      commit: async (artifact: unknown) => ({ hash: `fact-${++facts}`, artifact, artifactHash: `artifact-${facts}` }) as unknown as Fact<unknown>,
      invoke: async (_resource: unknown, op: string, args: Record<string, unknown>) => {
        this.operations.push({ op, args });
        if (op === "importArtifact") return { ref: args.ref, created: false, bytes: 256 };
        if (op === "putText") {
          const ref = `cas-${++this.sequence}`; this.cas.set(ref, String(args.text));
          return { ref, bytes: new TextEncoder().encode(String(args.text)).byteLength };
        }
        if (op === "getText") {
          const text = this.cas.get(String(args.ref)); if (text === undefined) throw new Error("missing CAS value");
          return { ref: args.ref, text, bytes: new TextEncoder().encode(text).byteLength };
        }
        if (op === "resolveImage") {
          const image = this.images.has(String(args.cacheKey)) ? `image-${String(args.cacheKey).slice(0, 12)}` : null;
          return { image };
        }
        if (op === "createImage") {
          if (!this.snapshotsAvailable) throw new Error("provider snapshots are unavailable");
          const cacheKey = String(args.cacheKey); const sandbox = [...this.sandboxes.values()].find(({ id }) => id === args.sandbox);
          if (!sandbox) throw new Error("missing source sandbox");
          const image = `image-${cacheKey.slice(0, 12)}`; const snapshot = sandbox.snapshot();
          this.images.set(cacheKey, snapshot); this.images.set(image, snapshot);
          return { image };
        }
        if (op === "deleteImage") {
          const snapshot = this.images.get(String(args.image));
          for (const [key, value] of this.images) if (value === snapshot) this.images.delete(key);
          return { ok: true };
        }
        if (op === "createSandbox" && args.resetImage === true) return { sandbox: `sandbox-${session}` };
        throw new Error(`unexpected operation ${op}`);
      },
    } as unknown as Ctx;
  }
}

class FakeSandbox implements Sandbox {
  readonly id: string;
  readonly files: Map<string, string>;
  rootExists: boolean;
  commit: string;
  tree: string;
  status: string;
  readonly setupCommands: string[] = [];
  constructor(readonly backend: FakeBackend, readonly agent: Sandbox["agent"], readonly session: string, source?: Snapshot) {
    this.id = `sandbox-${session}`; this.files = new Map(source?.files ?? []); this.rootExists = source?.rootExists ?? false;
    this.commit = source?.commit ?? "baseline-commit"; this.tree = source?.tree ?? "baseline-tree"; this.status = source?.status ?? "";
  }
  get pool(): SandboxPool { return this.backend.pool; }
  snapshot(): Snapshot { return { files: new Map(this.files), rootExists: this.rootExists,
    commit: this.commit, tree: this.tree, status: this.status }; }
  suspend(): Promise<void> { return Promise.resolve(); }
  resume(): Promise<void> { return Promise.resolve(); }
  delete(): Promise<void> { this.backend.sandboxes.delete(this.session); return Promise.resolve(); }
  exec(input: { args?: string[] }): Handle<SandboxCommandResult> {
    const args = input.args ?? [];
    if (args[1] === "probe") return handle(command("completed",
      JSON.stringify({ protocol: "constal.workspace-runner", version: 1, root: "/workspace" })));
    if (args[1] === "inspect") return handle(command("completed", JSON.stringify({
      protocol: "constal.workspace-runner", version: 1, root: "/workspace/repo",
      commit: this.commit, tree: this.tree, status: this.status,
    })));
    const separator = args.indexOf("--"); const argv = separator < 0 ? [] : args.slice(separator + 1);
    const [cmd, ...commandArgs] = argv;
    if (cmd === "test" && commandArgs[0] === "-e") return handle(command(this.rootExists ? "completed" : "failed"));
    if (cmd === "mkdir") { if (commandArgs.includes("/workspace/repo")) this.rootExists = true; return handle(command()); }
    if (cmd === "tar") { this.rootExists = true; return handle(command()); }
    if (cmd === "rm") return handle(command());
    if (cmd === "git") return handle(command());
    if (cmd) this.setupCommands.push([cmd, ...commandArgs].join(" "));
    return handle(command());
  }
  getFile(path: string): Handle<{ path: string; ref: never; bytes: number }> {
    const ref = this.files.get(path); if (!ref) throw new Error(`missing file ${path}`);
    return handle({ path, ref: ref as never, bytes: this.backend.cas.get(ref)?.length ?? 0 });
  }
  putFile(path: string, ref: never): Handle<{ ok: boolean }> { this.files.set(path, String(ref)); return handle({ ok: true }); }
  deleteFile(path: string): Handle<{ ok: boolean }> { this.files.delete(path); return handle({ ok: true }); }
}

const request: HzRequest = {
  objective: "Implement and verify the requested repository change.", context: null, constraints: [],
  source: { kind: "artifact", ref: "source-archive", format: "tar.gz" },
  environment: { name: "node", cache: true,
    setup: [{ cmd: "npm", args: ["install", "--ignore-scripts"], cwd: "/workspace/repo", timeoutMs: 600_000 }] },
};

describe("Horizon prepared Session workspaces", () => {
  it("keeps the bundled rollout runner byte-identical to the base-image runner", async () => {
    expect(WORKSPACE_RUNNER_SOURCE).toBe(await readFile(new URL("../sandbox/constal-workspace-runner.mjs", import.meta.url), "utf8"));
  });

  it("prepares once, publishes an immutable image, and forks it into a later Session", async () => {
    const backend = new FakeBackend();
    const first = await prepareWorkspace(request, backend.context("session-a"));
    expect(first.receipt.cache).toMatchObject({ hit: false, image: expect.stringMatching(/^image-/u) });
    expect(backend.sandboxes.get("session-a")?.setupCommands).toEqual(["npm install --ignore-scripts"]);
    expect(backend.images.has(first.receipt.cache.key)).toBe(true);

    const second = await prepareWorkspace(request, backend.context("session-b"));
    expect(second.receipt.cache).toEqual({ key: first.receipt.cache.key, hit: true, image: first.receipt.cache.image });
    expect(second.receipt.baseline).toEqual(first.receipt.baseline);
    expect(backend.sandboxes.get("session-b")?.setupCommands).toEqual([]);
    const secondCreateImage = backend.operations.filter(({ op }) => op === "createImage");
    expect(secondCreateImage).toHaveLength(1);
  });

  it("captures the actual post-step workspace tree as a provider snapshot", async () => {
    const backend = new FakeBackend(); const ctx = backend.context("session-a");
    const workspace = await prepareWorkspace(request, ctx);
    backend.sandboxes.get("session-a")!.tree = "changed-tree";
    backend.sandboxes.get("session-a")!.status = " M src/index.ts";
    const captured = await captureWorkspaceCheckpoint({ workspace, planFact: "plan", stepFact: "step",
      verificationFact: "verification", stepId: "implement" }, ctx);
    expect(captured.checkpoint).toMatchObject({ stepId: "implement", tree: "changed-tree", status: " M src/index.ts",
      image: expect.stringMatching(/^image-/u) });
    expect(backend.images.has(captured.checkpoint.cacheKey)).toBe(true);
  });

  it("continues with durable receipts when provider snapshots are unavailable", async () => {
    const backend = new FakeBackend(); backend.snapshotsAvailable = false; const ctx = backend.context("session-a");
    const workspace = await prepareWorkspace(request, ctx);
    expect(workspace.receipt.cache).toMatchObject({ hit: false, image: null });
    const captured = await captureWorkspaceCheckpoint({ workspace, planFact: "plan", stepFact: "step",
      verificationFact: "verification", stepId: "implement" }, ctx);
    expect(captured.checkpoint).toMatchObject({ image: null, tree: "baseline-tree" });
  });

  it("evicts an invalid provider snapshot and deterministically rebuilds from the base image", async () => {
    const backend = new FakeBackend();
    const first = await prepareWorkspace(request, backend.context("session-a"));
    const cached = backend.images.get(first.receipt.cache.key)!;
    cached.files.delete("/workspace/.constal/workspace-ready.json");

    const recovered = await prepareWorkspace(request, backend.context("session-b"));
    expect(recovered.receipt.cache).toMatchObject({ hit: false, image: expect.stringMatching(/^image-/u) });
    expect(backend.sandboxes.get("session-b")?.setupCommands).toEqual(["npm install --ignore-scripts"]);
    expect(backend.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "deleteImage" }),
      expect.objectContaining({ op: "createSandbox", args: expect.objectContaining({ resetImage: true }) }),
    ]));
  });
});
