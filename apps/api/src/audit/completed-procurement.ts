import { createHash } from "node:crypto";
import {
  HIRE_TASK_ID, HIRE_PAYER, HIRE_MERCHANT, HIRE_PRICE, TEST_TRANSACTION, TEST_EVIDENCE,
} from "../agents/hire-checkpoint.js";
import { hireReference } from "../agents/final-hire.js";
import { evaluateCapabilityTest, statisticsMicroTest } from "../agents/capability-tests.js";
import { assumedPrior, exact, observe, predictive } from "../agents/reliability.js";
import { isRecord } from "../agents/task.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { serializeAuditEvent, validateAuditEvent } from "../hedera/audit-event.js";

export const FINAL_TRANSACTION = "0.0.9185802@1793925842.587414987";
export const FINAL_EVIDENCE = "0d552ae272bda05a5dc607c27767728cab84dc2677d064014252d0bed6f9ca23";
const CHECKPOINT_HASH = "698beb22b24c2d2857dc4a999be55a8343db704c4301ba613cc9980e9d8857e6";
export const AUDIT_MANIFEST_HASH = "0dd184461d7d1eacd1d4028c9a64f521d231842783b3faef8938aabfdfbbfd37";
export const AUDIT_TASK = HIRE_TASK_ID;
export const AUDIT_TOPIC = "0.0.11331471";
export const AUDIT_OPERATOR = "0.0.11330954";

export const AUDIT_ORDER = [
  ["hire", "JOB_CREATED"], ["hire", "BID_SUBMITTED"], ["hire", "CAPABILITY_TEST_REQUESTED"],
  ["pocp", "PAYMENT_SETTLED"], ["hire", "CAPABILITY_TEST_COMPLETED"], ["hire", "WORKER_SELECTED"],
  ["hire", "PAYMENT_SETTLED"], ["hire", "TASK_COMPLETED"],
] as const;

const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

function verifiedAttempt(rows: unknown[] | null, transactionId: string) {
  const states = ["planned", "quoted", "authorized", "submitted", "settled", "verified"];
  if (!rows || rows.length !== states.length || !rows.every((entry, index) => isRecord(entry) &&
      entry.taskId === AUDIT_TASK && entry.payer === HIRE_PAYER && entry.state === states[index] &&
      entry.transactionId === (index < 3 ? undefined : transactionId))) throw new Error("Verified payment journal required");
  return rows[5];
}

function record(value: unknown) {
  if (!isRecord(value)) throw new Error("Invalid completed procurement record");
  return value;
}

export async function loadCompletedAudit(hire: unknown[] | null, test: unknown[] | null, mirror: URL) {
  verifiedAttempt(test, TEST_TRANSACTION);
  const detail = record(record(verifiedAttempt(hire, FINAL_TRANSACTION)).detail);
  const checkpoint = record(detail.checkpoint);
  const { checkpointHash, ...checkpointData } = checkpoint;
  const task = record(checkpoint.task);
  const bid = record(checkpoint.bid);
  const prior = record(checkpoint.priorTest);
  const budget = record(detail.budget);
  const payment = record(detail.payment);
  if (detail.status !== "task_completed" ||
      JSON.stringify(detail.lifecycle) !== JSON.stringify(["created", "bidding", "testing", "worker_selected",
        "hire_authorized", "payment_submitted", "payment_settled", "payment_verified", "task_completed"]) ||
      checkpointHash !== CHECKPOINT_HASH || digest(checkpointData) !== CHECKPOINT_HASH ||
      task.taskId !== AUDIT_TASK || JSON.stringify(task.input) !== "[2,4,6,8]" || bid.workerId !== "balanced" ||
      bid.merchant !== HIRE_MERCHANT || bid.priceTinybars !== HIRE_PRICE || prior.workerId !== "economy" ||
      prior.passed !== false || prior.transactionId !== TEST_TRANSACTION || prior.evidenceHash !== TEST_EVIDENCE ||
      payment.state !== "verified" || payment.transactionId !== FINAL_TRANSACTION ||
      payment.payer !== HIRE_PAYER || payment.merchant !== HIRE_MERCHANT || payment.amountTinybars !== HIRE_PRICE ||
      budget.settledTestTinybars !== "5000" || budget.settledHireTinybars !== HIRE_PRICE ||
      budget.totalSettledTinybars !== "755000" || budget.availableTinybars !== "245000" || budget.reservedTinybars !== "0") {
    throw new Error("Completed procurement does not match the verified checkpoint");
  }
  const evaluation = record(detail.evaluation);
  const finalInput = [2, 4, 6, 8];
  const result = evaluateCapabilityTest({
    testId: AUDIT_TASK, taskId: AUDIT_TASK, workerId: "balanced", capability: "statistics.summary",
    input: finalInput, expected: hireReference(finalInput), priceTinybars: HIRE_PRICE, timeoutMs: 0,
  }, evaluation.observed);
  const economy = evaluateCapabilityTest(statisticsMicroTest(AUDIT_TASK, "economy", "5000", 50),
    { count: 3, min: 3, max: 9, mean: 7 });
  const posterior = exact(predictive(observe(assumedPrior(6000), economy.passed)).pass);
  if (!result.passed || evaluation.passed !== true || result.evidenceHash !== FINAL_EVIDENCE ||
      evaluation.evidenceHash !== FINAL_EVIDENCE || economy.passed || economy.evidenceHash !== TEST_EVIDENCE ||
      posterior.numerator !== "2" || posterior.denominator !== "5") throw new Error("Independent evaluation evidence mismatch");

  const pending = detail.pendingAuditRecords;
  if (!Array.isArray(pending) || pending.length !== AUDIT_ORDER.length) throw new Error("Expected exactly eight pending records");
  const byId = new Map(pending.map((raw: unknown) => {
    const item = record(raw);
    if (item.status !== "pending") throw new Error("Unexpected source audit status");
    const event = validateAuditEvent(item.event);
    serializeAuditEvent(event);
    return [event.eventId, event] as const;
  }));
  const events = AUDIT_ORDER.map(([phase, type]) => {
    const event = byId.get(digest([AUDIT_TASK, phase, type]));
    if (!event || event.eventType !== type || event.jobId !== AUDIT_TASK) throw new Error("Missing expected audit event");
    return event;
  });
  if (digest(events.map(({ eventId, payloadHash }) => [eventId, payloadHash])) !== AUDIT_MANIFEST_HASH) {
    throw new Error("Audit manifest hash mismatch");
  }
  const payments = await Promise.all([TEST_TRANSACTION, FINAL_TRANSACTION].map((transactionId, index) =>
    reconcilePayment(mirror, { transactionId, payer: HIRE_PAYER, merchant: HIRE_MERCHANT,
      amountTinybars: index === 0 ? "5000" : HIRE_PRICE })));
  if (payments.some(({ status }) => status !== "verified")) throw new Error("Both x402 settlements must independently verify");

  return { taskId: AUDIT_TASK, procurementStatus: "task_completed" as const, events,
    payments: { capabilityTest: { transactionId: TEST_TRANSACTION, ...payments[0] },
      finalHire: { transactionId: FINAL_TRANSACTION, ...payments[1] } } };
}
