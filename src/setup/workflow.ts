// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  setupAwait, setupScreen, setupSubmission,
  type ConstalApiChangePlan, type ConstalApiChangeReceipt, type Ctx, type SetupScreen, type SetupSubmission,
} from "@constal/sdk";
import { HORIZON_BEHAVIOR_CATALOG } from "../behaviors.js";
import { HORIZON_GITHUB_EVENT_CATALOG, HORIZON_GITHUB_MENTIONS } from "../github-events.js";
import { applicationError, applicationFailureSummary, rethrowRuntimeControl } from "../runtime-control.js";

const WORKFLOW = { id: "horizon-github", version: "1", targetAgent: "horizon" } as const;
const PROVIDER = "crn:constal:production:platform:default:credential-provider/github-platform-app";
const STEP_IDS = ["introduction", "github", "repositories", "routing", "approval", "review", "complete"] as const;
const STEP_LABELS = ["Introduction", "Connect GitHub", "Repositories", "Events & behavior", "Approval", "Review", "Complete"] as const;

interface ConnectionReceipt {
  credential: { crn: string; hash: string };
  installationId: number;
  accountLogin: string;
  repositories: string[];
}

interface SetupConfiguration {
  connection: ConnectionReceipt;
  repositories: string[];
  events: string[];
  routes: Record<string, string>;
  mentions: string[];
  label: string;
  approverPermissions: string[];
  semanticApproval: true;
}

interface SetupPackage {
  channel: { deploymentRevision: string };
  authProvider: { deploymentRevision: string };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function setupPackage(value: unknown): SetupPackage {
  const start = record(value); const input = record(start?.input); const packageValue = record(input?.package);
  const channel = record(packageValue?.channel); const authProvider = record(packageValue?.authProvider);
  const revision = (candidate: Record<string, unknown> | null) => typeof candidate?.deploymentRevision === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(candidate.deploymentRevision)
    ? candidate.deploymentRevision : null;
  const channelRevision = revision(channel); const authRevision = revision(authProvider);
  if (start?.object !== "constal.setup.start" || start.version !== 1 || !channelRevision || !authRevision) {
    throw new TypeError("Horizon setup requires exact platform Channel package releases");
  }
  return { channel: { deploymentRevision: channelRevision }, authProvider: { deploymentRevision: authRevision } };
}

function steps(index: number, blocked = false): SetupScreen["steps"] {
  return STEP_IDS.map((id, ordinal) => ({ id, label: STEP_LABELS[ordinal]!,
    status: ordinal < index ? "complete" as const : ordinal === index ? blocked ? "blocked" as const : "current" as const : "pending" as const }));
}

async function present(input: Omit<SetupScreen, "object" | "version" | "workflow">, ctx: Ctx): Promise<SetupSubmission> {
  const screen = setupScreen({ object: "constal.setup.screen", version: 1, workflow: WORKFLOW, ...input });
  await ctx.commit(screen, { tier: "audit" });
  const response = await ctx.await<SetupSubmission>(screen.waitLabel!, setupAwait(screen));
  return setupSubmission(response, screen);
}

function connectionReceipt(value: unknown): ConnectionReceipt {
  const source = record(value); const credential = record(source?.credential);
  if (!source || !credential || typeof credential.crn !== "string" || !credential.crn.includes(":credential/")
    || typeof credential.hash !== "string" || !/^[a-f0-9]{64}$/u.test(credential.hash)
    || !Number.isSafeInteger(source.installationId) || Number(source.installationId) < 1
    || typeof source.accountLogin !== "string" || !source.accountLogin
    || !Array.isArray(source.repositories) || source.repositories.length > 500
    || source.repositories.some((item) => typeof item !== "string" || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(item))) {
    throw new TypeError("GitHub Credential interaction returned an invalid non-secret receipt");
  }
  return { credential: { crn: credential.crn, hash: credential.hash }, installationId: Number(source.installationId),
    accountLogin: source.accountLogin, repositories: [...new Set(source.repositories as string[])].sort() };
}

function strings(value: unknown, allowed: readonly string[], maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum
    || value.some((item) => typeof item !== "string" || !allowed.includes(item))) throw new TypeError("Setup selection is invalid");
  return [...new Set(value as string[])];
}

