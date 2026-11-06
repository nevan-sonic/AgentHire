import type { FastifyInstance } from "fastify";
import type { PublicKey } from "@hiero-ledger/sdk";
import type { WorkerAdapter } from "../agents/workers.js";
import { sanitizeStatisticsOutput } from "../agents/capability-tests.js";
import { HIRE_EXTENSION, hireBinding, hireDigest, parseHireRequest } from "../x402/hire-binding.js";
import { workerQuote } from "../x402/protocol.js";
import { registerPaidResource } from "./x402-worker.js";
import type { WorkerPaymentOptions } from "./x402-worker.js";

export function registerHireWorker(app: FastifyInstance, worker: WorkerAdapter, options: WorkerPaymentOptions & {
  payerKey(payer: string): Promise<PublicKey>;
}) {
  const { profile } = worker;
  const execute = worker.executeTask;
  if (profile.workerId !== "balanced" || !execute || options.endpoint !== profile.endpoint ||
      options.merchant !== profile.merchant) throw new Error("Expected the trusted Balanced worker");
  registerPaidResource(app, { ...options, path: new URL(profile.endpoint).pathname }, {
    prepare(body) {
      const request = parseHireRequest(body);
      if (!request) return null;
      const quote = workerQuote(profile.endpoint, profile.merchant, profile.priceTinybars);
      const requirement = quote.accepts[0];
      requirement.extra = { ...requirement.extra, hireRequest: hireDigest(request) };
      return {
        quote,
        async verifyBinding(payload, payer) {
          const signature = payload.extensions?.[HIRE_EXTENSION];
          const tx = payload.payload.transaction;
          if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature) ||
              typeof tx !== "string" || payload.accepted.extra?.hireRequest !== requirement.extra?.hireRequest) return false;
          return (await options.payerKey(payer)).verify(hireBinding(request, profile.endpoint, requirement, tx),
            Buffer.from(signature, "hex"));
        },
        async execute() {
          const output = await execute([...request.input]).catch(() => null);
          return { taskId: request.taskId, workerId: request.workerId, output: sanitizeStatisticsOutput(output) };
        },
      };
    },
  });
}
