import { setTimeout as delay } from "node:timers/promises";
import { Hbar, Status, TopicCreateTransaction, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import type { Client, Transaction } from "@hiero-ledger/sdk";
import { MAX_AUDIT_BYTES, serializeAuditEvent, validateAuditEvent } from "./audit-event.js";
import type { AuditEvent } from "./audit-event.js";

export const AUDIT_TOPIC_MEMO = "AgentHire Procurement Audit Trail";

export function parseAuditTopicId(value: string) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error("Configure a numeric HEDERA_HCS_TOPIC_ID");
  const id = TopicId.fromString(value);
  if (id.toString() !== value || id.num.isZero()) throw new Error("Configure a numeric HEDERA_HCS_TOPIC_ID");
  return id;
}

export function parseHcsFee(value: string): Hbar {
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,8})?$/.test(value)) throw new Error("Use an explicit positive HBAR fee with up to eight decimal places");
  const [whole, fraction = ""] = value.split(".");
  const tinybars = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  if (tinybars <= 0n || tinybars > (1n << 63n) - 1n) throw new Error("Maximum HBAR fee is out of range");
  return Hbar.fromTinybars(tinybars.toString());
}

type HcsWriteOptions = { network: "testnet"; maxFee: Hbar };

async function submit(client: Client, transaction: Transaction, options: HcsWriteOptions) {
  if (options.network !== "testnet" || BigInt(options.maxFee.toTinybars().toString()) <= 0n) {
    throw new Error("HCS writes require testnet and a positive maximum fee");
  }
  try {
    transaction.setMaxTransactionFee(options.maxFee)
      .setMaxAttempts(1)
      .setRegenerateTransactionId(false)
      .freezeWith(client);
  } catch {
    throw new Error("Could not prepare the HCS transaction");
  }
  const transactionId = transaction.transactionId?.toString();
  if (!transactionId) throw new Error("Could not assign an HCS transaction ID");
  const hashScanUrl = `https://hashscan.io/${options.network}/transaction/${transactionId.replace(/@(\d+)\.(\d+)$/, "-$1-$2")}`;
  let receipt;
  try {
    const response = await transaction.execute(client, 15_000);
    receipt = await response.getReceiptQuery(client).setValidateStatus(false).execute(client, 20_000);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status instanceof Status) {
      throw new Error(`Transaction ${transactionId} returned ${error.status.toString()}. ${hashScanUrl}`);
    }
    throw new Error(`Could not confirm transaction ${transactionId}. Check ${hashScanUrl} before retrying.`);
  }
  const receiptStatus = receipt.status.toString();
  if (receiptStatus !== "SUCCESS") {
    throw new Error(`Transaction ${transactionId} returned ${receiptStatus}. ${hashScanUrl}`);
  }
  return { receipt, transactionId, receiptStatus, hashScanUrl };
}

export async function createAuditTopic(client: Client, options: HcsWriteOptions & { existingTopicId?: string }) {
  if (options.existingTopicId?.trim()) throw new Error("An audit topic is already configured");
  if (!client.operatorPublicKey) throw new Error("Configure an operator to set the topic submit key");
  const transaction = new TopicCreateTransaction()
    .setTopicMemo(AUDIT_TOPIC_MEMO)
    .setSubmitKey(client.operatorPublicKey);
  const { receipt, ...result } = await submit(client, transaction, options);
  if (!receipt.topicId) throw new Error(`Topic ID missing from receipt. Check ${result.hashScanUrl} before retrying.`);
  return { ...result, topicId: receipt.topicId.toString() };
}

export async function submitAuditEvent(client: Client, topic: string, event: AuditEvent, options: HcsWriteOptions) {
  const topicId = parseAuditTopicId(topic);
  const message = serializeAuditEvent(event);
  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .setMaxChunks(1);
  const { receipt, ...result } = await submit(client, transaction, options);
  const sequenceNumber = receipt.topicSequenceNumber?.toString();
  return { ...result, topicId: topicId.toString(), sequenceNumber: sequenceNumber === "0" ? undefined : sequenceNumber };
}

type Coordinates = { topicId: string; sequenceNumber: string; consensusTimestamp: string };
type IndexedAuditEvent =
  | ({ status: "verified"; event: AuditEvent } & Coordinates)
  | ({ status: "invalid" } & Partial<Coordinates>);

