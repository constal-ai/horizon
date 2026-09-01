import { authProvider } from "@constal/sdk";

export default authProvider({
  id: "horizon-github",
  version: "0.1.1",
  needs: [{ binding: "verifier", kind: "service", ops: ["verifySignature"] }],
  async authenticate({ request }, context) {
    const result = await context.invoke<{ verified: boolean; installation?: string; sender?: { id: string; login: string } }>(
      context.resources.verifier!, "verifySignature", {
        bodyBase64: request.bodyBase64 ?? "", signature: request.headers["x-hub-signature-256"] ?? "",
      });
    return result.verified
      ? { authenticated: true, subject: `github:${result.installation ?? "installation"}`,
        claims: { provider: "github", installation: result.installation ?? "",
          sender_id: result.sender?.id ?? "", sender_login: result.sender?.login ?? "" } }
      : { authenticated: false };
  },
});
