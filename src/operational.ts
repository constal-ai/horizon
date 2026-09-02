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
  | { kind: "start-work"; objective: string };

export interface HorizonOperationalResult {
  object: "constal.horizon.operational-result";
  version: 1;
  status: "complete" | "needs-input" | "blocked";
  message: string;
  action: HorizonOperationalAction;
  evidence: string[];
  control?: { operation: "run.start" | "run.steer" | "run.wait.resolve"; plan: string; receipt: string; state: string };
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
  waits: ApiQueryResult | { error: string };
}

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
  const latest = "items" in runs && Array.isArray(runs.items) ? objectRef(runs.items[0]) : null;
  const currentRun = latest ? await observed(() => ctx.invoke<ApiGetResult>(ctx.resources.api!, "get",
    { ref: latest, page: { limit: 200 } })) : null;
  const waits = await observed(() => ctx.invoke<ApiQueryResult>(ctx.resources.api!, "query", {
    kind: "wait", scope: { kind: "namespace", namespace: ctx.run.namespace },
    filter: { op: "and", filters: [{ op: "eq", field: "agent", value: "horizon" },
      { op: "eq", field: "session", value: thread.workSession }] }, limit: 200,
  }));
  return { object: "constal.horizon.supervision", version: 1, thread, issue, comments, runs, currentRun, waits };
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

async function applyWorkOperation(ctx: Ctx, operation: "run.start" | "run.steer" | "run.wait.resolve",
  input: Record<string, unknown>, objective: string, eventId: string): Promise<WorkControlReceipt> {
  if (!ctx.resources.api) throw new TypeError("Horizon supervisor has no Constal API Resource");
  const plan = await ctx.invoke<ConstalApiChangePlan>(ctx.resources.api, "plan", {
    objective, operations: [{ id: "work", operation, input }],
  }, { dedupeKey: `horizon-supervisor-plan:${eventId}:${operation}` });
  const receipt = await ctx.invokeAsync<ConstalApiChangeReceipt>(ctx.resources.api, "apply", {
    plan: { id: plan.id, hash: plan.hash }, eventId,
  }, { dedupeKey: `horizon-supervisor-apply:${eventId}:${plan.hash}` });
  return { operation, plan: plan.hash, receipt: receipt.id, state: receipt.state };
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
    let operation: "run.start" | "run.steer" | "run.wait.resolve";
    let input: Record<string, unknown>;
    if (result.action.kind === "answer-work") {
      const waits = conversationalWaits(snapshot);
      if (waits.length !== 1) return { ...result, status: "needs-input", action: { kind: "respond" },
        message: waits.length === 0 ? "There is no open work decision for me to answer right now."
          : "More than one work decision is open, so I need the specific question you are answering.",
        evidence: [...result.evidence, `Observed ${waits.length} open conversational work waits.`] };
      const fields = record(waits[0]!.fields); const promise = typeof fields?.promise === "string" ? fields.promise
        : String(waits[0]!.id ?? "").split("/").at(-1) ?? "";
      operation = "run.wait.resolve";
      input = { namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession, promise,
        value: { ...event, objective: result.action.answer } };
    } else if (result.action.kind === "steer-work" || activeWork(snapshot)) {
      operation = "run.steer";
      const text = result.action.kind === "steer-work" ? result.action.text : result.action.objective;
      input = { namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession, text,
        data: { source: "github", issue: snapshot.thread.issue, foregroundRun: ctx.run.id } };
    } else {
      operation = "run.start";
      input = { namespace: ctx.run.namespace, agent: "horizon", session: snapshot.thread.workSession,
        data: { ...event, behavior: "issue-work", objective: result.action.objective } };
    }
    const control = await applyWorkOperation(ctx, operation, input,
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
    context: { eventClass: event.eventClass, context: operationalContext(event.context), constraints: event.constraints ?? [],
      supervision: snapshot },
    tools, model: "model", maxRounds: 64, parse: parseHorizonOperationalResult,
  }, ctx);
  const result = await executeAction(loop.artifact, event, snapshot, ctx);
  await ctx.commit({ kind: "horizon.operational-result", eventClass: event.eventClass,
    result, supervision: snapshot, toolEvidence: loop.evidence }, { tier: "audit" });
  return result;
}
