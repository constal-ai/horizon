#!/usr/bin/env node
// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tenant = required("CONSTAL_TENANT_ID");
const platformBase = (process.env.CONSTAL_PLATFORM_URL ?? "https://platform.constal.ai").replace(/\/$/u, "");
const authBase = (process.env.CONSTAL_AUTH_URL ?? "https://auth.constal.ai").replace(/\/$/u, "");
const adminToken = await secretFile(process.env.CONSTAL_AUTH_ADMIN_TOKEN_FILE ?? "../.constal-secrets/AUTH_ADMIN_TOKEN");
const temporary = await mkdtemp(join(tmpdir(), "constal-horizon-components-"));
let issued = null;

try {
  issued = await issueKey(`horizon-components-${randomUUID().slice(0, 8)}`);
  const deployments = [];
  for (const component of [
    { directory: "github-auth-provider", manifest: "constal.auth-provider.json", id: "horizon-github-auth" },
    { directory: "github-channel", manifest: "constal.channel.json", id: "horizon-github-channel" },
  ]) {
    const staging = join(temporary, component.directory); const archivePath = `${staging}.tar.gz`;
    await cp("src", join(staging, "src"), { recursive: true });
    await copyFile(join(component.directory, component.manifest), join(staging, component.manifest));
    const manifest = JSON.parse(await readFile(join(staging, component.manifest), "utf8"));
    await writeFile(join(staging, "package.json"), `${JSON.stringify({ name: `@constal/horizon-${component.directory}`,
      version: manifest.version, private: true, type: "module", dependencies: { "@constal/sdk": "2.5.0" } }, null, 2)}\n`);
    execFileSync("tar", ["-czf", archivePath, "-C", staging, "."], { stdio: "pipe" });
    const archive = await readFile(archivePath); const archiveHash = createHash("sha256").update(archive).digest("hex");
    let deployment = (await request("/v1/deployments", { method: "POST", headers: {
      "content-type": "application/gzip", "idempotency-key": `${component.id}-${archiveHash.slice(0, 48)}`,
    }, body: archive })).data;
    const deadline = Date.now() + 10 * 60_000;
    while (deployment?.status !== "deployed" && Date.now() < deadline) {
      if (deployment?.status === "failed") throw new Error(`${component.id} deployment failed: ${deployment.error}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      deployment = (await request(`/v1/deployments/${encodeURIComponent(String(deployment?.deploymentRevision ?? ""))}`)).data;
    }
    if (deployment?.status !== "deployed") throw new Error(`${component.id} deployment did not finish within 10 minutes`);
    deployments.push({ component: component.id, deploymentRevision: deployment.deploymentRevision,
      resourceCrn: deployment.resourceCrn, resourceHash: deployment.resourceHash });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, deployments }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (issued) await fetch(`${authBase}/internal/api-keys/${encodeURIComponent(issued.id)}/revoke`, { method: "POST", headers: {
    authorization: `Bearer ${adminToken}`, "content-type": "application/json",
  }, body: JSON.stringify({ tenant_id: tenant }) }).catch(() => undefined);
}

async function request(path, init = {}) {
  const response = await fetch(`${platformBase}${path}`, { ...init, headers: {
    authorization: `Bearer ${issued.key}`, "x-constal-tenant": tenant, "x-constal-namespace": "default", ...(init.headers ?? {}),
  } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)?.slice(0, 2_000)}`);
  return body;
}

async function issueKey(name) {
  const response = await fetch(`${authBase}/internal/api-keys/create`, { method: "POST", headers: {
    authorization: `Bearer ${adminToken}`, "content-type": "application/json",
  }, body: JSON.stringify({ tenant_id: tenant, name,
    scopes: ["deployment:create", "deployment:read", "resource:read"], expires_in: 1_800 }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.key !== "string" || typeof body?.id !== "string") throw new Error("could not create Horizon component deploy key");
  return body;
}

async function secretFile(path) { const value = (await readFile(path, "utf8")).trim(); if (!value) throw new Error(`${path} is empty`); return value; }
function required(name) { const value = String(process.env[name] ?? "").trim(); if (!value) throw new Error(`${name} is required`); return value; }
