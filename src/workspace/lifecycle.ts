import {
  canonicalJson, hashValue,
  type Ctx, type Sandbox, type SandboxCommandResult, type SandboxImage, type SandboxPool, type SpawnAttenuation,
} from "@constal/sdk";
import { storeArtifact } from "../artifacts.js";
import { rethrowRuntimeControl } from "../runtime-control.js";
import {
  type HzEnvironmentCommand, type HzRequest, type HzResolvedSource, type HzSourceInput,
  type HzWorkspaceAnchor, type HzWorkspaceCheckpoint, type HzWorkspaceReceipt, type HzWorkspaceState,
} from "../contracts.js";
import { HORIZON_LOOP_MICRO_USD, HORIZON_LOOP_WALL_MS, HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";
import { sourceResolver } from "../tasks/source.js";
import { availableTools, bindingsForTools, SOURCE_RESOLVER_TOOL_NAMES } from "../tools/index.js";
import { HORIZON_RUNNER_PATH, HORIZON_WORKSPACE_ROOT,
  WORKSPACE_RUNNER_PROTOCOL, WORKSPACE_RUNNER_SOURCE, WORKSPACE_RUNNER_VERSION } from "./runner-source.js";

export { HORIZON_RUNNER_PATH, HORIZON_WORKSPACE_ROOT } from "./runner-source.js";
const RECEIPT_PATH = "/workspace/.constal/workspace-ready.json";
const SOURCE_ARCHIVE_PATH = "/workspace/.constal/source.tar.gz";
const TIMEOUT_MS = 600_000;

export class WorkspacePreparationError extends Error {
  constructor(message: string) { super(message); this.name = "WorkspacePreparationError"; }
}

export interface PreparedWorkspace {
  receipt: HzWorkspaceReceipt;
  receiptRef: string;
}

interface GitHubArchiveResult { ref: string; bytes: number; format: "tar.gz"; source: string }

function attenuation(names: readonly string[], ctx: Pick<Ctx, "resources">): SpawnAttenuation {
  return { bindings: bindingsForTools(names, ctx), tools: [...names].sort() };
}

function succeeded(result: SandboxCommandResult): boolean {
  return result.status === "completed" && result.exitCode === 0;
}

async function rawCommand(selected: Sandbox, cmd: string, args: string[], cwd = "/workspace",
  options: { stdin?: string; outputs?: string[]; timeoutMs?: number } = {}): Promise<SandboxCommandResult> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return Promise.resolve(selected.exec({ cmd, args, cwd, timeoutMs,
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    ...(options.outputs === undefined ? {} : { outputs: options.outputs }) }, { timeoutMs }));
}

export async function workspaceCommand(selected: Sandbox, cmd: string, args: string[], cwd: string = HORIZON_WORKSPACE_ROOT,
  options: { stdin?: string; outputs?: string[]; timeoutMs?: number } = {}): Promise<SandboxCommandResult> {
  return rawCommand(selected, "node", [HORIZON_RUNNER_PATH, "exec", "--cwd", cwd, "--", cmd, ...args], "/workspace", options);
}

export async function archiveWorkspace(selected: Sandbox, output: string): Promise<SandboxCommandResult> {
  return rawCommand(selected, "node", [HORIZON_RUNNER_PATH, "archive", HORIZON_WORKSPACE_ROOT, output], "/workspace",
    { outputs: [output], timeoutMs: TIMEOUT_MS });
}

async function requireCommand(selected: Sandbox, cmd: string, args: string[], cwd: string = HORIZON_WORKSPACE_ROOT,
  options: { stdin?: string; outputs?: string[]; timeoutMs?: number } = {}): Promise<SandboxCommandResult> {
  const result = await workspaceCommand(selected, cmd, args, cwd, options);
  if (!succeeded(result)) throw new WorkspacePreparationError(`${cmd} failed (${result.status}, exit ${result.exitCode ?? "unknown"})`);
  return result;
}

function imageHandle(ctx: Ctx, pool: SandboxPool, id: string, cacheKey: string): SandboxImage {
  return { id, pool, cacheKey,
    delete: async (opts) => { await ctx.invoke(pool.resource, "deleteImage", { image: id }, opts); } } as SandboxImage;
}

