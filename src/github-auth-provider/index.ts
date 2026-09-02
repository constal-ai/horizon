import { authProvider } from "@constal/sdk";

export default authProvider({
  id: "horizon-github",
  version: "0.2.4",
  needs: [{ binding: "verifier", kind: "service", ops: ["webhook.verify"] }],
  async authenticate({ request }, context) {
    const result = await context.invoke<{ verified: boolean; installation?: string; sender?: { id: string; login: string } }>(
      context.resources.verifier!, "webhook.verify", {
        bodyBase64: request.bodyBase64 ?? "", signature: request.headers["x-hub-signature-256"] ?? "",
      });
    return result.verified
      ? { authenticated: true, subject: `github:${result.installation ?? "installation"}`,
        expiresAt: null,
        claims: { provider: "github", installation: result.installation ?? "",
          sender_id: result.sender?.id ?? "", sender_login: result.sender?.login ?? "" } }
      : { authenticated: false };
  },
});
