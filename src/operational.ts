import type {
  ConstalApiChangePlan, ConstalApiChangeReceipt, Ctx,
} from "@constal/sdk";
import { HORIZON_OPERATIONAL_SYSTEM } from "./prompts/operational.js";
import { runReactLoop } from "./react-loop.js";
import { availableTools, OPERATIONAL_TOOL_NAMES } from "./tools/index.js";
import type { HorizonRoutedEvent } from "./behaviors.js";

export type HorizonOperationalAction =
  | { kind: "respond" }
  | { kind: "answer-work"; answer: string }
  | { kind: "steer-work"; text: string }
  | { kind: "start-work"; objective: string }
  | { kind: "pause-work"; run: string }
  | { kind: "resume-work"; run: string }
  | { kind: "cancel-work"; run: string }
  | { kind: "interrupt-work"; run: string; text: string; mode: "safe-point" | "abort" }
  | { kind: "restart-work"; run: string; checkpoint: string; text: string };

type HorizonControlOperation = "run.start" | "run.steer" | "run.wait.resolve" | "run.pause" | "run.resume"
  | "run.cancel" | "run.interrupt" | "run.branch";

export interface HorizonOperationalResult {
  object: "constal.horizon.operational-result";
  version: 1;
  status: "complete" | "needs-input" | "blocked";
  message: string;
  action: HorizonOperationalAction;
  evidence: string[];
  control?: { operation: HorizonControlOperation; plan: string; receipt: string; state: string };
}

interface ApiObjectRef {
  kind: string; id: string; crn: string | null; hash: string | null; namespace: string | null; version: string | null;
}
interface ApiQueryResult { object: "constal.api.query"; items: Array<Record<string, unknown>>; next: string | null; evidence: unknown }
interface ApiGetResult { object: "constal.api.object"; ref: ApiObjectRef; value: unknown; evidence: unknown; next?: string | null }
type WorkControlReceipt = NonNullable<HorizonOperationalResult["control"]>;

interface GitHubThreadContext {
  owner: string;
  repository: string;
  issue: number;
  foregroundSession: string;
  workSession: string;
}

interface SupervisionSnapshot {
  object: "constal.horizon.supervision";
  version: 1;
  thread: GitHubThreadContext;
  issue: unknown;
  comments: unknown;
  runs: ApiQueryResult | { error: string };
  currentRun: ApiGetResult | null | { error: string };
  rootRun: ApiGetResult | null | { error: string };
  waits: ApiQueryResult | { error: string };
  activity: { state: "idle" | "running" | "waiting-user" | "failed" | "complete" | "transitioning";
    runId: string | null; phase: string | null; detail: string };
}

export const HORIZON_PROCESS = `Issue work follows one causal Run tree: ingress accepts the request; source preparation pins the repository and workspace; discovery frames unknowns; investigators resolve them; planning produces a rubric, design, ordered work, assertions, and critique; the user approves the immutable plan; execution handles one work unit at a time; independent verification and reconciliation decide whether to continue, replan, ask, or stop; successful work is packaged and published. Child Runs are specialist phases. A suspended parent waiting on a child is still running. Commits in the Run journal are the durable facts available for branching.`;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function operationalContext(value: unknown): unknown {
  const source = record(value);
  if (!source) return value ?? null;
  const { approval: _approval, ...context } = source;
  return context;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 2_048);
}

function threadContext(value: unknown): GitHubThreadContext | null {
  const source = record(value); const sessions = record(source?.sessions);
  const repository = typeof source?.repository === "string" ? source.repository : "";
  const [owner, name, extra] = repository.split("/");
  const issue = Number(source?.issue);
  const foregroundSession = typeof sessions?.foreground === "string" ? sessions.foreground : "";
  const workSession = typeof sessions?.work === "string" ? sessions.work : "";
  if (!owner || !name || extra !== undefined || !Number.isSafeInteger(issue) || issue < 1
    || !foregroundSession.endsWith("-front") || !workSession.endsWith("-work")
    || foregroundSession.slice(0, -6) !== workSession.slice(0, -5)
    || foregroundSession.length > 256 || workSession.length > 256) return null;
  return { owner, repository: name, issue, foregroundSession, workSession };
}

