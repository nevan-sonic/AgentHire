import type { FastifyInstance } from "fastify";
import {
  decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader,
} from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/http";
import { parsePaymentPayload } from "@x402/core/schemas";
import type { PaymentPayload } from "@x402/core/types";
import { WORKER_PATH, X402_NETWORK } from "../x402/config.js";
import {
  confirmsSettlement, inspectPayment, matchesRequirements, validPayer, workerQuote,
} from "../x402/protocol.js";
import type { ClaimPayment } from "../x402/replay.js";

function validDataset(value: unknown): value is { values: number[] } {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("values" in value)) return false;
  const values = value.values;
  return Array.isArray(values) && values.length >= 1 && values.length <= 100 &&
    values.every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 1e9);
}

export function registerX402Worker(app: FastifyInstance, options: {
  endpoint: string;
  merchant: string;
  facilitator: Pick<FacilitatorClient, "verify" | "settle">;
  claimPayment: ClaimPayment;
}) {
  const { endpoint, merchant, facilitator, claimPayment } = options;
  const quote = workerQuote(endpoint, merchant);
  const [requirements] = quote.accepts;

  app.post(WORKER_PATH, { bodyLimit: 4096 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!validDataset(request.body)) return reply.code(400).send({ error: "Provide 1–100 finite numbers with magnitude at most 1e9" });
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
      const settled = await facilitator.settle(payload, requirements);
      if (!confirmsSettlement(settled, transactionId) || (settled.payer && settled.payer !== verified.payer) ||
          (settled.amount !== undefined && settled.amount !== requirements.amount)) {
        return reply.code(502).send({ error: "Payment settlement not confirmed" });
      }

      reply.header("PAYMENT-RESPONSE", encodePaymentResponseHeader({
        success: true, transaction: transactionId, network: X402_NETWORK,
        payer: verified.payer, amount: requirements.amount,
      }));
      const { values } = request.body;
      return {
        count: values.length, min: Math.min(...values), max: Math.max(...values),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      };
    } catch {
      return reply.code(502).send({ error: "Payment could not be confirmed" });
    }
  });
}
