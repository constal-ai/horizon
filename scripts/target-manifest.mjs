// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

const deploymentRevisionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function targetManifest(manifest, current) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new TypeError("deployment manifest is invalid");
  if (current === null) return { ...manifest, expectedCurrentDeploymentRevision: null };
  if (!current || typeof current !== "object" || !deploymentRevisionPattern.test(String(current.deploymentRevision ?? ""))) {
    throw new TypeError("current Resource does not expose a valid deployment revision");
  }
  return { ...manifest, expectedCurrentDeploymentRevision: current.deploymentRevision };
}
