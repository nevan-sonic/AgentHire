import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProcurementBid, ProcurementTask } from "@agenthire/shared";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { createApp } from "../src/app.js";
import { compareBids, procure } from "../src/agents/manager.js";
import { createDemoRegistry, DEMO_MERCHANT, STATISTICS, WorkerRegistry } from "../src/agents/workers.js";
import type { WorkerAdapter } from "../src/agents/workers.js";
import { validateAuditEvent } from "../src/hedera/audit-event.js";
import { registerProcurementRoutes } from "../src/routes/procurement.js";
import { registerX402Worker } from "../src/routes/x402-worker.js";

const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const task: ProcurementTask = {
  taskId: "test-job", taskType: STATISTICS, capability: STATISTICS,
  input: [2, 4, 6, 8], maxBudgetTinybars: "1000000", deadlineMs: 1000,
  minimumReliabilityBps: 6000, selectionStrategy: "expected_cost",
};

const demoRegistry = () => createDemoRegistry(3001, DEMO_MERCHANT, now);
const decide = (overrides: Partial<ProcurementTask> = {}, registry = demoRegistry()) =>
  procure({ ...task, ...overrides }, registry, { now, bidTimeoutMs: 20 });

function single(change: (worker: WorkerAdapter) => WorkerAdapter) {
  const registry = new WorkerRegistry();
  registry.register(change(demoRegistry().discover()[0]));
  return registry;
}

function modified(overrides: Partial<ProcurementBid>) {
  return single((worker) => ({
    ...worker,
    async bid(task, signal) {
      return { ...await worker.bid(task, signal) as ProcurementBid, ...overrides };
    },
  }));
}

test("registers stable distinct workers and filters discovery by availability and capability", () => {
  const registry = demoRegistry();
  const workers = registry.discover(STATISTICS);
  assert.deepEqual(workers.map(({ profile }) => profile.workerId), ["balanced", "economy", "premium"]);
  assert.equal(new Set(workers.map(({ profile }) => profile.endpoint)).size, 3);
  assert.ok(workers.every(({ profile }) => profile.reliabilitySource === "demo-assumption"));
  assert.throws(() => registry.register(workers[0]), /duplicate worker ID/);
  assert.throws(() => new WorkerRegistry().register({
    ...workers[0], profile: { ...workers[0].profile, endpoint: "https://example.test/private" },
  }), /trusted local route/);
  assert.equal(registry.discover("unknown").length, 0);
  assert.equal(single((worker) => ({ ...worker, profile: { ...worker.profile, available: false } })).discover().length, 0);
});

test("collects three independent bids and chooses different winners by strategy", async () => {
  const expected = await decide();
  const cheapest = await decide({ selectionStrategy: "cheapest_eligible" });
  assert.equal(expected.bidsReceived.length, 3);
  assert.equal(expected.eligibleBids.length, 3);
  assert.equal(expected.selectedWorker?.workerId, "balanced");
  assert.equal(cheapest.selectedWorker?.workerId, "economy");
  assert.equal(expected.budgetRemainingTinybars, "250000");
  assert.deepEqual(expected.scoreBreakdown[0].expectedCostTinybars, { numerator: "7500000000", denominator: 9500 });
});

test("rejects expired, malformed, mismatched and unsafe bids without echoing destinations", async () => {
  const cases = [
    [{ expiresAt: "2025-12-31T23:59:59.000Z" }, "expired"],
    [{ taskId: "other" }, "identity_mismatch"],
    [{ workerId: "" }, "identity_mismatch"],
    [{ merchant: "0.0.555" }, "untrusted_payment_destination"],
    [{ endpoint: "https://example.test/secret" }, "untrusted_payment_destination"],
    [{ asset: "0.0.555" }, "unsupported_payment_asset_or_network"],
    [{ priceTinybars: "1000001" }, "over_budget"],
    [{ reliabilityBps: 5999 }, "below_minimum_reliability"],
    [{ priceTinybars: "-1" }, "invalid_price"],
    [{ priceTinybars: "1.1" }, "invalid_price"],
    [{ estimatedLatencyMs: 1001 }, "deadline_exceeded"],
  ] as const;
  for (const [overrides, reason] of cases) {
    const result = await decide({}, modified(overrides as Partial<ProcurementBid>));
    assert.equal(result.status, "no_eligible_bids");
    assert.deepEqual(result.rejectedBids, [{ workerId: "balanced", reason }]);
    assert.equal(result.paymentHandoff, null);
    assert.ok(!JSON.stringify(result).includes("example.test"));
  }
});

test("bounds unresponsive worker time and handles an empty registry", async () => {
  let aborted = false;
  const registry = single((worker) => ({
    ...worker,
    bid(_task, signal) {
      signal.addEventListener("abort", () => { aborted = true; });
      return new Promise(() => {});
    },
  }));
  const timeout = await decide({}, registry);
  assert.equal(aborted, true);
  assert.deepEqual(timeout.rejectedBids, [{ workerId: "balanced", reason: "timeout" }]);
  const empty = await decide({}, new WorkerRegistry());
  assert.equal(empty.status, "no_eligible_bids");
  assert.equal(empty.discoveredWorkers.length, 0);
  assert.equal(empty.paymentReadiness, "no_selection");
});

