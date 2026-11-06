import { PrivateKey } from "@hiero-ledger/sdk";
import { loadHederaConfig } from "../src/config/hedera.js";
import { capabilityDigest, parseCapabilityRequest } from "../src/x402/capability-binding.js";
import { paymentExplorerUrl, workerQuote } from "../src/x402/protocol.js";
import type { AuditEvent } from "../src/hedera/audit-event.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { collectBids, decide, parseJob, planBinding } from "../src/marketplace/manager.js";
import { evaluateProduction, operatorAuthorized, parseScope, runLive } from "../src/marketplace/live.js";
import { offer, origin, profile, seeds, validateOffer } from "../src/marketplace/protocol.js";
import { registerMarketplace } from "../src/marketplace/routes.js";
import { JobStore } from "../src/marketplace/store.js";
import { createWorker, executeStatistics } from "../src/marketplace/worker.js";

const merchant = "0.0.11330954";
const payer = "0.0.11331589";
const form = { title: "New dataset", mode: "preview", input: [10, 20, 30, 40, 50], capability: "statistics.summary",
  budget: "1000000", penalty: "450000", maxTest: "5000" };

test("job validation binds a fresh identity and rejects unsupported datasets", () => {
  const job = parseJob(form);
  assert.notEqual(job.id, parseJob(form).id);
  assert.deepEqual(job.task.input, form.input);
  assert.throws(() => parseJob({ ...form, input: [] }));
  assert.throws(() => parseJob({ ...form, input: [Infinity] }));
  assert.throws(() => parseJob({ ...form, maxTest: "1000001" }));
  assert.throws(() => parseJob({ ...form, merchant }));
});

test("worker endpoints return actual health and bids, then challenge protected execution", async () => {
  const worker = createWorker(seeds[0], {});
  try {
    const task = parseJob(form).task;
    const health = await worker.inject("/health");
    assert.deepEqual(health.json(), { status: "ok", workerId: "fast" });
    const offered = await worker.inject({ method: "POST", url: "/bid", payload: task });
    const bound = validateOffer(offered.json(), seeds[0], task, merchant);
    assert.equal(bound.bid.taskId, task.taskId);
    assert.throws(() => validateOffer(offered.json(), seeds[0], { ...task, input: [3] }, merchant));
    assert.throws(() => validateOffer(offered.json(), seeds[0], task, merchant, Date.now() + 600_001));
    const payload = { taskId: task.taskId, testId: `${task.taskId}-fast-statistics-v1`, workerId: "fast",
      capability: task.capability, input: task.input };
    for (const [url, amount] of [["/execute", bound.bid.priceTinybars], ["/capability-test", "5000"]]) {
      const response = await worker.inject({ method: "POST", url, payload });
      assert.equal(response.statusCode, 402);
      const quote = decodePaymentRequiredHeader(String(response.headers["payment-required"]));
      assert.equal(quote.accepts[0].amount, amount);
      assert.match(String(quote.accepts[0].extra?.capabilityRequest), /^[a-f0-9]{64}$/);
      assert.equal(response.json().count, undefined);
    }
    const rejected = await worker.inject({ method: "POST", url: "/execute", payload, headers: { "payment-signature": "invalid" } });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().count, undefined);
  } finally { await worker.close(); }
});

test("worker implementations produce input-dependent independently verified results", () => {
  for (const seed of seeds) {
    for (const input of [form.input, [-4, 0, 4, 12]]) {
      const actual = executeStatistics(seed, input);
      assert.ok(evaluateProduction(input, actual).passed);
      assert.equal(actual.mean, input === form.input ? 30 : 3);
    }
  }
  assert.throws(() => executeStatistics(seeds[0], Array(21).fill(0)));
  assert.equal(evaluateProduction(form.input, { count: 5, min: 10, max: 50, mean: 7 }).passed, false);
});

test("concurrent discovery rejects malformed bids and continues after a worker outage", async context => {
  const store = new JobStore(":memory:");
  const job = parseJob(form);
  store.create(job);
  const fetch = context.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    const seed = seeds.find(candidate => url.startsWith(origin(candidate)));
    assert.ok(seed);
    if (seed.id === "premium") throw new Error("offline");
    if (url.endsWith("/health")) return Response.json({ status: "ok", workerId: seed.id });
    if (url.endsWith("/agent")) return Response.json({ workerId: seed.id, endpoint: origin(seed) + "/execute",
      merchant, maxInput: seed.max, capabilities: ["statistics.summary"] });
    const result = offer(seed, JSON.parse(String(options?.body)), merchant);
    if (seed.id === "fast") result.bid.endpoint = "http://169.254.169.254/execute";
    return Response.json(result);
  });
  try {
    const candidates = await collectBids(store, job);
    assert.deepEqual(candidates.map(row => row.bid.workerId), ["reliable"]);
    assert.ok(store.events(job.id).some(event => event.kind === "worker.unavailable"));
    assert.ok(store.events(job.id).some(event => event.kind === "bid.rejected"));
    const plan = await decide(job, candidates);
    assert.equal(plan.trace.action, "SKIP");
    assert.equal(plan.trace.result, null);
    assert.ok(fetch.mock.calls.every(call => !String(call.arguments[0]).endsWith("/execute")));
  } finally { store.close(); }
});

