import assert from "node:assert/strict";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrivateKey } from "@hiero-ledger/sdk";
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/http";
import { createPayerSigner, payWorker, SpendingPolicy } from "../src/agents/payer.js";
import { createApp } from "../src/app.js";
import { runX402Demo } from "../src/cli/x402-demo.js";
import { registerX402Worker } from "../src/routes/x402-worker.js";
import { WORKER_PATH, X402_FEE_PAYER, X402_NETWORK, X402_PRICE } from "../src/x402/config.js";
import { inspectPayment, workerQuote } from "../src/x402/protocol.js";
import { reconcilePayment } from "../src/x402/reconcile.js";
import { filePaymentClaims } from "../src/x402/replay.js";

const endpoint = `http://localhost:3001${WORKER_PATH}`;
const merchant = "0.0.111";
const payer = "0.0.222";
const values = [2, 4, 6, 8];
const key = PrivateKey.generateED25519();
const sign = createPayerSigner(payer, key);
const quote = workerQuote(endpoint, merchant);

function worker(facilitator: Pick<FacilitatorClient, "verify" | "settle">) {
  const app = createApp();
  const claims = new Set<string>();
  registerX402Worker(app, {
    endpoint, merchant, facilitator,
    claimPayment: async (id) => {
      if (claims.has(id)) return false;
      claims.add(id);
      return true;
    },
  });
  return app;
}

const noPayment = {
  verify: async () => assert.fail("Unexpected verification"),
  settle: async () => assert.fail("Unexpected settlement"),
};

test("the worker validates input and returns a standard unpaid challenge", async (t) => {
  const app = worker(noPayment);
  t.after(() => app.close());
  const unpaid = await app.inject({ method: "POST", url: WORKER_PATH, payload: { values } });
  assert.equal(unpaid.statusCode, 402);
  assert.deepEqual(decodePaymentRequiredHeader(String(unpaid.headers["payment-required"])), quote);
  assert.equal(unpaid.headers["cache-control"], "no-store");
  assert.equal(unpaid.json().mean, undefined);
  const bad = await app.inject({ method: "POST", url: WORKER_PATH, payload: { values: ["4"] } });
  assert.equal(bad.statusCode, 400);
  const malformed = await app.inject({
    method: "POST", url: WORKER_PATH, payload: { values }, headers: { "payment-signature": "bad" },
  });
  assert.equal(malformed.statusCode, 400);
});

test("uses official signing, withholds worker results until settlement, and blocks concurrent replay", async (t) => {
  let release: () => void = () => {};
  let began: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { began = resolve; });
  const settle = t.mock.fn<FacilitatorClient["settle"]>(async (payload, requirements) => {
    began();
    await gate;
    return {
      success: true, network: X402_NETWORK,
      transaction: inspectPayment(payload.payload.transaction, requirements).transactionId,
      payer,
    };
  });
  const app = worker({ verify: async () => ({ isValid: true, payer }), settle });
  t.after(() => { release(); return app.close(); });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const response = await app.inject({
      method: "POST", url: WORKER_PATH,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      payload: String(init.body),
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: Object.fromEntries(Object.entries(response.headers)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    });
  });
  let completed = false;
  let proof = "";
  const paid = payWorker(new SpendingPolicy(endpoint, merchant, 1000000n, 1000000n), values, payer, async (challenge) => {
    const payload = await sign(challenge);
    proof = encodePaymentSignatureHeader(payload);
    return payload;
  }).finally(() => { completed = true; });
  // Fail promptly if signing or parsing fails before the settlement boundary.
  await Promise.race([started, paid]);
  assert.equal(completed, false);
  const duplicate = await app.inject({
    method: "POST", url: WORKER_PATH, payload: { values: [99] }, headers: { "payment-signature": proof },
  });
  assert.equal(duplicate.statusCode, 409);
  release();
  const result = await paid;
  assert.equal(settle.mock.callCount(), 1);
  assert.deepEqual(result.worker, { count: 4, min: 2, max: 8, mean: 5 });
  assert.equal(result.amountTinybars, X402_PRICE);
  assert.ok(!JSON.stringify(result).includes(key.toStringRaw()));
  assert.ok(!JSON.stringify(result).includes(proof));
});

