import { planPrompt } from "../src/goals/plan.js";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPayerSigner } from "../src/agents/payer.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import Fastify from "fastify";
import { loadHederaConfig } from "../src/config/hedera.js";
import type { AuditEvent } from "../src/hedera/audit-event.js";
import { digest } from "../src/marketplace/protocol.js";
import { inspectPayment, paymentExplorerUrl, workerQuote } from "../src/x402/protocol.js";
import { goalAuditManifest, publishGoalAudit } from "../src/goals/research-audit.js";
import { executePaidResearch } from "../src/goals/research-execution.js";
import { ResearchLedger, validateResearchScope } from "../src/goals/research-ledger.js";
import { discoverResearch, planResearch } from "../src/goals/research-plan.js";
import type { ResearchPlan } from "../src/goals/research-plan.js";
import { paidResearchRequest, parseResearchTask, RESEARCH_BINDING, researchBinding, researchWorkers, testRepository, verifyResearchBid, workerOrigin } from "../src/goals/research-protocol.js";
import { createResearchWorker, retrieveResearch } from "../src/goals/research-worker.js";
import { registerGoals } from "../src/goals/routes.js";
import { ResearchTools } from "../src/goals/tools.js";
import { createGoal, executeGoal } from "../src/goals/workflow.js";

const merchant = "0.0.11330954", payer = "0.0.11331589";
const env = { GROQ_GOALS_ENABLED: "true", GROQ_API_KEY: "mock", X402_PAYER_ID: payer };
const objective = "Compare three open-source agent frameworks";
const budget = { budget: "250000", maxTest: "5000", penalty: "160000" };
const steps = [
  { id: "search", capability: "web.research", objective: "Collect source evidence", dependencies: [], acceptance: ["Three sources"], queries: ["agent framework", "agent toolkit"] },
  { id: "write", capability: "document.report", objective: "Write the comparison", dependencies: ["search"], acceptance: ["Cite sources"], queries: [] },
  { id: "verify", capability: "verification.artifacts", objective: "Verify report", dependencies: ["write"], acceptance: ["Evidence checked"], queries: [] },
];
const quote = "This framework provides documented interfaces for running specialized agent workflows.";
const names = ["org/framework-a", "org/framework-b", "org/framework-c"];
const sourceText = (name: string) => quote + " Public documentation for " + name;
function blob(name: string) {
  const bytes = Buffer.from(sourceText(name));
  return { sha: createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex"),
    content: bytes.toString("base64"), encoding: "base64" };
}
const fakeGitHub: typeof fetch = async input => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.github.com");
  if (url.pathname === "/search/repositories") {
    return Response.json({ items: names.map(full_name => ({ full_name, private: false, license: { spdx_id: "MIT" } })) });
  }
  return Response.json(blob(url.pathname.replace(/^\/repos\//, "").replace(/\/readme$/, "")));
};
const fakeGroq: typeof fetch = async (_input, init) => {
  const message = JSON.parse(String(init?.body)).messages[0].content as string;
  const value = message.startsWith(planPrompt) ? { steps } :
    message.startsWith("Write") ? { title: "Comparison", recommendation: "Pilot the best fit.",
      findings: names.map(name => ({ analysis: "Provides documented agent interfaces.", quote, sourceId: blob(name).sha })) } :
      { passed: true, notes: "The cited passages are present." };
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { total_tokens: 300 } });
};
function scopeFor(plan: ResearchPlan) {
  const test = plan.decision.action === "TEST";
  return validateResearchScope({ goalId: plan.task.goalId, parentId: plan.task.parentId, missionId: plan.task.missionId,
    planHash: plan.planHash, payer, merchants: [merchant], endpoints: plan.quotes.map(item => item.endpoint),
    capability: "web.research", network: "hedera:testnet", asset: "0.0.0", total: "250000", parentAllocation: "230000",
    childAllocation: "200000", maxTest: test ? "5000" : "0", maxHire: "175000", maxPerPayment: "175000",
    maxPayments: test ? 2 : 1, maxSponsoredFee: "100000000", expiresAt: new Date(Date.now() + 240_000).toISOString(),
    maxAuditMessages: test ? 12 : 9, maxAuditFee: test ? "120000000" : "90000000", maxDelegationDepth: 1 },
  plan.task, plan.planHash, plan.bids, budget.budget, budget.maxTest, payer);
}

