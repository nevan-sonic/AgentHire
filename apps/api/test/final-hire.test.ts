import assert from "node:assert/strict";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/http";
import { createApp } from "../src/app.js";
import { executeFinalHire, hireRequest, previewFinalHire } from "../src/agents/final-hire.js";
import type { HireAuthorization } from "../src/agents/final-hire.js";
import { HIRE_MERCHANT, HIRE_PAYER, HIRE_TASK_ID, TEST_TRANSACTION, loadHireCheckpoint } from "../src/agents/hire-checkpoint.js";
import { createDemoRegistry } from "../src/agents/workers.js";
import { validateAuditEvent } from "../src/hedera/audit-event.js";
import { registerHireWorker } from "../src/routes/hire-worker.js";
import { hireDigest, parseHireRequest } from "../src/x402/hire-binding.js";
import { X402_ASSET, X402_NETWORK } from "../src/x402/config.js";
import { inspectPayment } from "../src/x402/protocol.js";
import type { JournalEntry } from "../src/x402/capability-journal.js";
import { fileCapabilityJournal, readAttempt } from "../src/x402/capability-journal.js";

const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const mirror = new URL("https://mirror.example.test");
const key = PrivateKey.generateECDSA();
const rows = ["planned", "quoted", "authorized", "submitted", "settled", "verified"].map((state, index) => ({
  taskId: HIRE_TASK_ID, payer: HIRE_PAYER, state, ...(index >= 3 ? { transactionId: TEST_TRANSACTION } : {}),
}));

function fixture(t: TestContext, mode: "success" | "wrong" | "reject" | "uncertain" | "quote" | "prior" = "success") {
  const registry = createDemoRegistry(3001, HIRE_MERCHANT, now);
  const worker = registry.discover().find(({ profile }) => profile.workerId === "balanced");
  if (!worker?.executeTask) assert.fail("Balanced missing");
  const execute = worker.executeTask;
  const { endpoint } = worker.profile;
  let produced = 0;
  let paid = 0;
  let confirmed = false;
  const settle = t.mock.fn<FacilitatorClient["settle"]>(async (payload, quote) => {
    assert.equal(produced, 0);
    if (mode === "uncertain") throw new Error("mock timeout");
    if (mode === "reject") return { success: false, network: X402_NETWORK, transaction: "", errorReason: "insufficient_funds" };
    confirmed = true;
    return { success: true, network: X402_NETWORK, transaction: inspectPayment(payload.payload.transaction, quote).transactionId, payer: HIRE_PAYER };
  });
  const app = createApp();
  t.after(() => app.close());
  registerHireWorker(app, { ...worker, async executeTask(input) {
    assert.ok(confirmed);
    produced++;
    const output = await execute(input) as { count: number; min: number; max: number; mean: number };
    return mode === "wrong" ? { ...output, mean: 7 } : output;
  } }, {
    endpoint, merchant: HIRE_MERCHANT, payerKey: async () => key.publicKey,
    facilitator: { verify: async () => ({ isValid: true, payer: HIRE_PAYER }), settle },
    claimPayment: async () => true,
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.origin === mirror.origin) {
      const id = url.pathname.split("/").at(-1);
      const prior = id === "0.0.9185802-1793924857-289452104";
      if (!prior && mode === "uncertain") return new Response(null, { status: 404 });
      const amount = prior ? (mode === "prior" ? 4999 : 5000) : 750000;
      return Response.json({ transactions: [{ result: "SUCCESS", name: "CRYPTOTRANSFER", transaction_id: id,
        charged_tx_fee: 295981, consensus_timestamp: "1793924865.052733981",
        transfers: [{ account: HIRE_PAYER, amount: -amount }, { account: HIRE_MERCHANT, amount }],
      }] });
    }
    assert.equal(url.href, endpoint);
    const incoming = new Headers(init?.headers);
    if (incoming.has("payment-signature")) paid++;
    const response = await app.inject({ method: "POST", url: url.pathname,
      headers: Object.fromEntries(incoming), payload: String(init?.body) });
    const headers = new Headers(Object.entries(response.headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const header = headers.get("payment-required");
    if (header && mode === "quote") {
      const quote = decodePaymentRequiredHeader(header);
      quote.accepts[0].amount = "749999";
      headers.set("payment-required", encodePaymentRequiredHeader(quote));
    }
    return new Response(response.body, { status: response.statusCode, headers });
  });
  let opened = false;
  const entries: JournalEntry[] = [];
  const load = () => loadHireCheckpoint(rows, registry, mirror, now);
  const run = async (patch: Partial<HireAuthorization> = {}) => {
    const checkpoint = await load();
    const request = parseHireRequest(hireRequest(checkpoint));
    if (!request) assert.fail("Invalid hire request");
    return executeFinalHire(checkpoint, {
      enabled: true, key, mirror, now,
      authorization: { taskId: HIRE_TASK_ID, payer: HIRE_PAYER, merchant: HIRE_MERCHANT, workerId: "balanced",
        endpoint, network: X402_NETWORK, asset: X402_ASSET, requestDigest: hireDigest(request),
        amountTinybars: "750000", maxTotalTinybars: "1000000", expiresAt: "2026-01-01T00:01:00.000Z", ...patch },
      openAttempt: async () => {
        if (opened) throw new Error("Existing attempt");
        opened = true;
        return async (entry) => { entries.push(entry); };
      },
    });
  };
  return { registry, load, run, entries, settle, fetchMock, produced: () => produced, paid: () => paid };
}

test("validates the original journal and ledger evidence, and rejects altered or expired checkpoints", async (t) => {
  const f = fixture(t);
  await assert.rejects(loadHireCheckpoint(rows.slice(0, -1), f.registry, mirror, now), /journal/);
  const checkpoint = await f.load();
  await assert.rejects(previewFinalHire({ ...checkpoint }, now), /Unverified/);
  await assert.rejects(previewFinalHire(checkpoint, () => now() + 30_001), /expired/);
  checkpoint.task.input[0] = 99;
  await assert.rejects(previewFinalHire(checkpoint, now), /altered/);
  assert.equal(f.paid(), 0);
});

test("rejects a mismatched prior settlement without accessing the worker", async (t) => {
  const f = fixture(t, "prior");
  await assert.rejects(f.load(), /Prior capability payment/);
  assert.equal(f.fetchMock.mock.callCount(), 1);
  assert.equal(f.paid(), 0);
});

test("read-only preview obtains the exact bound Balanced quote and expected output", async (t) => {
  const f = fixture(t);
  const preview = await previewFinalHire(await f.load(), now);
  assert.equal(preview.quote.amount, "750000");
  assert.equal(preview.quote.payTo, HIRE_MERCHANT);
  assert.deepEqual(preview.expected, { count: 4, min: 2, max: 8, mean: 5 });
  assert.equal(preview.projectedRemainingTinybars, "245000");
  assert.equal(f.paid(), 0);
  assert.equal(f.produced(), 0);
});

test("one mocked final hire settles, executes Balanced, validates output and records pending audits", async (t) => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.status, "task_completed");
  assert.equal(result.payment.state, "verified");
  assert.equal(result.payment.independent?.status, "verified");
  assert.equal(result.evaluation?.passed, true);
  assert.match(result.evaluation?.evidenceHash ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(result.lifecycle.slice(-5), ["hire_authorized", "payment_submitted", "payment_settled", "payment_verified", "task_completed"]);
  assert.equal(result.budget.totalSettledTinybars, "755000");
  assert.equal(result.budget.availableTinybars, "245000");
  assert.equal(f.settle.mock.callCount(), 1);
  assert.equal(f.produced(), 1);
  for (const record of result.pendingAuditRecords) {
    assert.equal(record.status, "pending");
    assert.deepEqual(validateAuditEvent(record.event), record.event);
  }
  assert.ok(!JSON.stringify(f.entries).includes(key.toStringRaw()));
  await assert.rejects(f.run(), /Existing attempt/);
  assert.equal(f.paid(), 1);
});

