// Copyright 2026 Coresource AI, Inc.
// SPDX-License-Identifier: Apache-2.0

import { authProvider } from "@constal/sdk";

export default authProvider({
  id: "horizon-github",
  version: "0.2.7",
  needs: [{ binding: "verifier", kind: "service", ops: ["webhook.verify"] }],
  async authenticate({ request }, context) {
    const result = await context.invoke<{ verified: boolean; installation?: string; sender?: { id: string; login: string } }>(
      context.resources.verifier!, "webhook.verify", {
        bodyBase64: request.bodyBase64 ?? "", signature: request.headers["x-hub-signature-256"] ?? "",
      });
    // The installation selects subscriptions; it is not the person who sent the event.
    // Events without a verified actor cannot acquire personal credential authority.
    return result.verified && result.sender && /^\d{1,20}$/u.test(result.sender.id)
      ? { authenticated: true, subject: `github:user:${result.sender.id}`,
        expiresAt: null,
        claims: { provider: "github", installation: result.installation ?? "",
          sender_id: result.sender?.id ?? "", sender_login: result.sender?.login ?? "" } }
      : { authenticated: false };
  },
});
