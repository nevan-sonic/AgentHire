import type { PublicKey } from "@hiero-ledger/sdk";
import type { FastifyInstance } from "fastify";
import { runCapabilityAdapter, sanitizeStatisticsOutput } from "../agents/capability-tests.js";
import type { WorkerRegistry } from "../agents/workers.js";
import { bindingBytes, CAPABILITY_EXTENSION, CAPABILITY_PATH, capabilityDigest, parseCapabilityRequest } from "../x402/capability-binding.js";
import { workerQuote } from "../x402/protocol.js";
import { registerPaidResource } from "./x402-worker.js";
import type { WorkerPaymentOptions } from "./x402-worker.js";

export function registerCapabilityWorker(app: FastifyInstance, registry: WorkerRegistry, options: WorkerPaymentOptions & {
  payerKey(payer: string): Promise<PublicKey>;
}) {
  registerPaidResource(app, { ...options, path: CAPABILITY_PATH }, {
    prepare(body) {
      const request = parseCapabilityRequest(body);
      if (!request) return null;
      const worker = registry.discover(request.capability).find(({ profile }) => profile.workerId === request.workerId);
      const offer = worker?.capabilityTest;
      if (!worker || !offer || worker.profile.merchant !== options.merchant) return null;
      const quote = workerQuote(options.endpoint, options.merchant, offer.priceTinybars);
      const requirement = quote.accepts[0];
      requirement.extra = { ...requirement.extra, capabilityRequest: capabilityDigest(request) };
      return {
        quote,
        async verifyBinding(payload, payer) {
          const signature = payload.extensions?.[CAPABILITY_EXTENSION];
          const transaction = payload.payload.transaction;
          if (payload.accepted.extra?.capabilityRequest !== requirement.extra?.capabilityRequest ||
              typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature) || typeof transaction !== "string") return false;
          const key = await options.payerKey(payer);
          return key.verify(bindingBytes(request, options.endpoint, requirement, transaction), Buffer.from(signature, "hex"));
        },
        async execute() {
          const result = await runCapabilityAdapter(request.input, offer.timeoutMs, offer.run);
          return {
            taskId: request.taskId, testId: request.testId, workerId: request.workerId,
            output: sanitizeStatisticsOutput(result.output),
            failure: result.failure ?? null, durationMs: result.durationMs,
          };
        },
      };
    },
  });
}
