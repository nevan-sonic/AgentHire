import { fileURLToPath } from "node:url";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { createApp } from "./app.js";
import { createDemoRegistry } from "./agents/workers.js";
import { registerHederaStatus } from "./routes/hedera.js";
import { registerX402Worker } from "./routes/x402-worker.js";
import { registerProcurementRoutes } from "./routes/procurement.js";
import { registerCapabilityWorker } from "./routes/capability-worker.js";
import { registerHireWorker } from "./routes/hire-worker.js";
import { CAPABILITY_PATH, lookupPayerAccount } from "./x402/capability-binding.js";
import { capabilityTestPrice } from "./x402/capability-config.js";
import { loadHederaMirrorNodeUrl } from "./config/hedera.js";
import { loadX402Config, X402_FACILITATOR } from "./x402/config.js";
import { filePaymentClaims } from "./x402/replay.js";

const app = createApp();

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "API shutdown failed");
    process.exitCode = 1;
  }
}

try {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const port = Number(process.env.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  registerHederaStatus(app, process.env);
  const x402 = process.env.X402_ENABLED === "true" ? loadX402Config(process.env, port) : undefined;
  const registry = createDemoRegistry(port, x402?.merchant, Date.now, {}, capabilityTestPrice(process.env));
  registerProcurementRoutes(app, registry, Boolean(x402));
  if (x402) {
    const facilitator = new HTTPFacilitatorClient({ url: X402_FACILITATOR, timeoutMs: 12_000 });
    const claimPayment = filePaymentClaims(fileURLToPath(new URL("../../../.agenthire-x402/", import.meta.url)));
    registerX402Worker(app, {
      ...x402, facilitator, claimPayment,
    });
    const mirror = loadHederaMirrorNodeUrl(process.env);
    const capabilityWorkers = createDemoRegistry(port, x402.merchant, Date.now, { economy: "incorrect" }, capabilityTestPrice(process.env));
    registerCapabilityWorker(app, capabilityWorkers, {
      endpoint: new URL(CAPABILITY_PATH, x402.endpoint).href, merchant: x402.merchant,
      facilitator, claimPayment, payerKey: async (payer) => (await lookupPayerAccount(mirror, payer)).publicKey,
    });
    for (const worker of registry.discover()) {
      const { profile } = worker;
      if (profile.workerId === "balanced") {
        registerHireWorker(app, worker, { endpoint: profile.endpoint, merchant: profile.merchant,
          facilitator, claimPayment, payerKey: async (payer) => (await lookupPayerAccount(mirror, payer)).publicKey });
        continue;
      }
      registerX402Worker(app, {
        endpoint: profile.endpoint, merchant: profile.merchant,
        path: new URL(profile.endpoint).pathname, priceTinybars: profile.priceTinybars,
        facilitator, claimPayment,
      });
    }
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await app.listen({ port, host: "localhost" });
} catch (error) {
  app.log.error(error, "API startup failed");
  process.exitCode = 1;
  await shutdown();
}
