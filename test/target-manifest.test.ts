// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { targetManifest } from "../scripts/target-manifest.mjs";

describe("portable deployment manifests", () => {
  it("keeps tenant promotion state out of every checked-in manifest", async () => {
    for (const path of ["constal.agent.json", "github-auth-provider/constal.auth-provider.json", "github-channel/constal.channel.json"]) {
      const manifest = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
      expect(manifest.expectedCurrentDeploymentRevision, path).toBeNull();
    }
  });

  it("targets a fresh tenant without a promotion base", () => {
    expect(targetManifest({ id: "horizon", expectedCurrentDeploymentRevision: "foreign" }, null))
      .toMatchObject({ id: "horizon", expectedCurrentDeploymentRevision: null });
  });

  it("injects only the target tenant's current deployment revision", () => {
    const deploymentRevision = "6d48e6a7-d770-49b6-bf49-82900ab9a88b";
    expect(targetManifest({ id: "horizon", expectedCurrentDeploymentRevision: null }, { deploymentRevision }))
      .toMatchObject({ id: "horizon", expectedCurrentDeploymentRevision: deploymentRevision });
    expect(() => targetManifest({ id: "horizon" }, {})).toThrow("valid deployment revision");
  });
});
