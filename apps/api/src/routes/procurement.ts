import type { FastifyInstance } from "fastify";
import type { ProcurementTask } from "@agenthire/shared";
import { procure } from "../agents/manager.js";
import { parseProcurementTask } from "../agents/task.js";
import { STATISTICS } from "../agents/workers.js";
import type { WorkerRegistry } from "../agents/workers.js";

export function registerProcurementRoutes(app: FastifyInstance, registry: WorkerRegistry, paymentEnabled = false) {
  app.get("/api/agents/workers", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== "capability") ||
        (query.capability !== undefined && query.capability !== STATISTICS)) {
      return reply.code(400).send({ error: "Supported capability filter: statistics.summary" });
    }
    return { workers: registry.discover(query.capability).map(({ profile }) => profile) };
  });

  app.post("/api/agents/procure", { bodyLimit: 4096 }, async (request, reply) => {
    let task: ProcurementTask;
    try {
      task = parseProcurementTask(request.body);
    } catch {
      return reply.code(400).send({ status: "error", error: "Invalid statistics.summary procurement task" });
    }
    return procure(task, registry, { paymentEnabled });
  });
}
