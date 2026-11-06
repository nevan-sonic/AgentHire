import { fileURLToPath } from "node:url";
import { registerGoals } from "./goals/routes.js";
import { registerMarketplace } from "./marketplace/routes.js";
import { createApp } from "./app.js";
import { registerDemoEvidence } from "./routes/demo-evidence.js";
import { registerHederaStatus } from "./routes/hedera.js";

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
  registerDemoEvidence(app, process.env);
  registerMarketplace(app, process.env);
  registerGoals(app, process.env);
  const { registerAgentOrchestrator } = await import("./routes/agent-orchestrator.js");
  registerAgentOrchestrator(app, process.env);

  // Automatically start marketplace worker services (ports 3101, 3102, 3103)
  const { seeds } = await import("./marketplace/protocol.js");
  const { createWorker } = await import("./marketplace/worker.js");
  const workerApps = seeds.map(seed => createWorker(seed, process.env));
  await Promise.all(workerApps.map((workerApp, index) =>
    workerApp.listen({ host: "127.0.0.1", port: seeds[index].port }).catch(err => {
      app.log.warn({ err }, `Worker ${seeds[index].name} startup note`);
    })
  ));

  // Automatically start research worker services (ports 3111, 3112)
  const { configuredResearchWorkers } = await import("./goals/research-protocol.js");
  const { createResearchWorker } = await import("./goals/research-worker.js");
  const researchWorkerList = configuredResearchWorkers(process.env);
  const researchApps = researchWorkerList.map(worker => createResearchWorker(worker, process.env));
  await Promise.all(researchApps.map((rApp, index) =>
    rApp.listen({ host: "127.0.0.1", port: researchWorkerList[index].port }).catch(err => {
      app.log.warn({ err }, `Research worker ${researchWorkerList[index].label} startup note`);
    })
  ));

  app.addHook("onClose", async () => {
    await Promise.allSettled([...workerApps, ...researchApps].map(w => w.close()));
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await app.listen({ port, host: "localhost" });
} catch (error) {
  app.log.error(error, "API startup failed");
  process.exitCode = 1;
  await shutdown();
}
