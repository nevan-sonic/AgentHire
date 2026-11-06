import { createHash } from "node:crypto";
import type { PrivateKey } from "@hiero-ledger/sdk";
import { createAuditEvent, serializeAuditEvent } from "../hedera/audit-event.js";
import type { AuditMetadata, AuditPayload } from "../hedera/audit-event.js";
import { HIRE_EXTENSION, hireBinding, hireDigest, parseHireRequest } from "../x402/hire-binding.js";
import type { OpenAttempt } from "../x402/capability-journal.js";
import { paymentExplorerUrl } from "../x402/protocol.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { evaluateCapabilityTest } from "./capability-tests.js";
import { assertHireCheckpoint, HIRE_MERCHANT, HIRE_PAYER, HIRE_PRICE, HIRE_TASK_ID, HIRE_WORKER } from "./hire-checkpoint.js";
import type { HireCheckpoint } from "./hire-checkpoint.js";
import { createPayerSigner, payForResource, PaymentAttemptError, requestResourceQuote, SpendingPolicy } from "./payer.js";
import { isRecord } from "./task.js";

export type HireAuthorization = {
  taskId: string; payer: string; workerId: string; merchant: string; endpoint: string;
  network: "hedera:testnet"; asset: "0.0.0"; requestDigest: string;
  amountTinybars: string; maxTotalTinybars: string; expiresAt: string;
};

export function hireRequest(checkpoint: HireCheckpoint) {
  const { task, bid } = checkpoint;
  return { taskId: task.taskId, bidId: bid.bidId, workerId: bid.workerId,
    capability: task.capability, input: [...task.input] };
}

export function hireReference(input: readonly number[]) {
  const sorted = [...input].sort((a, b) => a - b);
  let total = 0;
  for (const value of input) total += value;
  return { count: input.length, min: sorted[0], max: sorted[sorted.length - 1], mean: total / input.length };
}

function binding(checkpoint: HireCheckpoint) {
  const body = hireRequest(checkpoint);
  const request = parseHireRequest(body);
  if (!request) throw new Error("Invalid final task binding");
  return { body, request, digest: hireDigest(request) };
}

export async function previewFinalHire(checkpoint: HireCheckpoint, now = Date.now) {
  assertHireCheckpoint(checkpoint, now());
  const { body, digest } = binding(checkpoint);
  const { bid } = checkpoint;
  const { requirement } = await requestResourceQuote(
    new SpendingPolicy(bid.endpoint, bid.merchant, BigInt(bid.priceTinybars), BigInt(checkpoint.task.maxBudgetTinybars)), body,
  );
  if (requirement.amount !== bid.priceTinybars || requirement.extra?.hireRequest !== digest) throw new Error("Final quote mismatch");
  assertHireCheckpoint(checkpoint, now());
  return { checkpoint, quote: requirement, requestDigest: digest, expected: hireReference(body.input),
    projectedRemainingTinybars: (BigInt(checkpoint.task.maxBudgetTinybars) - BigInt(bid.priceTinybars)).toString(),
    paymentSigned: false };
}

type Stage = "created" | "bidding" | "testing" | "worker_selected" | "hire_authorized" |
  "payment_submitted" | "payment_settled" | "payment_verified" | "task_completed" | "task_failed" | "payment_uncertain";
const transitions: Partial<Record<Stage, readonly Stage[]>> = {
  worker_selected: ["hire_authorized", "task_failed"],
  hire_authorized: ["payment_submitted", "task_failed"],
  payment_submitted: ["payment_settled", "payment_uncertain", "task_failed"],
  payment_settled: ["payment_verified", "payment_uncertain", "task_failed"],
  payment_verified: ["task_completed", "task_failed"],
};

