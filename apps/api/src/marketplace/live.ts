import { DEMO_MERCHANT } from "../agents/workers.js";
import { timingSafeEqual } from "node:crypto";
import { Hbar } from "@hiero-ledger/sdk";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type { ProcurementBid } from "@agenthire/shared";
import { evaluateCapabilityTest, sanitizeStatisticsOutput } from "../agents/capability-tests.js";
import { createPayerSigner, payForResource, SpendingPolicy } from "../agents/payer.js";
import { isRecord, tinybars } from "../agents/task.js";
import { loadHederaConfig, parseHederaPrivateKey } from "../config/hedera.js";
import { createAuditEvent, serializeAuditEvent } from "../hedera/audit-event.js";
import type { AuditMetadata, AuditPayload } from "../hedera/audit-event.js";
import { createHederaClient } from "../hedera/client.js";
import { submitAuditEvent, verifyAuditEvent } from "../hedera/consensus.js";
import { checkAuditTopic, readVerifiedHistory } from "../audit/topic.js";
import { AUDIT_TOPIC } from "../audit/completed-procurement.js";
import { bindingBytes, CAPABILITY_EXTENSION, capabilityDigest, lookupPayerAccount } from "../x402/capability-binding.js";
import type { CapabilityRequest } from "../x402/capability-binding.js";
import { X402_ASSET, X402_FACILITATOR, X402_FEE_PAYER, X402_MAX_FEE, X402_NETWORK } from "../x402/config.js";
import { paymentExplorerUrl, validPayer } from "../x402/protocol.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { collectBids, decide, planBinding } from "./manager.js";
import { digest, origin, seeds } from "./protocol.js";
import type { Job, JobStore } from "./store.js";

const auditCap = 10_000_000n;
const scopeKeys = ["jobId", "payer", "merchant", "endpoints", "network", "asset", "maxTotal", "maxTest", "maxHire",
  "maxPayments", "maxSponsoredFee", "expiresAt", "topic", "maxAuditMessages", "maxAuditFee"];
export function operatorAuthorized(header: unknown, token: string | undefined) {
  if (!token || token.length < 32 || typeof header !== "string") return false;
  const expected = Buffer.from("Bearer " + token);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseScope(body: unknown, job: Job, env: NodeJS.ProcessEnv) {
  if (!isRecord(body) || Object.keys(body).length !== scopeKeys.length || scopeKeys.some(key => !Object.hasOwn(body, key)) ||
      body.jobId !== job.id || body.payer !== env.X402_PAYER_ID || body.merchant !== (env.X402_MERCHANT_ID ?? DEMO_MERCHANT) ||
      typeof body.payer !== "string" || typeof body.merchant !== "string" || !validPayer(body.payer, body.merchant) ||
      body.network !== X402_NETWORK || body.asset !== X402_ASSET || body.topic !== AUDIT_TOPIC ||
      !Array.isArray(body.endpoints) || !body.endpoints.length || body.endpoints.length > 6 ||
      !body.endpoints.every(endpoint => seeds.some(seed => ["/execute", "/capability-test"].some(path => origin(seed) + path === endpoint))) ||
      new Set(body.endpoints).size !== body.endpoints.length ||
      !tinybars(body.maxTotal) || !tinybars(body.maxTest) || !tinybars(body.maxHire) ||
      BigInt(body.maxTotal) > BigInt(job.task.maxBudgetTinybars) || BigInt(body.maxTest) > BigInt(job.maxTest) ||
      BigInt(body.maxTest) > BigInt(body.maxTotal) || BigInt(body.maxHire) > BigInt(body.maxTotal) || body.maxHire === "0" ||
      (body.maxPayments !== 1 && body.maxPayments !== 2) || body.maxSponsoredFee !== X402_MAX_FEE.toString() ||
      typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt)) ||
      Date.parse(body.expiresAt) <= Date.now() || Date.parse(body.expiresAt) > Date.now() + 600_000 ||
      typeof body.maxAuditMessages !== "number" || !Number.isInteger(body.maxAuditMessages) ||
      body.maxAuditMessages < 1 || body.maxAuditMessages > 10 || !tinybars(body.maxAuditFee) ||
      BigInt(body.maxAuditFee) > BigInt(body.maxAuditMessages) * auditCap) throw new Error("Invalid live policy");
  return { jobId: job.id, payer: body.payer, merchant: body.merchant, endpoints: body.endpoints as string[],
    network: X402_NETWORK, asset: X402_ASSET, maxTotal: body.maxTotal, maxTest: body.maxTest, maxHire: body.maxHire,
    maxPayments: body.maxPayments, maxSponsoredFee: body.maxSponsoredFee, expiresAt: body.expiresAt, topic: AUDIT_TOPIC,
    maxAuditMessages: body.maxAuditMessages, maxAuditFee: body.maxAuditFee };
}
export type Scope = ReturnType<typeof parseScope>;

