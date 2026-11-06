import { resolveAgentName } from "./ens.js";
import { randomUUID } from "node:crypto";
import type { MarketplaceAgent, ProcurementBid } from "@agenthire/shared";
import { assessBid } from "../agents/manager.js";
import { adaptiveProcurement } from "../agents/pocp.js";
import type { PaidTestExecutor } from "../agents/pocp.js";
import { integerIn, isRecord, parseProcurementTask, tinybars } from "../agents/task.js";
import { DEMO_MERCHANT, STATISTICS } from "../agents/workers.js";
import type { WorkerAdapter } from "../agents/workers.js";
import { digest, origin, profile, seeds, validateOffer } from "./protocol.js";
import type { Seed } from "./protocol.js";
import type { Job, JobStore } from "./store.js";

export function parseJob(body: unknown): Job {
  if (!isRecord(body) || Object.keys(body).length !== 7 || typeof body.title !== "string" ||
      !body.title.trim() || body.title.length > 100 || body.capability !== STATISTICS ||
      (body.mode !== "preview" && body.mode !== "live") ||
      !tinybars(body.budget) || !tinybars(body.maxTest) || !tinybars(body.penalty) ||
      !integerIn(Number(body.budget), 1, 10_000_000) || BigInt(body.maxTest) > BigInt(body.budget) ||
      BigInt(body.penalty) > 10_000_000n) throw new Error("Invalid job");
  const id = randomUUID();
  const task = parseProcurementTask({
    taskId: id, taskType: STATISTICS, capability: STATISTICS, input: body.input,
    maxBudgetTinybars: body.budget, deadlineMs: 60_000, minimumReliabilityBps: 1,
    selectionStrategy: "adaptive_pocp", pocp: { failurePenaltyTinybars: body.penalty },
  });
  return { id, title: body.title.trim(), mode: body.mode, task, maxTest: body.maxTest,
    status: "queued", createdAt: new Date().toISOString() };
}

async function readWorker(seed: Seed, path: string, body?: object) {
  const response = await fetch(origin(seed) + path, { redirect: "error", signal: AbortSignal.timeout(2500),
    ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("worker_rejected_request"); }
  const text = await response.text();
  if (text.length > 8192) throw new Error("oversized_worker_response");
  return JSON.parse(text) as unknown;
}

async function discoverStatistics(store: JobStore, merchant = DEMO_MERCHANT) {
  return Promise.all(seeds.map(async seed => {
    const checkedAt = new Date().toISOString();
    let online = false;
    try {
      const [health, agent] = await Promise.all([readWorker(seed, "/health"), readWorker(seed, "/agent")]);
      online = isRecord(health) && health.status === "ok" && health.workerId === seed.id &&
        isRecord(agent) && agent.workerId === seed.id && agent.endpoint === origin(seed) + "/execute" &&
        agent.merchant === merchant && agent.maxInput === seed.max && Array.isArray(agent.capabilities) &&
        agent.capabilities.includes(STATISTICS);
    } catch { /* Expose outages as unavailable. */ }
    const worker: MarketplaceAgent = { id: seed.id, name: seed.name, description: seed.description, maxInput: seed.max, basePrice: seed.base,
      reliabilityBps: seed.prior, health: online ? "online" : "unavailable", merchant, endpoint: origin(seed),
      network: "hedera:testnet", asset: "0.0.0", capability: STATISTICS, designation: "first-party", checkedAt,
      registration: "registered", verification: "Health check and independently evaluated capability observations", observations: store.observations(seed.id) };
    store.agent(seed.id, worker);
    return worker;
  }));
}

export async function discover(store: JobStore, env: NodeJS.ProcessEnv = {}) {
  const ensRpc = env.ENS_RPC_URL;
  const currentAgents: {
    id: string;
    name: string;
    description: string;
    capability: string;
  }[] = [
    {
      id: "researcher",
      name: "Research Agent",
      description: "Autonomous web search, evidence gathering, cross-referencing, and deep thinking on complex topics.",
      capability: "web.research",
    },
    {
      id: "coder",
      name: "Coding Agent",
      description: "Generates robust functions, APIs, scripts, unit tests, and production software modules.",
      capability: "code.generation",
    },
    {
      id: "data-analyst",
      name: "Data Analyst Agent",
      description: "In-depth spreadsheet and numerical dataset analysis: statistics, volatility, trend forecasting, and tabular insights.",
      capability: "data.analytics",
    },
    {
      id: "report-writer",
      name: "Report Generation Agent",
      description: "Synthesizes multi-source data and findings into executive-grade structured Markdown reports with citations.",
      capability: "document.report",
    },
    {
      id: "doc-summarizer",
      name: "Document Summarizer Agent",
      description: "Condenses lengthy PDF documents, Word files, research papers, and technical memos into concise executive briefs.",
      capability: "document.summarize",
    },
  ];

  let online = false;
  if (env.GROQ_GOALS_ENABLED === "true" && env.GROQ_API_KEY) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        redirect: "error", signal: AbortSignal.timeout(2500), headers: { Authorization: "Bearer " + env.GROQ_API_KEY },
      });
      if (response.ok) {
        const body: unknown = await response.json();
        const required = [env.GROQ_MANAGER_MODEL ?? "llama-3.1-8b-instant", env.GROQ_WORKER_MODEL ?? "llama-3.1-8b-instant"];
        online = isRecord(body) && Array.isArray(body.data) &&
          required.every(id => (body.data as unknown[]).some((model: unknown) => isRecord(model) && model.id === id));
      } else await response.body?.cancel();
    } catch { /* Provider status could not be verified. */ }
  }
  const workers = currentAgents.map(s => ({
    id: s.id, name: s.name, description: s.description, capability: s.capability,
    health: online ? "online" : "unavailable", designation: "first-party", network: "hedera:testnet",
    verification: "Direct specialist invocation", checkedAt: new Date().toISOString(),
  }));

  // Retrieve user-published custom agents from SQLite database
  const customRows = store.listCustomAgents();
  const customAgents: MarketplaceAgent[] = await Promise.all(customRows.map(async row => {
    let ensName: string | undefined;
    try {
      const result = await resolveAgentName(ensRpc, String(row.ensName), String(row.endpoint), String(row.merchant), env.ENS_NETWORK);
      if (result.address === row.ensAddress) ensName = result.name;
    } catch { /* No verified ENS badge. */ }
    return { ...(row as unknown as MarketplaceAgent), ensName, health: "unavailable" };
  }));
  return [...workers, ...customAgents];
}

