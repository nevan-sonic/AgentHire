import { inspectLiveInfrastructure, operatorAuthorized } from "../marketplace/live.js";
import { requestResourceQuote, SpendingPolicy } from "../agents/payer.js";
import { digest } from "../marketplace/protocol.js";
import { X402_ASSET, X402_FEE_PAYER, X402_MAX_FEE, X402_NETWORK } from "../x402/config.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { loadHederaMirrorNodeUrl } from "../config/hedera.js";
import { AUDIT_TOPIC } from "../audit/completed-procurement.js";
import { readVerifiedHistory } from "../audit/topic.js";
import { researchAuditFee, ResearchLedger, validateResearchScope } from "./research-ledger.js";
import { assertResearchPlanScope, executePaidResearch } from "./research-execution.js";
import { bidFor, discoverResearch, planResearch } from "./research-plan.js";
import { paidResearchRequest, parseResearchTask } from "./research-protocol.js";
import { publishGoalAudit } from "./research-audit.js";
import { eventStreams } from "../marketplace/sse.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { createGoal, executeGoal } from "./workflow.js";
import type { Goal } from "./workflow.js";

export function registerGoals(app: FastifyInstance, env: NodeJS.ProcessEnv, databasePath =
  fileURLToPath(new URL("../../../../.agenthire-marketplace/goals.sqlite", import.meta.url))) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO goals VALUES (?, ?)");
  const update = db.prepare("UPDATE goals SET body=? WHERE id=?");
  const select = db.prepare("SELECT body FROM goals WHERE id=?");
  const selectRecent = db.prepare("SELECT body FROM goals ORDER BY rowid DESC LIMIT 50");
  const active = new Set<Promise<void>>();
  const ledger = new ResearchLedger(db);
  const streams = eventStreams(24);
  const find = (id: string): Goal | null => {
    const row = select.get(id);
    return row ? JSON.parse(String(row.body)) as Goal : null;
  };
  function save(goal: Goal, kind: string, detail: object = {}) {
    goal.events.push({ id: goal.events.length + 1, kind, detail, at: new Date().toISOString() });
    update.run(JSON.stringify(goal), goal.id);
  }

  const record = (goal: Goal) => (kind: string, detail?: object) => save(goal, kind, detail);
  function schedule(work: Promise<void>) {
    active.add(work);
    void work.catch(() => app.log.warn("Goal persistence stopped")).finally(() => active.delete(work));
  }
  const authenticated = (header: unknown) => operatorAuthorized(header, env.MARKETPLACE_OPERATOR_TOKEN);

  for (const row of db.prepare("SELECT body FROM goals WHERE json_extract(body, '$.status') IN ('queued','running')").all()) {
    const goal = JSON.parse(String(row.body)) as Goal;
    goal.status = "interrupted";
    save(goal, "goal.interrupted", { reason: "Process restarted. Previous records are retained for review." });
  }
  app.addHook("preClose", async () => { streams.close(); });
  app.addHook("onClose", async () => { await Promise.allSettled(active); db.close(); });
  app.get("/api/marketplace/receipts/goals", async () => selectRecent.all().flatMap(row => {
    const goal = JSON.parse(String(row.body)) as Goal;
    return goal.events.filter(event => event.kind === "research.payment.verified")
      .map(event => ({ title: goal.objective, at: event.at, data: event.detail }));
  }));
  app.get("/api/marketplace/goals", async () => selectRecent.all().map(row => {
    const goal = JSON.parse(String(row.body)) as Goal;
    return { id: goal.id, objective: goal.objective, status: goal.status, createdAt: goal.createdAt };
  }));
  let windowStart = Date.now();
  let created = 0;
  app.post("/api/marketplace/goals", { bodyLimit: 8192 }, async (request, reply) => {
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); created = 0; }
    if (active.size >= 2 || created >= 4) return reply.code(429).send({ error: "Goal execution limit reached" });
    let goal;
    try { goal = createGoal(request.body); } catch { return reply.code(400).send({ error: "Invalid goal or deliverable" }); }
    created++;
    const snapshot = structuredClone(goal);
    insert.run(goal.id, JSON.stringify(goal));
    schedule(executeGoal(goal, env, record(goal), fetch, async (step, mission) => {
      const requested = goal.procurement;
      if (!requested) throw new Error("Research preview is unavailable");
      const task = parseResearchTask({ goalId: goal.id, parentId: goal.rootMissionId, missionId: mission.missionId,
        queries: step.queries, sourceCount: 3, inputDigest: mission.inputDigest });
      const outcomes = await discoverResearch(task, env);
      save(goal, "research.bids", { outcomes });
      requested.plan = await planResearch(task, requested.budget, requested.maxTest, requested.penalty, outcomes,
        worker => ledger.observations(worker));
      save(goal, "research.plan", { hash: requested.plan.planHash, decision: requested.plan.decision });
      return null;
    }));
    return reply.code(201).send(snapshot);
  });
  type Params = { goalId: string };
  app.get<{ Params: Params }>("/api/marketplace/goals/:goalId", async (request, reply) => {
    const goal = find(request.params.goalId);
    return goal ? { ...goal, ledger: ledger.summary(goal.id) } : reply.code(404).send({ error: "Goal not found" });
  });
  app.get<{ Params: Params }>("/api/marketplace/goals/:goalId/preflight", async (request, reply) => {
    if (!authenticated(request.headers.authorization)) return reply.code(403).send({ error: "Operator authentication required" });
    const goal = find(request.params.goalId);
    const plan = goal?.procurement?.plan;
    if (!goal || !plan || goal.status !== "awaiting_authorization" || ledger.scope(goal.id) || !env.X402_PAYER_ID) {
      return reply.code(409).send({ error: "No untouched reviewed research plan" });
    }
    try {
      const payer = env.X402_PAYER_ID;
      const checked = await inspectLiveInfrastructure(goal.id, payer, env);
      await Promise.all(plan.quotes.map(async quote => {
        const bid = bidFor(plan, quote);
        const body = paidResearchRequest(plan.task, bid, quote.phase);
        const amount = BigInt(quote.amount);
        const { requirement } = await requestResourceQuote(new SpendingPolicy(quote.endpoint, quote.merchant, amount, amount), body);
        if (requirement.amount !== quote.amount || requirement.extra?.researchRequest !== digest(body)) throw new Error("Quote changed");
      }));
      const test = BigInt(plan.decision.testPrice);
      const hire = plan.quotes.filter(quote => quote.phase === "hire").reduce((max, quote) =>
        BigInt(quote.amount) > max ? BigInt(quote.amount) : max, 0n);
      const messages = test > 0n ? 12 : 9;
      if (BigInt(checked.payerBalance) < test + hire || BigInt(checked.operatorBalance) < BigInt(messages) * researchAuditFee ||
          ledger.intents(goal.id).length) throw new Error("Insufficient balance or prior intent");
      return { goalId: goal.id, parentId: goal.rootMissionId, missionId: plan.task.missionId, deliverable: goal.deliverable,
        plan, payer, payerBalance: checked.payerBalance, operatorBalance: checked.operatorBalance, feePayer: X402_FEE_PAYER,
        maxSponsoredFee: X402_MAX_FEE.toString(), network: X402_NETWORK, asset: X402_ASSET,
        proposedMaxTotal: (test + hire).toString(), proposedMaxHire: hire.toString(), proposedMaxPayments: test > 0n ? 2 : 1,
        topic: AUDIT_TOPIC, topicHead: checked.topicHead, proposedAuditMessages: messages, maxAuditFee: (BigInt(messages) * researchAuditFee).toString(),
        previousIntents: 0, authorization: "required" };
    } catch { return reply.code(503).send({ error: "Research quote, payer, or topic preflight failed" }); }
  });
  app.post<{ Params: Params }>("/api/marketplace/goals/:goalId/authorize", { bodyLimit: 4096 }, async (request, reply) => {
    if (!authenticated(request.headers.authorization)) return reply.code(403).send({ error: "Operator authentication required" });
    if (env.RESEARCH_LIVE_ENABLED !== "true" || env.GROQ_GOALS_ENABLED !== "true" || !env.GROQ_API_KEY || active.size >= 2) {
      return reply.code(503).send({ error: "Research live mode and inference must be enabled separately" });
    }
    const goal = find(request.params.goalId);
    const procurement = goal?.procurement;
    const plan = procurement?.plan;
    if (!goal || !procurement || !plan || goal.status !== "awaiting_authorization") return reply.code(409).send({ error: "No reviewed plan" });
    try {
      const scope = validateResearchScope(request.body, plan.task, plan.planHash, plan.bids, procurement.budget, procurement.maxTest, env.X402_PAYER_ID);
      assertResearchPlanScope(plan, scope);
      const messages = plan.decision.action === "TEST" ? 12 : 9;
      if (scope.maxAuditMessages && (scope.maxAuditMessages < messages || BigInt(scope.maxAuditFee) < BigInt(messages) * researchAuditFee)) {
        throw new Error("Audit allowance does not cover the reviewed lifecycle");
      }
      const child = goal.missions.find(mission => mission.missionId === scope.missionId);
      if (!child || child.status !== "ready" || Date.now() >= Date.parse(child.authorization.expiresAt)) throw new Error("Mission expired");
      db.exec("BEGIN IMMEDIATE");
      try {
        if (find(goal.id)?.status !== "awaiting_authorization" || ledger.scope(goal.id) || ledger.intents(goal.id).length) throw new Error("Already authorized");
        ledger.approve(scope);
        child.authorization.maxSpendTinybars = scope.childAllocation;
        child.authorization.expiresAt = new Date(Math.min(Date.parse(child.authorization.expiresAt), Date.parse(scope.expiresAt))).toISOString();
        goal.status = "running";
        save(goal, "research.authorization.granted", scope);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      schedule((async () => {
        await executeGoal(goal, env, record(goal), fetch, async (_step, mission) => {
          if (mission.missionId !== scope.missionId || Date.now() >= Date.parse(mission.authorization.expiresAt)) {
            throw new Error("Delegation identity or expiry mismatch");
          }
          return executePaidResearch(plan, scope, ledger, env, record(goal));
        });
        const mayPublish = scope.maxAuditMessages > 0 && goal.events.some(event => event.kind === "research.payment.verified");
        procurement.auditStatus = mayPublish ? "pending" : scope.maxAuditMessages ? "stopped_before_publication" : "not_authorized";
        save(goal, "research.audit.status", { status: procurement.auditStatus });
        if (mayPublish) {
          try {
            await publishGoalAudit(goal, scope, env, record(goal));
            procurement.auditStatus = "verified";
          } catch { procurement.auditStatus = "stopped_for_review"; }
          save(goal, "research.audit.status", { status: procurement.auditStatus });
        }
      })());
      return reply.code(202).send({ goalId: goal.id, status: "running" });
    } catch { return reply.code(409).send({ error: "Delegated scope rejected, expired, or already claimed" }); }
  });
  app.get<{ Params: Params }>("/api/marketplace/goals/:goalId/reconcile", async (request, reply) => {
    if (!authenticated(request.headers.authorization)) return reply.code(403).send({ error: "Operator authentication required" });
    const summary = ledger.summary(request.params.goalId);
    if (!summary) return reply.code(404).send({ error: "Research ledger not found" });
    try {
      const mirror = loadHederaMirrorNodeUrl(env);
      const [payments, history] = await Promise.all([
        Promise.all(summary.intents.map(async intent => ({ id: intent.id, transactionId: intent.transactionId,
          evidence: intent.transactionId ? await reconcilePayment(mirror, { transactionId: intent.transactionId,
            payer: summary.scope.payer, merchant: intent.merchant, amountTinybars: intent.amount }) : null }))),
        readVerifiedHistory(mirror),
      ]);
      return { payments, audit: history.filter(item => item.event.jobId === request.params.goalId) };
    } catch { return reply.code(503).send({ error: "Independent evidence unavailable" }); }
  });
  app.get<{ Params: Params; Querystring: { cursor?: string } }>("/api/marketplace/goals/:goalId/events", (request, reply) => {
    if (!find(request.params.goalId)) return reply.code(404).send({ error: "Goal not found" });
    return streams.open(reply, request.headers["last-event-id"] ?? request.query.cursor ?? "0",
      cursor => find(request.params.goalId)?.events.filter(event => event.id > cursor) ?? []);
  });
}
