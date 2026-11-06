import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { ProcurementBid, ProcurementTask } from "@agenthire/shared";
import { createApp } from "../src/app.js";
import { evaluateCapabilityTest, runCapabilityTest, statisticsMicroTest } from "../src/agents/capability-tests.js";
import { procure } from "../src/agents/manager.js";
import { assumedPrior, beta, exact, observe, predictive } from "../src/agents/reliability.js";
import { createDemoRegistry, STATISTICS, WorkerRegistry } from "../src/agents/workers.js";
import { validateAuditEvent } from "../src/hedera/audit-event.js";
import { registerProcurementRoutes } from "../src/routes/procurement.js";

const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const task: ProcurementTask = {
  taskId: "pocp-test", taskType: STATISTICS, capability: STATISTICS, input: [2, 4, 6, 8],
  maxBudgetTinybars: "1000000", deadlineMs: 1000, minimumReliabilityBps: 3500,
  selectionStrategy: "adaptive_pocp", pocp: { failurePenaltyTinybars: "400000" },
};
const registry = (behavior: "correct" | "incorrect" = "correct") =>
  createDemoRegistry(3001, undefined, now, { economy: behavior });

test("uses bounded Beta priors and exact predictive updates after a pass or failure", () => {
  const prior = assumedPrior(6000);
  assert.deepEqual(prior, { alphaUnits: 12000, betaUnits: 8000 });
  assert.deepEqual(exact(predictive(prior).pass), { numerator: "3", denominator: "5" });
  assert.deepEqual(exact(predictive(prior).fail), { numerator: "2", denominator: "5" });
  assert.deepEqual(exact(predictive(observe(prior, true)).pass), { numerator: "11", denominator: "15" });
  assert.deepEqual(exact(predictive(observe(prior, false)).pass), { numerator: "2", denominator: "5" });
  assert.equal(prior.alphaUnits, 12000);
  assert.ok(assumedPrior(10000).betaUnits > 0);
  for (const invalid of [0, -1, 1.5, Infinity, 1_000_001]) assert.throws(() => beta(invalid, 100));
  assert.throws(() => assumedPrior(10001));
});

test("grades actual statistics and hashes canonical evidence independently", () => {
  const micro = statisticsMicroTest(task.taskId, "economy", "5000", 10);
  const a = evaluateCapabilityTest(micro, { count: 3, min: 3, max: 9, mean: 6 });
  const b = evaluateCapabilityTest(micro, { mean: 6, max: 9, min: 3, count: 3 });
  const bytes = '{"input":[3,6,9],"observed":{"count":3,"min":3,"max":9,"mean":6},"passed":true,"reason":"matches_reference"}';
  assert.equal(a.passed, true);
  assert.equal(a.evidenceHash, b.evidenceHash);
  assert.equal(a.evidenceHash, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(evaluateCapabilityTest(micro, { ...micro.expected, mean: 7 }).reason, "wrong_answer");
  assert.equal(evaluateCapabilityTest(micro, { passed: true }).reason, "malformed_output");
  assert.equal(evaluateCapabilityTest(micro, { ...micro.expected, mean: NaN }).observed, null);
});

test("bounds test runtime and sanitizes adapter errors", async () => {
  const micro = statisticsMicroTest(task.taskId, "economy", "5000", 5);
  let aborted = false;
  const timeout = await runCapabilityTest(micro, async (_input, signal) => new Promise((_, reject) =>
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("timeout")); })));
  assert.equal(timeout.reason, "timeout");
  assert.equal(timeout.passed, false);
  assert.equal(aborted, true);
  const error = await runCapabilityTest(micro, async () => { throw new Error("private error text"); });
  assert.equal(error.reason, "worker_error");
  assert.equal(error.observed, null);
  assert.ok(!JSON.stringify(error).includes("private error text"));
});

test("chooses exactly one positive-value test and charges its simulated cost", async (t) => {
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network operation"));
  const workers = new WorkerRegistry();
  let executions = 0;
  for (const worker of registry().discover()) {
    const capabilityTest = worker.capabilityTest;
    if (!capabilityTest) assert.fail("Missing demo capability test");
    workers.register({ ...worker, capabilityTest: { ...capabilityTest, run: async (input, signal) => {
      executions++;
      return capabilityTest.run(input, signal);
    } } });
  }
  const result = await procure(task, workers, { now });
  const trace = result.pocp;
  assert.equal(trace?.action, "TEST");
  assert.equal(trace?.baselineWorkerId, "economy");
  assert.equal(trace?.chosenTest?.workerId, "economy");
  assert.equal(trace?.result?.passed, true);
  assert.equal(trace?.finalWorkerId, "economy");
  assert.equal(trace?.valuations.length, 3);
  const valuation = trace?.valuations.find((v) => v.workerId === "economy");
  assert.ok(valuation?.status === "valued");
  assert.deepEqual(valuation.netValueOfInformationTinybars,
    { numerator: "23000", denominator: "1" });
  assert.deepEqual(trace?.budget, {
    totalTinybars: "1000000", committedTinybars: "0", simulatedTestTinybars: "5000",
    remainingAfterTestTinybars: "995000", projectedHireTinybars: "600000",
    projectedTotalTinybars: "605000", projectedRemainingTinybars: "395000",
  });
  assert.equal(result.budgetRemainingTinybars, "395000");
  assert.equal(executions, 1);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(result.paymentPlan?.testPaymentStatus, "simulated");
  assert.equal(result.paymentPlan?.paymentAuthorized, false);
  assert.equal(result.paymentHandoff?.paymentAuthorized, false);
  assert.equal(result.paymentHandoff?.maxAuthorizedPaymentTinybars, "600000");
  assert.equal(result.paymentHandoff?.endpoint, "http://localhost:3001/api/workers/analyze/economy");
  const tests = result.pendingAuditRecords.filter(({ event }) => event.eventType.startsWith("CAPABILITY_TEST"));
  assert.deepEqual(tests.map(({ event }) => event.eventType), ["CAPABILITY_TEST_REQUESTED", "CAPABILITY_TEST_COMPLETED"]);
  for (const { status, event } of result.pendingAuditRecords) {
    assert.equal(status, "pending");
    assert.deepEqual(validateAuditEvent(event), event);
    assert.ok(!("input" in event.metadata));
  }
  assert.equal(tests[1].event.metadata.artifactHash, trace?.result?.evidenceHash);
});