async function resolveImage(ctx: Ctx, pool: SandboxPool, cacheKey: string): Promise<SandboxImage | null> {
  const result = await ctx.invoke<{ image: string | null }>(pool.resource, "resolveImage", { cacheKey });
  return result.image === null ? null : imageHandle(ctx, pool, result.image, cacheKey);
}

async function publishImage(ctx: Ctx, selected: Sandbox, cacheKey: string): Promise<SandboxImage | null> {
  try {
    const result = await ctx.invoke<{ image: string }>(selected.pool.resource, "createImage",
      { sandbox: selected.id, cacheKey }, { dedupeKey: `horizon-image:${cacheKey}`, timeoutMs: TIMEOUT_MS });
    return imageHandle(ctx, selected.pool, result.image, cacheKey);
  } catch (error) {
    rethrowRuntimeControl(error);
    await ctx.commit({ kind: "horizon.workspace-cache-unavailable", cacheKey,
      reason: error instanceof Error ? error.message : "The Sandbox provider does not support prepared images." }, { tier: "audit" });
    return null;
  }
}

async function installRunner(ctx: Ctx, selected: Sandbox): Promise<string> {
  const digest = await hashValue(WORKSPACE_RUNNER_SOURCE);
  const stored = await ctx.invoke<{ ref: string; bytes: number }>(ctx.resources.cas!, "putText", { text: WORKSPACE_RUNNER_SOURCE });
  await Promise.resolve(selected.putFile(HORIZON_RUNNER_PATH, stored.ref, { mode: 0o555, invoke: { timeoutMs: TIMEOUT_MS } }));
  const probe = await rawCommand(selected, "node", [HORIZON_RUNNER_PATH, "probe"]);
  if (!succeeded(probe)) throw new WorkspacePreparationError("The Constal workspace runner did not start in the selected Sandbox Pool image.");
  let value: unknown;
  try { value = JSON.parse(probe.stdoutPreview.trim()); } catch { throw new WorkspacePreparationError("The Constal workspace runner returned an invalid probe."); }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (record?.protocol !== WORKSPACE_RUNNER_PROTOCOL || record.version !== WORKSPACE_RUNNER_VERSION || record.root !== "/workspace") {
    throw new WorkspacePreparationError("The selected Sandbox Pool image does not implement the required workspace runner protocol.");
  }
  return digest;
}

function githubSource(input: HzSourceInput): input is Extract<HzSourceInput, { kind: "github" }> {
  return input.kind === "github";
}

async function resolveRequestedSource(request: HzRequest, ctx: Ctx): Promise<HzSourceInput> {
  if (request.source) {
    if (githubSource(request.source)) {
      await ctx.invoke(ctx.resources.github!, "repository.get",
        { owner: request.source.owner, repository: request.source.repository });
    }
    return request.source;
  }
  const tools = availableTools(SOURCE_RESOLVER_TOOL_NAMES, ctx);
  if (!ctx.resources.github || tools.length === 0) {
    throw new WorkspacePreparationError("Horizon requires an explicit artifact source or an authenticated GitHub binding.");
  }
  let answer: string | null = null;
  for (let attempt = 1; ; attempt++) {
    const resolved = await ctx.spawn(sourceResolver, { request, answer, tools }, {
      retries: 1, dedupe: "specHash", budget: { turns: HORIZON_STANDARD_LOOP_TURNS,
        microUsd: HORIZON_LOOP_MICRO_USD, wallMs: HORIZON_LOOP_WALL_MS }, attenuation: attenuation(tools, ctx),
    });
    await ctx.commit({ kind: "horizon.source-resolution", attempt,
      resolution: resolved.resolution, toolEvidence: resolved.toolEvidence }, { tier: "audit" });
    if (resolved.resolution.status === "ready" && resolved.resolution.source) return resolved.resolution.source;
    const response = await ctx.await<{ answer: string }>("horizon-source", {
      schema: { type: "object", required: ["answer"], additionalProperties: false,
        properties: { answer: { type: "string", minLength: 1, maxLength: 65_536 } } }, maxBytes: 65_536, afterRun: "ignore",
    });
    answer = response.answer.trim();
    if (!answer) throw new WorkspacePreparationError("Repository source resolution received an empty answer.");
  }
}

