import type { ProcurementBid, ProcurementTask, WorkerProfile } from "@agenthire/shared";
import { WORKER_PATH, X402_ASSET, X402_NETWORK } from "../x402/config.js";
import { summarizeStatistics } from "./statistics.js";

export const STATISTICS = "statistics.summary";
export const DEMO_MERCHANT = "0.0.11330954";

export function compareWorkerIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface WorkerAdapter {
  profile: WorkerProfile;
  bid(task: Readonly<ProcurementTask>, signal: AbortSignal): Promise<unknown>;
  capabilityTest?: {
    priceTinybars: string;
    timeoutMs: number;
    run(input: readonly number[], signal: AbortSignal): Promise<unknown>;
  };
}

export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerAdapter>();

  register(worker: WorkerAdapter) {
    const { workerId, endpoint } = worker.profile;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(workerId) || this.workers.has(workerId)) {
      throw new Error("Invalid or duplicate worker ID");
    }
    const url = new URL(endpoint);
    if (url.protocol !== "http:" || url.hostname !== "localhost" ||
        url.username || url.password || url.search || url.hash ||
        url.pathname !== `${WORKER_PATH}/${workerId}`) {
      throw new Error("Worker endpoint must match its trusted local route");
    }
    const profile = structuredClone(worker.profile);
    const test = worker.capabilityTest;
    this.workers.set(workerId, { profile, bid: worker.bid.bind(worker),
      capabilityTest: test && { priceTinybars: test.priceTinybars, timeoutMs: test.timeoutMs, run: test.run.bind(test) } });
  }

  discover(capability?: string) {
    return [...this.workers.values()].filter(({ profile }) =>
      profile.available && (capability === undefined || profile.capabilities.includes(capability)),
    ).sort((left, right) => compareWorkerIds(left.profile.workerId, right.profile.workerId))
      .map((worker) => ({ ...worker, profile: structuredClone(worker.profile),
        capabilityTest: worker.capabilityTest && { ...worker.capabilityTest } }));
  }
}

export function createDemoRegistry(port = 3001, merchant = DEMO_MERCHANT, now = Date.now,
  fixtures: Partial<Record<string, "correct" | "incorrect" | "timeout" | "error">> = {}) {
  const registry = new WorkerRegistry();
  const seeds = [
    { workerId: "economy", displayName: "Economy Statistics Worker", description: "Low-price summary adapter",
      priceTinybars: "600000", estimatedLatencyMs: 300, reliabilityBps: 6000 },
    { workerId: "balanced", displayName: "Balanced Statistics Worker", description: "Mid-price summary adapter",
      priceTinybars: "750000", estimatedLatencyMs: 200, reliabilityBps: 9500 },
    { workerId: "premium", displayName: "Premium Statistics Worker", description: "Highest assumed reliability summary adapter",
      priceTinybars: "950000", estimatedLatencyMs: 100, reliabilityBps: 9900 },
  ] as const;
  for (const seed of seeds) {
    const profile: WorkerProfile = {
      ...seed, pricingPolicy: "flat-per-task", capabilities: [STATISTICS], taskTypes: [STATISTICS],
      endpoint: `http://localhost:${port}${WORKER_PATH}/${seed.workerId}`,
      merchant, available: true, reliabilitySource: "demo-assumption", kind: "demo-adapter",
    };
    registry.register({
      profile,
      capabilityTest: {
        priceTinybars: "5000",
        timeoutMs: 50,
        async run(input, signal) {
          signal.throwIfAborted();
          const fixture = fixtures[profile.workerId];
          if (fixture === "timeout") {
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(new Error("Timed out")), { once: true }));
          }
          if (fixture === "error") throw new Error("Demo worker error");
          const result = summarizeStatistics(input);
          return fixture === "incorrect" ? { ...result, mean: result.mean + 1 } : result;
        },
      },
      async bid(task, signal): Promise<ProcurementBid> {
        signal.throwIfAborted();
        if (!profile.taskTypes.includes(task.taskType) || !profile.capabilities.includes(task.capability)) {
          throw new Error("Unsupported task");
        }
        return {
          bidId: `${task.taskId}-${profile.workerId}`, taskId: task.taskId, workerId: profile.workerId,
          capability: task.capability, priceTinybars: profile.priceTinybars,
          estimatedLatencyMs: profile.estimatedLatencyMs, reliabilityBps: profile.reliabilityBps,
          expiresAt: new Date(now() + 30_000).toISOString(), merchant: profile.merchant,
          endpoint: profile.endpoint, asset: X402_ASSET, network: X402_NETWORK, status: "offered",
        };
      },
    });
  }
  return registry;
}
