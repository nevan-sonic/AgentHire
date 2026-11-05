import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PrivateKey, Status, TopicCreateTransaction, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { runHcsDemo } from "../src/cli/hcs-demo.js";
import { loadHederaConfig } from "../src/config/hedera.js";
import {
  canonicalAuditPayload, createAuditEvent, serializeAuditEvent, validateAuditEvent,
} from "../src/hedera/audit-event.js";
import type { AuditPayload } from "../src/hedera/audit-event.js";
import { createHederaClient } from "../src/hedera/client.js";
import {
  createAuditTopic, getAuditEvents, parseHcsFee, submitAuditEvent, verifyAuditEvent,
} from "../src/hedera/consensus.js";

const topic = "0.0.222";
const mirror = new URL("https://mirror.example.test");
const env = {
  HEDERA_OPERATOR_ID: "0.0.111",
  HEDERA_OPERATOR_KEY: PrivateKey.generateED25519().toStringDer(),
};
const payload: AuditPayload = {
  version: 1, eventId: "demo-1", eventType: "JOB_CREATED", jobId: "job-1",
  agentId: "manager-1", timestamp: "2026-01-01T00:00:00.000Z", metadata: {},
};
const event = createAuditEvent(payload);
const options = { network: "testnet", maxFee: parseHcsFee("2.01234567") } as const;

function indexed(sequence = 1, message = serializeAuditEvent(event)) {
  return {
    topic_id: topic, sequence_number: sequence, consensus_timestamp: "1793920574.831650235",
    message: Buffer.from(message).toString("base64"),
  };
}

function response(status: Status, extra: object = {}) {
  const query = {
    setValidateStatus(validate: boolean) {
      assert.equal(validate, false);
      return query;
    },
    execute: async () => ({ status, ...extra }),
  };
  return { getReceiptQuery: () => query };
}

test("uses deterministic compact JSON and independently reproducible SHA-256", () => {
  const metadata = { workerId: "worker-1", amountUnit: "tinybar", amountBaseUnits: "123" } as const;
  const input = { ...payload, metadata };
  const expected = '{"agentId":"manager-1","eventId":"demo-1","eventType":"JOB_CREATED","jobId":"job-1","metadata":{"amountBaseUnits":"123","amountUnit":"tinybar","workerId":"worker-1"},"timestamp":"2026-01-01T00:00:00.000Z","version":1}';
  assert.equal(canonicalAuditPayload(input), expected);
  assert.equal(createAuditEvent(input).payloadHash, createHash("sha256").update(Buffer.from(expected)).digest("hex"));
  assert.equal(
    serializeAuditEvent(createAuditEvent(input)),
    serializeAuditEvent(createAuditEvent({ ...payload, metadata: {
      amountBaseUnits: "123", workerId: "worker-1", amountUnit: "tinybar",
    } })),
  );
});

test("rejects unsupported schemas, secret fields, imprecise money, and oversized messages", () => {
  for (const value of [
    { ...event, version: 2 },
    { ...event, eventType: "OTHER" },
    { ...event, timestamp: "2026-02-30T00:00:00.000Z" },
    { ...event, metadata: { privateKey: env.HEDERA_OPERATOR_KEY } },
    { ...event, metadata: { amountBaseUnits: 0.5, amountUnit: "tinybar" } },
    { ...event, metadata: { amountBaseUnits: "1", amountUnit: "token-base-unit" } },
  ]) assert.throws(() => validateAuditEvent(value), /Invalid audit event schema/);

  const large = "a".repeat(96);
  assert.throws(() => serializeAuditEvent(createAuditEvent({
    ...payload, eventId: large, jobId: large, agentId: large,
    metadata: {
      workerId: large, artifactHash: "f".repeat(64), outcome: "failure",
      paymentTransactionId: "1234567890123456789.1234567890123456789.1234567890123456789@1234567890123456789.123456789",
      amountBaseUnits: "9999999999999999999", amountUnit: "token-base-unit",
      tokenId: "1234567890123456789.1234567890123456789.1234567890123456789",
    },
  })), /size limit/);
});

