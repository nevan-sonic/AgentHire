import { createHash } from "node:crypto";
import { PublicKey } from "@hiero-ledger/sdk";
import type { PaymentRequirements } from "@x402/core/types";
import { isRecord } from "../agents/task.js";
import { validStatisticsInput } from "../agents/statistics.js";

export const CAPABILITY_PATH = "/api/workers/capability-test";
export const CAPABILITY_EXTENSION = "agenthire-capability-binding";

export type CapabilityRequest = {
  taskId: string; testId: string; workerId: string; capability: "statistics.summary"; input: number[];
};

export function parseCapabilityRequest(value: unknown): CapabilityRequest | null {
  if (!isRecord(value) || Object.keys(value).length !== 5) return null;
  const { taskId, testId, workerId, capability, input } = value;
  if (typeof taskId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(taskId) ||
      typeof workerId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(workerId) ||
      testId !== `${taskId}-${workerId}-statistics-v1` ||
      capability !== "statistics.summary" || !validStatisticsInput(input)) return null;
  return { taskId, testId, workerId, capability, input };
}

export function capabilityDigest(request: CapabilityRequest) {
  return createHash("sha256").update(JSON.stringify([
    request.taskId, request.testId, request.workerId, request.capability, request.input,
  ])).digest("hex");
}

export function bindingBytes(request: CapabilityRequest, endpoint: string, quote: PaymentRequirements, transaction: string) {
  return Buffer.from(JSON.stringify([
    CAPABILITY_EXTENSION, 1, capabilityDigest(request), endpoint, quote.payTo, quote.network, quote.asset,
    quote.scheme, quote.amount, quote.extra?.feePayer, quote.maxTimeoutSeconds,
    createHash("sha256").update(transaction).digest("hex"),
  ]));
}

export async function lookupPayerAccount(mirror: URL, payer: string) {
  const url = new URL(`/api/v1/accounts/${encodeURIComponent(payer)}`, mirror);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Unable to check the payer account");
  const account = JSON.parse(await response.text(), (key, value, context?: { source: string }) =>
    key === "balance" && typeof value === "number" && context ? context.source : value);
  if (account?.account !== payer || account.deleted !== false || !/^[a-f0-9]+$/i.test(account.key?.key ?? "")) {
    throw new Error("Payer account is missing or has an unsupported key");
  }
  const publicKey = account.key._type === "ECDSA_SECP256K1" ? PublicKey.fromStringECDSA(account.key.key)
    : account.key._type === "ED25519" ? PublicKey.fromStringED25519(account.key.key) : null;
  const balance = account.balance?.balance;
  if (!publicKey || typeof balance !== "string" || !/^\d+$/.test(balance)) throw new Error("Unsupported payer account data");
  return { publicKey, balanceTinybars: balance };
}