function routing(value: unknown): Pick<SetupConfiguration, "events" | "routes" | "mentions" | "label"> {
  const source = record(value); const routes = record(source?.routes);
  const mentions = source?.mentions;
  const eventIds = HORIZON_GITHUB_EVENT_CATALOG.events.map(({ id }) => id);
  const events = strings(source?.events, eventIds, eventIds.length);
  if (!source || !routes || !Array.isArray(mentions)
    || mentions.length !== HORIZON_GITHUB_MENTIONS.length
    || HORIZON_GITHUB_MENTIONS.some((mention) => !mentions.includes(mention))
    || typeof source.label !== "string" || source.label.length > 64) throw new TypeError("Horizon event routing is invalid");
  const normalized: Record<string, string> = {};
  for (const event of events) {
    const declaration = HORIZON_GITHUB_EVENT_CATALOG.events.find(({ id }) => id === event)!;
    if (typeof routes[event] !== "string" || !(declaration.behaviors as readonly string[]).includes(routes[event] as string)) {
      throw new TypeError(`Horizon behavior is incompatible with ${event}`);
    }
    normalized[event] = routes[event] as string;
  }
  return { events, routes: normalized, mentions: [...HORIZON_GITHUB_MENTIONS], label: source.label };
}

async function terminal(kind: "complete" | "blocked", revision: number, title: string, summary: string,
  details: Array<{ label: string; value: string }>, ctx: Ctx): Promise<SetupScreen> {
  const screen = setupScreen({ object: "constal.setup.screen", version: 1, workflow: WORKFLOW, revision,
    status: kind, title: "Set up Horizon", description: "GitHub issue automation for Horizon.",
    steps: steps(kind === "complete" ? STEP_IDS.length - 1 : Math.min(revision - 1, STEP_IDS.length - 1), kind === "blocked"),
    current: { kind, id: kind === "complete" ? "complete" : "review", title, description: "", actions: [], summary, details },
    waitLabel: null });
  await ctx.commit(screen, { tier: "audit" });
  return screen;
}

