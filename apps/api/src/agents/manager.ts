import { createHash } from "node:crypto";
import type { PocpPaymentPlan, ProcurementBid, ProcurementPaymentHandoff, ProcurementTask, SelectionStrategy, WorkerProfile } from "@agenthire/shared";
import { createAuditEvent, serializeAuditEvent } from "../hedera/audit-event.js";
import type { AuditMetadata, AuditPayload } from "../hedera/audit-event.js";
import { X402_ASSET, X402_NETWORK } from "../x402/config.js";
import { integerIn, isRecord, parseProcurementTask, tinybars } from "./task.js";
import { compareWorkerIds } from "./workers.js";
import type { WorkerAdapter, WorkerRegistry } from "./workers.js";
import { adaptiveProcurement } from "./pocp.js";
import type { PaidTestExecutor } from "./pocp.js";

const bidFields = [
  "bidId", "taskId", "workerId", "capability", "priceTinybars", "estimatedLatencyMs",
  "reliabilityBps", "expiresAt", "merchant", "endpoint", "network", "asset", "status",
];

type BidReceipt =
  | { workerId: string; status: "eligible"; bid: ProcurementBid }
  | { workerId: string; status: "rejected"; reason: string; bid?: ProcurementBid };

export function assessBid(value: unknown, task: ProcurementTask, worker: WorkerProfile, now: number, remainingMs: number): BidReceipt {
  const { workerId } = worker;
  const reject = (reason: string, bid?: ProcurementBid): BidReceipt => ({ workerId, status: "rejected", reason, bid });
  if (!isRecord(value) || Object.keys(value).length !== bidFields.length ||
      Object.keys(value).some((field) => !bidFields.includes(field)) ||
      typeof value.bidId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,128}$/.test(value.bidId) ||
      value.status !== "offered") return reject("malformed_bid");
  if (value.taskId !== task.taskId || value.workerId !== workerId) return reject("identity_mismatch");
  if (value.capability !== task.capability) return reject("unsupported_capability");
  if (value.merchant !== worker.merchant || value.endpoint !== worker.endpoint) return reject("untrusted_payment_destination");
  if (value.asset !== X402_ASSET || value.network !== X402_NETWORK) return reject("unsupported_payment_asset_or_network");
  if (!tinybars(value.priceTinybars) || value.priceTinybars === "0") return reject("invalid_price");
  if (!integerIn(value.reliabilityBps, 1, 10_000) || !integerIn(value.estimatedLatencyMs, 1, 60_000)) {
    return reject("invalid_estimate");
  }
  if (typeof value.expiresAt !== "string") return reject("invalid_expiration");
  const expiration = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiration) || new Date(expiration).toISOString() !== value.expiresAt) return reject("invalid_expiration");

  const bid: ProcurementBid = {
    bidId: value.bidId, taskId: task.taskId, workerId, capability: task.capability,
    priceTinybars: value.priceTinybars, estimatedLatencyMs: value.estimatedLatencyMs,
    reliabilityBps: value.reliabilityBps, expiresAt: value.expiresAt,
    merchant: worker.merchant, endpoint: worker.endpoint, network: X402_NETWORK, asset: X402_ASSET, status: "offered",
  };
  if (expiration <= now) return reject("expired", bid);
  if (BigInt(bid.priceTinybars) > BigInt(task.maxBudgetTinybars)) return reject("over_budget", bid);
  if (bid.reliabilityBps < task.minimumReliabilityBps) return reject("below_minimum_reliability", bid);
  if (bid.estimatedLatencyMs > remainingMs) return reject("deadline_exceeded", bid);
  return { workerId, status: "eligible", bid };
}

