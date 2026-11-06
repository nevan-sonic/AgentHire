import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { PrivateKey, Status, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { AUDIT_MANIFEST_HASH, AUDIT_OPERATOR, AUDIT_ORDER, AUDIT_TASK, AUDIT_TOPIC, FINAL_TRANSACTION, loadCompletedAudit } from "../src/audit/completed-procurement.js";
import { publicationJournal } from "../src/audit/publication-journal.js";
import { inspectPublication, publishAudit } from "../src/audit/publisher.js";
import { checkAuditTopic, readVerifiedHistory } from "../src/audit/topic.js";
import type { VerifiedTopicEvent } from "../src/audit/topic.js";
import { runAuditPublish } from "../src/cli/audit-publish.js";
import { loadHederaConfig } from "../src/config/hedera.js";
import { createAuditEvent, serializeAuditEvent, validateAuditEvent } from "../src/hedera/audit-event.js";
import type { AuditEvent } from "../src/hedera/audit-event.js";
import { createHederaClient } from "../src/hedera/client.js";
import { parseHcsFee, submitAuditEvent } from "../src/hedera/consensus.js";
import { HIRE_MERCHANT, HIRE_PAYER, TEST_TRANSACTION } from "../src/agents/hire-checkpoint.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/completed-procurement.json", import.meta.url), "utf8"));
const mirror = new URL("https://mirror.example.test");
const key = PrivateKey.generateED25519();
const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const authorization = {
  enabled: true, taskId: AUDIT_TASK, topicId: AUDIT_TOPIC, manifestHash: AUDIT_MANIFEST_HASH,
  expiresAt: "2026-01-01T00:01:00.000Z", maxSubmissions: 8,
  perSubmissionTinybars: 10_000_000n, aggregateTinybars: 80_000_000n,
};
const demo = createAuditEvent({ version: 1, eventId: "demo-event-001", eventType: "JOB_CREATED",
  jobId: "demo-job-001", agentId: "demo-manager-001", timestamp: "2026-01-01T00:00:00.000Z", metadata: {} });
const index = (event: AuditEvent, sequence: number): VerifiedTopicEvent => ({
  status: "verified", event, topicId: AUDIT_TOPIC, sequenceNumber: String(sequence),
  consensusTimestamp: `1793925848.${String(sequence).padStart(9, "0")}`,
});
const restId = (id: string) => id.replace(/@(\d+)\.(\d+)$/, "-$1-$2");
const testId = restId(TEST_TRANSACTION);
const finalId = restId(FINAL_TRANSACTION);
const demoRow = { topic_id: AUDIT_TOPIC, sequence_number: 1, consensus_timestamp: "1793921503.196389104",
  message: Buffer.from(serializeAuditEvent(demo)).toString("base64") };

function mockMirror(t: TestContext, mode: "valid" | "invalid_payment" | "wrong_key" = "valid") {
  return t.mock.method(globalThis, "fetch", async (input: URL | string, init?: RequestInit) => {
    assert.equal(new URL(input).origin, mirror.origin);
    assert.equal(init?.method ?? "GET", "GET");
    const url = new URL(input);
    if (url.pathname === `/api/v1/topics/${AUDIT_TOPIC}`) return Response.json({
      topic_id: AUDIT_TOPIC, deleted: false, memo: "AgentHire Procurement Audit Trail", admin_key: null,
      submit_key: { key: mode === "wrong_key" ? "00" : key.publicKey.toStringRaw() },
    });
    if (url.pathname === `/api/v1/accounts/${AUDIT_OPERATOR}`) return Response.json({
      account: AUDIT_OPERATOR, deleted: false, key: { _type: "ED25519", key: key.publicKey.toStringRaw() },
      balance: { balance: 100_000_000 },
    });
    if (url.pathname === `/api/v1/topics/${AUDIT_TOPIC}/messages`) {
      return Response.json({ messages: [demoRow], links: { next: null } });
    }
    const id = url.pathname.split("/").at(-1);
    assert.ok(id === testId || id === finalId);
    const amount = id === testId ? (mode === "invalid_payment" ? 4999 : 5000) : 750000;
    return Response.json({ transactions: [{
      result: "SUCCESS", name: "CRYPTOTRANSFER", transaction_id: id, charged_tx_fee: 295981,
      consensus_timestamp: "1793925848.962423593",
      transfers: [{ account: HIRE_PAYER, amount: -amount }, { account: HIRE_MERCHANT, amount }],
    }] });
  });
}

async function workspace(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "agenthire-audit-"));
  t.after(async () => { for (const file of await readdir(directory)) await unlink(join(directory, file)); await rmdir(directory); });
  return directory;
}

