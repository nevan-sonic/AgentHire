import { adaptiveProcurement } from "../agents/pocp.js";
import { assumedPrior, describe, observe } from "../agents/reliability.js";
import { isRecord } from "../agents/task.js";
import { digest } from "../marketplace/protocol.js";
import { requestResourceQuote, SpendingPolicy } from "../agents/payer.js";
import { readBounded } from "./tools.js";
import { configuredResearchWorkers, paidResearchRequest, researchWorkers, verifyResearchBid, workerMerchant, workerOrigin } from "./research-protocol.js";
import type { ResearchBid, ResearchTask } from "./research-protocol.js";

export async function discoverResearch(task: ResearchTask, env: NodeJS.ProcessEnv, transport = fetch) {
  const found = await Promise.all(configuredResearchWorkers(env).map(async worker => {
    try {
      const root = workerOrigin(worker);
      const merchant = workerMerchant(worker, env);
      const headers = { "content-type": "application/json" };
      const signal = AbortSignal.timeout(3000);
      const options = { redirect: "error" as const, signal };
      const [health, agent] = await Promise.all(["/health", "/agent"].map(async path =>
        readBounded(await transport(root + path, options), 8192)));
      if (!isRecord(health) || health.status !== "ok" || health.id !== worker.id || !isRecord(agent) ||
          agent.id !== worker.id || agent.base !== root || agent.merchant !== merchant || agent.capability !== "web.research") {
        throw new Error("Worker metadata mismatch");
      }
      const response = await transport(root + "/bid", { ...options, method: "POST", headers, body: JSON.stringify(task) });
      const bid = verifyResearchBid(await readBounded(response, 8192), worker, task, merchant);
      return { workerId: worker.id, status: "eligible" as const, bid };
    } catch { return { workerId: worker.id, status: "unavailable_or_invalid_bid" as const }; }
  }));
  return found;
}

export async function planResearch(task: ResearchTask, budget: string, maxTest: string, penalty: string,
  outcomes: Awaited<ReturnType<typeof discoverResearch>>, observations: (worker: string) => boolean[], transport = fetch) {
  const bids = outcomes.flatMap(row => row.bid ? [row.bid] : []);
  if (bids.length < 2) throw new Error("Two compatible research bids are required");
  const scored = bids.map(bid => ({ ...bid, reliabilityBps: researchWorkers.find(worker => worker.id === bid.workerId)!.prior,
    estimatedLatencyMs: bid.workerId === "quick-research" ? 12_000 : 25_000 }));
  const prior = (bid: typeof scored[number]) => observations(bid.workerId).reduce((model, passed) => observe(model, passed), assumedPrior(bid.reliabilityBps));
  const result = await adaptiveProcurement({ taskId: task.missionId, maxBudgetTinybars: budget, minimumReliabilityBps: 1,
    pocp: { failurePenaltyTinybars: penalty } }, scored, scored.map(bid => ({
    profile: bid, ...(BigInt(bid.testPrice) <= BigInt(maxTest) ? { capabilityTest: {
      priceTinybars: bid.testPrice, timeoutMs: 7000, async run() { throw new Error("Research probes require settlement"); },
    } } : {}),
  })), Date.now() + 120_000, Date.now, {
    planningOnly: true, overheadMs: 15_000, async run() { throw new Error("Research plan cannot execute"); },
  }, prior);
  const selection = result.trace.baselineWorkerId;
  if (!selection) throw new Error("No affordable research worker");
  const test = result.chosenTest;
  const valuation = result.trace.valuations.find(row => row.workerId === test?.workerId);
  const branches = test && valuation?.status === "valued" ? { pass: valuation.pass.workerId!, fail: valuation.fail.workerId! }
    : { pass: selection, fail: selection };
  const decision = { action: result.trace.action, reason: result.trace.reason, baseline: selection, branches,
    testWorker: test?.workerId ?? null, testPrice: test?.priceTinybars ?? "0",
    valuation: valuation ?? null, baselineLoss: result.trace.baselineLossTinybars,
    priors: scored.map(bid => ({ worker: bid.workerId, ...describe(prior(bid), observations(bid.workerId).length ? "posterior_estimate" : "assumed_prior") })) };
  const required = [
    ...(test ? [{ workerId: test.workerId, phase: "test" as const }] : []),
    ...[...new Set(Object.values(branches))].map(workerId => ({ workerId, phase: "hire" as const })),
  ];
  const quotes = await Promise.all(required.map(async ({ workerId, phase }) => {
    const bid = bids.find(item => item.workerId === workerId)!;
    const endpoint = phase === "test" ? bid.testEndpoint : bid.endpoint;
    const amount = phase === "test" ? bid.testPrice : bid.priceTinybars;
    const { requirement } = await requestResourceQuote(new SpendingPolicy(endpoint, bid.merchant, BigInt(amount), BigInt(amount)),
      paidResearchRequest(task, bid, phase), transport);
    if (requirement.amount !== amount || requirement.extra?.researchRequest !== digest(paidResearchRequest(task, bid, phase))) {
      throw new Error("Research challenge does not match bid");
    }
    return { workerId, phase, endpoint, amount, merchant: bid.merchant };
  }));
  const plan = { task, bids, outcomes, decision, quotes };
  return { ...plan, planHash: digest(plan) };
}

export type ResearchPlan = Awaited<ReturnType<typeof planResearch>>;
export type ResearchQuote = ResearchPlan["quotes"][number];
export function bidFor(plan: ResearchPlan, quote: ResearchQuote): ResearchBid {
  const bid = plan.bids.find(item => item.workerId === quote.workerId);
  if (!bid) throw new Error("Unknown reviewed quote");
  return bid;
}
