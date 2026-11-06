import assert from "node:assert/strict";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import type { ProcurementTask } from "@agenthire/shared";
import { createApp } from "../src/app.js";
import { executePaidPocp } from "../src/agents/paid-pocp.js";
import type { CapabilityAuthorization } from "../src/agents/paid-pocp.js";
import { createDemoRegistry, DEMO_MERCHANT, STATISTICS, WorkerRegistry } from "../src/agents/workers.js";
import { runPaidPocpDemo } from "../src/cli/paid-pocp-demo.js";
import { validateAuditEvent } from "../src/hedera/audit-event.js";
import { registerCapabilityWorker } from "../src/routes/capability-worker.js";
import { registerProcurementRoutes } from "../src/routes/procurement.js";
import { CAPABILITY_PATH, capabilityDigest } from "../src/x402/capability-binding.js";
import { fileCapabilityJournal } from "../src/x402/capability-journal.js";
import type { JournalEntry } from "../src/x402/capability-journal.js";
import { X402_ASSET, X402_FEE_PAYER, X402_NETWORK } from "../src/x402/config.js";
import { inspectPayment } from "../src/x402/protocol.js";

const payer = "0.0.222";
const endpoint = `http://localhost:3001${CAPABILITY_PATH}`;
const merchant = DEMO_MERCHANT;
const key = PrivateKey.generateECDSA();
const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const mirror = new URL("https://mirror.example.test");
const task: ProcurementTask = {
  taskId: "paid-demo", taskType: STATISTICS, capability: STATISTICS, input: [2, 4, 6, 8],
  maxBudgetTinybars: "1000000", deadlineMs: 60000, minimumReliabilityBps: 3500,
  selectionStrategy: "adaptive_pocp", pocp: { failurePenaltyTinybars: "400000" },
};
const request = { taskId: task.taskId, testId: "paid-demo-economy-statistics-v1",
  workerId: "economy", capability: STATISTICS, input: [3, 6, 9] } as const;
const auth: CapabilityAuthorization = {
  payer, merchant, endpoint, taskId: request.taskId, workerId: request.workerId, testId: request.testId,
  requestDigest: capabilityDigest({ ...request, input: [...request.input] }),
  amountTinybars: "5000", asset: X402_ASSET, network: X402_NETWORK, maxTotalTinybars: "1000000",
  finalHireReserveTinybars: "750000", expiresAt: "2026-01-01T00:01:00.000Z",
};

function fixture(t: TestContext, setup: {
  bad?: boolean; settlement?: "reject" | "throw"; mirror?: "missing" | "invalid";
  alterQuote?: (quote: PaymentRequirements) => void;
  settleGate?: () => Promise<void>;
} = {}) {
  const workers = createDemoRegistry(3001, merchant, now, { economy: setup.bad ? "incorrect" : "correct" });
  const registry = new WorkerRegistry();
  let outputs = 0;
  for (const worker of workers.discover()) {
    const offer = worker.capabilityTest;
    if (!offer) assert.fail("Missing test offer");
    registry.register({ ...worker, capabilityTest: { ...offer, async run(input, signal) {
      outputs++;
      return offer.run(input, signal);
    } } });
  }
  const verify = t.mock.fn<FacilitatorClient["verify"]>(async () => ({ isValid: true, payer }));
  const settle = t.mock.fn<FacilitatorClient["settle"]>(async (payload, quote) => {
    await setup.settleGate?.();
    if (setup.settlement === "throw") throw new Error("mock timeout");
    if (setup.settlement === "reject") return {
      success: false, network: X402_NETWORK, transaction: "", errorReason: "insufficient_funds",
    };
    return { success: true, network: X402_NETWORK,
      transaction: inspectPayment(payload.payload.transaction, quote).transactionId, payer };
  });
  const app = createApp();
  t.after(() => app.close());
  const claims = new Set<string>();
  registerCapabilityWorker(app, registry, {
    endpoint, merchant, facilitator: { verify, settle }, payerKey: async () => key.publicKey,
    claimPayment: async (id) => { if (claims.has(id)) return false; claims.add(id); return true; },
  });
  let paidProof: string | null = null;
  const fetch = t.mock.method(globalThis, "fetch", async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.origin === mirror.origin) {
      if (setup.mirror === "missing" || setup.settlement === "throw") return new Response(null, { status: 404 });
      if (setup.mirror === "invalid") return Response.json({ transactions: [] });
      const transaction_id = url.pathname.split("/").at(-1);
      assert.ok(transaction_id?.startsWith(X402_FEE_PAYER + "-"));
      return Response.json({ transactions: [{
        result: "SUCCESS", name: "CRYPTOTRANSFER", transaction_id, charged_tx_fee: 295897,
        consensus_timestamp: "1793922746.955672525", transfers: [
          { account: payer, amount: -5000 }, { account: merchant, amount: 5000 },
        ],
      }] });
    }
    assert.equal(url.href, endpoint);
    const incoming = new Headers(init?.headers);
    paidProof = incoming.get("payment-signature") ?? paidProof;
    const response = await app.inject({
      method: "POST", url: CAPABILITY_PATH, payload: String(init?.body),
      headers: Object.fromEntries(incoming),
    });
    const headers = new Headers(Object.entries(response.headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const required = headers.get("payment-required");
    if (required && setup.alterQuote) {
      const quote = decodePaymentRequiredHeader(required);
      setup.alterQuote(quote.accepts[0]);
      headers.set("payment-required", encodePaymentRequiredHeader(quote));
    }
    return new Response(response.body, { status: response.statusCode, headers });
  });
  const entries: JournalEntry[] = [];
  let opened = false;
  const execute = (authorization = auth, input = task) => executePaidPocp(input, registry, {
    enabled: true, authorization, key, mirror, now,
    openAttempt: async () => {
      if (opened) throw new Error("Duplicate attempt");
      opened = true;
      return async (entry) => { entries.push(entry); };
    },
  });
  return { app, execute, entries, fetch, verify, settle, outputs: () => outputs, proof: () => paidProof };
}

