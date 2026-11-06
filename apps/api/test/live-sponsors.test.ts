import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { JobStore } from "../src/marketplace/store.js";
import { registerMarketplace } from "../src/marketplace/routes.js";
import { registerAgentOrchestrator } from "../src/routes/agent-orchestrator.js";
import { worldChallenge } from "../src/routes/world-id.js";

test("the marketplace rejects the previous client-supplied verification flag", async () => {
  const app = Fastify();
  registerMarketplace(app, {}, new JobStore(":memory:"));
  try {
    const response = await app.inject({ method: "POST", url: "/api/marketplace/agents",
      payload: { worldIdVerified: true, worldIdNullifier: "made-up" } });
    assert.equal(response.statusCode, 400);
    assert.throws(() => worldChallenge({}, "listing"), /not configured/);
  } finally { await app.close(); }
});

test("publishing consumes the listing-bound challenge and nullifier together", () => {
  const store = new JobStore(":memory:");
  try {
    const expires = Math.floor(Date.now() / 1000) + 30;
    store.savePublishChallenge("nonce", "listing", expires);
    assert.throws(() => store.publishAgent("nonce", "modified", "user", "id", {}));
    store.publishAgent("nonce", "listing", "user", "id", { id: "id" });
    assert.equal(store.hasPublishChallenge("nonce", "listing"), false);
    store.savePublishChallenge("new", "listing", expires);
    assert.throws(() => store.publishAgent("new", "listing", "user", "other", {}));
    assert.deepEqual(store.listCustomAgents(), [{ id: "id" }]);
  } finally { store.close(); }
});

test("direct invocation has no legacy payment endpoint and reports provider failure", async () => {
  const app = Fastify();
  registerAgentOrchestrator(app, {});
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/orchestrator/run", payload: { prompt: "test" } })).statusCode, 404);
    const response = await app.inject({ method: "POST", url: "/api/orchestrator/stream", payload: { prompt: "Research open source repositories" } });
    assert.match(response.body, /event: error/);
    assert.doesNotMatch(response.body, /event: done|transactionId/);
  } finally { await app.close(); }
});
