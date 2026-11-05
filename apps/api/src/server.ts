import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

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

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await app.listen({ port, host: "localhost" });
} catch (error) {
  app.log.error(error, "API startup failed");
  process.exitCode = 1;
  await shutdown();
}