async function workerHarness() {
  const apps = researchWorkers.map(worker => createResearchWorker(worker, env));
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const index = researchWorkers.findIndex(worker => workerOrigin(worker) === url.origin);
    assert.ok(index >= 0);
    const response = await apps[index].inject({ method: options?.method === "POST" ? "POST" : "GET", url: url.pathname,
      payload: options?.body === undefined ? undefined : JSON.parse(String(options.body)) });
    return new Response(response.body, { status: response.statusCode, headers: response.headers as Record<string, string> });
  };
  return { transport, close: () => Promise.all(apps.map(app => app.close())) };
}

test("independent research worker routes quote task-bound prices and require x402", async () => {
  const harness = await workerHarness();
  try {
    const goal = createGoal({ objective, deliverable: "Cited report", procurement: budget });
    const task = parseResearchTask({ goalId: goal.id, parentId: goal.rootMissionId, missionId: "11111111-aaaa-4bbb-8ccc-222222222222",
      queries: ["agent framework", "agent toolkit"], sourceCount: 3, inputDigest: digest("input") });
    const found = await discoverResearch(task, env, harness.transport);
    const plan = await planResearch(task, budget.budget, budget.maxTest, budget.penalty, found, () => [], harness.transport);
    assert.equal(plan.bids.length, 2);
    assert.notEqual(plan.bids[0].priceTinybars, plan.bids[1].priceTinybars);
    assert.equal(plan.decision.action, "TEST");
    const skipped = await planResearch(task, budget.budget, "0", "0", found, () => [], harness.transport);
    assert.equal(skipped.decision.action, "SKIP");
    assert.throws(() => verifyResearchBid(plan.bids[0], researchWorkers[0], { ...task, sourceCount: 4 }, merchant));
    assert.throws(() => verifyResearchBid(plan.bids[0], researchWorkers[0], task, merchant, Date.now() + 700_000));
    const challenge = await harness.transport(plan.bids[0].endpoint, { method: "POST",
      body: JSON.stringify(paidResearchRequest(task, plan.bids[0], "hire")) });
    assert.equal(challenge.status, 402);
    assert.ok(challenge.headers.get("payment-required"));
  } finally { await harness.close(); }
});

test("research ledger conserves child funds across SQLite connections and blocks uncertain reuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agenthire-paid-ledger-"));
  const filename = join(directory, "ledger.sqlite");
  const db = new DatabaseSync(filename);
  const other = new DatabaseSync(filename);
  const ledger = new ResearchLedger(db);
  const concurrent = new ResearchLedger(other);
  const harness = await workerHarness();
  try {
    const goal = createGoal({ objective, deliverable: "Report", procurement: budget });
    const task = parseResearchTask({ goalId: goal.id, parentId: goal.rootMissionId, missionId: "11111111-aaaa-4bbb-8ccc-222222222222",
      queries: ["agent framework"], sourceCount: 3, inputDigest: digest("input") });
    const plan = await planResearch(task, budget.budget, budget.maxTest, budget.penalty, await discoverResearch(task, env, harness.transport), () => [], harness.transport);
    const scope = scopeFor(plan);
    ledger.approve(scope);
    const selected = plan.quotes.find(item => item.phase === "hire")!;
    const intent = { id: "hire", phase: "hire" as const, amount: selected.amount, workerId: selected.workerId, merchant };
    ledger.reserve(scope, intent, selected.endpoint, merchant);
    assert.equal(ledger.summary(goal.id)?.available, (200000n - BigInt(selected.amount)).toString());
    ledger.mark(intent.id, ["reserved"], "submitted", { transactionId: "test-transaction" });
    ledger.mark(intent.id, ["submitted"], "uncertain");
    assert.throws(() => concurrent.reserve(scope, { ...intent, id: "different-intent" }, selected.endpoint, merchant));
    assert.equal(concurrent.summary(goal.id)?.reserved, selected.amount);
    const probe = plan.quotes.find(item => item.phase === "test");
    if (probe) assert.throws(() => concurrent.reserve(scope, { ...intent, id: "test", phase: "test", amount: probe.amount }, probe.endpoint, merchant));
    ledger.mark(intent.id, ["uncertain"], "settled", { fee: "300000" });
    assert.throws(() => ledger.mark(intent.id, ["settled"], "released"));
    ledger.observe(selected.workerId, "hire", intent.id, true, {});
    ledger.observe(selected.workerId, "hire", intent.id, false, {});
    assert.deepEqual(ledger.observations(selected.workerId), [true]);
  } finally { await harness.close(); db.close(); other.close(); await rm(filename, { force: true }); await rmdir(directory); }
});

