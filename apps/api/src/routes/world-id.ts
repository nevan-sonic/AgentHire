import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { isRecord } from "../agents/task.js";

function worldEnvironment(env: NodeJS.ProcessEnv) {
  const environment = env.WLD_ENVIRONMENT ?? "production";
  if (environment !== "production" && environment !== "staging" && environment !== "sandbox") throw new Error("Invalid World ID environment");
  return environment;
}

export function worldChallenge(env: NodeJS.ProcessEnv, signal: string) {
  const { WLD_APP_ID: appId, WLD_RP_ID: rpId, WLD_PUBLISH_ACTION: action, WLD_RP_SIGNING_KEY: signingKeyHex } = env;
  if (!appId || !/^app_[a-z0-9]+$/i.test(appId) || !rpId || !/^rp_[a-z0-9]+$/i.test(rpId) ||
      !action || !signingKeyHex || !/^(?:0x)?[a-f0-9]{64}$/i.test(signingKeyHex)) throw new Error("World ID publishing is not configured");
  const signed = signRequest({ signingKeyHex, action, ttl: 300 });
  return { app_id: appId, action, signal, environment: worldEnvironment(env), rp_context: {
    rp_id: rpId, nonce: signed.nonce, created_at: signed.createdAt, expires_at: signed.expiresAt, signature: signed.sig,
  } };
}
export async function verifyWorldProof(env: NodeJS.ProcessEnv, proof: unknown, nonce: string, signal: string) {
  const rp = env.WLD_RP_ID;
  if (!rp || !/^rp_[a-z0-9]+$/i.test(rp) || !env.WLD_PUBLISH_ACTION ||
      !isRecord(proof) || proof.protocol_version !== "4.0" || proof.environment !== worldEnvironment(env) ||
      proof.action !== env.WLD_PUBLISH_ACTION || proof.nonce !== nonce ||
      !Array.isArray(proof.responses) || proof.responses.length !== 1) throw new Error("Invalid World ID proof");
  const item: unknown = proof.responses[0];
  const field = (value: unknown): value is string => typeof value === "string" && /^(?:\d{1,78}|0x[a-f0-9]{1,64})$/i.test(value);
  if (!isRecord(item) || item.identifier !== "proof_of_human" || item.issuer_schema_id !== 1 ||
      !field(item.nullifier) || !field(item.signal_hash) || BigInt(item.signal_hash) !== BigInt(hashSignal(signal))) {
    throw new Error("World ID proof is not bound to the listing");
  }
  const response = await fetch(`https://developer.worldcoin.org/api/v4/verify/${rp}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(proof),
  });
  const result: unknown = await response.json();
  if (!response.ok || !isRecord(result) || result.success !== true) throw new Error("World ID rejected the proof");
  return BigInt(item.nullifier).toString();
}
