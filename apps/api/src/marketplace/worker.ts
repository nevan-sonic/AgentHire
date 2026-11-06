import { fileURLToPath } from "node:url";
import { HTTPFacilitatorClient } from "@x402/core/http";
import Fastify from "fastify";
import { validStatisticsInput } from "../agents/statistics.js";
import { loadHederaMirrorNodeUrl } from "../config/hedera.js";
import { registerPaidResource } from "../routes/x402-worker.js";
import { bindingBytes, capabilityDigest, CAPABILITY_EXTENSION, lookupPayerAccount, parseCapabilityRequest } from "../x402/capability-binding.js";
import { X402_FACILITATOR } from "../x402/config.js";
import { workerQuote } from "../x402/protocol.js";
import { filePaymentClaims } from "../x402/replay.js";
import { offer, origin, parseWorkerTask, profile, testPrice } from "./protocol.js";
import type { Seed } from "./protocol.js";

export function executeStatistics(seed: Seed, input: readonly number[]) {
  if (!validStatisticsInput(input) || input.length > seed.max) throw new Error("Unsupported dataset");
  const values = seed.id === "premium" ? [...input].sort((a, b) => a - b) : input;
  let min = Infinity, max = -Infinity, sum = 0, correction = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    const adjusted = seed.id === "fast" ? value : value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  const mean = sum / values.length;
  if (seed.id === "reliable" && (mean < min - 1e-7 || mean > max + 1e-7)) throw new Error("Inconsistent summary");
  if (seed.id === "premium") {
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { count: values.length, min, max, mean, median };
  }
  return { count: values.length, min, max, mean };
}

export function createWorker(seed: Seed, env: NodeJS.ProcessEnv, workerOrigin = origin(seed)) {
  const app = Fastify({ bodyLimit: 8192 });
  const worker = profile(seed, env.X402_MERCHANT_ID, workerOrigin);
  app.get("/agent", async () => ({ ...worker, maxInput: seed.max, designation: "first-party", testPrice }));
  app.get("/health", async () => ({ status: "ok", workerId: seed.id }));
  app.post("/bid", async (request, reply) => {
    try { return offer(seed, parseWorkerTask(request.body), worker.merchant, Date.now(), workerOrigin); }
    catch { return reply.code(400).send({ error: "Unsupported task" }); }
  });
  const facilitator = new HTTPFacilitatorClient({ url: X402_FACILITATOR, timeoutMs: 12_000 });
  const mirror = loadHederaMirrorNodeUrl(env);
  const claimsDirectory = env.MARKETPLACE_WORKER_CLAIMS_DIR?.trim();
  const claimPayment = env.RENDER === "true" && !claimsDirectory
    ? async () => { throw new Error("Hosted worker requires persistent payment claim storage"); }
    : filePaymentClaims(claimsDirectory || fileURLToPath(new URL("../../../../.agenthire-x402/", import.meta.url)));
  for (const path of ["/capability-test", "/execute"]) {
    const endpoint = workerOrigin + path;
    registerPaidResource(app, { endpoint, merchant: worker.merchant, facilitator, claimPayment, path }, {
      prepare(body) {
        const request = parseCapabilityRequest(body);
        if (!request || request.workerId !== seed.id || request.input.length > seed.max ||
            request.taskId === "paid-pocp-live-001") return null;
        const amount = path === "/capability-test" ? testPrice : String(seed.base + Math.max(0, request.input.length - 5) * 200);
        const quote = workerQuote(endpoint, worker.merchant, amount);
        const requirement = quote.accepts[0];
        requirement.extra = { ...requirement.extra, capabilityRequest: capabilityDigest(request) };
        return { quote, async verifyBinding(payload, payer) {
          const signature = payload.extensions?.[CAPABILITY_EXTENSION];
          const transaction = payload.payload.transaction;
          if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature) || typeof transaction !== "string" ||
              payload.accepted.extra?.capabilityRequest !== requirement.extra?.capabilityRequest) return false;
          const { publicKey } = await lookupPayerAccount(mirror, payer);
          return publicKey.verify(bindingBytes(request, endpoint, requirement, transaction), Buffer.from(signature, "hex"));
        }, async execute() { return executeStatistics(seed, request.input); } };
      },
    });
  }
  return app;
}