test("builds the ordered eight-event manifest with stable version 1 identities, hashes and separate payment references", async (t) => {
  mockMirror(t);
  const first = await loadCompletedAudit(fixture.hire, fixture.pocp, mirror);
  const second = await loadCompletedAudit(fixture.hire, fixture.pocp, mirror);
  assert.deepEqual(first, second);
  assert.deepEqual(first.events.map(({ eventType }) => eventType), AUDIT_ORDER.map(([, type]) => type));
  assert.equal(new Set(first.events.map(({ eventId }) => eventId)).size, 8);
  assert.deepEqual(first.events.filter(({ eventType }) => eventType === "PAYMENT_SETTLED")
    .map(({ metadata }) => metadata.paymentTransactionId), [TEST_TRANSACTION, FINAL_TRANSACTION]);
  for (const event of first.events) assert.deepEqual(validateAuditEvent(JSON.parse(serializeAuditEvent(event))), event);
});

test("rejects altered checkpoint, final budget, output, event manifest and invalid settlement", async (t) => {
  const fetch = mockMirror(t, "invalid_payment");
  for (const modify of [
    (detail: typeof fixture.hire[0]["detail"]) => { detail.checkpoint.task.input[0] = 99; },
    (detail: typeof fixture.hire[0]["detail"]) => { detail.budget.availableTinybars = "245001"; },
    (detail: typeof fixture.hire[0]["detail"]) => { detail.evaluation.observed.mean = 99; },
    (detail: typeof fixture.hire[0]["detail"]) => {
      const { payloadHash, ...event } = detail.pendingAuditRecords[0].event;
      assert.ok(payloadHash);
      detail.pendingAuditRecords[0].event = createAuditEvent({ ...event, timestamp: "2026-01-01T00:00:00.000Z" });
    },
  ]) {
    const altered = structuredClone(fixture.hire);
    modify(altered.at(-1).detail);
    await assert.rejects(loadCompletedAudit(altered, fixture.pocp, mirror));
  }
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(loadCompletedAudit(fixture.hire, fixture.pocp, mirror), /independently verify/);
});

test("checks topic identity, submit key, and independently decoded original sequence 1", async (t) => {
  mockMirror(t);
  assert.equal(await checkAuditTopic(mirror, AUDIT_TOPIC, AUDIT_OPERATOR, key.publicKey), "100000000");
  await assert.rejects(checkAuditTopic(mirror, "0.0.123", AUDIT_OPERATOR, key.publicKey), /Wrong audit topic/);
  await assert.rejects(checkAuditTopic(mirror, AUDIT_TOPIC, AUDIT_OPERATOR, PrivateKey.generateED25519().publicKey), /submit key/);
  assert.deepEqual(await readVerifiedHistory(mirror), [index(demo, 1)].map((row) =>
    ({ ...row, consensusTimestamp: demoRow.consensus_timestamp })));
});

test("detects already-published events and stops on hash or order conflicts", async (t) => {
  mockMirror(t);
  const { events } = await loadCompletedAudit(fixture.hire, fixture.pocp, mirror);
  const journal = publicationJournal(await workspace(t));
  const { reports } = await inspectPublication(events, [index(demo, 1), index(events[0], 2)], journal);
  assert.equal(reports[0].status, "verified");
  assert.equal(reports[1].status, "missing");
  const { payloadHash, ...event } = events[0];
  assert.ok(payloadHash);
  const conflict = createAuditEvent({ ...event, timestamp: "2026-01-01T00:00:00.000Z" });
  const conflicting = await inspectPublication(events, [index(demo, 1), index(conflict, 2)], journal);
  assert.equal(conflicting.reports[0].status, "conflict");
  const skipped = await inspectPublication(events, [index(demo, 1), index(events[1], 2)], journal);
  assert.equal(skipped.reports[1].status, "conflict");
});

test("enforces the exact manifest and aggregate fee budget before claiming or submitting", async (t) => {
  mockMirror(t);
  const { events } = await loadCompletedAudit(fixture.hire, fixture.pocp, mirror);
  const directory = await workspace(t);
  const journal = publicationJournal(directory);
  const submit = t.mock.fn(async () => assert.fail("Unexpected HCS write"));
  const verify = async () => assert.fail("Unexpected verification");
  await assert.rejects(publishAudit(events, [index(demo, 1)], {
    authorization: { ...authorization, aggregateTinybars: 79_999_999n },
    balanceTinybars: 100_000_000n, journal, submit, verify, now,
  }), /aggregate fee/);
  await assert.rejects(publishAudit([...events].reverse(), [index(demo, 1)], {
    authorization, balanceTinybars: 100_000_000n, journal, submit, verify, now,
  }), /authorization/);
  assert.equal(submit.mock.callCount(), 0);
  assert.deepEqual(await readdir(directory), []);
});

