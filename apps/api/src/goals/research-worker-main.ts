import { fileURLToPath } from "node:url";
import { configuredResearchWorkers } from "./research-protocol.js";
import { createResearchWorker } from "./research-worker.js";

try { process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const worker = configuredResearchWorkers(process.env).find(item => item.id === process.argv[2]);
if (!worker) throw new Error("Choose quick-research or deep-research");
await createResearchWorker(worker, process.env).listen({ host: "127.0.0.1", port: worker.port });
console.log(`${worker.label} listening on loopback port ${worker.port}`);