test("creates a restricted topic with a fee cap and verifies its receipt", async (t) => {
  const client = createHederaClient(loadHederaConfig(env));
  t.after(() => client.close());
  const execute = t.mock.method(TopicCreateTransaction.prototype, "execute", async () =>
    response(Status.Success, { topicId: TopicId.fromString(topic) }));
  await assert.rejects(createAuditTopic(client, { ...options, existingTopicId: topic }), /already configured/);
  const result = await createAuditTopic(client, options);
  const tx = execute.mock.calls[0].this as TopicCreateTransaction;
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(tx.topicMemo, "AgentHire Procurement Audit Trail");
  assert.equal(tx.submitKey?.toString(), client.operatorPublicKey?.toString());
  assert.equal(tx.adminKey, null);
  assert.equal(tx.maxTransactionFee?.toTinybars().toString(), "201234567");
  assert.equal(tx.regenerateTransactionId, false);
  assert.equal(tx.maxAttempts, 1);
  assert.equal(result.topicId, topic);
  assert.equal(result.receiptStatus, "SUCCESS");
  assert.match(result.hashScanUrl, /^https:\/\/hashscan\.io\/testnet\/transaction\//);
});

test("submits one canonical message, returns the receipt sequence, and rejects failed receipts", async (t) => {
  const client = createHederaClient(loadHederaConfig(env));
  t.after(() => client.close());
  let success = true;
  const execute = t.mock.method(TopicMessageSubmitTransaction.prototype, "execute", async () =>
    success ? response(Status.Success, { topicSequenceNumber: 17n }) : response(Status.InvalidSignature));
  await assert.rejects(submitAuditEvent(client, topic, { ...event, jobId: "other" }, options), /hash mismatch/);
  assert.equal(execute.mock.callCount(), 0);
  const result = await submitAuditEvent(client, topic, event, options);
  const tx = execute.mock.calls[0].this as TopicMessageSubmitTransaction;
  assert.equal(tx.topicId?.toString(), topic);
  assert.equal(Buffer.from(tx.message ?? []).toString(), serializeAuditEvent(event));
  assert.equal(tx.maxChunks, 1);
  assert.equal(result.sequenceNumber, "17");
  assert.equal(result.receiptStatus, "SUCCESS");
  success = false;
  await assert.rejects(submitAuditEvent(client, topic, event, options), /INVALID_SIGNATURE.*hashscan/);
});

test("retrieves paginated Mirror Node messages and verifies their decoded payloads", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.pathname, `/api/v1/topics/${topic}/messages`);
    return url.searchParams.has("sequencenumber")
      ? Response.json({ messages: [indexed(2)], links: { next: null } })
      : Response.json({ messages: [indexed()], links: { next: `${url.pathname}?sequencenumber=gt:1` } });
  });
  const result = await getAuditEvents(mirror, topic);
  assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(result.events.map((row) => [row.status, row.sequenceNumber]), [["verified", "1"], ["verified", "2"]]);
  assert.equal(result.next, undefined);
});

test("polls for indexing and distinguishes verified, pending, invalid and error", async (t) => {
  const pause = async () => {};
  let replies: Response[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.pathname, `/api/v1/topics/${topic}/messages/1`);
    return replies.shift() ?? new Response(null, { status: 404 });
  });
  replies = [new Response(null, { status: 404 }), Response.json(indexed())];
  assert.deepEqual(await verifyAuditEvent(mirror, topic, "1", pause), {
    status: "verified", topicId: topic, sequenceNumber: "1",
    consensusTimestamp: "1793920574.831650235", event,
  });
  assert.equal((await verifyAuditEvent(mirror, topic, "1", pause)).status, "pending");
  replies = [Response.json(indexed(1, JSON.stringify({ ...event, jobId: "other" })))];
  assert.equal((await verifyAuditEvent(mirror, topic, "1", pause)).status, "invalid");
  replies = [Response.json({ ...indexed(), message: "not valid base64" })];
  assert.equal((await verifyAuditEvent(mirror, topic, "1", pause)).status, "invalid");
  replies = [new Response(null, { status: 503 })];
  assert.equal((await verifyAuditEvent(mirror, topic, "1", pause)).status, "error");
});

test("CLI previews writes without any network calls and requires an explicit fee", async (t) => {
  const create = t.mock.method(TopicCreateTransaction.prototype, "execute", () => assert.fail("Unexpected write"));
  const submit = t.mock.method(TopicMessageSubmitTransaction.prototype, "execute", () => assert.fail("Unexpected write"));
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network request"));
  const lines: string[] = [];
  const print = (line: string) => lines.push(line);
  await runHcsDemo([], env, print);
  await runHcsDemo(["create-topic", "--max-fee-hbar", "2"], env, print);
  await runHcsDemo(["submit-event"], { ...env, HEDERA_HCS_TOPIC_ID: topic }, print);
  await assert.rejects(runHcsDemo(["create-topic", "--execute"], env, print), /explicitly/);
  await assert.rejects(runHcsDemo(["verify-event", "--execute"], env, print), /Unexpected/);
  assert.ok(lines.every((line) => JSON.parse(line).mode === "dry-run"));
  assert.ok(lines.every((line) => !line.includes(env.HEDERA_OPERATOR_KEY)));
  assert.equal(create.mock.callCount() + submit.mock.callCount() + fetch.mock.callCount(), 0);
});