test("stops on delayed indexing and resumes from verified history without duplicating a submission", async (t) => {
  mockMirror(t);
  const { events } = await loadCompletedAudit(fixture.hire, fixture.pocp, mirror);
  const directory = await workspace(t);
  const indexed = [index(demo, 1)];
  let delayed = true;
  const submit = t.mock.fn(async (event: AuditEvent, cap: bigint, before: (id: string) => Promise<void>) => {
    assert.equal(cap, 10_000_000n);
    const sequence = indexed.length + 1;
    const transactionId = `${AUDIT_OPERATOR}@1793926000.${String(sequence).padStart(9, "0")}`;
    await before(transactionId);
    indexed.push(index(event, sequence));
    return { transactionId, topicId: AUDIT_TOPIC, sequenceNumber: String(sequence), receiptStatus: "SUCCESS" };
  });
  const verify = async (sequence: string) => delayed
    ? { status: "pending" as const, topicId: AUDIT_TOPIC, sequenceNumber: sequence } : indexed[Number(sequence) - 1];
  const options = { authorization, balanceTinybars: 100_000_000n, submit, verify, now };
  const first = await publishAudit(events, indexed.slice(), { ...options, journal: publicationJournal(directory) });
  assert.equal(first[0].status, "uncertain");
  assert.equal(submit.mock.callCount(), 1);
  await publishAudit(events, indexed.slice(0, 1), { ...options, journal: publicationJournal(directory) });
  assert.equal(submit.mock.callCount(), 1);
  delayed = false;
  const second = await publishAudit(events, indexed.slice(), { ...options, journal: publicationJournal(directory) });
  assert.ok(second.every(({ status }) => status === "verified"));
  assert.equal(submit.mock.callCount(), 8);
  assert.equal(new Set(indexed.map(({ event }) => event.eventId)).size, 9);
  await publishAudit(events, indexed.slice(), { ...options, journal: publicationJournal(directory) });
  assert.equal(submit.mock.callCount(), 8);
});

test("an interrupted or uncertain native submission is never retried automatically", async (t) => {
  mockMirror(t);
  const { events } = await loadCompletedAudit(fixture.hire, fixture.pocp, mirror);
  const directory = await workspace(t);
  const submit = t.mock.fn(async (_event: AuditEvent, _cap: bigint, before: (id: string) => Promise<void>) => {
    await before(`${AUDIT_OPERATOR}@1793926000.123456789`);
    throw new Error("mock timeout");
  });
  const options = { authorization, balanceTinybars: 100_000_000n, submit,
    verify: async () => assert.fail("No authoritative sequence"), now };
  const history = [index(demo, 1)];
  const first = await publishAudit(events, history, { ...options, journal: publicationJournal(directory) });
  assert.equal(first[0].status, "uncertain");
  assert.ok(first[0].transactionId);
  assert.equal((await publicationJournal(directory).read(events[0]))?.status, "uncertain");
  await publishAudit(events, history, { ...options, journal: publicationJournal(directory) });
  assert.equal(submit.mock.callCount(), 1);
});

test("native HCS submission reserves the transaction ID before execute and applies its SDK fee cap", async (t) => {
  const client = createHederaClient(loadHederaConfig({
    HEDERA_OPERATOR_ID: AUDIT_OPERATOR, HEDERA_OPERATOR_KEY: key.toStringDer(),
  }));
  t.after(() => client.close());
  let recorded: string | undefined;
  const execute = t.mock.method(TopicMessageSubmitTransaction.prototype, "execute", async function (this: TopicMessageSubmitTransaction) {
    assert.equal(recorded, this.transactionId?.toString());
    assert.equal(this.maxTransactionFee?.toTinybars().toString(), "10000000");
    assert.equal(this.maxAttempts, 1);
    const query = { setValidateStatus: () => query, execute: async () => ({ status: Status.Success, topicSequenceNumber: 2n }) };
    return { getReceiptQuery: () => query };
  });
  const result = await submitAuditEvent(client, AUDIT_TOPIC, demo, {
    network: "testnet", maxFee: parseHcsFee("0.1"), beforeSubmit: async (id) => { recorded = id; },
  });
  assert.equal(result.sequenceNumber, "2");
  assert.equal(execute.mock.callCount(), 1);
});

test("CLI preflight reads evidence without signing, publishing, or creating publication files", async (t) => {
  mockMirror(t);
  const directory = await workspace(t);
  const hash = createHash("sha256").update(AUDIT_TASK).digest("hex");
  for (const kind of ["hire", "pocp"]) {
    await writeFile(join(directory, `${kind}-${hash}.jsonl`), fixture[kind].map((row: unknown) => JSON.stringify(row)).join("\n"));
  }
  const execute = t.mock.method(TopicMessageSubmitTransaction.prototype, "execute", () => assert.fail("Unexpected HCS write"));
  const report = await runAuditPublish([], {
    HEDERA_OPERATOR_ID: AUDIT_OPERATOR, HEDERA_OPERATOR_KEY: key.toStringDer(), HEDERA_MIRROR_NODE_URL: mirror.href,
  }, directory);
  assert.equal(report.mode, "read_only");
  assert.equal(report.eventCount, 8);
  assert.equal(report.initialMissing, 8);
  assert.equal(report.indexedTopicSequenceBefore, "1");
  assert.equal(report.operatorHasSufficientBalance, true);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal((await readdir(directory)).length, 2);
  await assert.rejects(runAuditPublish(["--execute"], {}, directory), /authorization/);
});