async function materializeSource(request: HzRequest, ctx: Ctx): Promise<HzResolvedSource> {
  const selected = await resolveRequestedSource(request, ctx);
  if (selected.kind === "artifact") {
    const adopted = await ctx.invoke<{ ref: string; created: boolean; bytes: number }>(ctx.resources.cas!, "importArtifact", { ref: selected.ref });
    return { kind: "artifact", archive: { ref: adopted.ref, bytes: adopted.bytes, format: "tar.gz" }, github: null };
  }
  const archive = await ctx.invoke<GitHubArchiveResult>(ctx.resources.github!, "repository.archive", {
    owner: selected.owner, repository: selected.repository, ref: selected.ref,
  }, { dedupeKey: `horizon-source:${await hashValue(selected)}` });
  if (archive.format !== "tar.gz" || !archive.ref || !Number.isSafeInteger(archive.bytes) || archive.bytes < 1) {
    throw new WorkspacePreparationError("GitHub returned an invalid immutable repository archive.");
  }
  const adopted = await ctx.invoke<{ ref: string; created: boolean; bytes: number }>(ctx.resources.cas!, "importArtifact", { ref: archive.ref });
  return { kind: "github", archive: { ref: adopted.ref, bytes: adopted.bytes, format: "tar.gz" },
    github: { owner: selected.owner, repository: selected.repository, requestedRef: selected.ref, sourceUrl: archive.source ?? null } };
}

function parseInspection(result: SandboxCommandResult): { commit: string; tree: string; status: string } {
  if (!succeeded(result)) throw new WorkspacePreparationError("Workspace inspection failed after preparation.");
  let value: unknown;
  try { value = JSON.parse(result.stdoutPreview.trim()); } catch { throw new WorkspacePreparationError("Workspace inspection returned invalid JSON."); }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!source || source.protocol !== WORKSPACE_RUNNER_PROTOCOL || source.version !== WORKSPACE_RUNNER_VERSION
    || typeof source.commit !== "string" || typeof source.tree !== "string" || typeof source.status !== "string") {
    throw new WorkspacePreparationError("Workspace inspection did not return the required identity.");
  }
  return { commit: source.commit, tree: source.tree, status: source.status };
}

async function inspectWorkspace(selected: Sandbox): Promise<{ commit: string; tree: string; status: string }> {
  return parseInspection(await rawCommand(selected, "node", [HORIZON_RUNNER_PATH, "inspect", HORIZON_WORKSPACE_ROOT]));
}

export async function inspectWorkspaceState(ctx: Ctx): Promise<HzWorkspaceState> {
  const selected = await ctx.sandboxPool(ctx.resources.sandbox!).createSandbox(ctx.run.agent.crn, ctx.run.session);
  const inspection = await inspectWorkspace(selected);
  return { tree: inspection.tree, status: inspection.status };
}

export async function restoreWorkspaceAnchor(anchor: HzWorkspaceAnchor, reason: string,
  ctx: Ctx): Promise<HzWorkspaceState> {
  if (!anchor.image) throw new WorkspacePreparationError("The selected verified workspace point has no restorable image.");
  const pool = ctx.sandboxPool(ctx.resources.sandbox!);
  const image = imageHandle(ctx, pool, anchor.image, anchor.cacheKey);
  const selected = await pool.createSandbox(ctx.run.agent.crn, ctx.run.session, { image }, {
    dedupeKey: `horizon-restore:${await hashValue({ anchor: anchor.receipt, image: anchor.image, reason })}`,
    timeoutMs: TIMEOUT_MS,
  });
  const inspection = await inspectWorkspace(selected);
  if (inspection.tree !== anchor.tree || inspection.status !== anchor.status) {
    throw new WorkspacePreparationError("The restored workspace does not match its verified checkpoint receipt.");
  }
  const state = { tree: inspection.tree, status: inspection.status };
  await ctx.commit({ kind: "horizon.workspace-restored", reason, anchor, state }, { tier: "audit" });
  return state;
}

