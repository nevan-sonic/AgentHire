import type { PublicKey } from "@hiero-ledger/sdk";
import { AUDIT_TOPIC, AUDIT_OPERATOR } from "./completed-procurement.js";
import { AUDIT_TOPIC_MEMO, getAuditEvents } from "../hedera/consensus.js";
import { lookupPayerAccount } from "../x402/capability-binding.js";
import type { AuditVerification } from "../hedera/consensus.js";

export type VerifiedTopicEvent = Extract<AuditVerification, { status: "verified" }>;
const DEMO_HASH = "8b01c4b516c3f93d21f15467b3b59322d8f9970005f419845646e5e9eb1bbf57";

export async function checkAuditTopic(mirror: URL, topicId: string, operator: string, key: PublicKey) {
  if (topicId !== AUDIT_TOPIC || operator !== AUDIT_OPERATOR) throw new Error("Wrong audit topic or operator");
  const [response, account] = await Promise.all([
    fetch(new URL(`/api/v1/topics/${topicId}`, mirror), { redirect: "error", signal: AbortSignal.timeout(5_000) }),
    lookupPayerAccount(mirror, operator),
  ]);
  if (!response.ok) throw new Error("Existing HCS topic could not be read");
  const topic = await response.json();
  const publicKeys = [key.toStringRaw(), key.toStringDer()].map((value) => value.toLowerCase());
  if (topic.topic_id !== topicId || topic.deleted !== false || topic.memo !== AUDIT_TOPIC_MEMO ||
      topic.admin_key != null || !publicKeys.includes(String(topic.submit_key?.key ?? "").toLowerCase()) ||
      key.toStringRaw() !== account.publicKey.toStringRaw()) {
    throw new Error("Existing topic or submit key did not match the configured operator");
  }
  return account.balanceTinybars;
}

export async function readVerifiedHistory(mirror: URL) {
  const events: VerifiedTopicEvent[] = [];
  let cursor: string | undefined;
  for (let batch = 0; batch < 10; batch++) {
    const page = await getAuditEvents(mirror, AUDIT_TOPIC, cursor);
    for (const item of page.events) {
      if (item.status !== "verified" || BigInt(item.sequenceNumber) !== BigInt(events.length) + 1n) {
        throw new Error("Invalid or incomplete HCS topic history");
      }
      events.push(item);
    }
    cursor = page.next;
    if (!cursor) {
      const demo = events[0];
      if (!demo || demo.event.eventId !== "demo-event-001" || demo.event.payloadHash !== DEMO_HASH) {
        throw new Error("Original sequence 1 demonstration did not verify");
      }
      return events;
    }
  }
  throw new Error("Topic history exceeds the safe scan limit");
}
