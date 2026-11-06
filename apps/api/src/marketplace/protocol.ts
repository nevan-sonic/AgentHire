import { createHash } from "node:crypto";
import type { MarketplaceOffer, ProcurementBid, ProcurementTask, WorkerProfile } from "@agenthire/shared";
import { parseProcurementTask } from "../agents/task.js";
import { DEMO_MERCHANT, STATISTICS } from "../agents/workers.js";
import { X402_ASSET, X402_NETWORK } from "../x402/config.js";

export const seeds = [
  { id: "fast", name: "Fast Analyst", port: 3101, max: 20, base: 600000, prior: 6000, description: "Single-pass statistics for small datasets." },
  { id: "reliable", name: "Reliable Analyst", port: 3102, max: 60, base: 750000, prior: 9500, description: "Compensated summation with consistency checks." },
  { id: "premium", name: "Premium Analyst", port: 3103, max: 100, base: 950000, prior: 9900, description: "Sorted distribution analysis with a median calculation." },
] as const;
export type Seed = typeof seeds[number];
export const testPrice = "5000";
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const origin = (seed: Seed) => `http://127.0.0.1:${seed.port}`;

export function profile(seed: Seed, merchant = DEMO_MERCHANT, workerOrigin = origin(seed)): WorkerProfile {
  return {
    workerId: seed.id, displayName: seed.name, description: seed.description, pricingPolicy: "flat-per-task",
    capabilities: [STATISTICS], taskTypes: [STATISTICS], endpoint: workerOrigin + "/execute",
    merchant, available: true, reliabilitySource: "bayesian-prior", kind: "first-party-service",
    priceTinybars: String(seed.base), reliabilityBps: seed.prior, estimatedLatencyMs: 250,
  };
}

export function offer(seed: Seed, task: ProcurementTask, merchant: string, now = Date.now(), workerOrigin = origin(seed)): MarketplaceOffer {
  if (task.input.length > seed.max) throw new Error("Input exceeds worker limit");
  const worker = profile(seed, merchant, workerOrigin);
  const inputDigest = digest(task.input);
  const bid: ProcurementBid = {
    bidId: digest([task.taskId, seed.id, inputDigest]), workerId: seed.id, taskId: task.taskId,
    capability: STATISTICS, priceTinybars: String(seed.base + Math.max(0, task.input.length - 5) * 200),
    estimatedLatencyMs: worker.estimatedLatencyMs, reliabilityBps: seed.prior,
    expiresAt: new Date(now + 10 * 60_000).toISOString(), merchant, endpoint: worker.endpoint,
    network: X402_NETWORK, asset: X402_ASSET, status: "offered",
  };
  return { bid, inputDigest, testPrice, testEndpoint: workerOrigin + "/capability-test", maxInput: seed.max };
}

export function validateOffer(value: unknown, seed: Seed, task: ProcurementTask, merchant: string, now = Date.now(), workerOrigin = origin(seed)): MarketplaceOffer {
  const expected = offer(seed, task, merchant, now, workerOrigin);
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5 || !("bid" in value) ||
      !value.bid || typeof value.bid !== "object") throw new Error("malformed_bid");
  const bid = value.bid as ProcurementBid;
  const expires = Date.parse(bid.expiresAt);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 600_000) throw new Error("expired_or_invalid_bid");
  for (const key of Object.keys(expected.bid) as (keyof ProcurementBid)[]) {
    if (key !== "expiresAt" && bid[key] !== expected.bid[key]) throw new Error("bid_binding_mismatch");
  }
  if (Object.keys(bid).length !== Object.keys(expected.bid).length ||
      !Object.entries(expected).filter(([key]) => key !== "bid").every(([key, entry]) => Reflect.get(value, key) === entry)) {
    throw new Error("bid_binding_mismatch");
  }
  return { ...expected, bid };
}

export function parseWorkerTask(value: unknown) {
  return parseProcurementTask(value);
}