async function workspaceExists(selected: Sandbox): Promise<boolean> {
  return succeeded(await workspaceCommand(selected, "test", ["-e", HORIZON_WORKSPACE_ROOT], "/workspace"));
}

function normalizedSetupCommand(command: HzEnvironmentCommand): HzEnvironmentCommand {
  const value = command.cwd.startsWith("/") ? command.cwd : `${HORIZON_WORKSPACE_ROOT}/${command.cwd}`;
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop(); else segments.push(segment);
  }
  const cwd = `/${segments.join("/")}`;
  if (cwd !== HORIZON_WORKSPACE_ROOT && !cwd.startsWith(`${HORIZON_WORKSPACE_ROOT}/`)) {
    throw new WorkspacePreparationError("A Horizon environment setup command is outside /workspace/repo.");
  }
  return { ...command, cwd };
}

async function initializeWorkspace(ctx: Ctx, selected: Sandbox, source: HzResolvedSource,
  request: HzRequest, runnerDigest: string, cacheKey: string): Promise<HzWorkspaceReceipt> {
  if (await workspaceExists(selected)) {
    throw new WorkspacePreparationError("The Session workspace exists without a matching prepared-image receipt.");
  }
  await requireCommand(selected, "mkdir", ["-p", "/workspace/.constal", HORIZON_WORKSPACE_ROOT], "/workspace");
  await Promise.resolve(selected.putFile(SOURCE_ARCHIVE_PATH, source.archive.ref, { invoke: { timeoutMs: TIMEOUT_MS } }));
  await requireCommand(selected, "tar", ["-xzf", SOURCE_ARCHIVE_PATH, "-C", HORIZON_WORKSPACE_ROOT,
    "--strip-components=1", "--no-same-owner", "--no-same-permissions"], "/workspace");
  for (const input of request.environment.setup) {
    const command = normalizedSetupCommand(input);
    await requireCommand(selected, command.cmd, command.args, command.cwd, { timeoutMs: command.timeoutMs });
  }
  await requireCommand(selected, "rm", ["-rf", "--", `${HORIZON_WORKSPACE_ROOT}/.git`], HORIZON_WORKSPACE_ROOT);
  await requireCommand(selected, "git", ["init", "--initial-branch=constal-baseline"], HORIZON_WORKSPACE_ROOT);
  await requireCommand(selected, "git", ["add", "-A"], HORIZON_WORKSPACE_ROOT);
  await requireCommand(selected, "git", ["-c", "user.name=Constal Horizon", "-c", "user.email=horizon@constal.invalid",
    "commit", "--no-gpg-sign", "-m", "Constal immutable source baseline"], HORIZON_WORKSPACE_ROOT);
  const baseline = await inspectWorkspace(selected);
  if (baseline.status) throw new WorkspacePreparationError("Workspace preparation did not produce a clean immutable baseline.");
  const receipt: HzWorkspaceReceipt = {
    object: "constal.horizon.workspace-ready", version: 1, session: ctx.run.session, sandbox: selected.id,
    root: HORIZON_WORKSPACE_ROOT, cache: { key: cacheKey, hit: false, image: null },
    runner: { protocol: WORKSPACE_RUNNER_PROTOCOL, version: WORKSPACE_RUNNER_VERSION, digest: runnerDigest },
    source, baseline: { commit: baseline.commit, tree: baseline.tree }, setup: request.environment,
  };
  const stored = await ctx.invoke<{ ref: string }>(ctx.resources.cas!, "putText", { text: canonicalJson(receipt) });
  await Promise.resolve(selected.putFile(RECEIPT_PATH, stored.ref, { mode: 0o444, invoke: { timeoutMs: TIMEOUT_MS } }));
  return receipt;
}