test("full goal delegates, settles through mocked boundary, verifies real artifact shape, and publishes mock HCS", async () => {
  const harness = await workerHarness();
  const key = PrivateKey.generateECDSA();
  const hederaEnv = { HEDERA_NETWORK: "testnet", HEDERA_OPERATOR_ID: merchant, HEDERA_OPERATOR_KEY: key.toStringDer() };
  const config = loadHederaConfig(hederaEnv);
  for (const scenario of ["success", "paid-failure", "uncertain"] as const) {
    const db = new DatabaseSync(":memory:");
    const ledger = new ResearchLedger(db);
    const goal = createGoal({ objective, deliverable: "Cited report", procurement: budget });
    const save = (kind: string, detail: object = {}) =>
      goal.events.push({ id: goal.events.length + 1, kind, detail, at: new Date().toISOString() });
    try {
      await executeGoal(goal, env, save, fakeGroq, async (step, mission) => {
        const task = parseResearchTask({ goalId: goal.id, parentId: goal.rootMissionId, missionId: mission.missionId,
          queries: step.queries, sourceCount: 3, inputDigest: mission.inputDigest });
        const outcomes = await discoverResearch(task, env, harness.transport);
        save("research.bids", { outcomes });
        goal.procurement!.plan = await planResearch(task, budget.budget, budget.maxTest, budget.penalty, outcomes, () => [], harness.transport);
        return null;
      });
      assert.equal(goal.status, "awaiting_authorization");
      assert.equal(goal.artifacts.length, 0);
      const plan = goal.procurement!.plan!;
      const scope = scopeFor(plan);
      ledger.approve(scope);
      save("research.authorization.granted", scope);
      let payments = 0;
      await executeGoal(goal, env, save, fakeGroq, async () => executePaidResearch(plan, scope, ledger, env, save, {
        async inspectLiveInfrastructure() { return { key, config, payerBalance: "250000", operatorBalance: "120000000", topicHead: "9" }; },
        async payForResource(policy, body, payingAccount, _sign, hooks) {
          const request = body as ReturnType<typeof paidResearchRequest>;
          assert.ok(hooks);
          const challenge = workerQuote(policy.endpoint, merchant, policy.maxTotal.toString());
          challenge.accepts[0].extra = { ...challenge.accepts[0].extra, researchRequest: digest(request) };
          assert.ok(encodePaymentRequiredHeader(challenge));
          await hooks.authorize(challenge);
          const transactionId = `0.0.9185802@180000000${++payments}.000000001`;
          await hooks.submitted(transactionId);
          if (scenario === "uncertain") throw new Error("Transport lost");
          await hooks.settled(transactionId);
          if (scenario === "paid-failure" && request.phase === "hire") throw new Error("Worker unavailable after settlement");
          const tools = new ResearchTools(fakeGitHub);
          const worker = researchWorkers.find(item => item.id === request.bid.workerId)!;
          const sources = request.phase === "test" ? [await tools.dispatch("github.read", testRepository, ["github.read"])]
            : await retrieveResearch(worker, request.task, tools);
          return { transactionId, explorer: paymentExplorerUrl(transactionId), network: "hedera:testnet", asset: "0.0.0",
            amountTinybars: policy.maxTotal.toString(), payer: payingAccount, merchant, status: "facilitator-settled",
            worker: { intentId: request.intentId, workerId: request.bid.workerId, sources } };
        },
        async reconcilePayment() { return scenario === "uncertain" ? { status: "pending" } :
          { status: "verified", feeTinybars: "300000", consensusTimestamp: "1800000001.000000002" }; },
        tools: () => new ResearchTools(fakeGitHub),
      }));
      if (scenario === "uncertain") {
        assert.equal(goal.status, "failed");
        assert.equal(payments, 1);
        assert.equal(ledger.summary(goal.id)?.reserved, "5000");
        assert.equal(ledger.summary(goal.id)?.intents[0].state, "uncertain");
        continue;
      }
      assert.equal(payments, 2);
      assert.equal(ledger.summary(goal.id)?.sponsoredFees, "600000");
      if (scenario === "paid-failure") {
        assert.equal(goal.status, "failed");
        assert.equal(ledger.summary(goal.id)?.intents[1].state, "settled");
        assert.equal(goal.artifacts.length, 0);
        continue;
      }
      assert.equal(goal.status, "completed");
      assert.equal(goal.artifacts.length, 3);
      assert.deepEqual(goal.artifacts[1].parents, [goal.artifacts[0].id]);
      assert.equal(goal.artifacts[0].verification, "verified");
      assert.ok(goal.artifacts.every(artifact => artifact.hash === digest(artifact.content)));
      const manifest = goalAuditManifest(goal);
      assert.equal(manifest.length, 12);
      assert.equal(new Set(manifest.map(event => event.eventId)).size, 12);
      const indexed = new Map<string, AuditEvent>();
      await publishGoalAudit(goal, scope, hederaEnv, save, {
        async actualAuditFee() { return "450000"; },
        async checkAuditTopic() { return "120000000"; },
        async readVerifiedHistory() { return []; },
        async submitAuditEvent(_client, topicId, event, options) {
          assert.equal(options.maxFee.toTinybars().toString(), "10000000");
          const sequenceNumber = String(indexed.size + 10);
          const transactionId = `${merchant}@1800000000.${sequenceNumber.padStart(9, "0")}`;
          await options.beforeSubmit?.(transactionId);
          indexed.set(sequenceNumber, event);
          return { topicId, sequenceNumber, transactionId, receiptStatus: "SUCCESS", hashScanUrl: paymentExplorerUrl(transactionId) };
        },
        async verifyAuditEvent(_mirror, topicId, sequenceNumber) {
          return { status: "verified", event: indexed.get(sequenceNumber)!, topicId, sequenceNumber, consensusTimestamp: "1800000001.000000003" };
        },
      });
      assert.equal(indexed.size, 12);
      await assert.rejects(publishGoalAudit(goal, scope, hederaEnv, save), /Prior uncertain activity/);
    } finally { db.close(); }
  }
  await harness.close();
});