function objectRef(value: unknown): ApiObjectRef | null {
  const source = record(value);
  if (!source || typeof source.kind !== "string" || typeof source.id !== "string") return null;
  return { kind: source.kind, id: source.id,
    crn: typeof source.crn === "string" ? source.crn as never : null,
    hash: typeof source.hash === "string" ? source.hash as never : null,
    namespace: typeof source.namespace === "string" ? source.namespace : null,
    version: typeof source.version === "string" ? source.version : null };
}

function runFields(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.fields) ?? {};
}

function runId(value: Record<string, unknown>): string | null {
  const fields = runFields(value);
  return typeof fields.id === "string" ? fields.id : null;
}

function parentRunId(value: Record<string, unknown>): string | null {
  const parent = runFields(value).parent_run;
  return typeof parent === "string" && parent ? parent : null;
}

function runStatus(value: Record<string, unknown>): string {
  return String(value.state ?? runFields(value).status ?? "unknown");
}

function activeRunItems(value: ApiQueryResult | { error: string }): Record<string, unknown>[] {
  return queryItems(value).filter((item) => ["queued", "leased", "suspended"].includes(runStatus(item)));
}

function activeLeaf(value: ApiQueryResult | { error: string }): Record<string, unknown> | null {
  const active = activeRunItems(value);
  const parents = new Set(active.map(parentRunId).filter((id): id is string => id !== null));
  return active.find((item) => {
    const id = runId(item);
    return id !== null && !parents.has(id);
  }) ?? active[0] ?? null;
}

function rootRun(value: ApiQueryResult | { error: string }, leaf: Record<string, unknown> | null): Record<string, unknown> | null {
  const items = queryItems(value); const byId = new Map(items.flatMap((item) => {
    const id = runId(item); return id ? [[id, item] as const] : [];
  }));
  let current = leaf; const seen = new Set<string>();
  while (current) {
    const id = runId(current); const parent = parentRunId(current);
    if (!id || seen.has(id) || !parent) return current;
    seen.add(id); current = byId.get(parent) ?? null;
  }
  return null;
}

async function observed<T>(read: () => Promise<T>): Promise<T | { error: string }> {
  try { return await read(); }
  catch (error) { return { error: boundedError(error) }; }
}

async function supervisionSnapshot(event: HorizonRoutedEvent, ctx: Ctx): Promise<SupervisionSnapshot | null> {
  const thread = threadContext(event.context);
  if (!thread || !ctx.resources.github || !ctx.resources.api) return null;
  const issue = await observed(() => ctx.invoke(ctx.resources.github!, "issue.get",
    { owner: thread.owner, repository: thread.repository, issue: thread.issue }));
  const comments = await observed(() => ctx.invoke(ctx.resources.github!, "issue.comments.list",
    { owner: thread.owner, repository: thread.repository, issue: thread.issue, page: 1, perPage: 100 }));
  const runs = await observed(() => ctx.invoke<ApiQueryResult>(ctx.resources.api!, "query", {
    kind: "run", scope: { kind: "namespace", namespace: ctx.run.namespace },
    filter: { op: "eq", field: "session_id", value: thread.workSession },
    order: [{ field: "updated_at", direction: "descending" }], limit: 100,
    fields: ["id", "status", "scheduler", "agent_id", "session_id", "parent_run", "created_at", "updated_at",
      "duration_ms", "elapsed_ms", "total_micro_usd", "turns_used", "max_turns"],
  }));
  const runItems = "items" in runs && Array.isArray(runs.items) ? runs.items.flatMap((item) => record(item) ? [record(item)!] : []) : [];
  const latestItem = activeLeaf(runs) ?? runItems[0] ?? null;
  const rootItem = rootRun(runs, latestItem);
  const latest = objectRef(latestItem);
  const root = objectRef(rootItem);
  const currentRun = latest ? await observed(() => ctx.invoke<ApiGetResult>(ctx.resources.api!, "get",
    { ref: latest, page: { limit: 500 } })) : null;
  const rootDetail = root ? latest?.id === root.id ? currentRun : await observed(() => ctx.invoke<ApiGetResult>(ctx.resources.api!, "get",
    { ref: root, page: { limit: 500 } })) : null;
  const waits = await observed(() => ctx.invoke<ApiQueryResult>(ctx.resources.api!, "query", {
    kind: "wait", scope: { kind: "namespace", namespace: ctx.run.namespace },
    filter: { op: "and", filters: [{ op: "eq", field: "agent", value: "horizon" },
      { op: "eq", field: "session", value: thread.workSession }] }, limit: 200,
  }));
  return { object: "constal.horizon.supervision", version: 1, thread, issue, comments, runs, currentRun, rootRun: rootDetail, waits,
    activity: workActivity(currentRun, waits) };
}

