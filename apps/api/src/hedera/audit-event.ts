import { createHash } from "node:crypto";

export const AUDIT_EVENT_TYPES = [
  "JOB_CREATED", "BID_SUBMITTED", "CAPABILITY_TEST_REQUESTED",
  "CAPABILITY_TEST_COMPLETED", "WORKER_SELECTED", "PAYMENT_SETTLED",
  "TASK_COMPLETED", "TASK_FAILED",
  "GOAL_CREATED", "DELEGATION_AUTHORIZED", "RESEARCH_BID_RECEIVED", "SUBCONTRACTOR_SELECTED",
  "SUBCONTRACT_PAYMENT_SETTLED", "RESEARCH_ARTIFACT_VERIFIED", "MISSION_COMPLETED", "GOAL_COMPLETED", "GOAL_FAILED",
] as const;

export const MAX_AUDIT_BYTES = 768;

export type AuditMetadata = {
  workerId?: string;
  paymentTransactionId?: string;
  amountBaseUnits?: string;
  amountUnit?: "tinybar" | "token-base-unit";
  tokenId?: string;
  outcome?: "success" | "failure";
  artifactHash?: string;
};

export type AuditPayload = {
  version: 1;
  eventId: string;
  eventType: (typeof AUDIT_EVENT_TYPES)[number];
  jobId: string;
  agentId: string;
  timestamp: string;
  metadata: AuditMetadata;
};
export type AuditEvent = AuditPayload & { payloadHash: string };

const idPattern = /^[a-z0-9][a-z0-9_-]{0,95}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const payloadKeys = ["version", "eventId", "eventType", "jobId", "agentId", "timestamp", "metadata"];
const metadataKeys = [
  "workerId", "paymentTransactionId", "amountBaseUnits", "amountUnit", "tokenId", "outcome", "artifactHash",
];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function validMetadata(value: unknown): value is AuditMetadata {
  if (!object(value) || Object.keys(value).some((key) => !metadataKeys.includes(key))) return false;
  const { workerId, paymentTransactionId, amountBaseUnits, amountUnit, tokenId, outcome, artifactHash } = value;
  return (workerId === undefined || matches(workerId, idPattern))
    && (paymentTransactionId === undefined || matches(paymentTransactionId, /^\d{1,19}\.\d{1,19}\.\d{1,19}@\d{1,19}\.\d{9}$/))
    && (outcome === undefined || outcome === "success" || outcome === "failure")
    && (artifactHash === undefined || matches(artifactHash, hashPattern))
    && (amountBaseUnits === undefined
      ? amountUnit === undefined && tokenId === undefined
      : matches(amountBaseUnits, /^(0|[1-9]\d{0,18})$/)
        && (amountUnit === "tinybar" && tokenId === undefined
          || amountUnit === "token-base-unit" && matches(tokenId, /^\d{1,19}\.\d{1,19}\.\d{1,19}$/)));
}

function validPayload(value: unknown): value is AuditPayload {
  if (!object(value)) return false;
  const { eventId, eventType, jobId, agentId, timestamp, metadata } = value;
  return Object.keys(value).length === payloadKeys.length
    && Object.keys(value).every((key) => payloadKeys.includes(key))
    && value.version === 1
    && matches(eventId, idPattern) && matches(jobId, idPattern) && matches(agentId, idPattern)
    && AUDIT_EVENT_TYPES.some((type) => type === eventType)
    && matches(timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    && Number.isFinite(Date.parse(timestamp))
    && new Date(timestamp).toISOString() === timestamp
    && validMetadata(metadata);
}

function canonicalJson(value: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return JSON.stringify(sorted);
}

function sortedMetadata(metadata: AuditMetadata) {
  return Object.fromEntries(Object.entries(metadata).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  ));
}

export function canonicalAuditPayload(payload: AuditPayload): string {
  if (!validPayload(payload)) throw new Error("Invalid version 1 audit payload");
  return canonicalJson({ ...payload, metadata: sortedMetadata(payload.metadata) });
}

export function createAuditEvent(payload: AuditPayload): AuditEvent {
  const canonical = canonicalAuditPayload(payload);
  return { ...payload, payloadHash: createHash("sha256").update(canonical, "utf8").digest("hex") };
}

export function validateAuditEvent(value: unknown): AuditEvent {
  if (!object(value)) throw new Error("Invalid audit event");
  const { payloadHash, ...payload } = value;
  if (!matches(payloadHash, hashPattern) || !validPayload(payload)) throw new Error("Invalid audit event schema");
  const event = createAuditEvent(payload);
  if (event.payloadHash !== payloadHash) throw new Error("Audit payload hash mismatch");
  return event;
}

export function serializeAuditEvent(value: unknown): string {
  const { payloadHash, ...payload } = validateAuditEvent(value);
  const serialized = canonicalJson({ ...payload, metadata: sortedMetadata(payload.metadata), payloadHash });
  if (Buffer.byteLength(serialized, "utf8") > MAX_AUDIT_BYTES) throw new Error("Audit event exceeds message size limit");
  return serialized;
}
