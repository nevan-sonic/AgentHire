import { createHash } from "node:crypto";
import type { ProcurementTask } from "@agenthire/shared";
import { evaluateCapabilityTest, statisticsMicroTest } from "./capability-tests.js";
import { assessBid, requestBid } from "./manager.js";
import type { WorkerRegistry } from "./workers.js";
import { reconcilePayment } from "../x402/reconcile.js";

export const HIRE_TASK_ID = "paid-pocp-live-001";
export const HIRE_PAYER = "0.0.11331589";
export const HIRE_MERCHANT = "0.0.11330954";
export const HIRE_WORKER = "balanced";
export const HIRE_PRICE = "750000";
export const TEST_TRANSACTION = "0.0.9185802@1793924857.289452104";
export const TEST_EVIDENCE = "501649a83faea80bb75486ec93978d7401a11a9a96963b5188171577df9d2867";
const issued = new WeakSet<object>();

export async function loadHireCheckpoint(rows: unknown[] | null, registry: WorkerRegistry, mirror: URL, now = Date.now) {
  // Reconstruct the recorded Step 09 decision from repository-pinned public evidence and the local journal.
  const states = ["planned", "quoted", "authorized", "submitted", "settled", "verified"];
  if (!rows || rows.length !== states.length || !rows.every((row, index) => {
    const entry = row as Record<string, unknown> | null;
    return entry?.taskId === HIRE_TASK_ID && entry.payer === HIRE_PAYER && entry.state === states[index] &&
      (index < 3 ? entry.transactionId === undefined : entry.transactionId === TEST_TRANSACTION);
  })) throw new Error("Verified Step 09 attempt journal is required");

  const test = evaluateCapabilityTest(statisticsMicroTest(HIRE_TASK_ID, "economy", "5000", 50),
    { count: 3, min: 3, max: 9, mean: 7 });
  if (test.passed || test.evidenceHash !== TEST_EVIDENCE) throw new Error("Capability evidence mismatch");
  const priorPayment = await reconcilePayment(mirror, {
    transactionId: TEST_TRANSACTION, payer: HIRE_PAYER, merchant: HIRE_MERCHANT, amountTinybars: "5000",
  });
  if (priorPayment.status !== "verified") throw new Error("Prior capability payment could not be verified");

  const task: ProcurementTask = {
    taskId: HIRE_TASK_ID, taskType: "statistics.summary", capability: "statistics.summary",
    input: [2, 4, 6, 8], maxBudgetTinybars: "995000", deadlineMs: 60000,
    minimumReliabilityBps: 3500, selectionStrategy: "expected_cost",
  };
  const worker = registry.discover(task.capability).find(({ profile }) => profile.workerId === HIRE_WORKER);
  if (!worker?.executeTask || worker.profile.merchant !== HIRE_MERCHANT || worker.profile.priceTinybars !== HIRE_PRICE) {
    throw new Error("Selected Balanced adapter no longer matches the recorded decision");
  }
  // Refresh only the selected worker's expired offer, retaining exactly the accepted commercial terms.
  const response = await requestBid(worker, task, 500);
  if (response.status !== "received") throw new Error("Balanced bid could not be refreshed");
  const checked = assessBid(response.value, task, worker.profile, now(), task.deadlineMs);
  if (checked.status !== "eligible" || checked.bid.priceTinybars !== HIRE_PRICE) throw new Error("Balanced bid could not be refreshed");
  const decision = {
    status: "worker_selected" as const, task, bid: checked.bid, initialBudgetTinybars: "1000000",
    settledTestTinybars: "5000", priorTest: { workerId: "economy", passed: false,
      transactionId: TEST_TRANSACTION, evidenceHash: TEST_EVIDENCE, verification: priorPayment },
  };
  const checkpoint = { ...decision, checkpointHash: createHash("sha256").update(JSON.stringify(decision)).digest("hex") };
  issued.add(checkpoint);
  return checkpoint;
}

export type HireCheckpoint = Awaited<ReturnType<typeof loadHireCheckpoint>>;

export function assertHireCheckpoint(checkpoint: HireCheckpoint, now: number) {
  const { checkpointHash, ...decision } = checkpoint;
  if (!issued.has(checkpoint) || createHash("sha256").update(JSON.stringify(decision)).digest("hex") !== checkpointHash ||
      Date.parse(checkpoint.bid.expiresAt) <= now) throw new Error("Unverified, altered, or expired hire checkpoint");
}