test("PoCP can propose a positive-value test without simulated execution", async () => {
  const job = parseJob(form);
  const candidates = seeds.map(seed => {
    const { bid } = offer(seed, job.task, merchant);
    return { bid, adapter: { profile: profile(seed), async bid() { return bid; }, capabilityTest: { priceTinybars: "5000", timeoutMs: 200,
      async run() { assert.fail("preview invoked protected execution"); } } } };
  });
  const plan = await decide(job, candidates);
  assert.equal(plan.trace.executionMode, "preview");
  assert.equal(plan.trace.action, "TEST");
  assert.equal(plan.trace.result, null);
  const skipped = await decide({ ...job, task: { ...job.task, pocp: { failurePenaltyTinybars: "0" } } },
    candidates);
  assert.equal(skipped.trace.action, "SKIP");
});

test("authorization is job-scoped, time-limited, allowlisted, and enforces spending and HCS caps", () => {
  const job = parseJob({ ...form, mode: "live" });
  const env = { X402_PAYER_ID: payer, X402_MERCHANT_ID: merchant };
  const token = "a".repeat(32);
  assert.equal(operatorAuthorized("Bearer " + token, token), true);
  assert.equal(operatorAuthorized("Bearer " + token, undefined), false);
  const policy = { jobId: job.id, payer, merchant, endpoints: [origin(seeds[0]) + "/execute"], network: "hedera:testnet",
    asset: "0.0.0", maxTotal: "1000000", maxTest: "5000", maxHire: "750000", maxPayments: 2,
    maxSponsoredFee: "100000000", expiresAt: new Date(Date.now() + 60_000).toISOString(),
    topic: "0.0.11331471", maxAuditMessages: 10, maxAuditFee: "100000000" };
  assert.equal(parseScope(policy, job, env).jobId, job.id);
  for (const invalid of [{ maxTest: "5001" }, { maxTotal: "1000001" }, { maxSponsoredFee: "100000001" },
    { maxAuditFee: "100000001" }, { topic: "0.0.1" }, { endpoints: ["http://169.254.169.254/execute"] },
    { jobId: "paid-pocp-live-001" }, { expiresAt: new Date(0).toISOString() }]) {
    assert.throws(() => parseScope({ ...policy, ...invalid }, job, env));
  }
});