test("wrong task output fails independently while preserving settled spending", async (t) => {
  const f = fixture(t, "wrong");
  const result = await f.run();
  assert.equal(result.status, "task_failed");
  assert.equal(result.evaluation?.reason, "wrong_answer");
  assert.equal(result.budget.settledHireTinybars, "750000");
  assert.equal(result.pendingAuditRecords.at(-1)?.event.eventType, "TASK_FAILED");
  assert.equal(f.paid(), 1);
});

test("definitive rejection releases the reservation without releasing worker output", async (t) => {
  const f = fixture(t, "reject");
  const result = await f.run();
  assert.equal(result.payment.state, "failed");
  assert.equal(result.budget.reservedTinybars, "0");
  assert.equal(result.budget.availableTinybars, "995000");
  assert.equal(f.produced(), 0);
});

test("uncertain settlement retains the reservation and blocks another attempt", async (t) => {
  const f = fixture(t, "uncertain");
  const result = await f.run();
  assert.equal(result.status, "payment_uncertain");
  assert.equal(result.budget.reservedTinybars, "750000");
  assert.equal(result.budget.settledHireTinybars, "0");
  assert.equal(f.produced(), 0);
  await assert.rejects(f.run(), /Existing attempt/);
  assert.equal(f.paid(), 1);
});

test("wrong worker, amount, input binding, budget, expiration, and quote fail before submission", async (t) => {
  const f = fixture(t, "quote");
  for (const patch of [{ workerId: "economy" }, { amountTinybars: "749999" }, { requestDigest: "bad" },
    { maxTotalTinybars: "749999" }, { expiresAt: "2025-12-31T23:59:59.000Z" }]) {
    await assert.rejects(f.run(patch), /authorization/);
  }
  assert.equal((await f.run()).payment.state, "failed");
  assert.equal(f.paid(), 0);
  assert.equal(f.settle.mock.callCount(), 0);
});

test("durable journals distinguish the settled test and final hire and lock both across restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "agenthire-hire-"));
  t.after(async () => {
    for (const file of await readdir(directory)) await unlink(join(directory, file));
    await rmdir(directory);
  });
  const testAttempt = await fileCapabilityJournal(directory)(HIRE_TASK_ID, HIRE_PAYER);
  await testAttempt({ state: "verified", transactionId: TEST_TRANSACTION });
  const hireAttempt = await fileCapabilityJournal(directory, "hire")(HIRE_TASK_ID, HIRE_PAYER);
  await hireAttempt({ state: "uncertain" });
  assert.equal((await readAttempt(directory, HIRE_TASK_ID, "pocp"))?.[0].state, "verified");
  assert.equal((await readAttempt(directory, HIRE_TASK_ID, "hire"))?.[0].state, "uncertain");
  await assert.rejects(fileCapabilityJournal(directory)(HIRE_TASK_ID, HIRE_PAYER), /already exists/);
  await assert.rejects(fileCapabilityJournal(directory, "hire")(HIRE_TASK_ID, HIRE_PAYER), /already exists/);
});