function workActivity(current: ApiGetResult | null | { error: string }, waits: ApiQueryResult | { error: string }): SupervisionSnapshot["activity"] {
  const exact = current && "value" in current ? record(current.value) : null;
  const value = record(exact?.run) ?? exact;
  const runId = typeof value?.runId === "string" ? value.runId : null;
  const status = typeof value?.status === "string" ? value.status : null;
  const task = record(value?.task); const phase = typeof task?.id === "string" ? task.id : runId ? "horizon" : null;
  const open = queryItems(waits); const userWait = open.find((item) => {
    const fields = record(item.fields); return fields?.waitKind === "await" || fields?.kind === "await";
  });
  if (userWait) return { state: "waiting-user", runId, phase,
    detail: "The work Run is waiting for an authenticated answer to one presented decision." };
  if (!current) return { state: "idle", runId: null, phase: null, detail: "No work Run has been observed for this issue." };
  if ("error" in current) return { state: "transitioning", runId: null, phase: null,
    detail: `Exact work state is temporarily unavailable: ${current.error}` };
  if (status === "failed") return { state: "failed", runId, phase, detail: String(value?.error ?? "The work Run failed.") };
  if (status === "complete" || status === "stopped") return { state: "complete", runId, phase,
    detail: status === "complete" ? "The work Run completed." : "The work Run stopped." };
  if (status === "queued" || status === "leased") return { state: "running", runId, phase,
    detail: status === "leased" ? "The current work component is executing." : "The current work component is queued to execute." };
  const awaiting = Array.isArray(value?.awaiting) ? value.awaiting.flatMap((item) => record(item) ? [record(item)!] : []) : [];
  if (status === "suspended" && awaiting.some((item) => item.kind === "spawn")) return { state: "running", runId, phase,
    detail: "The current work component yielded durably while one of its child agents executes." };
  return { state: "transitioning", runId, phase,
    detail: "The work Run yielded at a durable boundary and is not paused; no user decision is currently open." };
}

function action(value: unknown): HorizonOperationalAction | null {
  const source = record(value); const kind = source?.kind;
  if (!source) return null;
  if (kind === "respond" && Object.keys(source).length === 1) return { kind };
  if (kind === "answer-work" && typeof source.answer === "string" && source.answer.trim() && source.answer.length <= 65_536) {
    return { kind, answer: source.answer.trim() };
  }
  if (kind === "steer-work" && typeof source.text === "string" && source.text.trim() && source.text.length <= 32_768) {
    return { kind, text: source.text.trim() };
  }
  if (kind === "start-work" && typeof source.objective === "string" && source.objective.trim() && source.objective.length <= 65_536) {
    return { kind, objective: source.objective.trim() };
  }
  if ((kind === "pause-work" || kind === "resume-work" || kind === "cancel-work")
    && typeof source.run === "string" && source.run && source.run.length <= 256) {
    return { kind, run: source.run };
  }
  if (kind === "interrupt-work" && typeof source.run === "string" && source.run && source.run.length <= 256
    && typeof source.text === "string" && source.text.trim() && source.text.length <= 32_768
    && (source.mode === "safe-point" || source.mode === "abort")) {
    return { kind, run: source.run, text: source.text.trim(), mode: source.mode };
  }
  if (kind === "restart-work" && typeof source.run === "string" && source.run && source.run.length <= 256
    && typeof source.checkpoint === "string" && /^[a-f0-9]{64}$/u.test(source.checkpoint)
    && typeof source.text === "string" && source.text.trim() && source.text.length <= 32_768) {
    return { kind, run: source.run, checkpoint: source.checkpoint, text: source.text.trim() };
  }
  return null;
}

export function parseHorizonOperationalResult(value: unknown): HorizonOperationalResult | null {
  const source = record(value); const selected = action(source?.action);
  if (!source || source.object !== "constal.horizon.operational-result" || source.version !== 1
    || !["complete", "needs-input", "blocked"].includes(String(source.status)) || !selected
    || typeof source.message !== "string" || !source.message.trim() || source.message.length > 65_536
    || !Array.isArray(source.evidence) || source.evidence.length > 128
    || source.evidence.some((item) => typeof item !== "string" || !item.trim() || item.length > 8_192)) return null;
  return { object: "constal.horizon.operational-result", version: 1,
    status: source.status as HorizonOperationalResult["status"], message: source.message.trim(), action: selected,
    evidence: source.evidence.map(String) };
}