test("unpaid capability request is bound to a valid 402 quote and exposes no result", async (t) => {
  const f = fixture(t);
  const post = (payload: object) => f.app.inject({ method: "POST", url: CAPABILITY_PATH, payload });
  const response = await post(request);
  assert.equal(response.statusCode, 402);
  assert.deepEqual(response.json(), { error: "Payment required" });
  const quote = decodePaymentRequiredHeader(String(response.headers["payment-required"]));
  assert.equal(quote.x402Version, 2);
  assert.equal(quote.accepts[0].amount, "5000");
  assert.equal(quote.accepts[0].extra?.capabilityRequest, auth.requestDigest);
  assert.equal(quote.accepts[0].payTo, merchant);
  assert.equal((await post({ ...request, testId: "wrong" })).statusCode, 400);
  assert.equal((await post({ ...request, workerId: "unknown", testId: "paid-demo-unknown-statistics-v1" })).statusCode, 400);
  assert.equal(f.outputs(), 0);
  assert.equal(f.verify.mock.callCount(), 0);
});

test("mock settlement unlocks only the authorized test and produces verified evidence and pending audits", async (t) => {
  let release = () => {};
  let reached = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const f = fixture(t, { settleGate: async () => { reached(); await gate; } });
  const operation = f.execute();
  try {
    await Promise.race([started, operation]);
    assert.equal(f.outputs(), 0);
    const proof = f.proof();
    assert.ok(proof);
    for (const other of [
      { ...request, workerId: "balanced", testId: "paid-demo-balanced-statistics-v1" },
      { ...request, taskId: "other", testId: "other-economy-statistics-v1" },
      { ...request, input: [3, 6, 10] },
    ]) {
      const response: { statusCode: number } = await f.app.inject({
        method: "POST", url: CAPABILITY_PATH, payload: other, headers: { "payment-signature": proof },
      });
      assert.equal(response.statusCode, 400);
    }
    const forged = decodePaymentSignatureHeader(proof);
    const other = { ...request, input: [3, 6, 10] };
    forged.accepted.extra = { ...forged.accepted.extra, capabilityRequest: capabilityDigest(other) };
    assert.equal((await f.app.inject({
      method: "POST", url: CAPABILITY_PATH, payload: other,
      headers: { "payment-signature": encodePaymentSignatureHeader(forged) },
    })).statusCode, 400);
  } finally {
    release();
  }
  const result = await operation;
  assert.deepEqual(f.entries.map(({ state }) => state),
    ["planned", "quoted", "authorized", "submitted", "settled", "verified"]);
  assert.equal(f.outputs(), 1);
  assert.equal(f.settle.mock.callCount(), 1);
  assert.equal(result.pocp?.payment?.state, "verified");
  assert.equal(result.pocp?.result?.passed, true);
  assert.equal(result.selectedWorker?.workerId, "economy");
  assert.equal(result.pocp?.paymentBudget?.testSpentTinybars, "5000");
  assert.equal(result.budgetRemainingTinybars, "395000");
  assert.equal(result.paymentPlan?.paymentAuthorized, false);
  assert.ok(result.pendingAuditRecords.some(({ event }) => event.eventType === "PAYMENT_SETTLED" &&
    event.metadata.paymentTransactionId === result.pocp?.payment?.evidence?.transactionId));
  for (const { event, status } of result.pendingAuditRecords) {
    assert.equal(status, "pending");
    assert.deepEqual(validateAuditEvent(event), event);
  }
  assert.ok(!JSON.stringify(result).includes(key.toStringRaw()));
  const replay = await f.app.inject({
    method: "POST", url: CAPABILITY_PATH, payload: request, headers: { "payment-signature": f.proof() ?? "" },
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(f.outputs(), 1);
});

test("mock-paid incorrect output reduces the posterior and changes the winner", async (t) => {
  const f = fixture(t, { bad: true });
  const result = await f.execute();
  assert.equal(result.pocp?.result?.reason, "wrong_answer");
  assert.equal(result.pocp?.baselineWorkerId, "economy");
  assert.equal(result.pocp?.posteriors.find((entry) => entry.workerId === "economy")?.mean.numerator, "2");
  assert.equal(result.selectedWorker?.workerId, "balanced");
  assert.equal(result.budgetRemainingTinybars, "245000");
});

test("mock definitive settlement rejection withholds output and leaves priors unchanged", async (t) => {
  const f = fixture(t, { settlement: "reject" });
  const result = await f.execute();
  assert.equal(result.pocp?.payment?.state, "failed");
  assert.equal(result.pocp?.paymentBudget?.testSpentTinybars, "0");
  assert.equal(result.pocp?.result, null);
  assert.ok(result.pocp?.posteriors.every((entry) => entry.source === "assumed_prior"));
  assert.equal(f.outputs(), 0);
});

test("skip, expired authorization and insufficient hire reserve make no payment requests", async (t) => {
  const f = fixture(t);
  const skipped = await f.execute(auth, { ...task, pocp: { failurePenaltyTinybars: "100000" } });
  assert.equal(skipped.pocp?.action, "SKIP");
  for (const patch of [
    { expiresAt: "2025-12-31T00:00:00.000Z" }, { finalHireReserveTinybars: "749999" },
    { maxTotalTinybars: "754999" }, { workerId: "balanced" }, { testId: "wrong" },
  ]) {
    assert.equal((await f.execute({ ...auth, ...patch })).pocp?.payment?.state, "failed");
  }
  assert.equal(f.fetch.mock.callCount(), 0);
});

for (const [name, patch] of Object.entries({
  merchant: { payTo: "0.0.333" }, asset: { asset: "0.0.333" },
  network: { network: "hedera:mainnet" }, price: { amount: "5001" },
  cheaper: { amount: "4999" }, feePayer: { extra: { feePayer: "0.0.444" } },
})) {
  test(`rejects a mismatched ${name} quote without submitting a signature`, async (t) => {
    const f = fixture(t, { alterQuote: (quote) => { Object.assign(quote, patch); } });
    assert.equal((await f.execute()).pocp?.payment?.state, "failed");
    assert.equal(f.fetch.mock.callCount(), 1);
    assert.equal(f.proof(), null);
    assert.equal(f.verify.mock.callCount(), 0);
  });
}

test("ambiguous mock settlement reserves the payment and blocks a second attempt", async (t) => {
  const f = fixture(t, { settlement: "throw" });
  const result = await f.execute();
  assert.equal(result.pocp?.payment?.state, "uncertain");
  assert.equal(result.pocp?.payment?.reservedTinybars, "5000");
  assert.equal(result.pocp?.payment?.spentTinybars, "0");
  assert.equal(result.selectedWorker, null);
  assert.equal(f.outputs(), 0);
  assert.equal((await f.execute()).pocp?.payment?.state, "uncertain");
  assert.equal(f.settle.mock.callCount(), 1);
});

test("mock facilitator success with delayed indexing stays settled and cannot be resubmitted", async (t) => {
  const f = fixture(t, { mirror: "missing" });
  const result = await f.execute();
  assert.equal(result.pocp?.payment?.state, "settled");
  assert.equal(result.pocp?.payment?.evidence?.independentStatus, "pending");
  assert.equal(result.pocp?.payment?.spentTinybars, "5000");
  assert.equal((await f.execute()).pocp?.payment?.state, "uncertain");
  assert.equal(f.settle.mock.callCount(), 1);
});

test("durable journal claims a task once across instances and payer changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pocp-journal-"));
  t.after(async () => { for (const file of await readdir(directory)) await unlink(join(directory, file)); await rmdir(directory); });
  const record = await fileCapabilityJournal(directory)(task.taskId, payer);
  await record({ state: "submitted", transactionId: "0.0.9185802@1793922740.663974206" });
  await assert.rejects(fileCapabilityJournal(directory)(task.taskId, "0.0.333"), /already exists/);
});

test("public procurement remains simulation and default CLI signs nothing without credentials", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  registerProcurementRoutes(app, createDemoRegistry());
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network operation"));
  const response = await app.inject({ method: "POST", url: "/api/agents/procure", payload: task });
  assert.equal(response.json().pocp.executionMode, "simulation");
  assert.equal((await app.inject({ method: "POST", url: "/api/agents/procure",
    payload: { ...task, executionMode: "live" } })).statusCode, 400);
  assert.equal((await runPaidPocpDemo([], {})).mode, "simulation");
  await assert.rejects(runPaidPocpDemo(["--execute"], {}), /separately authorize/);
  assert.equal(fetch.mock.callCount(), 0);
});