test("invalid verification and failed or ambiguous settlement never release the result", async (t) => {
  let verify = false;
  let ambiguous = false;
  const settle = t.mock.fn<FacilitatorClient["settle"]>(async () => {
    if (ambiguous) throw new Error(key.toStringRaw());
    return { success: false, network: X402_NETWORK, transaction: "", errorReason: key.toStringRaw() };
  });
  const app = worker({ verify: async () => ({ isValid: verify, payer }), settle });
  t.after(() => app.close());
  const send = async (proof: string) => app.inject({
    method: "POST", url: WORKER_PATH, payload: { values }, headers: { "payment-signature": proof },
  });
  const proof = encodePaymentSignatureHeader(await sign(quote));
  assert.equal((await send(proof)).statusCode, 402);
  assert.equal(settle.mock.callCount(), 0);
  verify = true;
  const rejected = await send(proof);
  assert.equal(rejected.statusCode, 502);
  assert.equal(rejected.headers["payment-response"], undefined);
  assert.ok(!rejected.body.includes(key.toStringRaw()));
  assert.equal((await send(proof)).statusCode, 409);
  ambiguous = true;
  const second = encodePaymentSignatureHeader(await sign(quote));
  assert.equal((await send(second)).statusCode, 502);
  assert.equal((await send(second)).statusCode, 409);
  assert.equal(settle.mock.callCount(), 2);
});

test("rejects unsafe quotes before any signing and reserves the total budget", async (t) => {
  let offered = quote;
  t.mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 402, headers: { "payment-required": encodePaymentRequiredHeader(offered) },
  }));
  const mustNotSign = t.mock.fn(async () => assert.fail("Unexpected signing"));
  const policy = new SpendingPolicy(endpoint, merchant, 1000000n, 1000000n);
  for (const [overrides, error] of [
    [{ payTo: "0.0.333" }, /allowlist/],
    [{ network: "hedera:mainnet" }, /Unsupported/],
    [{ asset: "0.0.444" }, /Unsupported/],
    [{ amount: "1.1" }, /Unsupported/],
    [{ amount: "1000001" }, /per-payment/],
  ] as const) {
    offered = { ...quote, accepts: [{ ...quote.accepts[0], ...overrides }] };
    await assert.rejects(payWorker(policy, values, payer, mustNotSign), error);
  }
  offered = quote;
  policy.reserve(quote);
  await assert.rejects(payWorker(policy, values, payer, mustNotSign), /remaining spending budget/);
  assert.equal(mustNotSign.mock.callCount(), 0);
});

test("replay claims are atomic and survive a new store instance", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "agenthire-x402-"));
  t.after(async () => {
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  });
  const results = await Promise.all([filePaymentClaims(directory)("id"), filePaymentClaims(directory)("id")]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await filePaymentClaims(directory)("id"), false);
});

test("dry run checks an actual challenge without a payer key or payment request", async (t) => {
  const app = worker(noPayment);
  t.after(() => app.close());
  const fetch = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, endpoint);
    assert.equal(new Headers(init.headers).has("payment-signature"), false);
    const response = await app.inject({
      method: "POST", url: WORKER_PATH, payload: String(init.body),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "payment-required": String(response.headers["payment-required"]) },
    });
  });
  const lines: string[] = [];
  assert.equal(await runX402Demo([], { X402_MERCHANT_ID: merchant }, (line) => lines.push(line)), 0);
  assert.equal(JSON.parse(lines[0]).paymentMade, false);
  assert.equal(fetch.mock.callCount(), 1);
});

test("independently reconciles exact transfer amounts and actual fee from Mirror Node", async (t) => {
  const transactionId = `${X402_FEE_PAYER}@1793920000.123456789`;
  const id = `${X402_FEE_PAYER}-1793920000-123456789`;
  let attempts = 0;
  let recipientCredit = 1000000;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.pathname, `/api/v1/transactions/${id}`);
    if (!attempts++) return new Response(null, { status: 404 });
    return Response.json({ transactions: [{
      result: "SUCCESS", name: "CRYPTOTRANSFER", transaction_id: id, charged_tx_fee: 404433,
      consensus_timestamp: "1793920001.123456789",
      transfers: [{ account: payer, amount: -1000000 }, { account: merchant, amount: recipientCredit }],
    }] });
  });
  const mirror = new URL("https://mirror.example.test");
  const evidence = { transactionId, payer, merchant, amountTinybars: "1000000" };
  assert.deepEqual(await reconcilePayment(mirror, evidence, async () => {}), {
    status: "verified", feeTinybars: "404433", consensusTimestamp: "1793920001.123456789",
  });
  recipientCredit = 999999;
  assert.equal((await reconcilePayment(mirror, evidence)).status, "invalid");
});
