import type { FastifyInstance } from "fastify";
import { loadHederaConfig } from "../config/hedera.js";
import { createHederaConnection } from "../hedera/client.js";

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const localAuthority = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function registerHederaStatus(
  app: FastifyInstance,
  env: NodeJS.ProcessEnv,
  connect = createHederaConnection,
) {
  if (env.NODE_ENV === "production" || env.HEDERA_DIAGNOSTICS_ENABLED !== "true") return;

  let status: { operatorAccountId: string; connection: ReturnType<typeof connect> } | undefined;
  try {
    const config = loadHederaConfig(env);
    const connection = connect(config);
    status = { operatorAccountId: config.operatorAccountId.toString(), connection };
    app.addHook("onClose", async () => connection.close());
  } catch {
    app.log.warn("Hedera diagnostics configuration is unavailable");
  }

  app.get("/api/hedera/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      !loopbackAddresses.has(request.raw.socket.remoteAddress ?? "") ||
      !localAuthority.test(request.host)
    ) {
      return reply.code(404).send({ error: "Not found" });
    }

    if (!status) {
      return reply.code(503).send({
        connected: false,
        error: "Configure a valid Hedera testnet operator and restart the API.",
      });
    }

    const { operatorAccountId, connection } = status;
    try {
      const hbarBalance = await connection.getBalance();
      return {
        network: "testnet",
        connected: true,
        operatorAccountId,
        hbarBalance,
        unit: "HBAR",
      };
    } catch {
      request.log.warn("Hedera account balance query failed");
      return reply.code(503).send({
        connected: false,
        error: "Hedera testnet balance query failed. Check connectivity and operator settings.",
      });
    }
  });
}
