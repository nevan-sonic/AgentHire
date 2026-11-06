import { createHash } from "node:crypto";
import type { AuditEvent } from "../hedera/audit-event.js";
import { serializeAuditEvent } from "../hedera/audit-event.js";
import type { AuditVerification } from "../hedera/consensus.js";
import { validSequence } from "../hedera/consensus.js";
import { normalizeTransactionId, paymentExplorerUrl } from "../x402/protocol.js";
import { AUDIT_MANIFEST_HASH, AUDIT_OPERATOR, AUDIT_TASK, AUDIT_TOPIC } from "./completed-procurement.js";
import type { publicationJournal } from "./publication-journal.js";
import type { VerifiedTopicEvent } from "./topic.js";

type Journal = ReturnType<typeof publicationJournal>;
type ReportEvent = {
  eventId: string; eventType: AuditEvent["eventType"]; payloadHash: string;
  status: "missing" | "verified" | "uncertain" | "conflict";
  sequenceNumber?: string; consensusTimestamp?: string; transactionId?: string;
  hashScanUrl?: string; reason?: string;
};

export type PublicationAuthorization = {
  enabled: boolean; taskId: string; topicId: string; manifestHash: string; expiresAt: string;
  maxSubmissions: number; perSubmissionTinybars: bigint; aggregateTinybars: bigint;
};

export async function inspectPublication(events: AuditEvent[], history: VerifiedTopicEvent[], journal: Journal) {
  const reports: ReportEvent[] = [];
  const known = new Set(events.map(({ eventId }) => eventId));
  const unexpected = history.some(({ event }) => event.jobId === AUDIT_TASK && !known.has(event.eventId));
  let last = 0n;
  let gap = false;
  let attempts = 0;
  let committedCap = 0n;

  for (const event of events) {
    serializeAuditEvent(event);
    const matches = history.filter((item) => item.event.eventId === event.eventId);
    const row: ReportEvent = { eventId: event.eventId, eventType: event.eventType, payloadHash: event.payloadHash, status: "missing" };
    const saved = await journal.read(event);
    if (saved) { attempts++; committedCap += BigInt(saved.feeCapTinybars); }
    if (unexpected || matches.length > 1 || matches.some(({ event: found }) => found.payloadHash !== event.payloadHash)) {
      row.status = "conflict";
      row.reason = "duplicate, unexpected, or conflicting indexed event";
    } else if (matches.length === 1) {
      const indexed = matches[0];
      if (indexed.topicId !== AUDIT_TOPIC || gap || BigInt(indexed.sequenceNumber) <= last ||
          (saved?.sequenceNumber && saved.sequenceNumber !== indexed.sequenceNumber)) {
        row.status = "conflict";
        row.reason = "indexed sequence conflicts with the ordered manifest";
      } else {
        last = BigInt(indexed.sequenceNumber);
        row.status = "verified";
        row.sequenceNumber = indexed.sequenceNumber;
        row.consensusTimestamp = indexed.consensusTimestamp;
        if (saved?.sequenceNumber === indexed.sequenceNumber) {
          row.transactionId = saved.transactionConfirmed !== false ? normalizeTransactionId(saved.transactionId) : undefined;
          if (row.transactionId) row.hashScanUrl = paymentExplorerUrl(row.transactionId);
        }
      }
    } else {
      gap = true;
      if (saved) {
        row.status = "uncertain";
        row.reason = "prior attempt is not independently indexed";
        row.transactionId = normalizeTransactionId(saved.transactionId);
        if (row.transactionId) row.hashScanUrl = paymentExplorerUrl(row.transactionId);
      }
    }
    reports.push(row);
  }
  return { reports, attempts, committedCap };
}

type SubmitReceipt = { transactionId: string; topicId: string; sequenceNumber?: string; receiptStatus: string };