test("a failed observation lowers reliability and changes the final winner", async () => {
  const result = await procure(task, registry("incorrect"), { now });
  assert.equal(result.pocp?.baselineWorkerId, "economy");
  assert.equal(result.pocp?.chosenTest?.workerId, "economy");
  assert.equal(result.pocp?.result?.reason, "wrong_answer");
  assert.deepEqual(result.pocp?.posteriors.find(({ workerId }) => workerId === "economy")?.mean,
    { numerator: "2", denominator: "5" });
  assert.equal(result.selectedWorker?.workerId, "balanced");
  assert.equal(result.paymentHandoff?.workerId, "balanced");
  assert.equal(result.budgetRemainingTinybars, "245000");
});

test("skips a negative-value test and rejects tests with no affordable hire or an over-budget fee", async () => {
  const result = await procure({ ...task, pocp: { failurePenaltyTinybars: "100000" } }, registry(), { now });
  assert.equal(result.pocp?.action, "SKIP");
  assert.equal(result.pocp?.result, null);
  assert.equal(result.paymentPlan?.testPaymentStatus, "not_required");
  assert.ok(result.pocp?.valuations.every((row) => row.status !== "valued" ||
    BigInt(row.netValueOfInformationTinybars.numerator) <= 0n));
  const tight = await procure({ ...task, maxBudgetTinybars: "600000" }, registry(), { now });
  const blocked = tight.pocp?.valuations[0];
  assert.ok(blocked?.status === "unavailable");
  assert.equal(blocked.reason, "no_affordable_post_test_hire");
  assert.equal(tight.pocp?.action, "SKIP");
  const workers = new WorkerRegistry();
  for (const worker of registry().discover()) {
    if (!worker.capabilityTest) assert.fail("Missing fixture");
    workers.register({ ...worker, capabilityTest: { ...worker.capabilityTest, priceTinybars: "1000001" } });
  }
  const over = await procure(task, workers, { now });
  assert.equal(over.pocp?.action, "SKIP");
  assert.ok(over.pocp?.valuations.every((row) => row.status === "unavailable" && row.reason === "test_over_budget"));
});

test("uses a terminal loss when a test branch has no eligible hire", async () => {
  const workers = new WorkerRegistry();
  const economy = registry().discover().find(({ profile }) => profile.workerId === "economy");
  if (!economy) assert.fail("Missing economy");
  workers.register(economy);
  const decision = await procure({ ...task, minimumReliabilityBps: 6000 }, workers, { now });
  const valuation = decision.pocp?.valuations[0];
  assert.equal(valuation?.status, "valued");
  if (valuation?.status !== "valued") assert.fail("Missing valuation");
  assert.equal(valuation.fail.workerId, null);
  assert.deepEqual(valuation.fail.lossTinybars, decision.pocp?.noHireLossTinybars);
});

test("breaks equal positive test valuations by worker ID", async () => {
  const workers = new WorkerRegistry();
  for (const worker of registry().discover().filter(({ profile }) => profile.workerId !== "premium").reverse()) {
    workers.register({ ...worker, async bid(input, signal) {
      const bid = await worker.bid(input, signal) as ProcurementBid;
      return { ...bid, priceTinybars: "600000", reliabilityBps: 6000, estimatedLatencyMs: 200 };
    } });
  }
  const decision = await procure(task, workers, { now });
  assert.equal(decision.pocp?.action, "TEST");
  assert.equal(decision.pocp?.chosenTest?.workerId, "balanced");
});

test("serves adaptive PoCP opt-in while preserving the legacy procurement response", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  registerProcurementRoutes(app, createDemoRegistry());
  const post = (payload: object) => app.inject({ method: "POST", url: "/api/agents/procure", payload });
  const response = await post(task);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().pocp.action, "TEST");
  assert.equal((await post({ ...task, pocp: { failurePenaltyTinybars: -1 } })).statusCode, 400);
  const { pocp, ...legacy } = task;
  assert.equal(pocp?.failurePenaltyTinybars, "400000");
  assert.equal((await post(legacy)).statusCode, 400);
  const unchanged = await post({ ...legacy, selectionStrategy: "expected_cost" });
  assert.equal(unchanged.json().selectedWorker.workerId, "balanced");
  assert.equal(unchanged.json().pocp, undefined);
});