async function runHorizonSetupInternal(message: unknown, ctx: Ctx): Promise<SetupScreen> {
  const channelPackage = setupPackage(message);
  let revision = 1;
  let response = await present({ revision, status: "active", title: "Set up Horizon", description: "Install Horizon into GitHub and choose how repository events are handled.",
    steps: steps(0), waitLabel: `horizon-setup-introduction-${revision}`,
    current: { kind: "review", id: "introduction", title: "Horizon for GitHub",
      description: "Horizon can investigate issues, converse in issue comments, require approval, implement an approved plan, and publish a pull request.",
      sections: [{ id: "authority", title: "What this configures", rows: [
        { label: "Repository access", value: "Only repositories selected in GitHub" },
        { label: "Mutation", value: "Only after approval of an exact issue-work plan" },
        { label: "Other events", value: "Handled by Horizon's lightweight operational mode" },
      ] }], actions: [{ id: "continue", label: "Continue", intent: "primary" },
        { id: "cancel", label: "Cancel", intent: "secondary" }] },
  }, ctx);
  if (response.action === "cancel") return terminal("blocked", revision + 1, "Setup cancelled", "No configuration was changed.", [], ctx);

  revision++;
  response = await present({ revision, status: "active", title: "Set up Horizon", description: "Connect the organization installation used by Horizon.",
    steps: steps(1), waitLabel: `horizon-setup-github-${revision}`,
    current: { kind: "credential-interaction", id: "github", title: "Connect GitHub",
      description: "Install or reauthorize the Constal GitHub App. GitHub controls organization and repository access.",
      provider: PROVIDER, credentialId: "horizon-github", operation: "connect",
      actions: [{ id: "connect", label: "Connect GitHub", intent: "primary" },
        { id: "cancel", label: "Cancel", intent: "secondary" }] },
  }, ctx);
  if (response.action === "cancel") return terminal("blocked", revision + 1, "Setup cancelled", "No configuration was changed.", [], ctx);
  const connection = connectionReceipt(response.values);

  revision++;
  response = await present({ revision, status: "active", title: "Set up Horizon", description: "Choose which granted repositories Horizon may operate.",
    steps: steps(2), waitLabel: `horizon-setup-repositories-${revision}`,
    current: { kind: "form", id: "repositories", title: "Choose repositories",
      description: `Repositories available from ${connection.accountLogin}.`,
      schema: { type: "object", additionalProperties: false, required: ["repositories"], properties: {
        repositories: { type: "array", minItems: 1, maxItems: 500, uniqueItems: true,
          items: { enum: connection.repositories } },
      } }, initialValues: { repositories: connection.repositories },
      actions: [{ id: "continue", label: "Continue", intent: "primary" },
        { id: "cancel", label: "Cancel", intent: "secondary" }] },
  }, ctx);
  if (response.action === "cancel") return terminal("blocked", revision + 1, "Setup cancelled", "No configuration was changed.", [], ctx);
  const repositories = strings(response.values?.repositories, connection.repositories, 500);

  revision++;
  const routeProperties = Object.fromEntries(HORIZON_GITHUB_EVENT_CATALOG.events.map((event) => [event.id, {
    type: "string", enum: [...event.behaviors], title: event.title, description: event.description,
  }]));
  const defaultRoutes = Object.fromEntries(HORIZON_GITHUB_EVENT_CATALOG.events.map(({ id, defaultBehavior }) => [id, defaultBehavior]));
  response = await present({ revision, status: "active", title: "Set up Horizon", description: "Map GitHub events to behavior advertised by this Horizon release.",
    steps: steps(3), waitLabel: `horizon-setup-routing-${revision}`,
    current: { kind: "form", id: "routing", title: "Events and behavior",
      description: "Issue activation uses the durable planning and approved execution pipeline. Routine interactions default to the lightweight operational agent.",
      schema: { type: "object", additionalProperties: false, required: ["events", "routes", "mentions", "label"], properties: {
        events: { type: "array", minItems: 1, uniqueItems: true,
          items: { enum: HORIZON_GITHUB_EVENT_CATALOG.events.map(({ id }) => id) } },
        routes: { type: "object", additionalProperties: false,
          required: HORIZON_GITHUB_EVENT_CATALOG.events.map(({ id }) => id), properties: routeProperties },
        mentions: { type: "array", const: [...HORIZON_GITHUB_MENTIONS] },
        label: { type: "string", maxLength: 64, description: "Optional issue label that activates Horizon." },
      } }, initialValues: { events: HORIZON_GITHUB_EVENT_CATALOG.events.map(({ id }) => id),
        routes: defaultRoutes, mentions: [...HORIZON_GITHUB_MENTIONS], label: "horizon" },
      actions: [{ id: "continue", label: "Continue", intent: "primary" },
        { id: "cancel", label: "Cancel", intent: "secondary" }] },
  }, ctx);
  if (response.action === "cancel") return terminal("blocked", revision + 1, "Setup cancelled", "No configuration was changed.", [], ctx);
  const selectedRouting = routing(response.values);

  revision++;
  response = await present({ revision, status: "active", title: "Set up Horizon", description: "Choose who may approve issue-work plans.",
    steps: steps(4), waitLabel: `horizon-setup-approval-${revision}`,
    current: { kind: "form", id: "approval", title: "Plan approval",
      description: "Natural-language replies are interpreted semantically, then authorization and the exact plan revision are checked separately.",
      schema: { type: "object", additionalProperties: false,
        required: ["approverPermissions", "semanticApproval", "requireApproval"], properties: {
          approverPermissions: { type: "array", minItems: 1, uniqueItems: true,
            items: { enum: ["write", "maintain", "admin"] } },
          semanticApproval: { const: true }, requireApproval: { const: true },
        } }, initialValues: { approverPermissions: ["write", "maintain", "admin"], semanticApproval: true, requireApproval: true },
      actions: [{ id: "continue", label: "Review setup", intent: "primary" },
        { id: "cancel", label: "Cancel", intent: "secondary" }] },
  }, ctx);
  if (response.action === "cancel") return terminal("blocked", revision + 1, "Setup cancelled", "No configuration was changed.", [], ctx);
  const approverPermissions = strings(response.values?.approverPermissions, ["write", "maintain", "admin"], 3);
  const configuration: SetupConfiguration = { connection, repositories, ...selectedRouting,
    approverPermissions, semanticApproval: true };
  const { connection: _connection, ...channelConfiguration } = configuration;

  let plan: ConstalApiChangePlan;
  try {
    plan = await ctx.invoke<ConstalApiChangePlan>(ctx.resources.api!, "plan", {
      objective: "Install or update Horizon for GitHub using the reviewed repository, event-routing, and approval configuration.",
      operations: [{ id: "install-channel", operation: "channel.install", input: {
        namespace: ctx.run.namespace, package: channelPackage, id: "horizon-github", configuration: channelConfiguration,
        target: { resourceKind: "agent", selector: { matchLabels: { "channels.constal.ai/horizon-github": "enabled" } } },
        scopedBindings: [{ key: "github-user", subject: `github:${connection.installationId}`, target: connection.credential }],
        ingressRoutes: [{ provider: "github", key: `installation:${connection.installationId}` }],
      } }],
    }, { dedupeKey: `horizon-setup-plan:${ctx.run.session}:${revision}` });
  } catch (error) {
    rethrowRuntimeControl(error);
    return terminal("blocked", revision + 1, "Setup plan unavailable",
      error instanceof Error ? error.message : "The platform could not create the Horizon setup plan.", [], ctx);
  }
  await ctx.commit({ kind: "horizon.setup-plan", plan }, { tier: "audit" });

  revision++;
  response = await present({ revision, status: "active", title: "Set up Horizon", description: "Confirm the exact immutable ChangePlan.",
    steps: steps(5), waitLabel: `horizon-setup-review-${revision}`,
    current: { kind: "review", id: "review", title: "Review and install", description: "Only this exact plan hash can be applied.",
      sections: [{ id: "github", title: "GitHub", rows: [
        { label: "Organization", value: connection.accountLogin }, { label: "Repositories", value: repositories.join(", ") },
        { label: "Credential", value: connection.credential.crn },
      ] }, { id: "behavior", title: "Events and behavior", rows: selectedRouting.events.map((event) => ({
        label: HORIZON_GITHUB_EVENT_CATALOG.events.find(({ id }) => id === event)?.title ?? event,
        value: selectedRouting.routes[event] ?? "operate",
      })) }, { id: "authority", title: "Authority", rows: [
        { label: "Approvers", value: approverPermissions.join(", ") },
        { label: "Plan", value: plan.hash },
      ] }], actions: [{ id: "apply", label: "Install Horizon", intent: "primary" },
        { id: "cancel", label: "Cancel", intent: "secondary" }] },
  }, ctx);
  if (response.action === "cancel") return terminal("blocked", revision + 1, "Setup cancelled", "The reviewed ChangePlan was not applied.", [], ctx);

  let receipt: ConstalApiChangeReceipt;
  try {
    receipt = await ctx.invokeAsync<ConstalApiChangeReceipt>(ctx.resources.api!, "apply", {
      plan: { id: plan.id, hash: plan.hash }, eventId: `horizon-setup-${plan.hash.slice(0, 32)}`,
    }, { dedupeKey: `horizon-setup-apply:${plan.hash}` });
  } catch (error) {
    rethrowRuntimeControl(error);
    return terminal("blocked", revision + 1, "Installation needs attention",
      error instanceof Error ? error.message : "The Horizon ChangePlan could not be applied.", [{ label: "Plan", value: plan.hash }], ctx);
  }
  await ctx.commit({ kind: "horizon.setup-receipt", receipt }, { tier: "audit" });
  if (receipt.state !== "succeeded") return terminal("blocked", revision + 1, "Installation needs attention",
    `The ChangePlan finished in state ${receipt.state}.`, [{ label: "Plan", value: plan.hash }, { label: "Receipt", value: receipt.id }], ctx);
  return terminal("complete", revision + 1, "Horizon is installed",
    "GitHub events now route through the reviewed Horizon configuration.", [
      { label: "Organization", value: connection.accountLogin }, { label: "Repositories", value: repositories.join(", ") },
      { label: "Mentions", value: selectedRouting.mentions.join(", ") }, { label: "Plan", value: plan.hash },
    ], ctx);
}

export async function runHorizonSetup(message: unknown, ctx: Ctx): Promise<SetupScreen> {
  try { return await runHorizonSetupInternal(message, ctx); }
  catch (error) {
    rethrowRuntimeControl(error);
    const detail = applicationError(error);
    return terminal("blocked", 1, "Setup needs attention",
      `${applicationFailureSummary("setup", error)} No setup change was reported as complete.`,
      [{ label: "Failure", value: detail.name }], ctx);
  }
}