test("collects bids concurrently without allowing adapters to mutate the task", async () => {
  const registry = new WorkerRegistry();
  let started = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  for (const worker of demoRegistry().discover()) {
    registry.register({
      ...worker,
      async bid(input, signal) {
        if (++started === 3) release();
        await gate;
        assert.equal(input.input.length, 4);
        input.input.pop();
        return worker.bid(input, signal);
      },
    });
  }
  const result = await procure(task, registry, { now, bidTimeoutMs: 100 });
  assert.equal(result.eligibleBids.length, 3);
  assert.deepEqual(result.paymentHandoff?.input.values, task.input);
});

test("compares safe integer monetary strings exactly and resolves all ties deterministically", async () => {
  const [bid] = (await decide()).eligibleBids;
  const left = { ...bid, priceTinybars: "9007199254740992", workerId: "z" };
  const right = { ...bid, priceTinybars: "9007199254740993", workerId: "a" };
  assert.equal(compareBids(left, right, "expected_cost"), -1);
  assert.equal(compareBids(left, right, "cheapest_eligible"), -1);
  const a = { ...bid, priceTinybars: "100", reliabilityBps: 5000, workerId: "z" };
  const b = { ...bid, priceTinybars: "200", reliabilityBps: 10000, workerId: "a" };
  assert.equal(compareBids(a, b, "expected_cost"), -1);
  assert.ok(compareBids({ ...a, estimatedLatencyMs: 1 }, { ...a, workerId: "a" }, "expected_cost") < 0);
  assert.equal(compareBids(a, { ...a, workerId: "a" }, "expected_cost"), 1);
});

test("returns a non-authorizing payment handoff and validated pending HCS records without network calls", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network operation"));
  const result = await procure(task, demoRegistry(), { now, paymentEnabled: true });
  assert.deepEqual(result.paymentHandoff, {
    workerId: "balanced", endpoint: "http://localhost:3001/api/workers/analyze/balanced", merchant: DEMO_MERCHANT,
    network: "hedera:testnet", asset: "0.0.0", maxAuthorizedPaymentTinybars: "750000",
    input: { values: [2, 4, 6, 8] }, taskId: "test-job", bidId: "test-job-balanced",
    expiresAt: "2026-01-01T00:00:30.000Z", paymentAuthorized: false,
  });
  assert.deepEqual(result.pendingAuditRecords.map(({ event }) => event.eventType),
    ["JOB_CREATED", "BID_SUBMITTED", "BID_SUBMITTED", "BID_SUBMITTED", "WORKER_SELECTED"]);
  for (const { status, event } of result.pendingAuditRecords) {
    assert.equal(status, "pending");
    assert.deepEqual(validateAuditEvent(event), event);
  }
  assert.equal(network.mock.callCount(), 0);
});

test("serves discovery and procurement and exposes a matching unpaid quote for the selected adapter", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const registry = createDemoRegistry();
  registerProcurementRoutes(app, registry, true);
  const { profile } = registry.discover()[0];
  registerX402Worker(app, {
    ...profile, path: new URL(profile.endpoint).pathname,
    facilitator: { verify: async () => assert.fail("Unexpected verification"), settle: async () => assert.fail("Unexpected settlement") },
    claimPayment: async () => assert.fail("Unexpected payment claim"),
  });
  const workers = await app.inject("/api/agents/workers?capability=statistics.summary");
  assert.equal(workers.json().workers.length, 3);
  assert.equal((await app.inject("/api/agents/workers?capability=nope")).statusCode, 400);
  assert.equal((await app.inject("/api/agents/workers?capability=statistics.summary&capability=statistics.summary")).statusCode, 400);
  const send = (payload: object) => app.inject({ method: "POST", url: "/api/agents/procure", payload });
  assert.equal((await send({ ...task, maxBudgetTinybars: 1000000 })).statusCode, 400);
  assert.equal((await send({ ...task, input: ["2"] })).statusCode, 400);
  assert.equal((await send({ ...task, secret: "unexpected" })).statusCode, 400);
  const response = await send(task);
  assert.equal(response.statusCode, 200);
  const { paymentHandoff } = response.json();
  const unpaid = await app.inject({
    method: "POST", url: new URL(paymentHandoff.endpoint).pathname, payload: paymentHandoff.input,
  });
  assert.equal(unpaid.statusCode, 402);
  const quote = decodePaymentRequiredHeader(String(unpaid.headers["payment-required"]));
  assert.equal(quote.accepts[0].amount, paymentHandoff.maxAuthorizedPaymentTinybars);
  assert.equal(quote.accepts[0].payTo, paymentHandoff.merchant);
  assert.equal(quote.resource.url, paymentHandoff.endpoint);
});
