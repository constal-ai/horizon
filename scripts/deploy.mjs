#!/usr/bin/env node
// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { targetManifest } from "./target-manifest.mjs";

const tenant = required("CONSTAL_TENANT_ID");
const platformBase = (process.env.CONSTAL_PLATFORM_URL ?? "https://platform.constal.ai").replace(/\/$/u, "");
const authBase = (process.env.CONSTAL_AUTH_URL ?? "https://auth.constal.ai").replace(/\/$/u, "");
const adminToken = await secretFile(process.env.CONSTAL_AUTH_ADMIN_TOKEN_FILE ?? "../.constal-secrets/AUTH_ADMIN_TOKEN");
const temporary = await mkdtemp(join(tmpdir(), "constal-horizon-deploy-"));
let issued = null;

try {
  issued = await issueKey(`horizon-deploy-${randomUUID().slice(0, 8)}`);
  process.stdout.write(`${JSON.stringify({ ok: true, ...await deploy() }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (issued) await fetch(`${authBase}/internal/api-keys/${encodeURIComponent(issued.id)}/revoke`, { method: "POST", headers: {
    authorization: `Bearer ${adminToken}`, "content-type": "application/json",
  }, body: JSON.stringify({ tenant_id: tenant }) }).catch(() => undefined);
}

async function deploy() {
  const projectPath = join(temporary, "project");
  const sourcePath = join(temporary, "horizon.tar");
  const archivePath = join(temporary, "horizon.tar.gz");
  await mkdir(projectPath);
  execFileSync("git", ["archive", "--format=tar", "HEAD", "-o", sourcePath], { stdio: "pipe" });
  execFileSync("tar", ["-xf", sourcePath, "-C", projectPath], { stdio: "pipe" });
  const manifestPath = join(projectPath, "constal.agent.json");
  const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const current = await request(`/v1/namespaces/${encodeURIComponent(sourceManifest.namespace)}/resources/${encodeURIComponent(sourceManifest.kind)}/${encodeURIComponent(sourceManifest.id)}`)
    .then((value) => value?.data ?? null, (error) => error?.status === 404 ? null : Promise.reject(error));
  await writeFile(manifestPath, `${JSON.stringify(targetManifest(sourceManifest, current), null, 2)}\n`);
  execFileSync("tar", ["-czf", archivePath, "-C", projectPath, "."], { stdio: "pipe" });
  const archive = await readFile(archivePath); const archiveHash = createHash("sha256").update(archive).digest("hex");
  let deployment = (await request("/v1/deployments", { method: "POST", headers: {
    "content-type": "application/gzip", "idempotency-key": `horizon-${archiveHash.slice(0, 56)}`,
  }, body: archive })).data;
  const deadline = Date.now() + 10 * 60_000;
  while (deployment?.status !== "deployed" && Date.now() < deadline) {
    if (deployment?.status === "failed") throw new Error(`Horizon deployment failed: ${deployment.error}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    deployment = (await request(`/v1/deployments/${encodeURIComponent(String(deployment?.deploymentRevision ?? ""))}`)).data;
  }
  if (deployment?.status !== "deployed") throw new Error("Horizon deployment did not finish within 10 minutes");
  return { deployment };
}

async function request(path, init = {}) {
  const response = await fetch(`${platformBase}${path}`, { ...init, headers: {
    authorization: `Bearer ${issued.key}`, "x-constal-tenant": tenant, "x-constal-namespace": "default", ...(init.headers ?? {}),
  } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(
    new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)?.slice(0, 2_000)}`),
    { status: response.status },
  );
  return body;
}

async function issueKey(name) {
  const response = await fetch(`${authBase}/internal/api-keys/create`, { method: "POST", headers: {
    authorization: `Bearer ${adminToken}`, "content-type": "application/json",
  }, body: JSON.stringify({ tenant_id: tenant, name,
    scopes: ["deployment:create", "deployment:read", "resource:read"], expires_in: 1_800 }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.key !== "string" || typeof body?.id !== "string") throw new Error("could not create Horizon deploy key");
  return body;
}

async function secretFile(path) { const value = (await readFile(path, "utf8")).trim(); if (!value) throw new Error(`${path} is empty`); return value; }
function required(name) { const value = String(process.env[name] ?? "").trim(); if (!value) throw new Error(`${name} is required`); return value; }
