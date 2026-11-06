import { createHash } from "node:crypto";
import audit from "./audit-evidence.json";

export function transactionUrl(id: string) {
  if (!/^0\.0\.\d+@\d+\.\d{9}$/.test(id)) throw new Error("Invalid Hedera transaction ID");
  return "https://hashscan.io/testnet/transaction/" + id.replace("@", "-").replace(/\.(?=\d{9}$)/, "-");
}

export const demo = {
  source: "Recorded verified testnet execution",
  task: "paid-pocp-live-001",
  capability: "statistics.summary",
  status: "task_completed",
  budget: 1_000_000,
  topic: "0.0.11331471",
  token: "0.0.11331329",
  manifest: "0dd184461d7d1eacd1d4028c9a64f521d231842783b3faef8938aabfdfbbfd37",
  workers: [
    { name: "Economy", bid: 600_000, prior: 60, posterior: 40, note: "Capability test failed" },
    { name: "Balanced", bid: 750_000, prior: 95, note: "Selected · production verified" },
    { name: "Premium", bid: 950_000, prior: 99, note: "Not selected" },
  ],
  selected: "Balanced",
  test: {
    worker: "Economy", decision: "TEST", value: 23_000, input: [3, 6, 9], status: "FAIL",
    actual: { count: 3, min: 3, max: 9, mean: 7 },
    expected: { count: 3, min: 3, max: 9, mean: 6 },
    prior: "Beta(1.2, 0.8)", posterior: "Beta(1.2, 1.8)",
    evidence: "501649a83faea80bb75486ec93978d7401a11a9a96963b5188171577df9d2867",
  },
  payer: "0.0.11331589",
  merchant: "0.0.11330954",
  payments: [
    { label: "Capability test", worker: "Economy", amount: 5_000, id: "0.0.9185802@1793924857.289452104", status: "SUCCESS" },
    { label: "Final hire", worker: "Balanced", amount: 750_000, id: "0.0.9185802@1793925842.587414987", status: "SUCCESS" },
  ],
  result: {
    input: [2, 4, 6, 8], output: { count: 4, min: 2, max: 8, mean: 5 }, status: "PASS",
    evidence: "0d552ae272bda05a5dc607c27767728cab84dc2677d064014252d0bed6f9ca23",
  },
  audit,
} as const;

export function loadRecordedDemo() {
  const manifest = createHash("sha256").update(JSON.stringify(audit.map(row => [row.eventId, row.payloadHash]))).digest("hex");
  if (audit.length !== 8 || audit.some((row, index) => row.sequence !== index + 2 || row.status !== "verified") ||
      manifest !== demo.manifest || new Set(audit.map(row => row.eventId)).size !== 8) {
    throw new Error("Recorded audit evidence failed integrity validation");
  }
  for (const id of [...demo.payments.map(row => row.id), ...audit.map(row => row.transactionId)]) transactionUrl(id);
  return demo;
}
