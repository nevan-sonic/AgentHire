import { randomUUID } from "node:crypto";
import { verifyMessage } from "viem";
import { isRecord, integerIn } from "../agents/task.js";
import { digest } from "./protocol.js";
import { resolveAgentName } from "./ens.js";
import { worldChallenge, verifyWorldProof } from "../routes/world-id.js";
import { eventStreams } from "./sse.js";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { loadHederaMirrorNodeUrl } from "../config/hedera.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { AUDIT_TOPIC } from "../audit/completed-procurement.js";
import { readVerifiedHistory } from "../audit/topic.js";
import { operatorAuthorized, parseScope, runLive } from "./live.js";
import { discover, parseJob, planJob } from "./manager.js";
import { JobStore } from "./store.js";

export function registerMarketplace(app: FastifyInstance, env: NodeJS.ProcessEnv, store = new JobStore(
  fileURLToPath(new URL("../../../../.agenthire-marketplace/jobs.sqlite", import.meta.url)),
)) {
  const merchant = env.X402_MERCHANT_ID;
  const active = new Set<Promise<unknown>>();
  const streams = eventStreams(32);
  function schedule(work: Promise<unknown>) {
    active.add(work);
    void work.catch(() => app.log.warn("Marketplace background operation stopped")).finally(() => active.delete(work));
  }
  app.addHook("preClose", async () => { streams.close(); });
  app.addHook("onClose", async () => { await Promise.allSettled(active); store.close(); });

  for (const job of store.recoverable()) {
    if (!job) continue;
    if (job.status === "executing") store.transition(job.id, "executing", "needs_reconciliation", "job.interrupted",
      { reason: "Check recorded transactions before taking further action" });
    else {
      if (job.status === "discovering") store.transition(job.id, "discovering", "queued", "job.planning_restarted");
      schedule(planJob(store, job, merchant));
    }
  }

  let windowStart = Date.now(), created = 0;
  app.get<{ Querystring: { capability?: string } }>("/api/marketplace/agents", async request => {
    const all = await discover(store, env);
    if (!request.query.capability) return all;
    return all.filter(a => a.capability === request.query.capability);
  });
  function listing(input: unknown) {
    if (!isRecord(input) || Object.keys(input).length !== 7) throw new Error("Invalid agent listing");
    const { name, description, capability, basePrice, endpoint, merchant, ensName } = input;
    if (typeof name !== "string" || !name.trim() || name.length > 100 ||
        typeof description !== "string" || description.trim().length < 20 || description.length > 1000 ||
        typeof capability !== "string" || !["web.research", "code.generation", "data.analytics", "document.report", "document.summarize"].includes(capability) ||
        !integerIn(basePrice, 1, 10_000_000) || typeof endpoint !== "string" || endpoint.length > 500 ||
        typeof merchant !== "string" || !/^0\.0\.[1-9]\d{0,17}$/.test(merchant) ||
        typeof ensName !== "string" || !ensName.trim() || ensName.length > 255) throw new Error("Complete the agent listing before verification");
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Provide an HTTPS execution endpoint");
    return { name: name.trim(), description: description.trim(), capability, basePrice, endpoint: url.href, merchant, ensName: ensName.trim() };
  }
  let challengeWindow = Date.now(), challenges = 0;
  app.post("/api/marketplace/publish/challenge", { bodyLimit: 4096 }, async (request, reply) => {
    if (Date.now() - challengeWindow >= 60_000) { challengeWindow = Date.now(); challenges = 0; }
    if (challenges >= 20) return reply.code(429).send({ error: "Publishing challenge limit reached" });
    challenges++;
    try {
      const data = listing(request.body);
      const challenge = worldChallenge(env, digest(data));
      await resolveAgentName(env.ENS_RPC_URL, data.ensName, data.endpoint, data.merchant, env.ENS_NETWORK);
      store.savePublishChallenge(challenge.rp_context.nonce, challenge.signal, challenge.rp_context.expires_at);
      return reply.header("Cache-Control", "no-store").send(challenge);
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Publishing unavailable" }); }
  });
  app.post("/api/marketplace/agents", { bodyLimit: 16384 }, async (request, reply) => {
    const input = request.body;
    if (!isRecord(input) || Object.keys(input).length !== 3 || !isRecord(input.proof) ||
        typeof input.proof.nonce !== "string" || typeof input.signature !== "string" || !/^0x[a-f0-9]{130}$/i.test(input.signature)) {
      return reply.code(400).send({ error: "World ID proof and ENS wallet signature required" });
    }
    try {
      const data = listing(input.listing);
      const nonce = input.proof.nonce;
      const signal = digest(data);
      if (!store.hasPublishChallenge(nonce, signal)) throw new Error("Publishing challenge expired or listing changed");
      const resolved = await resolveAgentName(env.ENS_RPC_URL, data.ensName, data.endpoint, data.merchant, env.ENS_NETWORK);
      const message = `AgentHire publishing authorization\nListing: ${signal}\nWorld ID nonce: ${nonce}`;
      if (!await verifyMessage({ address: resolved.address, message, signature: input.signature as `0x${string}` })) {
        throw new Error("ENS signature does not match the resolved address");
      }
      const nullifier = await verifyWorldProof(env, input.proof, nonce, signal);
      const id = "custom-" + randomUUID();
      const agent = { ...data, ensName: resolved.name, ensAddress: resolved.address, id, designation: "third-party",
        health: "unavailable", network: "hedera:testnet", verification: "World ID publisher verified", checkedAt: new Date().toISOString() };
      store.publishAgent(nonce, signal, digest(nullifier), id, agent);
      return reply.code(201).send(agent);
    } catch { return reply.code(422).send({ error: "Publishing rejected. Check the listing, ENS ownership, and World ID proof." }); }
  });
  app.get<{ Params: { agentId: string } }>("/api/marketplace/agents/:agentId", async (request, reply) => {
    const agent = (await discover(store, env)).find(row => row.id === request.params.agentId);
    return agent ?? reply.code(404).send({ error: "Agent not found" });
  });
  app.get("/api/marketplace/receipts/jobs", async () => store.list().flatMap(job => job ? store.events(job.id)
    .filter(event => event.kind === "payment.verified").map(event => ({ title: job.title, at: event.at, data: event.data })) : []));
  app.get("/api/marketplace/jobs", async () => store.list());
  app.post("/api/marketplace/jobs", { bodyLimit: 8192 }, async (request, reply) => {
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); created = 0; }
    if (created >= 20 || active.size >= 8) return reply.code(429).send({ error: "Job creation limit reached" });
    try {
      const job = parseJob(request.body);
      store.create(job);
      created++;
      schedule(planJob(store, job, merchant));
      return reply.code(201).send(job);
    } catch { return reply.code(400).send({ error: "Invalid job title, dataset, spending limits, or mode" }); }
  });
  type Params = { jobId: string };
  app.get<{ Params: Params }>("/api/marketplace/jobs/:jobId", async (request, reply) => {
    const job = store.job(request.params.jobId);
    return job ? { job, events: store.events(job.id) } : reply.code(404).send({ error: "Job not found" });
  });
  app.get<{ Params: Params; Querystring: { cursor?: string } }>("/api/marketplace/jobs/:jobId/events", (request, reply) => {
    const job = store.job(request.params.jobId);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return streams.open(reply, request.headers["last-event-id"] ?? request.query.cursor ?? "0",
      cursor => store.events(job.id, cursor));
  });
  app.post<{ Params: Params }>("/api/marketplace/jobs/:jobId/authorize", { bodyLimit: 4096 }, async (request, reply) => {
    if (!operatorAuthorized(request.headers.authorization, env.MARKETPLACE_OPERATOR_TOKEN)) {
      return reply.code(403).send({ error: "Operator authentication required" });
    }
    if (env.MARKETPLACE_LIVE_ENABLED !== "true" || active.size >= 8) {
      return reply.code(503).send({ error: "Live mode unavailable" });
    }
    const job = store.job(request.params.jobId);
    if (!job || job.mode !== "live" || job.status !== "awaiting_authorization") {
      return reply.code(409).send({ error: "Job is not awaiting authorization" });
    }
    try {
      const scope = parseScope(request.body, job, env);
      if (!store.transition(job.id, "awaiting_authorization", "executing", "authorization.granted", scope)) {
        return reply.code(409).send({ error: "Authorization already claimed" });
      }
      schedule(runLive(store, job, scope, env));
      return reply.code(202).send({ status: "executing", jobId: job.id });
    } catch { return reply.code(400).send({ error: "Invalid authorization scope" }); }
  });
  app.post<{ Params: Params }>("/api/marketplace/jobs/:jobId/reconcile", async (request, reply) => {
    if (!operatorAuthorized(request.headers.authorization, env.MARKETPLACE_OPERATOR_TOKEN)) {
      return reply.code(403).send({ error: "Operator authentication required" });
    }
    const job = store.job(request.params.jobId);
    if (!job || job.status !== "needs_reconciliation") return reply.code(409).send({ error: "No interrupted job" });
    try {
      const events = store.events(job.id);
      const scope = events.find(event => event.kind === "authorization.granted")?.data;
      if (!scope) return reply.code(409).send({ error: "Authorization record missing" });
      const mirror = loadHederaMirrorNodeUrl(env);
      const [payments, history] = await Promise.all([
        Promise.all(events.filter(event => event.kind === "payment.submitted").map(async ({ data }) => ({
          transactionId: data.transactionId, ...await reconcilePayment(mirror, { transactionId: data.transactionId,
            payer: scope.payer, merchant: scope.merchant, amountTinybars: data.amount }),
        }))),
        readVerifiedHistory(mirror),
      ]);
      return { status: "needs_reconciliation", payments, topic: AUDIT_TOPIC,
        audit: history.filter(row => row.event.jobId === job.id).map(row => ({
          eventId: row.event.eventId, payloadHash: row.event.payloadHash, sequence: row.sequenceNumber,
        })) };
    } catch { return reply.code(503).send({ error: "Reconciliation evidence unavailable" }); }
  });
}
