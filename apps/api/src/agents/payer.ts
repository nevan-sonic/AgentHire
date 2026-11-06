import {
  decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader,
} from "@x402/core/http";
import { parsePaymentRequired } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { PrivateKey } from "@hiero-ledger/sdk";
import { x402Client } from "@x402/core/client";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { QUOTE_TIMEOUT_SECONDS, X402_ASSET, X402_FEE_PAYER, X402_NETWORK, X402_PRICE } from "../x402/config.js";
import { confirmsSettlement, inspectPayment, paymentExplorerUrl, validPayer } from "../x402/protocol.js";

export function createPayerSigner(payer: string, key: PrivateKey) {
  const signer = createClientHederaSigner(payer, key, { network: X402_NETWORK });
  const client = new x402Client()
    .register(X402_NETWORK, new ExactHederaScheme(signer))
    .setSpendControls({
      allowedAssets: [{ network: X402_NETWORK, asset: X402_ASSET, maxAmountPerPayment: X402_PRICE }],
    });
  return (quote: PaymentRequired) => client.createPaymentPayload(quote);
}

export class SpendingPolicy {
  private remaining: bigint;

  constructor(
    readonly endpoint: string,
    readonly merchant: string,
    readonly maxPerPayment: bigint,
    readonly maxTotal: bigint,
  ) {
    this.remaining = maxTotal;
  }

  inspect(quote: PaymentRequired): PaymentRequirements {
    if (quote.x402Version !== 2 || quote.resource.url !== this.endpoint || quote.accepts.length !== 1) {
      throw new Error("Unexpected worker endpoint or payment challenge");
    }
    const [requirement] = quote.accepts;
    if (requirement.payTo !== this.merchant) throw new Error("Merchant is outside the allowlist");
    if (requirement.network !== X402_NETWORK || requirement.asset !== X402_ASSET ||
        requirement.scheme !== "exact" || requirement.extra?.feePayer !== X402_FEE_PAYER ||
        requirement.maxTimeoutSeconds !== QUOTE_TIMEOUT_SECONDS ||
        !/^[1-9]\d{0,18}$/.test(requirement.amount)) {
      throw new Error("Unsupported network, asset, scheme, fee payer, or quote amount");
    }
    const amount = BigInt(requirement.amount);
    if (amount > this.maxPerPayment) throw new Error("Quote exceeds the per-payment limit");
    if (amount > this.remaining) throw new Error("Quote exceeds the remaining spending budget");
    return requirement;
  }

  reserve(quote: PaymentRequired) {
    const requirement = this.inspect(quote);
    this.remaining -= BigInt(requirement.amount);
  }
}

export async function requestWorkerQuote(policy: SpendingPolicy, values: number[]) {
  return requestResourceQuote(policy, { values });
}

export async function requestResourceQuote(policy: SpendingPolicy, input: object) {
  const response = await fetch(policy.endpoint, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  const header = response.headers.get("payment-required");
  await response.body?.cancel();
  if (response.status !== 402 || !header || header.length > 8_192) {
    throw new Error("The worker did not return an x402 challenge");
  }
  let quote: PaymentRequired;
  try {
    const decoded = decodePaymentRequiredHeader(header);
    const parsed = parsePaymentRequired(decoded);
    if (!parsed.success || parsed.data.x402Version !== 2) throw new Error();
    quote = decoded;
  } catch {
    throw new Error("The worker returned an invalid x402 challenge");
  }
  return { quote, requirement: policy.inspect(quote) };
}

export async function payWorker(
  policy: SpendingPolicy,
  values: number[],
  payer: string,
  sign: (quote: PaymentRequired) => Promise<PaymentPayload>,
) {
  const { worker, ...evidence } = await payForResource(policy, { values }, payer, sign);
  const { count, min, max, mean } = (worker ?? {}) as Record<string, unknown>;
  if (count !== values.length || ![min, max, mean].every((value) =>
    typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`Payment settled but worker result could not be confirmed. Check ${evidence.explorer} before retrying.`);
  }
  return { ...evidence, worker: { count, min, max, mean } };
}

export class PaymentAttemptError extends Error {
  constructor(readonly state: "failed" | "uncertain", readonly transactionId?: string) {
    super(transactionId ? `Payment or worker result could not be confirmed. Check ${paymentExplorerUrl(transactionId)} before retrying.`
      : "Could not prepare an authorized Hedera payment");
  }
}

export async function payForResource(
  policy: SpendingPolicy,
  input: object,
  payer: string,
  sign: (quote: PaymentRequired) => Promise<PaymentPayload>,
  hooks?: {
    authorize(quote: PaymentRequired): Promise<void>;
    submitted(transactionId: string): Promise<void>;
    settled(transactionId: string): Promise<void>;
  },
) {
  if (!validPayer(payer, policy.merchant)) throw new Error("Payer, merchant, and facilitator must be distinct");
  const { quote, requirement } = await requestResourceQuote(policy, input);
  // Reserve before signing. Keep the reservation even if the outcome is uncertain.
  policy.reserve(quote);
  await hooks?.authorize(quote);
  let signature: string;
  let transactionId: string;
  try {
    const payload = await sign(quote);
    const inspected = inspectPayment(payload.payload.transaction, requirement);
    if (inspected.payer !== payer) throw new Error();
    transactionId = inspected.transactionId;
    signature = encodePaymentSignatureHeader(payload);
  } catch {
    throw new PaymentAttemptError("failed");
  }

  const explorer = paymentExplorerUrl(transactionId);
  await hooks?.submitted(transactionId);
  try {
    const response = await fetch(policy.endpoint, {
      method: "POST", headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": signature },
      body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    const header = response.headers.get("payment-response");
    if (!response.ok || !header || header.length > 8_192) {
      await response.body?.cancel();
      if (response.status === 400 || response.status === 402) throw new PaymentAttemptError("failed", transactionId);
      throw new Error();
    }
    const settlement = decodePaymentResponseHeader(header);
    if (!confirmsSettlement(settlement, transactionId) || settlement.payer !== payer ||
        settlement.amount !== requirement.amount) throw new Error();

    await hooks?.settled(transactionId);
    const worker: unknown = await response.json().catch(() => null);
    return {
      transactionId, explorer, network: X402_NETWORK, asset: X402_ASSET,
      amountTinybars: requirement.amount, payer, merchant: policy.merchant,
      status: "facilitator-settled", worker,
    };
  } catch (error) {
    if (error instanceof PaymentAttemptError) throw error;
    throw new PaymentAttemptError("uncertain", transactionId);
  }
}
