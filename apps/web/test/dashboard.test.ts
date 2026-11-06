import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRecordedDemo, transactionUrl } from "../app/demo-data";
import { initialReplay, replayReducer, stages } from "../app/replay-state";

test("recorded demo remains available with all network access blocked", (context) => {
  const fetch = context.mock.method(globalThis, "fetch", () => { throw new Error("Offline"); });
  const demo = loadRecordedDemo();
  assert.equal(demo.source, "Recorded verified testnet execution");
  assert.equal(demo.task, "paid-pocp-live-001");
  assert.equal(demo.status, "task_completed");
  assert.equal(fetch.mock.callCount(), 0);
});

test("worker estimates and PoCP evidence match the completed procurement", () => {
  const { workers, selected, test: capability, result } = loadRecordedDemo();
  assert.deepEqual(workers.map(worker => [worker.bid, worker.prior]), [[600000, 60], [750000, 95], [950000, 99]]);
  assert.equal(workers[0].posterior, 40);
  assert.equal(selected, "Balanced");
  assert.equal(capability.decision, "TEST");
  assert.equal(capability.value, 23000);
  assert.equal(capability.status, "FAIL");
  assert.deepEqual([capability.actual.mean, capability.expected.mean], [7, 6]);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.output, { count: 4, min: 2, max: 8, mean: 5 });
});

test("settlement links, amounts and the budget ledger use actual evidence", () => {
  const { payments, budget } = loadRecordedDemo();
  assert.deepEqual(payments.map(payment => payment.amount), [5000, 750000]);
  assert.ok(payments.every(payment => payment.status === "SUCCESS"));
  assert.equal(budget - payments.reduce((sum, payment) => sum + payment.amount, 0), 245000);
  assert.deepEqual(payments.map(payment => transactionUrl(payment.id)), [
    "https://hashscan.io/testnet/transaction/0.0.9185802-1793924857-289452104",
    "https://hashscan.io/testnet/transaction/0.0.9185802-1793925842-587414987",
  ]);
  assert.throws(() => transactionUrl("invalid"));
});

test("audit snapshot validates the manifest and follows consensus sequence", () => {
  const { audit } = loadRecordedDemo();
  assert.deepEqual(audit.map(event => event.sequence), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(audit.map(event => event.type), [
    "JOB_CREATED", "BID_SUBMITTED", "CAPABILITY_TEST_REQUESTED", "PAYMENT_SETTLED",
    "CAPABILITY_TEST_COMPLETED", "WORKER_SELECTED", "PAYMENT_SETTLED", "TASK_COMPLETED",
  ]);
  assert.ok(audit.every(event => /^\d+\.\d{9}$/.test(event.timestamp) && event.status === "verified"));
  assert.equal(transactionUrl(audit[7].transactionId), "https://hashscan.io/testnet/transaction/0.0.11330954-1793926615-829030856");
});

test("replay pauses, steps, resets and completes without executing payments or publishing HCS", (context) => {
  const fetch = context.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  let state = replayReducer(initialReplay, "start");
  state = replayReducer(state, "tick");
  assert.equal(state.step, 1);
  state = replayReducer(state, "pause");
  assert.equal(replayReducer(state, "tick"), state);
  state = replayReducer(state, "step");
  assert.deepEqual(state, { step: 2, playing: false });
  state = replayReducer(state, "reset");
  assert.deepEqual(state, initialReplay);
  state = replayReducer(state, "play");
  for (let i = 1; i < stages.length; i++) state = replayReducer(state, "tick");
  assert.deepEqual(state, { step: 10, playing: false });
  assert.equal(stages[state.step], "HCS audit verified");
  assert.equal(fetch.mock.callCount(), 0);
});