export async function collectBids(store: JobStore, job: Job, merchant = DEMO_MERCHANT) {
  store.event(job.id, "discovery.started");
  const workers = await discoverStatistics(store, merchant);
  const candidates: { bid: ProcurementBid; adapter: WorkerAdapter }[] = [];
  await Promise.all(workers.map(async (worker, index) => {
    const seed = seeds[index];
    if (worker.health !== "online") return store.event(job.id, "worker.unavailable", { workerId: worker.id });
    store.event(job.id, "worker.discovered", worker);
    let reason = "worker_unavailable_or_invalid_bid";
    try {
      if (job.task.input.length > seed.max) { reason = "unsupported_input_length"; throw new Error(); }
      const offered = validateOffer(await readWorker(seed, "/bid", job.task), seed, job.task, merchant);
      const workerProfile = profile(seed, merchant);
      const checked = assessBid(offered.bid, job.task, workerProfile, Date.now(), job.task.deadlineMs);
      if (checked.status !== "eligible") { reason = checked.reason; throw new Error(); }
      const adapter: WorkerAdapter = { profile: workerProfile, async bid() { return offered.bid; } };
      if (BigInt(offered.testPrice) <= BigInt(job.maxTest)) adapter.capabilityTest = {
        priceTinybars: offered.testPrice, timeoutMs: 2500, async run() { throw new Error("Protected execution requires settlement"); },
      };
      candidates.push({ bid: checked.bid, adapter });
      store.event(job.id, "bid.received", offered);
    } catch { store.event(job.id, "bid.rejected", { workerId: worker.id, reason }); }
  }));
  candidates.sort((a, b) => a.bid.workerId.localeCompare(b.bid.workerId));
  store.event(job.id, "bidding.completed", { count: candidates.length });
  return candidates;
}

export type Candidates = Awaited<ReturnType<typeof collectBids>>;
export function decide(job: Job, candidates: Candidates, executor?: PaidTestExecutor) {
  return adaptiveProcurement(job.task, candidates.map(({ bid }) => bid), candidates.map(({ adapter }) => adapter),
    Date.now() + job.task.deadlineMs, Date.now, executor ?? {
      overheadMs: 15_000, planningOnly: true,
      async run() { throw new Error("Preview must not execute capability tests"); },
    });
}

export function planBinding(candidates: Candidates, plan: Awaited<ReturnType<typeof decide>>) {
  return digest({
    bids: candidates.map(({ bid }) => [bid.bidId, bid.endpoint, bid.merchant, bid.priceTinybars, bid.reliabilityBps]),
    selected: plan.winningBid?.bidId,
    test: plan.chosenTest,
  });
}

export async function planJob(store: JobStore, job: Job, merchant?: string) {
  if (!store.transition(job.id, "queued", "discovering", "job.planning")) return;
  try {
    const candidates = await collectBids(store, job, merchant);
    const plan = await decide(job, candidates);
    store.event(job.id, "pocp.evaluated", plan.trace);
    if (plan.chosenTest) store.event(job.id, "capability_test.planned", plan.chosenTest);
    if (!plan.winningBid) {
      store.transition(job.id, "discovering", "failed", "job.failed", { reason: "no_eligible_bids" });
      return;
    }
    store.transition(job.id, "discovering", job.mode === "preview" ? "preview_ready" : "awaiting_authorization",
      job.mode === "preview" ? "preview.ready" : "authorization.required",
      { projectedHire: plan.winningBid, test: plan.chosenTest, budget: job.task.maxBudgetTinybars, planHash: planBinding(candidates, plan) });
  } catch { store.transition(job.id, "discovering", "failed", "job.failed", { reason: "planning_failed" }); }
}
