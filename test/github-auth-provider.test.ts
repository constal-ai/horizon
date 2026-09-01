import { describe, expect, it, vi } from "vitest";
import type { AuthProviderContext } from "@constal/sdk";
import horizonGitHubAuth from "../src/github-auth-provider/index.js";

describe("Horizon GitHub Auth Provider", () => {
  it("emits claim keys accepted by the platform identity evidence contract", async () => {
    const invoke = vi.fn(async () => ({ verified: true, installation: "123", sender: { id: "7", login: "wlan0" } }));
    const result = await horizonGitHubAuth.authenticate({ request: {
      method: "POST", url: "https://platform.constal.ai/v1/integrations/github",
      headers: { "x-hub-signature-256": `sha256=${"a".repeat(64)}` }, bodyBase64: "e30=",
    }, ingress: { kind: "channel", crn: "crn:constal:production:tenant:default:channel/horizon-github" as never },
    audience: "crn:constal:production:tenant:default:channel/horizon-github" as never }, {
      provider: "crn:constal:production:tenant:default:auth-provider/horizon-github",
      requestId: "request", resources: { verifier: "verifier" }, invoke,
    } as unknown as AuthProviderContext);
    expect(result).toEqual({ authenticated: true, subject: "github:123", expiresAt: null, claims: {
      provider: "github", installation: "123", sender_id: "7", sender_login: "wlan0",
    } });
    expect(invoke).toHaveBeenCalledWith("verifier", "webhook.verify", {
      bodyBase64: "e30=", signature: `sha256=${"a".repeat(64)}`,
    });
    if (!result.authenticated) throw new Error("expected authenticated evidence");
    expect(result.expiresAt).toBeNull();
    expect(Object.keys(result.claims ?? {})).toEqual(expect.arrayContaining(["sender_id", "sender_login"]));
  });
});