test("anonymous users cannot authorize research payment or publication", async () => {
  const app = Fastify();
  registerGoals(app, { RESEARCH_LIVE_ENABLED: "true", MARKETPLACE_OPERATOR_TOKEN: "z".repeat(32) }, ":memory:");
  try {
    for (const operation of ["authorize", "preflight", "reconcile"]) {
      const response = await app.inject({ method: operation === "authorize" ? "POST" : "GET",
        url: "/api/marketplace/goals/unknown/" + operation });
      assert.equal(response.statusCode, 403);
    }
  } finally { await app.close(); }
});

test("worker verifies bound signed proof, settles, then checks Mirror before releasing research", async () => {
  const key = PrivateKey.generateECDSA();
  const worker = researchWorkers[0];
  const order: string[] = [];
  const intents = new Set<string>();
  const app = createResearchWorker(worker, env, {
    facilitator: {
      async verify() { order.push("verify"); return { isValid: true, payer }; },
      async settle(payload, requirements) {
        order.push("settle");
        return { success: true, network: "hedera:testnet", payer, amount: requirements.amount,
          transaction: inspectPayment(payload.payload.transaction, requirements).transactionId };
      },
    },
    async lookup() { return { publicKey: key.publicKey, balanceTinybars: "250000" }; },
    async reconcile() { order.push("mirror"); return { status: "verified", feeTinybars: "300000", consensusTimestamp: "1800000000.000000001" }; },
    async claimPayment() { return true; },
    async claimIntent(id) { if (intents.has(id)) return false; intents.add(id); return true; },
    tools: () => { order.push("execute"); return new ResearchTools(fakeGitHub); },
  });
  try {
    const goal = createGoal({ objective, deliverable: "Report", procurement: budget });
    const task = parseResearchTask({ goalId: goal.id, parentId: goal.rootMissionId, missionId: "11111111-aaaa-4bbb-8ccc-222222222222",
      queries: ["agent framework"], sourceCount: 3, inputDigest: digest("input") });
    const bidReply = await app.inject({ method: "POST", url: "/bid", payload: task });
    const bid = verifyResearchBid(bidReply.json(), worker, task, merchant);
    const body = paidResearchRequest(task, bid, "test");
    const challengeReply = await app.inject({ method: "POST", url: "/capability-test", payload: body });
    assert.equal(challengeReply.statusCode, 402);
    assert.deepEqual(order, []);
    const challenge = decodePaymentRequiredHeader(String(challengeReply.headers["payment-required"]));
    const sign = createPayerSigner(payer, key);
    const proof = await sign(challenge);
    const transaction = proof.payload.transaction;
    assert.equal(typeof transaction, "string");
    const signature = Buffer.from(key.sign(researchBinding(digest(body), bid.testEndpoint, bid.testPrice, merchant, transaction as string))).toString("hex");
    const header = encodePaymentSignatureHeader({ ...proof, extensions: { ...proof.extensions, [RESEARCH_BINDING]: signature } });
    const execute = () => app.inject({ method: "POST", url: "/capability-test", payload: body, headers: { "payment-signature": header } });
    const result = await execute();
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().sources[0].repository, testRepository);
    assert.deepEqual(order, ["verify", "settle", "mirror", "execute"]);
    assert.equal((await execute()).statusCode, 409);
    assert.equal(order.filter(item => item === "settle").length, 1);
  } finally { await app.close(); }
});
