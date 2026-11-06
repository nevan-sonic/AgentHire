import { fileURLToPath } from "node:url";
import { seeds } from "./protocol.js";
import { createWorker } from "./worker.js";

try { process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const seed = seeds.find(({ id }) => id === process.argv[2]);
if (!seed) throw new Error("Choose fast, reliable, or premium");
const port = Number(process.env.MARKETPLACE_WORKER_PORT ?? seed.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid worker port");
const publicUrl = process.env.MARKETPLACE_WORKER_PUBLIC_ORIGIN;
const publicOrigin = publicUrl ? new URL(publicUrl) : undefined;
if (publicOrigin && (publicOrigin.protocol !== "https:" || publicOrigin.href !== publicOrigin.origin + "/")) {
  throw new Error("Worker public origin must be an HTTPS origin without a path or credentials");
}
await createWorker(seed, process.env, publicOrigin?.origin ?? `http://127.0.0.1:${port}`).listen({ host: "127.0.0.1", port });
console.log(`${seed.name} listening at http://127.0.0.1:${port}`);
