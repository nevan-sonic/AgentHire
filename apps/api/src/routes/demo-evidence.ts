import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { AUDIT_MANIFEST_HASH, AUDIT_TASK, AUDIT_TOPIC, loadCompletedAudit } from "../audit/completed-procurement.js";
import { publicationJournal } from "../audit/publication-journal.js";
import { inspectPublication } from "../audit/publisher.js";
import { readVerifiedHistory } from "../audit/topic.js";
import { loadHederaMirrorNodeUrl } from "../config/hedera.js";
import { readAttempt } from "../x402/capability-journal.js";

export function registerDemoEvidence(app: FastifyInstance, env: NodeJS.ProcessEnv) {
  const directory = fileURLToPath(new URL("../../../../.agenthire-x402/", import.meta.url));

  app.get(`/api/demo/procurement/${AUDIT_TASK}`, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const mirror = loadHederaMirrorNodeUrl(env);
      const [hire, test, history] = await Promise.all([
        readAttempt(directory, AUDIT_TASK, "hire"),
        readAttempt(directory, AUDIT_TASK, "pocp"),
        readVerifiedHistory(mirror),
      ]);
      const completed = await loadCompletedAudit(hire, test, mirror);
      const journal = publicationJournal(directory);
      const { reports } = await inspectPublication(completed.events, history, journal);
      if (reports.some(event => event.status !== "verified" || !event.transactionId)) {
        return reply.code(503).send({ status: "unavailable" });
      }
      return {
        status: "verified",
        task: completed.taskId,
        procurementStatus: completed.procurementStatus,
        topic: AUDIT_TOPIC,
        manifest: AUDIT_MANIFEST_HASH,
        payments: Object.values(completed.payments).map(({ status, transactionId }) => ({ status, transactionId })),
        audit: reports.map(({ eventId, eventType, payloadHash, sequenceNumber, transactionId, consensusTimestamp, status }) =>
          ({ eventId, eventType, payloadHash, sequenceNumber, transactionId, consensusTimestamp, status })),
      };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
}
