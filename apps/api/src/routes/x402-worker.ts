import type { FastifyInstance } from "fastify";
import {
  decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader,
} from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/http";
import { parsePaymentPayload } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { WORKER_PATH, X402_NETWORK } from "../x402/config.js";
import {
  confirmsSettlement, inspectPayment, matchesRequirements, validPayer, workerQuote,
} from "../x402/protocol.js";
import type { ClaimPayment } from "../x402/replay.js";
import { summarizeStatistics, validStatisticsInput } from "../agents/statistics.js";

function validDataset(value: unknown): value is { values: number[] } {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("values" in value)) return false;
  const values = value.values;
  return validStatisticsInput(values);
}

export type WorkerPaymentOptions = {
  endpoint: string;
  merchant: string;
  facilitator: Pick<FacilitatorClient, "verify" | "settle">;
  claimPayment: ClaimPayment;
  path?: string;
  priceTinybars?: string;
};

export function registerX402Worker(app: FastifyInstance, options: WorkerPaymentOptions) {
  registerPaidResource(app, options, {
    prepare(body) {
      if (!validDataset(body)) return null;
      return {
        quote: workerQuote(options.endpoint, options.merchant, options.priceTinybars),
        execute: async () => summarizeStatistics(body.values),
      };
    },
  });
}

type PaidResource = {
  quote: PaymentRequired;
  verifyBinding?: (payload: PaymentPayload, payer: string) => Promise<boolean>;
  verifySettlement?(transactionId: string, payer: string): Promise<boolean>;
  claimIntent?(): Promise<boolean>;
  execute(): Promise<unknown>;
};

export function registerPaidResource(app: FastifyInstance, options: WorkerPaymentOptions, resource: {
  prepare(body: unknown): PaidResource | null;
}) {
  const { endpoint, merchant, facilitator, claimPayment } = options;
  app.post(options.path ?? WORKER_PATH, { bodyLimit: 4096 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const prepared = resource.prepare(request.body);
    if (!prepared) return reply.code(400).send({ error: "Invalid worker input" });
    const { quote, verifyBinding, claimIntent, verifySettlement, execute } = prepared;
    const [requirements] = quote.accepts;
    const header = request.headers["payment-signature"];
    if (header === undefined) {
      return reply.code(402).header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(quote))
        .send({ error: "Payment required" });
    }

    let payload: PaymentPayload;
    let transactionId: string;
    let payer: string;
    try {
      if (typeof header !== "string" || header.length > 16_384) throw new Error();
      const decoded = decodePaymentSignatureHeader(header);
      const parsed = parsePaymentPayload(decoded);
      if (!parsed.success || parsed.data.x402Version !== 2) throw new Error();
      if (decoded.resource?.url !== endpoint || !matchesRequirements(decoded.accepted, requirements)) throw new Error();
      const { transaction } = decoded.payload;
      ({ transactionId, payer } = inspectPayment(transaction, requirements));
      if (verifyBinding && !await verifyBinding(decoded, payer)) throw new Error();
      payload = { x402Version: 2, resource: quote.resource, accepted: requirements, payload: { transaction } };
    } catch {
      return reply.code(400).send({ error: "Invalid x402 payment proof" });
    }

    try {
      const verified = await facilitator.verify(payload, requirements);
      if (verified.isValid !== true || !validPayer(verified.payer, merchant) || verified.payer !== payer) {
        return reply.code(402).send({ error: "Payment verification failed" });
      }
      // Claim before settlement. An ambiguous outcome also consumes this transaction ID.
      if (!await claimPayment(transactionId)) {
        return reply.code(409).send({ error: "Payment proof already consumed or awaiting reconciliation" });
      }
      if (claimIntent && !await claimIntent()) return reply.code(409).send({ error: "Payment intent already consumed" });
      const settled = await facilitator.settle(payload, requirements);
      if (verifyBinding && settled.success === false && settled.errorReason === "insufficient_funds") {
        return reply.code(402).send({ error: "Payment rejected" });
      }
      if (!confirmsSettlement(settled, transactionId) || (settled.payer && settled.payer !== verified.payer) ||
          (settled.amount !== undefined && settled.amount !== requirements.amount)) {
        return reply.code(502).send({ error: "Payment settlement not confirmed" });
      }

      if (verifySettlement && !await verifySettlement(transactionId, payer)) return reply.code(502).send({ error: "Settlement is pending independent confirmation" });
      reply.header("PAYMENT-RESPONSE", encodePaymentResponseHeader({
        success: true, transaction: transactionId, network: X402_NETWORK,
        payer: verified.payer, amount: requirements.amount,
      }));
      return await execute();
    } catch {
      return reply.code(502).send({ error: "Payment could not be confirmed" });
    }
  });
}