function queryItems(value: ApiQueryResult | { error: string }): Record<string, unknown>[] {
  return "items" in value && Array.isArray(value.items) ? value.items.flatMap((item) => {
    const source = record(item); return source ? [source] : [];
  }) : [];
}

function activeWork(snapshot: SupervisionSnapshot): boolean {
  return queryItems(snapshot.runs).some((item) => ["queued", "leased", "suspended"].includes(String(item.state))
    || ["queued", "leased", "suspended"].includes(String(record(item.fields)?.status)));
}

function conversationalWaits(snapshot: SupervisionSnapshot): Record<string, unknown>[] {
  return queryItems(snapshot.waits).filter((item) => {
    const fields = record(item.fields);
    return fields?.waitKind === "await" || fields?.kind === "await";
  });
}

async function applyWorkOperations(ctx: Ctx, operations: Array<{ id: string; operation: HorizonControlOperation;
  input: Record<string, unknown> }>, objective: string, eventId: string): Promise<WorkControlReceipt> {
  if (!ctx.resources.api) throw new TypeError("Horizon supervisor has no Constal API Resource");
  const plan = await ctx.invoke<ConstalApiChangePlan>(ctx.resources.api, "plan", {
    objective, operations,
  }, { dedupeKey: `horizon-supervisor-plan:${eventId}:${operations.map(({ operation }) => operation).join("+")}` });
  const receipt = await ctx.invokeAsync<ConstalApiChangeReceipt>(ctx.resources.api, "apply", {
    plan: { id: plan.id, hash: plan.hash }, eventId,
  }, { dedupeKey: `horizon-supervisor-apply:${eventId}:${plan.hash}` });
  return { operation: operations.at(-1)!.operation, plan: plan.hash, receipt: receipt.id, state: receipt.state };
}

function exactRun(snapshot: SupervisionSnapshot, id: string): Record<string, unknown> | null {
  return queryItems(snapshot.runs).find((item) => runId(item) === id) ?? null;
}

function detailRunId(value: ApiGetResult | null | { error: string }): string | null {
  if (!value || "error" in value) return null;
  const detail = record(value.value); const run = record(detail?.run) ?? detail;
  return typeof run?.runId === "string" ? run.runId : null;
}

function detailHasCheckpoint(value: ApiGetResult | null | { error: string }, checkpoint: string): boolean {
  if (!value || "error" in value) return false;
  const detail = record(value.value); const journal = record(detail?.journal);
  return Array.isArray(journal?.entries) && journal.entries.some((entry) => {
    const source = record(entry); const result = record(source?.value);
    return source?.kind === "commit" && result?.hash === checkpoint;
  });
}