export async function executeFinalHire(checkpoint: HireCheckpoint, options: {
  enabled: boolean; authorization: HireAuthorization; key: PrivateKey; mirror: URL; openAttempt: OpenAttempt; now?: () => number;
}) {
  const { authorization: auth, key, mirror, openAttempt } = options;
  const now = options.now ?? Date.now;
  const { task, bid } = checkpoint;
  const { body, request, digest } = binding(checkpoint);
  const expires = Date.parse(auth.expiresAt);
  function authorize() {
    assertHireCheckpoint(checkpoint, now());
    if (!options.enabled || !Number.isFinite(expires) || new Date(expires).toISOString() !== auth.expiresAt ||
        now() >= expires || auth.taskId !== HIRE_TASK_ID || auth.workerId !== HIRE_WORKER ||
        auth.payer !== HIRE_PAYER || auth.merchant !== HIRE_MERCHANT || auth.endpoint !== bid.endpoint ||
        auth.network !== bid.network || auth.asset !== bid.asset || auth.requestDigest !== digest ||
        auth.amountTinybars !== HIRE_PRICE || auth.maxTotalTinybars !== checkpoint.initialBudgetTinybars ||
        BigInt(auth.amountTinybars) > BigInt(task.maxBudgetTinybars) ||
        BigInt(checkpoint.settledTestTinybars) + BigInt(auth.amountTinybars) > BigInt(auth.maxTotalTinybars)) {
      throw new Error("Exact final-hire authorization or budget check failed");
    }
  }
  authorize();
  const record = await openAttempt(task.taskId, auth.payer);
  const stages: Stage[] = ["created", "bidding", "testing", "worker_selected"];
  const advance = (next: Stage) => {
    const last = stages.at(-1);
    if (!last || !transitions[last]?.includes(next)) throw new Error("Invalid procurement lifecycle transition");
    stages.push(next);
  };
  await record({ state: "planned", detail: { checkpoint, stages: [...stages] } });

  const price = BigInt(bid.priceTinybars);
  const policy = new SpendingPolicy(bid.endpoint, bid.merchant, price, BigInt(task.maxBudgetTinybars));
  const sign = createPayerSigner(auth.payer, key);
  let transactionId: string | undefined;
  let settled = false;
  let failure: "failed" | "uncertain" = "failed";
  let output: unknown;
  try {
    const response = await payForResource(policy, body, auth.payer, async (quote) => {
      authorize();
      const payload = await sign(quote);
      const tx = payload.payload.transaction;
      if (typeof tx !== "string") throw new Error("Missing signed transfer");
      return { ...payload, extensions: { ...payload.extensions, [HIRE_EXTENSION]:
        Buffer.from(key.sign(hireBinding(request, bid.endpoint, quote.accepts[0], tx))).toString("hex") } };
    }, {
      async authorize(quote) {
        await record({ state: "quoted" });
        authorize();
        if (quote.accepts[0].amount !== bid.priceTinybars || quote.accepts[0].extra?.hireRequest !== digest) {
          throw new Error("Final quote does not match the authorized task");
        }
        advance("hire_authorized");
        await record({ state: "authorized" });
      },
      async submitted(id) {
        authorize();
        advance("payment_submitted");
        await record({ state: "submitted", transactionId: id });
        transactionId = id;
      },
      async settled(id) {
        settled = true;
        advance("payment_settled");
        await record({ state: "settled", transactionId: id });
      },
    });
    output = response.worker;
  } catch (error) {
    if (transactionId && (!(error instanceof PaymentAttemptError) || error.state === "uncertain")) failure = "uncertain";
  }

  const independent = transactionId && (settled || failure === "uncertain") ? await reconcilePayment(mirror, {
    transactionId, payer: auth.payer, merchant: bid.merchant, amountTinybars: bid.priceTinybars,
  }) : null;
  const state = independent?.status === "verified" ? "verified" : independent?.status === "invalid" ? "uncertain"
    : settled ? "settled" : failure;
  if (state === "verified") {
    if (!settled) advance("payment_settled");
    advance("payment_verified");
  }
  const evaluation = settled ? evaluateCapabilityTest({
    testId: bid.bidId, taskId: task.taskId, workerId: bid.workerId, capability: task.capability,
    input: task.input, expected: hireReference(task.input), priceTinybars: bid.priceTinybars, timeoutMs: 0,
  }, isRecord(output) && Object.keys(output).length === 3 && output.taskId === task.taskId &&
      output.workerId === bid.workerId ? output.output : null) : null;
  if (state === "uncertain") advance("payment_uncertain");
  else if (state === "failed" || (state === "verified" && !evaluation?.passed)) advance("task_failed");
  else if (state === "verified") advance("task_completed");
  const paid = state === "verified" || state === "settled";
  const spent = paid ? price : 0n;
  const reserved = !paid && state === "uncertain" ? price : 0n;
  const available = BigInt(task.maxBudgetTinybars) - spent - reserved;
  const timestamp = new Date(now()).toISOString();
  const audit = (eventType: AuditPayload["eventType"], metadata: AuditMetadata = {}, phase = "hire") => {
    const event = createAuditEvent({ version: 1,
      eventId: createHash("sha256").update(JSON.stringify([task.taskId, phase, eventType])).digest("hex"),
      eventType, jobId: task.taskId, agentId: "agenthire-manager", timestamp, metadata });
    serializeAuditEvent(event);
    return { status: "pending" as const, event };
  };
  const testAmount = { workerId: "economy", amountBaseUnits: checkpoint.settledTestTinybars, amountUnit: "tinybar" } as const;
  const hireAmount = { workerId: bid.workerId, amountBaseUnits: bid.priceTinybars, amountUnit: "tinybar" } as const;
  const pendingAuditRecords = [
    audit("JOB_CREATED"), audit("BID_SUBMITTED", hireAmount),
    audit("CAPABILITY_TEST_REQUESTED", testAmount),
    audit("CAPABILITY_TEST_COMPLETED", { ...testAmount, outcome: "failure", artifactHash: checkpoint.priorTest.evidenceHash }),
    audit("PAYMENT_SETTLED", { ...testAmount, paymentTransactionId: checkpoint.priorTest.transactionId }, "pocp"),
    audit("WORKER_SELECTED", hireAmount),
    ...(paid && transactionId ? [audit("PAYMENT_SETTLED", { ...hireAmount, paymentTransactionId: transactionId })] : []),
    ...(stages.at(-1) === "task_completed" ? [audit("TASK_COMPLETED", {
      workerId: bid.workerId, outcome: "success", artifactHash: evaluation?.evidenceHash,
    })] : stages.at(-1) === "task_failed" ? [audit("TASK_FAILED", {
      workerId: bid.workerId, outcome: "failure", artifactHash: evaluation?.evidenceHash,
    })] : []),
  ];
  const result = {
    checkpoint, lifecycle: stages, status: stages.at(-1),
    payment: { state, transactionId, explorer: transactionId && paymentExplorerUrl(transactionId), independent,
      payer: auth.payer, merchant: bid.merchant, amountTinybars: bid.priceTinybars, requestDigest: digest },
    evaluation, pendingAuditRecords,
    reason: state === "uncertain" ? "reconciliation_required" : state === "failed" ? "quote_or_payment_rejected"
      : state === "settled" ? "awaiting_independent_verification" : evaluation?.reason,
    budget: { settledTestTinybars: checkpoint.settledTestTinybars, settledHireTinybars: spent.toString(),
      totalSettledTinybars: (BigInt(checkpoint.settledTestTinybars) + spent).toString(), reservedTinybars: reserved.toString(),
      availableTinybars: available.toString(), projectedHireTinybars: price.toString() },
  };
  await record({ state, transactionId, detail: result });
  return result;
}
