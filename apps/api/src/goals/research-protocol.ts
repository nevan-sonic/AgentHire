import { isRecord } from "../agents/task.js";
import { digest } from "../marketplace/protocol.js";
import { DEMO_MERCHANT } from "../agents/workers.js";
import { X402_ASSET, X402_NETWORK } from "../x402/config.js";

export const researchWorkers = [
  { id: "quick-research", label: "Quick Researcher", port: 3111, reads: 4, searches: 1, base: 90_000, prior: 6500 },
  { id: "deep-research", label: "Deep Researcher", port: 3112, reads: 8, searches: 2, base: 140_000, prior: 9000 },
] as const;
export type ResearchWorker = Omit<typeof researchWorkers[number], "port"> & { port: number };
export function configuredResearchWorkers(env: NodeJS.ProcessEnv): ResearchWorker[] {
  const configured = researchWorkers.map(worker => {
    const raw = (worker.id === "quick-research" ? env.RESEARCH_QUICK_PORT : env.RESEARCH_DEEP_PORT)?.trim();
    const port = raw ? Number(raw) : worker.port;
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || (raw && !/^\d{4,5}$/.test(raw))) {
      throw new Error("Invalid research worker port");
    }
    return { ...worker, port };
  });
  if (configured[0].port === configured[1].port) throw new Error("Research workers require separate ports");
  return configured;
}
export const testRepository = "octokit/rest.js";
export const workerOrigin = (worker: ResearchWorker) => `http://127.0.0.1:${worker.port}`;
export function workerMerchant(worker: ResearchWorker, env: NodeJS.ProcessEnv) {
  const value = (worker.id === "quick-research" ? env.RESEARCH_QUICK_MERCHANT : env.RESEARCH_DEEP_MERCHANT)?.trim() ||
    env.X402_MERCHANT_ID?.trim() || DEMO_MERCHANT;
  if (!/^0\.0\.[1-9]\d{0,17}$/.test(value)) throw new Error("Invalid research merchant");
  return value;
}

export type ResearchTask = { goalId: string; parentId: string; missionId: string; queries: string[]; sourceCount: number; inputDigest: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function parseResearchTask(input: unknown): ResearchTask {
  if (!isRecord(input) || Object.keys(input).length !== 6 ||
      ![input.goalId, input.parentId, input.missionId].every(id => typeof id === "string" && uuid.test(id)) ||
      new Set([input.goalId, input.parentId, input.missionId]).size !== 3 ||
      !Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > 2 ||
      input.queries.some(query => typeof query !== "string" || query.trim().length < 2 || query.length > 90) ||
      !Number.isInteger(input.sourceCount) || Number(input.sourceCount) < 3 || Number(input.sourceCount) > 4 ||
      typeof input.inputDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.inputDigest)) throw new Error("Invalid research task");
  return { goalId: String(input.goalId), parentId: String(input.parentId), missionId: String(input.missionId),
    queries: [...input.queries], sourceCount: Number(input.sourceCount), inputDigest: input.inputDigest };
}

export function researchBid(worker: ResearchWorker, task: ResearchTask, merchant: string, expiresAt: string) {
  const taskDigest = digest(task);
  const priceTinybars = String(worker.base + task.sourceCount * 3000 + Math.min(worker.searches, task.queries.length) * 2000);
  const testPrice = "5000";
  return { bidId: digest([worker.id, taskDigest, merchant, priceTinybars, testPrice, expiresAt]), taskDigest, workerId: worker.id,
    merchant, priceTinybars, testPrice, expiresAt, network: X402_NETWORK, asset: X402_ASSET,
    capability: "web.research" as const, endpoint: workerOrigin(worker) + "/execute", testEndpoint: workerOrigin(worker) + "/capability-test" };
}
export type ResearchBid = ReturnType<typeof researchBid>;
export function verifyResearchBid(value: unknown, worker: ResearchWorker, task: ResearchTask, merchant: string, now = Date.now()) {
  if (!isRecord(value) || typeof value.expiresAt !== "string") throw new Error("Malformed research bid");
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== value.expiresAt ||
      expiry <= now || expiry > now + 600_000) throw new Error("Research bid expired");
  const expected = researchBid(worker, task, merchant, value.expiresAt);
  if (Object.keys(value).length !== Object.keys(expected).length ||
      !Object.entries(expected).every(([key, entry]) => value[key] === entry)) throw new Error("Research bid binding mismatch");
  return expected;
}

export function paidResearchRequest(task: ResearchTask, bid: ResearchBid, phase: "test" | "hire") {
  return { task, bid, phase, intentId: digest([task.goalId, task.missionId, phase]) };
}
export const RESEARCH_BINDING = "agenthire-research-binding";
export function researchBinding(requestDigest: string, endpoint: string, amount: string, merchant: string, transaction: string) {
  return Buffer.from(JSON.stringify([RESEARCH_BINDING, requestDigest, endpoint, amount, merchant, X402_NETWORK, X402_ASSET, digest(transaction)]));
}