async function resetSessionSandbox(ctx: Ctx, pool: SandboxPool, selected: Sandbox, cacheKey: string): Promise<Sandbox> {
  try { await selected.delete(); } catch (error) {
    rethrowRuntimeControl(error); /* The explicit reset below is authoritative for application failures. */
  }
  await ctx.invoke(pool.resource, "createSandbox", { agent: ctx.run.agent.crn, session: ctx.run.session, resetImage: true },
    { dedupeKey: `horizon-reset:${ctx.run.session}:${cacheKey}` });
  return pool.createSandbox(ctx.run.agent.crn, ctx.run.session);
}

async function readCachedReceipt(ctx: Ctx, selected: Sandbox, expectedCacheKey: string): Promise<HzWorkspaceReceipt> {
  const marker = await Promise.resolve(selected.getFile(RECEIPT_PATH, { timeoutMs: TIMEOUT_MS }));
  const loaded = await ctx.invoke<{ text: string }>(ctx.resources.cas!, "getText", { ref: marker.ref, maximumBytes: 1_048_576 });
  let value: unknown;
  try { value = JSON.parse(loaded.text); } catch { throw new WorkspacePreparationError("The prepared Sandbox image has an invalid workspace receipt."); }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<HzWorkspaceReceipt> : null;
  if (!source || source.object !== "constal.horizon.workspace-ready" || source.version !== 1
    || source.root !== HORIZON_WORKSPACE_ROOT || source.cache?.key !== expectedCacheKey
    || source.runner?.protocol !== WORKSPACE_RUNNER_PROTOCOL || source.runner.version !== WORKSPACE_RUNNER_VERSION
    || typeof source.baseline?.commit !== "string" || typeof source.baseline.tree !== "string") {
    throw new WorkspacePreparationError("The prepared Sandbox image does not match the requested Horizon environment.");
  }
  return source as HzWorkspaceReceipt;
}