export async function inspectLiveInfrastructure(jobId: string, payer: string, env: NodeJS.ProcessEnv) {
  const config = loadHederaConfig(env);
  const mirror = config.mirrorNodeUrl;
  const key = parseHederaPrivateKey(env.X402_PAYER_KEY ?? "", "X402_PAYER_KEY");
  const [{ publicKey, balanceTinybars }, operatorBalance, supported, history] = await Promise.all([
    lookupPayerAccount(mirror, payer),
    checkAuditTopic(mirror, AUDIT_TOPIC, config.operatorAccountId.toString(), config.operatorKey.publicKey),
    new HTTPFacilitatorClient({ url: X402_FACILITATOR, timeoutMs: 8000 }).getSupported(),
    readVerifiedHistory(mirror),
  ]);
  if (key.publicKey.toStringRaw() !== publicKey.toStringRaw() ||
      !supported.kinds.some(kind => kind.x402Version === 2 && kind.network === X402_NETWORK && kind.scheme === "exact" &&
        kind.extra?.feePayer === X402_FEE_PAYER) || history.some(row => row.event.jobId === jobId)) {
    throw new Error("Payer key, facilitator or topic history did not verify");
  }
  return { config, key, payerBalance: balanceTinybars, operatorBalance, topicHead: history.at(-1)?.sequenceNumber };
}
const liveDependencies = { inspectLiveInfrastructure, collectBids, payForResource, reconcilePayment, submitAuditEvent, verifyAuditEvent };

