import assert from "node:assert/strict";
import { test } from "node:test";
import { Hbar, MirrorNodeAccountBalanceQuery, PrivateKey } from "@hiero-ledger/sdk";
import type { Client } from "@hiero-ledger/sdk";
import Fastify from "fastify";
import { createApp } from "../src/app.js";
import { loadHederaConfig } from "../src/config/hedera.js";
import { createHederaConnection } from "../src/hedera/client.js";
import { registerHederaStatus } from "../src/routes/hedera.js";

const key = PrivateKey.generateED25519();
const env = {
  HEDERA_DIAGNOSTICS_ENABLED: "true",
  HEDERA_OPERATOR_ID: "0.0.123456",
  HEDERA_OPERATOR_KEY: key.toStringDer(),
};

test("loads testnet defaults and parses DER and raw private keys", () => {
  const config = loadHederaConfig(env);
  assert.equal(config.network, "testnet");
  assert.equal(config.operatorAccountId.toString(), env.HEDERA_OPERATOR_ID);
  assert.equal(config.mirrorNodeUrl.origin, "https://testnet.mirrornode.hedera.com");
  const ecdsa = PrivateKey.generateECDSA();
  for (const [value, expected] of [
    [env.HEDERA_OPERATOR_KEY, key],
    [key.toStringRaw(), key],
    [`ed25519:${key.toStringRaw()}`, key],
    [ecdsa.toStringDer(), ecdsa],
    [`ecdsa:${ecdsa.toStringRaw()}`, ecdsa],
  ] as const) {
    const parsed = loadHederaConfig({ ...env, HEDERA_OPERATOR_KEY: value });
    assert.ok(parsed.operatorKey.publicKey.toString() === expected.publicKey.toString());
  }
});

test("rejects missing credentials, unsupported networks and invalid settings", () => {
  assert.throws(() => loadHederaConfig({}), /OPERATOR_ID and HEDERA_OPERATOR_KEY are required/);
  assert.throws(() => loadHederaConfig({ ...env, HEDERA_NETWORK: "mainnet" }), /must be testnet/);
  assert.throws(() => loadHederaConfig({ ...env, HEDERA_OPERATOR_ID: "invalid" }), /numeric Hedera account ID/);
  assert.throws(
    () => loadHederaConfig({ ...env, HEDERA_OPERATOR_KEY: "invalid-key-marker" }),
    { message: "HEDERA_OPERATOR_KEY is not a supported Hedera private key" },
  );
  assert.throws(
    () => loadHederaConfig({ ...env, HEDERA_MIRROR_NODE_URL: "https://user:secret@example.test" }),
    /HTTPS base URL without credentials/,
  );
});

test("queries the configured Mirror Node with a deadline and preserves tinybar precision", async (t) => {
  const config = loadHederaConfig({
    ...env,
    HEDERA_MIRROR_NODE_URL: "https://mirror.example.test:8443/api/v1",
  });
  const connection = createHederaConnection(config);
  t.after(() => connection.close());

  const execute = t.mock.method(MirrorNodeAccountBalanceQuery.prototype, "execute", function (
    this: MirrorNodeAccountBalanceQuery,
    client: Client,
    timeout: number,
  ) {
    assert.equal(this.accountId?.toString(), env.HEDERA_OPERATOR_ID);
    assert.equal(String(client.operatorAccountId), env.HEDERA_OPERATOR_ID);
    assert.equal(client.mirrorRestApiBaseUrl, "https://mirror.example.test:8443/api/v1");
    assert.equal(timeout, 5_000);
    return Promise.resolve({ hbars: Hbar.fromTinybars("9007199254740993") });
  });
  assert.equal(await connection.getBalance(), "90071992.54740993");
  assert.equal(execute.mock.callCount(), 1);
});

test("serves local diagnostics and closes the connection with Fastify", async () => {
  const app = createApp();
  let closeCalls = 0;
  let queryCalls = 0;
  registerHederaStatus(app, env, () => ({
    getBalance: async () => {
      queryCalls++;
      return "0.00000001";
    },
    close: () => { closeCalls++; },
  }));
  try {
    const response = await app.inject("/api/hedera/status");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), {
      network: "testnet",
      connected: true,
      operatorAccountId: env.HEDERA_OPERATOR_ID,
      hbarBalance: "0.00000001",
      unit: "HBAR",
    });
    assert.ok(!response.body.includes(env.HEDERA_OPERATOR_KEY));
    assert.equal((await app.inject({
      url: "/api/hedera/status",
      remoteAddress: "192.0.2.10",
    })).statusCode, 404);
    assert.equal((await app.inject({
      url: "/api/hedera/status",
      headers: { host: "example.test" },
    })).statusCode, 404);
    assert.equal(queryCalls, 1);
  } finally {
    await app.close();
  }
  assert.equal(closeCalls, 1);
});

test("keeps health available and handles missing credentials safely", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  registerHederaStatus(app, { HEDERA_DIAGNOSTICS_ENABLED: "true" });
  const health = await app.inject("/health");
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok", service: "agenthire-api" });
  const status = await app.inject("/api/hedera/status");
  assert.equal(status.statusCode, 503);
  assert.deepEqual(status.json(), {
    connected: false,
    error: "Configure a valid Hedera testnet operator and restart the API.",
  });
});

test("sanitizes query errors and timeouts", async (t) => {
  let logs = "";
  const app = Fastify({ logger: { stream: { write: (line: string) => { logs += line; } } } });
  t.after(() => app.close());
  registerHederaStatus(app, env, () => ({
    getBalance: async () => { throw new Error(`SDK deadline: ${env.HEDERA_OPERATOR_KEY}`); },
    close: () => {},
  }));
  const response = await app.inject("/api/hedera/status");
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    connected: false,
    error: "Hedera testnet balance query failed. Check connectivity and operator settings.",
  });
  assert.ok(!response.body.includes(env.HEDERA_OPERATOR_KEY));
  assert.ok(logs.includes("Hedera account balance query failed"));
  assert.ok(!logs.includes(env.HEDERA_OPERATOR_KEY));
});

test("leaves diagnostics disabled by default and in production", async () => {
  for (const settings of [{}, { ...env, NODE_ENV: "production" }]) {
    const app = createApp();
    try {
      registerHederaStatus(app, settings, () => assert.fail("Unexpected connection"));
      assert.equal((await app.inject("/api/hedera/status")).statusCode, 404);
    } finally {
      await app.close();
    }
  }
});
