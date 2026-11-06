import { Hbar } from "@hiero-ledger/sdk";
import { AUDIT_TOPIC } from "../audit/completed-procurement.js";
import { checkAuditTopic, readVerifiedHistory } from "../audit/topic.js";
import { loadHederaConfig } from "../config/hedera.js";
import { createAuditEvent, serializeAuditEvent } from "../hedera/audit-event.js";
import type { AuditMetadata, AuditPayload } from "../hedera/audit-event.js";
import { createHederaClient } from "../hedera/client.js";
import { submitAuditEvent, verifyAuditEvent } from "../hedera/consensus.js";
import { digest } from "../marketplace/protocol.js";
import { isRecord } from "../agents/task.js";
import { readBounded } from "./tools.js";
import { normalizeTransactionId, paymentExplorerUrl } from "../x402/protocol.js";
import { researchAuditFee } from "./research-ledger.js";
import type { ResearchScope } from "./research-ledger.js";
import type { Goal } from "./workflow.js";

export function goalAuditManifest(goal: Goal) {
  const result: ReturnType<typeof createAuditEvent>[] = [];
  const plan = goal.procurement?.plan;
  if (!plan) return result;
  function add(type: AuditPayload["eventType"], identity: string, timestamp: string, metadata: AuditMetadata = {}) {
    result.push(createAuditEvent({ version: 1, eventId: digest([goal.id, type, identity]), eventType: type,
      jobId: goal.id, agentId: "lead-research", timestamp, metadata }));
  }
  add("GOAL_CREATED", goal.id, goal.createdAt);
  const review = goal.events.find(row => row.kind === "research.bids");
  for (const bid of plan.bids) add("RESEARCH_BID_RECEIVED", bid.bidId, review?.at ?? goal.createdAt,
    { workerId: bid.workerId, amountBaseUnits: bid.priceTinybars, amountUnit: "tinybar" });
  for (const row of goal.events) {
    const data = row.detail as { id?: string; worker?: string; transactionId?: string; amount?: string; phase?: string; passed?: boolean; hash?: string; evidenceHash?: string };
    if (row.kind === "research.authorization.granted") add("DELEGATION_AUTHORIZED", plan.task.missionId, row.at, { artifactHash: plan.planHash });
    if (row.kind === "research.payment.reserved" && data.phase === "test") add("CAPABILITY_TEST_REQUESTED", data.id!, row.at, { workerId: data.worker });
    if (row.kind === "research.payment.verified") add("SUBCONTRACT_PAYMENT_SETTLED", data.id!, row.at,
      { workerId: data.worker, paymentTransactionId: data.transactionId, amountBaseUnits: data.amount, amountUnit: "tinybar" });
    if (row.kind === "research.observation" && data.phase === "test") add("CAPABILITY_TEST_COMPLETED", data.id!, row.at,
      { workerId: data.worker, outcome: data.passed ? "success" : "failure", artifactHash: data.evidenceHash });
    if (row.kind === "research.worker.selected") add("SUBCONTRACTOR_SELECTED", plan.task.missionId, row.at, { workerId: data.worker });
    if (row.kind === "research.artifact.verified") {
      add("RESEARCH_ARTIFACT_VERIFIED", plan.task.missionId, row.at, { workerId: data.worker, artifactHash: data.hash });
      add("MISSION_COMPLETED", plan.task.missionId, row.at, { workerId: data.worker });
    }
    if (row.kind === "goal.completed" || row.kind === "goal.failed") {
      add(row.kind === "goal.completed" ? "GOAL_COMPLETED" : "GOAL_FAILED", goal.id, row.at,
        { outcome: row.kind === "goal.completed" ? "success" : "failure" });
    }
  }
  return result;
}