export type AuditVerification = IndexedAuditEvent
  | { status: "pending" | "error"; topicId: string; sequenceNumber: string };

export function validSequence(value: string) {
  return /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= (1n << 64n) - 1n;
}

function decodeMessage(row: unknown, topicId: string, expectedSequence?: string): IndexedAuditEvent {
  if (!row || typeof row !== "object") return { status: "invalid" };
  const { topic_id, sequence_number, consensus_timestamp, message } = row as Record<string, unknown>;
  const sequenceNumber = typeof sequence_number === "number" && Number.isSafeInteger(sequence_number)
    ? String(sequence_number) : sequence_number;
  if (
    topic_id !== topicId || typeof sequenceNumber !== "string" || !validSequence(sequenceNumber) ||
    (expectedSequence !== undefined && sequenceNumber !== expectedSequence) ||
    typeof consensus_timestamp !== "string" || !/^\d+\.\d{9}$/.test(consensus_timestamp)
  ) return { status: "invalid" };
  const coordinates = { topicId, sequenceNumber, consensusTimestamp: consensus_timestamp };
  try {
    if (typeof message !== "string" || message.length > Math.ceil(MAX_AUDIT_BYTES / 3) * 4) {
      throw new Error();
    }
    const bytes = Buffer.from(message, "base64");
    if (bytes.length > MAX_AUDIT_BYTES || bytes.toString("base64") !== message) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const event = validateAuditEvent(JSON.parse(text));
    if (serializeAuditEvent(event) !== text) throw new Error();
    return { status: "verified", ...coordinates, event };
  } catch {
    return { status: "invalid", ...coordinates };
  }
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text(), (key, value, context?: { source: string }) =>
    key === "sequence_number" && typeof value === "number" && context && /^\d+$/.test(context.source)
      ? context.source : value,
  );
}

export async function getAuditEvents(mirror: URL, topic: string, cursor?: string) {
  const topicId = parseAuditTopicId(topic).toString();
  const path = `/api/v1/topics/${topicId}/messages`;
  const endpoint = new URL(path, mirror);
  function pageUrl(next: string) {
    const url = new URL(next, endpoint);
    if (url.origin !== endpoint.origin || url.pathname !== path || url.username || url.password || url.hash) {
      throw new Error("Invalid Mirror Node audit pagination link");
    }
    return url;
  }

  let next: URL | undefined = pageUrl(cursor ?? "?limit=25&order=asc");
  const events: IndexedAuditEvent[] = [];
  const visited = new Set<string>();
  for (let page = 0; page < 10 && next; page++) {
    if (visited.has(next.href)) throw new Error("Repeated Mirror Node audit pagination link");
    visited.add(next.href);
    const response = await fetch(next, { signal: AbortSignal.timeout(5_000), redirect: "error" });
    if (!response.ok) throw new Error("Could not retrieve Mirror Node audit messages");
    const data = await readJson(response) as { messages?: unknown; links?: { next?: unknown } };
    if (!Array.isArray(data?.messages)) throw new Error("Invalid Mirror Node audit page");
    events.push(...data.messages.map((message) => decodeMessage(message, topicId)));
    const link = data.links?.next;
    if (link != null && typeof link !== "string") throw new Error("Invalid Mirror Node audit pagination link");
    next = link ? pageUrl(link) : undefined;
  }
  return { events, next: next?.href };
}

export async function verifyAuditEvent(
  mirror: URL,
  topic: string,
  sequenceNumber: string,
  pause: (milliseconds: number) => Promise<void> = delay,
): Promise<AuditVerification> {
  const topicId = parseAuditTopicId(topic).toString();
  if (!validSequence(sequenceNumber)) throw new Error("Use a positive topic sequence number");
  const url = new URL(`/api/v1/topics/${topicId}/messages/${sequenceNumber}`, mirror);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "error" });
      if (response.status === 404) {
        if (attempt < 3) await pause(1_000);
        continue;
      }
      if (!response.ok) return { status: "error", topicId, sequenceNumber };
      let message: unknown;
      try {
        message = await readJson(response);
      } catch {
        return { status: "invalid", topicId, sequenceNumber };
      }
      return decodeMessage(message, topicId, sequenceNumber);
    }
    // Only an entirely exhausted 404 poll is an indexing delay.
    return { status: "pending", topicId, sequenceNumber };
  } catch {
    return { status: "error", topicId, sequenceNumber };
  }
}
