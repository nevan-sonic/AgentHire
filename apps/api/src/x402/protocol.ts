import { Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { inspectHederaTransaction } from "@x402/hedera";
import type { PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  QUOTE_TIMEOUT_SECONDS, X402_ASSET, X402_FEE_PAYER, X402_MAX_FEE, X402_NETWORK, X402_PRICE,
} from "./config.js";

const numericAccount = /^\d{1,19}\.\d{1,19}\.\d{1,19}$/;
const transactionIdPattern = /^(\d+\.\d+\.\d+)[@-](\d+)[.-](\d{9})$/;

export function workerQuote(endpoint: string, merchant: string, price = X402_PRICE): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: endpoint, description: "Deterministic numeric dataset summary", mimeType: "application/json" },
    accepts: [{
      scheme: "exact", network: X402_NETWORK, asset: X402_ASSET,
      amount: price, payTo: merchant, maxTimeoutSeconds: QUOTE_TIMEOUT_SECONDS,
      extra: { feePayer: X402_FEE_PAYER },
    }],
  };
}

export function matchesRequirements(value: PaymentRequirements, expected: PaymentRequirements) {
  return value.scheme === expected.scheme && value.network === expected.network &&
    value.asset === expected.asset && value.amount === expected.amount &&
    value.payTo === expected.payTo && value.maxTimeoutSeconds === expected.maxTimeoutSeconds &&
    value.extra?.feePayer === expected.extra?.feePayer;
}

export function normalizeTransactionId(value: unknown) {
  const match = typeof value === "string" ? transactionIdPattern.exec(value) : null;
  return match ? `${match[1]}@${match[2]}.${match[3]}` : undefined;
}

export function paymentExplorerUrl(transactionId: string) {
  return `https://hashscan.io/testnet/transaction/${transactionId.replace(/@(\d+)\.(\d+)$/, "-$1-$2")}`;
}

export function inspectPayment(transaction: unknown, requirements: PaymentRequirements) {
  if (typeof transaction !== "string" || transaction.length > 16_384) throw new Error("Invalid payment transaction");
  const bytes = Buffer.from(transaction, "base64");
  if (!bytes.length || bytes.toString("base64") !== transaction) throw new Error("Invalid payment encoding");
  const inspected = inspectHederaTransaction(transaction);
  const signed = Transaction.fromBytes(bytes);
  const transactionId = normalizeTransactionId(inspected.transactionId);
  const fee = signed.maxTransactionFee?.toTinybars().toString();
  if (!(signed instanceof TransferTransaction) || !transactionId || inspected.hasNonTransferOperations ||
      inspected.transactionIdAccountId !== X402_FEE_PAYER || !fee ||
      BigInt(fee) <= 0n || BigInt(fee) > X402_MAX_FEE ||
      signed.transactionValidDuration <= 0 || signed.transactionValidDuration > requirements.maxTimeoutSeconds ||
      Object.keys(inspected.tokenTransfers).length !== 0 || inspected.hbarTransfers.length !== 2) {
    throw new Error("Unexpected Hedera payment transaction");
  }
  const credit = inspected.hbarTransfers.find((transfer) => transfer.accountId === requirements.payTo);
  const debit = inspected.hbarTransfers.find((transfer) => transfer.accountId !== requirements.payTo);
  if (credit?.amount !== requirements.amount || debit?.amount !== `-${requirements.amount}` ||
      !validPayer(debit?.accountId, requirements.payTo)) {
    throw new Error("Payment does not match the quoted transfer");
  }
  return { transactionId, payer: debit.accountId };
}

export function validPayer(value: unknown, merchant: string): value is string {
  return typeof value === "string" && numericAccount.test(value) &&
    value !== merchant && value !== X402_FEE_PAYER && value !== "0.0.0";
}

export function confirmsSettlement(value: SettleResponse, transactionId: string) {
  return value.success === true && value.network === X402_NETWORK &&
    normalizeTransactionId(value.transaction) === transactionId;
}