async function actualAuditFee(mirror: URL, transactionId: string) {
  try {
    const id = transactionId.replace(/@(\d+)\.(\d+)$/, "-$1-$2");
    const response = await fetch(new URL("/api/v1/transactions/" + id, mirror), { redirect: "error", signal: AbortSignal.timeout(5000) });
    const body = await readBounded(response, 64_000);
    if (!isRecord(body) || !Array.isArray(body.transactions)) return undefined;
    const row = body.transactions.find(item => isRecord(item) && item.result === "SUCCESS" &&
      item.name === "CONSENSUSSUBMITMESSAGE" && normalizeTransactionId(item.transaction_id) === transactionId);
    const fee = row?.charged_tx_fee;
    return Number.isSafeInteger(fee) && fee >= 0 && BigInt(fee) <= researchAuditFee ? String(fee) : undefined;
  } catch { return undefined; }
}

const auditDeps = { checkAuditTopic, readVerifiedHistory, submitAuditEvent, verifyAuditEvent, actualAuditFee };
export async function publishGoalAudit(goal: Goal, scope: ResearchScope, env: NodeJS.ProcessEnv,
  save: (kind: string, detail?: object) => void, deps: typeof auditDeps = auditDeps) {
  if (!scope.maxAuditMessages) return;
  if (goal.events.some(event => event.kind === "research.payment.uncertain" || event.kind === "research.audit.submitted")) {
    throw new Error("Prior uncertain activity blocks publication");
  }
  const batch = goalAuditManifest(goal);
  if (batch.length > scope.maxAuditMessages || BigInt(batch.length) * researchAuditFee > BigInt(scope.maxAuditFee)) throw new Error("Audit allowance exceeded");
  const config = loadHederaConfig(env);
  const [balance, history] = await Promise.all([
    deps.checkAuditTopic(config.mirrorNodeUrl, AUDIT_TOPIC, config.operatorAccountId.toString(), config.operatorKey.publicKey),
    deps.readVerifiedHistory(config.mirrorNodeUrl),
  ]);
  if (BigInt(balance) < BigInt(scope.maxAuditFee) || history.some(row => row.event.jobId === goal.id)) throw new Error("Audit preflight conflict");
  let sequence = BigInt(history.at(-1)?.sequenceNumber ?? "0");
  const client = createHederaClient(config);
  try {
    save("research.audit.manifest", { topic: AUDIT_TOPIC, hash: digest(batch), events: batch });
    for (const event of batch) {
      if (Date.now() >= Date.parse(scope.expiresAt)) throw new Error("Audit authorization expired");
      const receipt = await deps.submitAuditEvent(client, AUDIT_TOPIC, event, { network: config.network,
        maxFee: Hbar.fromTinybars(researchAuditFee.toString()), async beforeSubmit(transactionId) {
          if (Date.now() >= Date.parse(scope.expiresAt)) throw new Error("Audit authorization expired");
          save("research.audit.submitted", { eventId: event.eventId, eventType: event.eventType, transactionId, explorer: paymentExplorerUrl(transactionId) });
        } });
      if (receipt.receiptStatus !== "SUCCESS" || !receipt.sequenceNumber) throw new Error("Audit receipt uncertain");
      const indexed = await deps.verifyAuditEvent(config.mirrorNodeUrl, AUDIT_TOPIC, receipt.sequenceNumber);
      if (indexed.status !== "verified" || indexed.sequenceNumber !== receipt.sequenceNumber || indexed.topicId !== AUDIT_TOPIC ||
          BigInt(indexed.sequenceNumber) <= sequence || serializeAuditEvent(indexed.event) !== serializeAuditEvent(event)) {
        throw new Error("Audit indexing uncertain");
      }
      sequence = BigInt(indexed.sequenceNumber);
      const feeTinybars = await deps.actualAuditFee(config.mirrorNodeUrl, receipt.transactionId);
      save("research.audit.verified", { eventId: event.eventId, eventType: event.eventType, transactionId: receipt.transactionId,
        sequence: indexed.sequenceNumber, consensusTimestamp: indexed.consensusTimestamp, feeTinybars, explorer: paymentExplorerUrl(receipt.transactionId) });
    }
  } finally { client.close(); }
}
