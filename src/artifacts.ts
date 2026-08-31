import { canonicalJson, type Ctx } from "@constal/sdk";

export interface ArtifactEnvelope {
  ref: string;
}

export async function storeArtifact(ctx: Ctx, value: unknown): Promise<ArtifactEnvelope> {
  const text = canonicalJson(value);
  const stored = await ctx.invoke<{ ref: string; bytes: number }>(ctx.resources.cas!, "putText", { text });
  if (!stored.ref || stored.bytes !== new TextEncoder().encode(text).byteLength) {
    throw new TypeError("Horizon CAS did not confirm the stored planning artifact");
  }
  return { ref: stored.ref };
}

export async function loadArtifact<T>(ctx: Ctx, envelope: ArtifactEnvelope): Promise<T> {
  if (!envelope || typeof envelope.ref !== "string" || envelope.ref.length === 0 || envelope.ref.length > 1_024) {
    throw new TypeError("Horizon artifact envelope is invalid");
  }
  const loaded = await ctx.invoke<{ ref: string; text: string; bytes: number }>(ctx.resources.cas!, "getText",
    { ref: envelope.ref, maximumBytes: 1_048_576 });
  if (loaded.ref !== envelope.ref || typeof loaded.text !== "string") throw new TypeError("Horizon CAS artifact read is invalid");
  try { return JSON.parse(loaded.text) as T; }
  catch { throw new TypeError("Horizon CAS artifact is not canonical JSON"); }
}
