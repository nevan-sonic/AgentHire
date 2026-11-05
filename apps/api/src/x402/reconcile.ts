import { setTimeout as delay } from "node:timers/promises";
import { X402_FEE_PAYER, X402_MAX_FEE } from "./config.js";

type Transfer = { account: string; amount: number | string; is_approval?: boolean };
type TransactionRow = {
  result: string;
  name: string;
  transaction_id: string;
  charged_tx_fee: number | string;
  consensus_timestamp: string;
  transfers?: Transfer[];
};

function exactInteger(value: number | string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error("Invalid Mirror Node amount");
}

export async function reconcilePayment(mirror: URL, evidence: {
  transactionId: string; payer: string; merchant: string; amountTinybars: string;
}, pause: (milliseconds: number) => Promise<void> = delay) {
  const id = evidence.transactionId.replace(/@(\d+)\.(\d+)$/, "-$1-$2");
  const url = new URL(`/api/v1/transactions/${id}`, mirror);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5_000) });
      if (response.status === 404) {
        if (attempt < 3) await pause(1_000);
        continue;
      }
      if (!response.ok) return { status: "error" } as const;
      const data: { transactions?: TransactionRow[] } = JSON.parse(await response.text(),
        (key, value, context?: { source: string }) =>
          (key === "amount" || key === "charged_tx_fee") && typeof value === "number" &&
          context && /^-?\d+$/.test(context.source) ? context.source : value);
      const row = data.transactions?.find((tx) => tx.result === "SUCCESS" &&
        tx.transaction_id === id && tx.name === "CRYPTOTRANSFER");
      if (!row || !Array.isArray(row.transfers) || !id.startsWith(`${X402_FEE_PAYER}-`)) return { status: "invalid" } as const;
      const total = (account: string) => row.transfers
        ?.filter((entry) => entry.account === account && entry.is_approval !== true)
        .reduce((sum, entry) => sum + exactInteger(entry.amount), 0n);
      const fee = exactInteger(row.charged_tx_fee);
      if (total(evidence.payer) !== -BigInt(evidence.amountTinybars) ||
          total(evidence.merchant) !== BigInt(evidence.amountTinybars) ||
          fee < 0n || fee > X402_MAX_FEE || !/^\d+\.\d{9}$/.test(row.consensus_timestamp)) {
        return { status: "invalid" } as const;
      }
      return { status: "verified", feeTinybars: fee.toString(), consensusTimestamp: row.consensus_timestamp } as const;
    }
    return { status: "pending" } as const;
  } catch {
    return { status: "error" } as const;
  }
}
