import { opTool, type Tool } from "@constal/sdk";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function compact(value: unknown, depth = 0): unknown {
  if (depth >= 4) return "[nested value omitted]";
  if (typeof value === "string") return value.length <= 1_024 ? value : `${value.slice(0, 1_024)}…`;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(-8).map((item) => compact(item, depth + 1));
  const source = record(value);
  if (!source) return String(value);
  return Object.fromEntries(Object.entries(source).slice(0, 20)
    .map(([key, item]) => [key, compact(item, depth + 1)]));
}

function selected(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => source[field] === undefined ? [] : [[field, compact(source[field])]]));
}

function previewBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function platformGetPreview(value: unknown): unknown {
  const source = record(value); const detail = record(source?.value); const run = record(detail?.run);
  if (!source || !detail || !run) return compact(value);
  const evidence = record(source.evidence); const journal = record(detail.journal); const workflow = record(detail.workflow);
  const journalEntries = Array.isArray(journal?.entries) ? journal.entries.flatMap((item) => record(item) ? [record(item)!] : []) : [];
  const relevantJournal = [...new Map([...journalEntries.filter((item) => item.status === "failed" || item.error !== undefined).slice(-6),
    ...journalEntries.slice(-3)].map((item) => [String(item.pos ?? item.seq ?? ""), item])).values()];
  const workflowNodes = Array.isArray(workflow?.nodes) ? workflow.nodes.flatMap((item) => record(item) ? [record(item)!] : []) : [];
  const relevantNodes = [...new Map([...workflowNodes.filter((item) => ["failed", "blocked"].includes(String(item.status))).slice(-6),
    ...workflowNodes.slice(-3)].map((item) => [String(item.id ?? ""), item])).values()];
  const invocations = Array.isArray(detail.resourceInvocations)
    ? detail.resourceInvocations.flatMap((item) => record(item) ? [record(item)!] : []) : [];
  const failedInvocations = invocations.filter((item) => item.lastError !== null && item.lastError !== undefined
    || item.terminalStatus === "failed").slice(-6);
  const preview = {
    object: source.object ?? null,
    ref: compact(source.ref),
    next: typeof source.next === "string" ? source.next : null,
    evidence: evidence ? selected(evidence, ["source", "complete", "warnings", "observedAt"]) : null,
    value: {
      run: selected(run, ["runId", "session", "status", "scheduler", "statusDetail", "createdAt", "updatedAt",
        "error", "result", "fact", "budget", "limits", "task", "parent", "awaiting"]),
      lineage: compact(detail.lineage),
      workflow: workflow ? {
        ...selected(workflow, ["currentNodeId", "startedAt", "endedAt", "truncated"]),
        nodes: relevantNodes.map((item) => selected(item,
          ["id", "kind", "label", "status", "summary", "detail", "parent", "startedAt", "endedAt"])),
      } : null,
      journal: journal ? {
        ...selected(journal, ["head", "after", "before", "hasOlder", "hasNewer"]),
        entries: relevantJournal.map((item) => selected(item,
          ["seq", "pos", "kind", "status", "at", "error", "operation", "value", "valueRef"])),
      } : null,
      resourceInvocations: failedInvocations.map((item) => selected(item,
        ["id", "position", "operation", "phase", "terminalStatus", "lastDisposition", "lastError", "recoveryWork"])),
    },
  };
  if (previewBytes(preview) <= 16_384) return preview;
  const essential = {
    object: preview.object, ref: preview.ref, next: preview.next, evidence: preview.evidence,
    value: { run: selected(run, ["runId", "session", "status", "scheduler", "statusDetail", "createdAt", "updatedAt",
      "error", "fact", "budget", "limits", "task", "parent", "awaiting"]), lineage: compact(detail.lineage) },
  };
  if (previewBytes(essential) <= 16_384) return essential;
  return { object: preview.object, ref: preview.ref, next: preview.next,
    value: { run: selected(run, ["runId", "status", "scheduler", "createdAt", "updatedAt", "error", "fact"]) } };
}

const tools = [
  opTool("api", "query", { name: "platform_query",
    description: "Query authorized Constal objects when the supplied supervision snapshot does not contain enough exact state. Preserve evidence completeness and pagination warnings." }),
  opTool("api", "get", { name: "platform_get",
    description: "Read one exact authorized Constal object. For a Run, request a small bounded journal page and follow pagination only when the user's question requires older evidence.",
    preview: platformGetPreview }),
];

export const PLATFORM_TOOLS: Record<string, Tool> = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