export async function publishAudit(events: AuditEvent[], history: VerifiedTopicEvent[], options: {
  authorization: PublicationAuthorization; balanceTinybars: bigint; journal: Journal;
  submit(event: AuditEvent, fee: bigint, beforeSubmit: (transactionId: string) => Promise<void>): Promise<SubmitReceipt>;
  verify(sequence: string): Promise<AuditVerification>;
  now?: () => number;
}) {
  const { authorization: auth, journal } = options;
  const now = options.now ?? Date.now;
  const expiry = Date.parse(auth.expiresAt);
  const { reports, attempts, committedCap } = await inspectPublication(events, history, journal);
  if (reports.some(({ status }) => status === "uncertain" || status === "conflict")) return reports;
  const missing = reports.filter(({ status }) => status === "missing").length;
  const needed = BigInt(missing) * auth.perSubmissionTinybars;
  const manifest = createHash("sha256").update(JSON.stringify(events.map(
    ({ eventId, payloadHash }) => [eventId, payloadHash],
  ))).digest("hex");
  if (!auth.enabled || auth.taskId !== AUDIT_TASK || auth.topicId !== AUDIT_TOPIC ||
      auth.manifestHash !== AUDIT_MANIFEST_HASH || manifest !== AUDIT_MANIFEST_HASH || events.length !== 8 ||
      !Number.isFinite(expiry) || new Date(expiry).toISOString() !== auth.expiresAt || expiry <= now() ||
      !Number.isInteger(auth.maxSubmissions) || auth.maxSubmissions < 1 || auth.maxSubmissions > 8 ||
      attempts + missing > auth.maxSubmissions || auth.perSubmissionTinybars <= 0n ||
      auth.perSubmissionTinybars > 10_000_000n || auth.aggregateTinybars > 80_000_000n ||
      committedCap + needed > auth.aggregateTinybars || needed > options.balanceTinybars) {
    throw new Error("Publication authorization, balance, or aggregate fee limit rejected");
  }

  let highest = BigInt(history.at(-1)?.sequenceNumber ?? "0");
  for (let i = 0; i < events.length; i++) {
    const row = reports[i];
    const event = events[i];
    if (row.status === "verified") {
      const saved = await journal.read(event);
      if (saved && saved.status !== "verified") await journal.write(event, {
        ...saved, status: "verified", sequenceNumber: row.sequenceNumber, consensusTimestamp: row.consensusTimestamp,
        transactionConfirmed: Boolean(row.transactionId),
      });
      continue;
    }
    if (now() >= expiry) break;
    const base = { eventId: event.eventId, payloadHash: event.payloadHash, feeCapTinybars: auth.perSubmissionTinybars.toString() };
    let transactionId: string | undefined, sequenceNumber: string | undefined;
    let claimed = false;
    try {
      await journal.claim(event, base.feeCapTinybars);
      claimed = true;
      const receipt = await options.submit(event, auth.perSubmissionTinybars, async (id) => {
        if (now() >= expiry || normalizeTransactionId(id) !== id || !id.startsWith(AUDIT_OPERATOR + "@")) {
          throw new Error("Submission authorization expired or operator changed");
        }
        transactionId = id;
        await journal.write(event, { ...base, status: "submitting", transactionId });
      });
      if (!transactionId || receipt.transactionId !== transactionId || receipt.receiptStatus !== "SUCCESS" ||
          receipt.topicId !== AUDIT_TOPIC || !receipt.sequenceNumber || !validSequence(receipt.sequenceNumber)) {
        throw new Error("Receipt did not confirm an authoritative sequence");
      }
      sequenceNumber = receipt.sequenceNumber;
      await journal.write(event, { ...base, status: "submitted", transactionId, sequenceNumber });
      const checked = await options.verify(sequenceNumber);
      if (checked.status !== "verified" || checked.topicId !== AUDIT_TOPIC || checked.sequenceNumber !== sequenceNumber ||
          BigInt(sequenceNumber) <= highest || checked.event.eventId !== event.eventId ||
          checked.event.payloadHash !== event.payloadHash || serializeAuditEvent(checked.event) !== serializeAuditEvent(event)) {
        throw new Error("Submitted event did not independently verify");
      }
      highest = BigInt(sequenceNumber);
      await journal.write(event, { ...base, status: "verified", transactionId, sequenceNumber,
        consensusTimestamp: checked.consensusTimestamp });
      Object.assign(row, { status: "verified", transactionId, sequenceNumber,
        consensusTimestamp: checked.consensusTimestamp, hashScanUrl: paymentExplorerUrl(transactionId) });
    } catch {
      if (claimed) await journal.write(event, { ...base, status: "uncertain", transactionId, sequenceNumber });
      Object.assign(row, { status: "uncertain", transactionId, sequenceNumber,
        hashScanUrl: transactionId && paymentExplorerUrl(transactionId),
        reason: "Publication could not be independently confirmed. Reconcile before continuing." });
      break;
    }
  }
  return reports;
}