async function executeAction(result: HorizonOperationalResult, event: HorizonRoutedEvent,
  snapshot: SupervisionSnapshot | null, ctx: Ctx): Promise<HorizonOperationalResult> {
  if (result.action.kind === "respond") return result;
  if (!snapshot) return { ...result, status: "blocked", action: { kind: "respond" },
    message: "I cannot locate the durable work session for this conversation.",
    evidence: [...result.evidence, "The accepted event did not contain a valid foreground/work Session pair."] };
  const eventContext = record(event.context); const delivery = typeof eventContext?.delivery === "string" ? eventContext.delivery : ctx.run.id;
  const eventId = `horizon-supervisor-${delivery}`;
  try {
    let operations: Array<{ id: string; operation: HorizonControlOperation; input: Record<string, unknown> }>;
    if (result.action.kind === "answer-work") {
      const waits = conversationalWaits(snapshot);
      if (waits.length !== 1) return { ...result, status: "needs-input", action: { kind: "respond" },
        message: waits.length === 0 ? "There is no open work decision for me to answer right now."
          : "More than one work decision is open, so I need the specific question you are answering.",
        evidence: [...result.evidence, `Observed ${waits.length} open conversational work waits.`] };
      const fields = record(waits[0]!.fields); const promise = typeof fields?.promise === "string" ? fields.promise
        : String(waits[0]!.id ?? "").split("/").at(-1) ?? "";
      operations = [{ id: "answer", operation: "run.wait.resolve", input: {
        namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession, promise,
        value: { ...event, objective: result.action.answer },
      } }];
    } else if (result.action.kind === "steer-work") {
      operations = [{ id: "steer", operation: "run.steer", input: {
        namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession, text: result.action.text,
        data: { source: "github", issue: snapshot.thread.issue, foregroundRun: ctx.run.id },
      } }];
    } else if (result.action.kind === "start-work") {
      operations = activeWork(snapshot) ? [{ id: "steer", operation: "run.steer", input: {
        namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession, text: result.action.objective,
        data: { source: "github", issue: snapshot.thread.issue, foregroundRun: ctx.run.id },
      } }] : [{ id: "start", operation: "run.start", input: {
        namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession,
        data: { ...event, behavior: "issue-work", objective: result.action.objective },
      } }];
    } else {
      const selected = exactRun(snapshot, result.action.run);
      if (!selected) return { ...result, status: "needs-input", action: { kind: "respond" },
        message: "I could not match that request to an exact Run in the current work tree.",
        evidence: [...result.evidence, `No observed work Run has id ${result.action.run}.`] };
      const base = { namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession,
        run: result.action.run };
      if (result.action.kind === "pause-work") operations = [{ id: "pause", operation: "run.pause", input: { ...base, request: {} } }];
      else if (result.action.kind === "resume-work") operations = [{ id: "resume", operation: "run.resume", input: { ...base, request: {} } }];
      else if (result.action.kind === "cancel-work") operations = [{ id: "cancel", operation: "run.cancel", input: { ...base, request: {} } }];
      else if (result.action.kind === "interrupt-work") operations = [{ id: "interrupt", operation: "run.interrupt", input: {
        ...base, request: { mode: result.action.mode, payload: { text: result.action.text,
          data: { source: "github", issue: snapshot.thread.issue, foregroundRun: ctx.run.id } } },
      } }];
      else {
        if (detailRunId(snapshot.rootRun) !== result.action.run || !detailHasCheckpoint(snapshot.rootRun, result.action.checkpoint)) {
          return { ...result, status: "needs-input", action: { kind: "respond" },
            message: "I could not match that description to an exact durable Fact on the root work Run.",
            evidence: [...result.evidence, `Checkpoint ${result.action.checkpoint} was not observed on Run ${result.action.run}.`] };
        }
        operations = [{ id: "restart", operation: "run.branch", input: { ...base, request: {
          at: result.action.checkpoint, text: result.action.text, data: {
            object: "constal.horizon.restart", version: 1, checkpoint: result.action.checkpoint,
            source: event.source ?? null, issue: snapshot.thread.issue, foregroundRun: ctx.run.id,
          },
        } } }];
      }
    }
    const control = await applyWorkOperations(ctx, operations,
      `Apply the authenticated GitHub conversation decision to Horizon work for issue #${snapshot.thread.issue}.`, eventId);
    return { ...result, control };
  } catch (error) {
    return { ...result, status: "blocked", action: { kind: "respond" },
      message: `I understood the request, but could not apply it to the durable work session: ${boundedError(error)}`,
      evidence: [...result.evidence, "The governed work-session ChangePlan or application did not succeed."] };
  }
}

export async function runHorizonOperational(event: HorizonRoutedEvent, ctx: Ctx): Promise<HorizonOperationalResult> {
  const snapshot = await supervisionSnapshot(event, ctx);
  const tools = availableTools(OPERATIONAL_TOOL_NAMES, ctx);
  const loop = await runReactLoop({
    role: "operational", system: HORIZON_OPERATIONAL_SYSTEM, objective: event.objective,
    context: { process: HORIZON_PROCESS, eventClass: event.eventClass, context: operationalContext(event.context), constraints: event.constraints ?? [],
      supervision: snapshot },
    tools, model: "model", maxRounds: 64, parse: parseHorizonOperationalResult,
  }, ctx);
  const result = await executeAction(loop.artifact, event, snapshot, ctx);
  await ctx.commit({ kind: "horizon.operational-result", eventClass: event.eventClass,
    result, supervision: snapshot, toolEvidence: loop.evidence }, { tier: "audit" });
  return result;
}
