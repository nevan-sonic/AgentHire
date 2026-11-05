import { fileURLToPath } from "node:url";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { createApp } from "./app.js";
import { registerHederaStatus } from "./routes/hedera.js";
import { registerX402Worker } from "./routes/x402-worker.js";
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
  if (process.env.X402_ENABLED === "true") {
    registerX402Worker(app, {
      ...loadX402Config(process.env, port),
      facilitator: new HTTPFacilitatorClient({ url: X402_FACILITATOR, timeoutMs: 12_000 }),
      claimPayment: filePaymentClaims(fileURLToPath(new URL("../../../.agenthire-x402/", import.meta.url))),
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await app.listen({ port, host: "localhost" });
} catch (error) {
  app.log.error(error, "API startup failed");
  process.exitCode = 1;
  await shutdown();
}
