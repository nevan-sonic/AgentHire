import type { PaymentRequirements } from "@x402/core/types";
import { bindingBytes, capabilityDigest, parseCapabilityRequest } from "./capability-binding.js";
import type { CapabilityRequest } from "./capability-binding.js";

export const HIRE_EXTENSION = "agenthire-final-hire-binding";

export function parseHireRequest(value: unknown): CapabilityRequest | null {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5) return null;
  const { taskId, bidId, workerId, capability, input } = value as Record<string, unknown>;
  if (typeof taskId !== "string" || workerId !== "balanced" || bidId !== `${taskId}-balanced`) return null;
  return parseCapabilityRequest({ taskId, testId: `${taskId}-balanced-statistics-v1`, workerId, capability, input });
}

export const hireDigest = (request: CapabilityRequest) => capabilityDigest(request);
export const hireBinding = (request: CapabilityRequest, endpoint: string, quote: PaymentRequirements, transaction: string) =>
  bindingBytes(request, endpoint, quote, transaction, HIRE_EXTENSION);