export async function prepareWorkspace(request: HzRequest, ctx: Ctx): Promise<PreparedWorkspace> {
  if (!ctx.resources.sandbox || !ctx.resources.cas) throw new WorkspacePreparationError("Horizon requires Sandbox Pool and CAS bindings.");
  const source = await materializeSource(request, ctx);
  const runnerDigest = await hashValue(WORKSPACE_RUNNER_SOURCE);
  const cacheKey = await hashValue({ object: "constal.horizon.environment", version: 1,
    pool: ctx.resources.sandbox, runner: { protocol: WORKSPACE_RUNNER_PROTOCOL, version: WORKSPACE_RUNNER_VERSION, digest: runnerDigest },
    source, environment: request.environment });
  await ctx.commit({ kind: "horizon.source", source, environment: request.environment, cacheKey }, { tier: "audit" });
  const pool = ctx.sandboxPool(ctx.resources.sandbox);
  const cached = request.environment.cache ? await resolveImage(ctx, pool, cacheKey) : null;
  let selected = await pool.createSandbox(ctx.run.agent.crn, ctx.run.session, cached ? { image: cached } : undefined);
  let receipt: HzWorkspaceReceipt;
  let image: SandboxImage | null = cached;
  if (cached) {
    try {
      const verifiedRunnerDigest = await installRunner(ctx, selected);
      if (verifiedRunnerDigest !== runnerDigest) throw new WorkspacePreparationError("The installed workspace runner digest changed during preparation.");
      const persisted = await readCachedReceipt(ctx, selected, cacheKey);
      const inspection = await inspectWorkspace(selected);
      if (inspection.commit !== persisted.baseline.commit || inspection.tree !== persisted.baseline.tree || inspection.status) {
        throw new WorkspacePreparationError("The prepared Sandbox image failed baseline verification.");
      }
      receipt = { ...persisted, session: ctx.run.session, sandbox: selected.id,
        cache: { key: cacheKey, hit: true, image: cached.id } };
    } catch (error) {
      rethrowRuntimeControl(error);
      await ctx.commit({ kind: "horizon.workspace-cache-invalid", cacheKey, image: cached.id,
        reason: error instanceof Error ? error.message : "Prepared image verification failed." }, { tier: "audit" });
      try { await cached.delete(); } catch (deleteError) {
        rethrowRuntimeControl(deleteError); /* Driver deletion is idempotent and may already be reconciled. */
      }
      selected = await resetSessionSandbox(ctx, pool, selected, cacheKey);
      image = null;
      const verifiedRunnerDigest = await installRunner(ctx, selected);
      if (verifiedRunnerDigest !== runnerDigest) throw new WorkspacePreparationError("The installed workspace runner digest changed during recovery.");
      receipt = await initializeWorkspace(ctx, selected, source, request, runnerDigest, cacheKey);
      if (request.environment.cache) image = await publishImage(ctx, selected, cacheKey);
      receipt = { ...receipt, cache: { key: cacheKey, hit: false, image: image?.id ?? null } };
    }
  } else {
    const verifiedRunnerDigest = await installRunner(ctx, selected);
    if (verifiedRunnerDigest !== runnerDigest) throw new WorkspacePreparationError("The installed workspace runner digest changed during preparation.");
    if (await workspaceExists(selected)) {
      try {
        const persisted = await readCachedReceipt(ctx, selected, cacheKey);
        const inspection = await inspectWorkspace(selected);
        receipt = { ...persisted, session: ctx.run.session, sandbox: selected.id,
          cache: { key: cacheKey, hit: true, image: persisted.cache.image } };
        await ctx.commit({ kind: "horizon.workspace-session-reused", cacheKey, sandbox: selected.id,
          receipt: receipt.cache, inspection }, { tier: "audit" });
      } catch (error) {
        rethrowRuntimeControl(error);
        await ctx.commit({ kind: "horizon.workspace-session-invalid", cacheKey, sandbox: selected.id,
          reason: error instanceof Error ? error.message : "The live Session workspace receipt is invalid." }, { tier: "audit" });
        selected = await resetSessionSandbox(ctx, pool, selected, cacheKey);
        const recoveredRunnerDigest = await installRunner(ctx, selected);
        if (recoveredRunnerDigest !== runnerDigest) {
          throw new WorkspacePreparationError("The installed workspace runner digest changed during Session recovery.");
        }
        receipt = await initializeWorkspace(ctx, selected, source, request, runnerDigest, cacheKey);
      }
    } else {
      receipt = await initializeWorkspace(ctx, selected, source, request, runnerDigest, cacheKey);
    }
    if (!receipt.cache.hit) {
      if (request.environment.cache) image = await publishImage(ctx, selected, cacheKey);
      receipt = { ...receipt, cache: { key: cacheKey, hit: false, image: image?.id ?? null } };
    }
  }
  const stored = await storeArtifact(ctx, receipt);
  await ctx.commit({ kind: "horizon.workspace-ready", receipt, receiptRef: stored.ref }, { tier: "audit" });
  return { receipt, receiptRef: stored.ref };
}

export async function captureWorkspaceCheckpoint(input: {
  workspace: PreparedWorkspace;
  planFact: string;
  stepFact: string;
  verificationFact: string;
  stepId: string;
}, ctx: Ctx): Promise<{ checkpoint: HzWorkspaceCheckpoint; receiptRef: string }> {
  const pool = ctx.sandboxPool(ctx.resources.sandbox!);
  const selected = await pool.createSandbox(ctx.run.agent.crn, ctx.run.session);
  const inspection = await inspectWorkspace(selected);
  const cacheKey = await hashValue({ object: "constal.horizon.checkpoint", version: 1,
    workspace: input.workspace.receiptRef, planFact: input.planFact, stepFact: input.stepFact,
    verificationFact: input.verificationFact, stepId: input.stepId, tree: inspection.tree, status: inspection.status });
  const image = await publishImage(ctx, selected, cacheKey);
  const checkpoint: HzWorkspaceCheckpoint = {
    object: "constal.horizon.workspace-checkpoint", version: 1, workspaceReceipt: input.workspace.receiptRef,
    planFact: input.planFact, stepFact: input.stepFact, verificationFact: input.verificationFact,
    stepId: input.stepId, tree: inspection.tree, status: inspection.status, image: image?.id ?? null, cacheKey,
  };
  const stored = await storeArtifact(ctx, checkpoint);
  await ctx.commit({ kind: "horizon.workspace-checkpoint", checkpoint, receiptRef: stored.ref }, { tier: "audit" });
  return { checkpoint, receiptRef: stored.ref };
}
