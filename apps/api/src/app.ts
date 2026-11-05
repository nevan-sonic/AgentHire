import type { HealthEndpoint } from "@agenthire/shared";
import cors from "@fastify/cors";
import Fastify from "fastify";

export function createApp() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: "http://localhost:3000" });

  const healthPath: HealthEndpoint["path"] = "/health";
  app.get<{ Reply: HealthEndpoint["response"] }>(healthPath, async () => ({
    status: "ok",
    service: "agenthire-api",
  }));

  return app;
}
