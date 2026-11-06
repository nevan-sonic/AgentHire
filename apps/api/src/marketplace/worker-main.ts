import { fileURLToPath } from "node:url";
import { seeds } from "./protocol.js";
import { createWorker } from "./worker.js";

try { process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const seed = seeds.find(({ id }) => id === process.argv[2]);
if (!seed) throw new Error("Choose fast, reliable, or premium");
await createWorker(seed, process.env).listen({ host: "127.0.0.1", port: seed.port });
console.log(`${seed.name} listening at http://127.0.0.1:${seed.port}`);