export async function requestBid(worker: WorkerAdapter, task: ProcurementTask, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<{ status: "timeout" }>((resolve) => {
        timer = setTimeout(() => { resolve({ status: "timeout" }); controller.abort(); }, timeoutMs);
      }),
      Promise.resolve().then(() => worker.bid(structuredClone(task), controller.signal))
        .then((value) => ({ status: "received", value }) as const, () => ({ status: "worker_error" }) as const),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const compareBigInts = (left: bigint, right: bigint) => left < right ? -1 : left > right ? 1 : 0;

export function compareBids(left: ProcurementBid, right: ProcurementBid, strategy: SelectionStrategy) {
  const a = BigInt(left.priceTinybars), b = BigInt(right.priceTinybars);
  const nominal = compareBigInts(a, b);
  const expected = compareBigInts(a * BigInt(right.reliabilityBps), b * BigInt(left.reliabilityBps));
  return (strategy === "cheapest_eligible" ? nominal || expected : expected || nominal) ||
    left.estimatedLatencyMs - right.estimatedLatencyMs || compareWorkerIds(left.workerId, right.workerId);
}

function pendingAudit(
  task: ProcurementTask, eventType: AuditPayload["eventType"], timestamp: string, bid?: ProcurementBid,
  metadata?: AuditMetadata,
) {
  const event = createAuditEvent({
    version: 1, eventId: createHash("sha256").update(JSON.stringify([task.taskId, eventType, bid?.workerId])).digest("hex"),
    eventType, jobId: task.taskId, agentId: "agenthire-manager", timestamp,
    metadata: metadata ?? (bid ? { workerId: bid.workerId, amountBaseUnits: bid.priceTinybars, amountUnit: "tinybar" } : {}),
  });
  serializeAuditEvent(event);
  return { status: "pending" as const, event };
}

export async function procure(
  input: ProcurementTask,
  registry: WorkerRegistry,
  options: { bidTimeoutMs?: number; now?: () => number; paymentEnabled?: boolean; paidTestExecutor?: PaidTestExecutor } = {},
) {
  const task = parseProcurementTask(input);
  const now = options.now ?? Date.now;
  const start = now();
  const discovered = registry.discover(task.capability).filter(({ profile }) => profile.taskTypes.includes(task.taskType));
  const discoveredWorkers = discovered.map(({ profile }) => profile);
  const outcomes = await Promise.all(discovered.map((worker) =>
    requestBid(worker, task, Math.min(options.bidTimeoutMs ?? 500, task.deadlineMs)),
  ));
  const decisionTime = now();
  const timestamp = new Date(decisionTime).toISOString();
  const bidsReceived: BidReceipt[] = outcomes.flatMap((outcome, index) => outcome.status === "received"
    ? [assessBid(outcome.value, task, discoveredWorkers[index], decisionTime, task.deadlineMs - (decisionTime - start))]
    : []);
  const rejectedBids = [
    ...bidsReceived.flatMap((receipt) => receipt.status === "rejected"
      ? [{ workerId: receipt.workerId, reason: receipt.reason }] : []),
    ...outcomes.flatMap((outcome, index) => outcome.status !== "received"
      ? [{ workerId: discoveredWorkers[index].workerId, reason: outcome.status }] : []),
  ].sort((a, b) => compareWorkerIds(a.workerId, b.workerId));
  const eligibleBids = bidsReceived.flatMap((receipt) => receipt.status === "eligible" ? [receipt.bid] : [])
    .sort((a, b) => compareBids(a, b, task.selectionStrategy));
  const adaptive = task.selectionStrategy === "adaptive_pocp"
    ? await adaptiveProcurement(task, eligibleBids, discovered, start + task.deadlineMs, now, options.paidTestExecutor) : null;
  const winningBid = adaptive ? adaptive.winningBid : eligibleBids[0] ?? null;
  const finalTimestamp = adaptive ? new Date(now()).toISOString() : timestamp;
  const selectedWorker = discoveredWorkers.find((worker) => worker.workerId === winningBid?.workerId) ?? null;
  const scoreBreakdown = eligibleBids.map((bid, index) => ({
    rank: index + 1, workerId: bid.workerId, priceTinybars: bid.priceTinybars,
    reliabilityBps: bid.reliabilityBps, estimatedLatencyMs: bid.estimatedLatencyMs,
    reliabilitySource: "demo-assumption" as const,
    expectedCostTinybars: { numerator: (BigInt(bid.priceTinybars) * 10_000n).toString(), denominator: bid.reliabilityBps },
  }));
  const paymentHandoff: ProcurementPaymentHandoff | null = winningBid && selectedWorker ? {
    workerId: selectedWorker.workerId, endpoint: selectedWorker.endpoint, merchant: selectedWorker.merchant,
    network: X402_NETWORK, asset: X402_ASSET, maxAuthorizedPaymentTinybars: winningBid.priceTinybars,
    taskId: task.taskId, input: { values: [...task.input] }, bidId: winningBid.bidId, expiresAt: winningBid.expiresAt,
    paymentAuthorized: false,
  } : null;
  const test = adaptive?.chosenTest;
  const observed = adaptive?.result;
  const testMetadata: AuditMetadata | undefined = test
    ? { workerId: test.workerId, amountBaseUnits: test.priceTinybars, amountUnit: "tinybar" } : undefined;
  const pendingAuditRecords = [
    pendingAudit(task, "JOB_CREATED", timestamp),
    ...bidsReceived.flatMap(({ bid }) => bid ? [pendingAudit(task, "BID_SUBMITTED", timestamp, bid)] : []),
    ...(testMetadata ? [
      pendingAudit(task, "CAPABILITY_TEST_REQUESTED", timestamp, undefined, testMetadata),
    ] : []),
    ...(testMetadata && adaptive?.payment?.evidence && BigInt(adaptive.payment.spentTinybars) > 0n ? [
      pendingAudit(task, "PAYMENT_SETTLED", finalTimestamp, undefined, {
        ...testMetadata, paymentTransactionId: adaptive.payment.evidence.transactionId,
      }),
    ] : []),
    ...(testMetadata && observed ? [
      pendingAudit(task, "CAPABILITY_TEST_COMPLETED", finalTimestamp, undefined, {
        ...testMetadata, outcome: observed.passed ? "success" : "failure", artifactHash: observed.evidenceHash,
      }),
    ] : []),
    ...(winningBid ? [pendingAudit(task, "WORKER_SELECTED", finalTimestamp, winningBid)] : []),
  ];
  const paymentPlan: PocpPaymentPlan | null = adaptive ? {
    test: test ? { testId: test.testId, workerId: test.workerId, priceTinybars: test.priceTinybars } : null,
    testPaymentStatus: adaptive.payment?.state ?? (test ? "simulated" : "not_required"),
    finalWorker: paymentHandoff,
    finalBid: winningBid,
    totalBudgetTinybars: task.maxBudgetTinybars,
    remainingAfterTestTinybars: adaptive.trace.budget.remainingAfterTestTinybars,
    paymentAuthorized: false,
  } : null;

  return {
    status: winningBid ? "selected" as const : "no_eligible_bids" as const,
    taskId: task.taskId, discoveredWorkers, bidsReceived, rejectedBids, eligibleBids,
    selectionStrategy: task.selectionStrategy, selectedWorker, winningBid, scoreBreakdown,
    budgetRemainingTinybars: adaptive?.trace.budget.projectedRemainingTinybars ??
      (BigInt(task.maxBudgetTinybars) - BigInt(winningBid?.priceTinybars ?? "0")).toString(),
    rationale: winningBid
      ? `${winningBid.workerId} ranked first by ${adaptive ? "procurement loss" : task.selectionStrategy === "expected_cost" ? "expected cost per successful task" : "nominal price"}. See the exact scores and tie-break fields.`
      : discoveredWorkers.length === 0 ? "No available workers match the task." : "No bids met the task requirements.",
    paymentReadiness: !paymentHandoff ? "no_selection" as const
      : options.paymentEnabled ? "requires_live_quote_and_authorization" as const : "worker_endpoint_disabled" as const,
    paymentHandoff, pendingAuditRecords,
    ...(adaptive ? { pocp: adaptive.trace, paymentPlan } : {}),
  };
}