export async function runLive(store: JobStore, job: Job, auth: Scope, env: NodeJS.ProcessEnv,
  dependencies: typeof liveDependencies = liveDependencies) {
  const expired = () => Date.now() >= Date.parse(auth.expiresAt) || store.job(job.id)?.status !== "executing";
  let moneyStarted = false;
  let auditStarted = false;
  let stage = "live_preflight";
  try {
    const { config, key, payerBalance, operatorBalance, topicHead } = await dependencies.inspectLiveInfrastructure(job.id, auth.payer, env);
    const mirror = config.mirrorNodeUrl;
    if (BigInt(payerBalance) < BigInt(auth.maxTotal) || BigInt(operatorBalance) < BigInt(auth.maxAuditFee) || expired()) throw new Error();
    const candidates = await dependencies.collectBids(store, job, auth.merchant, env);
    const plan = await decide(job, candidates);
    const approvedPlan = store.events(job.id).filter(event => event.kind === "authorization.required").at(-1)?.data;
    if (approvedPlan?.planHash !== planBinding(candidates, plan)) throw new Error("Reviewed plan changed");
    store.event(job.id, "pocp.evaluated", plan.trace);
    const test = plan.chosenTest;
    const valuation = plan.trace.valuations.find(row => row.workerId === test?.workerId);
    const allowableHireIds = test && valuation?.status === "valued" ? [valuation.pass.workerId, valuation.fail.workerId]
      : [plan.winningBid?.workerId];
    const projectedAuditCount = candidates.length + (test ? 7 : 4);
    const testCost = BigInt(test?.priceTinybars ?? "0");
    if (!plan.winningBid || (test ? 2 : 1) > auth.maxPayments || testCost > BigInt(auth.maxTest) ||
        projectedAuditCount > auth.maxAuditMessages || BigInt(projectedAuditCount) * auditCap > BigInt(auth.maxAuditFee) ||
        (test && !auth.endpoints.includes(new URL("/capability-test", candidates.find(row => row.bid.workerId === test.workerId)?.bid.endpoint).href)) ||
        allowableHireIds.some(id => !candidates.some(({ bid }) => bid.workerId === id && auth.endpoints.includes(bid.endpoint) &&
          BigInt(bid.priceTinybars) <= BigInt(auth.maxHire) && BigInt(bid.priceTinybars) + testCost <= BigInt(auth.maxTotal)))) throw new Error();

    let spent = 0n, attempts = 0;
    const sign = createPayerSigner(auth.payer, key);
    async function pay(phase: "test" | "hire", bid: ProcurementBid, input: readonly number[], amount: string) {
      const endpoint = phase === "test" ? new URL("/capability-test", bid.endpoint).href : bid.endpoint;
      const cost = BigInt(amount);
      const permitted = () => !expired() && Date.parse(bid.expiresAt) > Date.now() && bid.merchant === auth.merchant &&
        auth.endpoints.includes(endpoint) && attempts < auth.maxPayments && spent + cost <= BigInt(auth.maxTotal) &&
        cost <= BigInt(phase === "test" ? auth.maxTest : auth.maxHire);
      if (!permitted()) throw new Error("Policy rejected");
      const request: CapabilityRequest = { taskId: job.id, testId: `${job.id}-${bid.workerId}-statistics-v1`,
        workerId: bid.workerId, capability: "statistics.summary", input: [...input] };
      const requestDigest = capabilityDigest(request);
      const policy = new SpendingPolicy(endpoint, auth.merchant, cost, cost);
      const response = await dependencies.payForResource(policy, request, auth.payer, async quote => {
        if (!permitted()) throw new Error("Policy expired");
        const payload = await sign(quote);
        const transaction = payload.payload.transaction;
        if (typeof transaction !== "string") throw new Error("Invalid payment");
        return { ...payload, extensions: { ...payload.extensions, [CAPABILITY_EXTENSION]:
          Buffer.from(key.sign(bindingBytes(request, endpoint, quote.accepts[0], transaction))).toString("hex") } };
      }, {
        async authorize(quote) {
          if (!permitted() || quote.accepts[0].amount !== amount || quote.accepts[0].extra?.capabilityRequest !== requestDigest) {
            throw new Error("Quote mismatch");
          }
          store.event(job.id, "payment.quoted", { phase, amount, endpoint, requestDigest });
        },
        async submitted(transactionId) {
          if (!permitted()) throw new Error("Policy expired");
          store.event(job.id, "payment.submitted", { phase, transactionId, amount, explorer: paymentExplorerUrl(transactionId) });
          moneyStarted = true;
          attempts++;
          spent += cost;
        },
        async settled(transactionId) { store.event(job.id, "payment.settled", { phase, transactionId }); },
      });
      const evidence = await dependencies.reconcilePayment(mirror, { transactionId: response.transactionId, payer: auth.payer,
        merchant: auth.merchant, amountTinybars: amount });
      if (evidence.status !== "verified") throw new Error("Mirror verification incomplete");
      store.event(job.id, "payment.verified", { phase, transactionId: response.transactionId, amount, explorer: response.explorer, ...evidence });
      return { ...response, evidence, requestDigest };
    }

    const audit: ReturnType<typeof createAuditEvent>[] = [];
    function record(type: AuditPayload["eventType"], phase: string, metadata: AuditMetadata = {}) {
      audit.push(createAuditEvent({ version: 1, eventId: digest([job.id, type, phase]), eventType: type, jobId: job.id,
        agentId: "agenthire-manager", timestamp: new Date().toISOString(), metadata }));
    }
    const paymentMeta = (workerId: string, amountBaseUnits: string, paymentTransactionId?: string): AuditMetadata =>
      ({ workerId, amountBaseUnits, amountUnit: "tinybar", paymentTransactionId });
    record("JOB_CREATED", "create");
    for (const { bid } of candidates) record("BID_SUBMITTED", bid.workerId, paymentMeta(bid.workerId, bid.priceTinybars));
    stage = "capability_test";
    const execution = await decide(job, candidates, { overheadMs: 15_000, async run(chosen, bid) {
      if (chosen.testId !== test?.testId) throw new Error("Plan changed");
      store.event(job.id, "capability_test.planned", chosen);
      record("CAPABILITY_TEST_REQUESTED", "test", paymentMeta(bid.workerId, chosen.priceTinybars));
      const paid = await pay("test", bid, chosen.input, chosen.priceTinybars);
      const observed = evaluateCapabilityTest(chosen, coreOutput(paid.worker));
      const result = { ...observed, durationMs: 0 };
      store.event(job.id, "capability_test.completed", { ...observed, workerId: bid.workerId });
      record("PAYMENT_SETTLED", "test", paymentMeta(bid.workerId, chosen.priceTinybars, paid.transactionId));
      record("CAPABILITY_TEST_COMPLETED", "test", { workerId: bid.workerId, outcome: result.passed ? "success" : "failure", artifactHash: result.evidenceHash });
      return { state: "verified", spentTinybars: chosen.priceTinybars, reservedTinybars: "0", result };
    } });
    if (execution.trace.action !== plan.trace.action || !execution.winningBid) throw new Error("Selection changed outside the plan");
    if (execution.result) store.event(job.id, "reliability.updated", { estimates: execution.trace.posteriors });
    const bid = execution.winningBid;
    if (!allowableHireIds.includes(bid.workerId)) throw new Error("Selection changed outside authorized branches");
    record("WORKER_SELECTED", "hire", paymentMeta(bid.workerId, bid.priceTinybars));
    store.event(job.id, "worker.selected", bid);
    stage = "final_hire";
    store.event(job.id, "task.execution.started", { workerId: bid.workerId });
    const paid = await pay("hire", bid, job.task.input, bid.priceTinybars);
    record("PAYMENT_SETTLED", "hire", paymentMeta(bid.workerId, bid.priceTinybars, paid.transactionId));
    const evaluation = evaluateProduction(job.task.input, paid.worker);
    store.event(job.id, "task.execution.completed", { output: evaluation.output });
    store.event(job.id, "task.verification.completed", evaluation);
    record(evaluation.passed ? "TASK_COMPLETED" : "TASK_FAILED", "result",
      { workerId: bid.workerId, outcome: evaluation.passed ? "success" : "failure", artifactHash: evaluation.evidenceHash });
    stage = "audit";
    if (audit.length !== projectedAuditCount) throw new Error("Audit scope changed");
    const manifest = audit.map(event => ({ eventId: event.eventId, payloadHash: event.payloadHash }));
    store.event(job.id, "audit.manifest", { topic: auth.topic, manifestHash: digest(manifest), events: audit });
    let lastSequence = BigInt(topicHead ?? "0");
    const client = createHederaClient(config);
    try {
      for (const event of audit) {
        if (expired()) throw new Error("Audit policy expired");
        store.event(job.id, "audit.prepared", event);
        const receipt = await dependencies.submitAuditEvent(client, auth.topic, event, {
          network: config.network, maxFee: Hbar.fromTinybars(auditCap.toString()), async beforeSubmit(transactionId) {
            if (expired()) throw new Error("Audit policy expired");
            store.event(job.id, "audit.submitted", { eventId: event.eventId, transactionId });
            auditStarted = true;
          },
        });
        if (receipt.receiptStatus !== "SUCCESS" || !receipt.sequenceNumber) throw new Error("HCS receipt uncertain");
        const indexed = await dependencies.verifyAuditEvent(mirror, auth.topic, receipt.sequenceNumber);
        if (indexed.status !== "verified" || indexed.topicId !== auth.topic || indexed.sequenceNumber !== receipt.sequenceNumber ||
            BigInt(indexed.sequenceNumber) <= lastSequence || serializeAuditEvent(indexed.event) !== serializeAuditEvent(event)) {
          throw new Error("HCS indexing uncertain");
        }
        lastSequence = BigInt(indexed.sequenceNumber);
        store.event(job.id, "audit.verified", { eventId: event.eventId, transactionId: receipt.transactionId,
          sequence: indexed.sequenceNumber, consensusTimestamp: indexed.consensusTimestamp, explorer: paymentExplorerUrl(receipt.transactionId) });
      }
    } finally { client.close(); }
    store.transition(job.id, "executing", evaluation.passed ? "completed" : "failed",
      evaluation.passed ? "job.completed" : "job.failed", { spentTinybars: spent.toString(),
        remainingTinybars: (BigInt(job.task.maxBudgetTinybars) - spent).toString() });
  } catch {
    store.transition(job.id, "executing", moneyStarted || auditStarted ? "needs_reconciliation" : "failed",
      "job.failed", { stage, reason: moneyStarted || auditStarted ? "writes_may_have_occurred_do_not_retry" : "live_preflight_or_policy_failed" });
  }
}

function coreOutput(value: unknown) {
  if (!isRecord(value)) return null;
  const { count, min, max, mean } = value;
  return sanitizeStatisticsOutput({ count, min, max, mean });
}

export function evaluateProduction(input: readonly number[], value: unknown) {
  const output = coreOutput(value);
  const sorted = [...input].sort((a, b) => a - b);
  const expected = { count: sorted.length, min: sorted[0], max: sorted.at(-1),
    mean: sorted.map(value => value / sorted.length).reduce((sum, value) => sum + value, 0) };
  const passed = output !== null && output.count === expected.count && output.min === expected.min &&
    output.max === expected.max && Math.abs(output.mean - expected.mean) <= Math.max(1e-6, Math.abs(expected.mean) * 1e-12);
  return { output, expected, passed, evidenceHash: digest({ input, output, passed }) };
}
