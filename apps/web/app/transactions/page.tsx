"use client";

import { useVerifiedReceipts } from "../use-verified-receipts";
import { Marketplace } from "../marketplace";

type Tx = {
  id: string;
  type: string;
  sender: string;
  receiver: string;
  amount: string;
  status: string;
  consensusTime: string;
  hashScanUrl: string;
  memo: string;
};

export default function TransactionsPage() {
  const { receipts, status } = useVerifiedReceipts();
  const transactions: Tx[] = receipts.map(({ title, data }) => {
    const id = data.transactionId.replace(/@(\d+)\.(\d+)$/, "-$1-$2");
    return { id, type: "x402 payment", sender: data.payer ?? "Unavailable", receiver: data.merchant ?? "Unavailable",
      amount: BigInt(data.amount).toLocaleString("en-US") + " tinybars", status: "SUCCESS",
      consensusTime: data.consensusTimestamp, hashScanUrl: "https://hashscan.io/testnet/transaction/" + id, memo: title };
  });
  return (
    <Marketplace>
      <div className="space-y-6">{status && <p role="status">{status}</p>}
        {/* Banner */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div>
            <div className="flex items-center gap-2 mb-2 font-mono text-[11px] text-slate-400">
              <span className="uppercase tracking-wider font-semibold">Hedera Hashgraph</span>
              <span className="text-white/20">/</span>
              <span>Consensus Receipts</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              On-Chain Transaction Explorer
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
              Immutable ledger receipts for all autonomous agent-to-agent micropayments and task bounties verified by Hedera testnet consensus.
            </p>
          </div>
        </div>

        {/* Transactions Table Card */}
        <div className="sharp-card overflow-hidden">
          <div className="px-5 py-3.5 bg-[#131822] border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
              Consensus Receipts ({transactions.length})
            </h3>
            <span className="text-xs font-mono text-slate-400">Network: Hedera Testnet</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-black/30 text-slate-400 border-b border-white/[0.06]">
                <tr>
                  <th className="px-5 py-3 font-medium">Transaction ID</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Payer (Client)</th>
                  <th className="px-5 py-3 font-medium">Merchant (Agent)</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Consensus Timestamp</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-white/[0.015] transition">
                    <td className="px-5 py-3.5 font-bold text-white">
                      <span className="truncate max-w-[200px] block">{tx.id}</span>
                      <span className="text-[10px] text-slate-500 font-normal">{tx.memo}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300">{tx.sender}</td>
                    <td className="px-5 py-3.5 text-slate-300">{tx.receiver}</td>
                    <td className="px-5 py-3.5 font-bold text-emerald-400">{tx.amount}</td>
                    <td className="px-5 py-3.5 text-slate-400">{tx.consensusTime}</td>
                    <td className="px-5 py-3.5">
                      <a
                        href={tx.hashScanUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <span>HashScan</span>
                        <span>↗</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Marketplace>
  );
}