test("SQLite restart preserves job and event cursors and rejects duplicate live claims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agenthire-marketplace-"));
  try {
    const path = join(directory, "jobs.sqlite");
    const job = { ...parseJob(form), status: "awaiting_authorization" };
    const first = new JobStore(path);
    first.create(job);
    const firstId = first.events(job.id)[0].id;
    assert.equal(first.transition(job.id, "awaiting_authorization", "executing", "authorization.granted"), true);
    assert.equal(first.transition(job.id, "awaiting_authorization", "executing", "authorization.granted"), false);
    first.close();
    const restarted = new JobStore(path);
    assert.equal(restarted.job(job.id)?.status, "executing");
    assert.deepEqual(restarted.events(job.id, firstId).map(row => row.kind), ["authorization.granted"]);
    const app = Fastify();
    registerMarketplace(app, {}, restarted);
    const restored = await app.inject(`/api/marketplace/jobs/${job.id}`);
    assert.equal(restored.json().job.status, "needs_reconciliation");
    assert.equal((await app.inject({ method: "POST", url: `/api/marketplace/jobs/${job.id}/authorize`, payload: {} })).statusCode, 403);
    await app.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("SSE reconnect sends persisted events after Last-Event-ID", async () => {
  const app = Fastify();
  const store = new JobStore(":memory:");
  const job = { ...parseJob(form), status: "preview_ready" };
  store.create(job);
  const cursor = store.events(job.id)[0].id;
  store.event(job.id, "preview.ready", { paymentAuthorized: false });
  registerMarketplace(app, {}, store);
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const controller = new AbortController();
  try {
    const response = await fetch(`${url}/api/marketplace/jobs/${job.id}/events`, {
      headers: { "Last-Event-ID": String(cursor) }, signal: controller.signal,
    });
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = response.body!.getReader();
    let received = "";
    while (!received.includes("preview.ready")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += new TextDecoder().decode(chunk.value);
    }
    assert.match(received, /preview.ready/);
    assert.doesNotMatch(received, /job.created/);
    await reader.cancel();
  } finally { controller.abort(); await app.close(); }
});

test("live manager evaluates real worker output with mocked settlement and stops on uncertainty", async () => {
  const key = PrivateKey.generateECDSA();
  const config = loadHederaConfig({ HEDERA_NETWORK: "testnet", HEDERA_OPERATOR_ID: merchant, HEDERA_OPERATOR_KEY: key.toStringDer() });
  for (const uncertain of [false, true]) {
    const store = new JobStore(":memory:");
    try {
      const job = { ...parseJob({ ...form, mode: "live" }), status: "executing" };
      store.create(job);
      const candidates = seeds.map(seed => {
        const { bid } = offer(seed, job.task, merchant);
        return { bid, adapter: { profile: profile(seed), async bid() { return bid; },
          capabilityTest: { priceTinybars: "5000", timeoutMs: 2500, async run() { throw new Error("Protected"); } } } };
      });
      const planned = await decide(job, candidates);
      store.event(job.id, "authorization.required", { planHash: planBinding(candidates, planned) });
      const scope = parseScope({ jobId: job.id, payer, merchant,
        endpoints: seeds.flatMap(seed => [origin(seed) + "/execute", origin(seed) + "/capability-test"]),
        network: "hedera:testnet", asset: "0.0.0", maxTotal: "755000", maxTest: "5000", maxHire: "750000",
        maxPayments: 2, maxSponsoredFee: "100000000", expiresAt: new Date(Date.now() + 60_000).toISOString(),
        topic: "0.0.11331471", maxAuditMessages: 10, maxAuditFee: "100000000" },
      job, { X402_PAYER_ID: payer, X402_MERCHANT_ID: merchant });
      let paid = 0;
      const indexed = new Map<string, AuditEvent>();
      await runLive(store, job, scope, {}, {
        async inspectLiveInfrastructure() { return { config, key, payerBalance: "1000000", operatorBalance: "100000000", topicHead: "9" }; },
        async collectBids() { return candidates; },
        async payForResource(policy, body, payerId, _sign, hooks) {
          const request = parseCapabilityRequest(body);
          assert.ok(request);
          assert.ok(hooks);
          const amount = policy.maxPerPayment.toString();
          const quote = workerQuote(policy.endpoint, merchant, amount);
          quote.accepts[0].extra = { ...quote.accepts[0].extra, capabilityRequest: capabilityDigest(request) };
          await hooks.authorize(quote);
          const transactionId = `0.0.9185802@180000000${++paid}.000000001`;
          await hooks.submitted(transactionId);
          if (uncertain) throw new Error("Mock connection lost after submit");
          await hooks.settled(transactionId);
          const seed = seeds.find(seed => seed.id === request.workerId);
          assert.ok(seed);
          return { transactionId, explorer: paymentExplorerUrl(transactionId), network: "hedera:testnet", asset: "0.0.0",
            amountTinybars: amount, payer: payerId, merchant, status: "facilitator-settled",
            worker: executeStatistics(seed, request.input) };
        },
        async reconcilePayment() { return { status: "verified", feeTinybars: "300000", consensusTimestamp: "1800000001.000000002" }; },
        async submitAuditEvent(_client, topicId, event, options) {
          assert.equal(options.maxFee.toTinybars().toString(), "10000000");
          const sequenceNumber = String(indexed.size + 10);
          const transactionId = `${merchant}@1800000000.${sequenceNumber.padStart(9, "0")}`;
          await options.beforeSubmit?.(transactionId);
          indexed.set(sequenceNumber, event);
          return { topicId, sequenceNumber, transactionId, receiptStatus: "SUCCESS", hashScanUrl: paymentExplorerUrl(transactionId) };
        },
        async verifyAuditEvent(_mirror, topicId, sequenceNumber) {
          const event = indexed.get(sequenceNumber);
          assert.ok(event);
          return { event, status: "verified", topicId, sequenceNumber, consensusTimestamp: "1800000001.000000003" };
        },
      });
      const events = store.events(job.id);
      if (uncertain) {
        assert.equal(store.job(job.id)?.status, "needs_reconciliation");
        assert.equal(paid, 1);
        assert.equal(indexed.size, 0);
        assert.ok(!events.some(event => event.kind === "task.execution.completed"));
      } else {
        assert.equal(store.job(job.id)?.status, "completed");
        assert.equal(paid, 2);
        assert.equal(indexed.size, 10);
        assert.ok(events.some(event => event.kind === "reliability.updated"));
        const result = events.find(event => event.kind === "task.verification.completed")?.data;
        assert.equal(result.passed, true);
        assert.deepEqual(result.output, { count: 5, min: 10, max: 50, mean: 30 });
        assert.ok(!JSON.stringify(events).includes(key.toStringDer()));
      }
    } finally { store.close(); }
  }
});
