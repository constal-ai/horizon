// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

export function targetManifest<T extends Record<string, unknown>>(
  manifest: T,
  current: null | { deploymentRevision?: unknown },
): T & { expectedCurrentDeploymentRevision: string | null };
