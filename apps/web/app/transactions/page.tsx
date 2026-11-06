"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  const [transactions, setTransactions] = useState<Tx[]>([
    {
      id: "0.0.11331589-1793943830-959449382",
      type: "x402 Micropayment",
      sender: "0.0.11331589",
      receiver: "0.0.11330954",
      amount: "180,000 tinybars",
      status: "SUCCESS",
      consensusTime: "1793943836.219842104",
      hashScanUrl: "https://hashscan.io/testnet/transaction/0.0.11331589-1793943830-959449382",
      memo: "AgentHire x402 Micropayment - Coding Agent",
    },
    {
      id: "0.0.11331589-1793942568-325956882",
      type: "x402 Micropayment",
      sender: "0.0.11331589",
      receiver: "0.0.11330954",
      amount: "600,000 tinybars",
      status: "SUCCESS",
      consensusTime: "1793942576.663939104",
      hashScanUrl: "https://hashscan.io/testnet/transaction/0.0.11331589-1793942568-325956882",
      memo: "AgentHire x402 Micropayment - Fast Analyst",
    },
    {
      id: "0.0.9185802-1793925842-587414987",
      type: "Contract Hire Payment",
      sender: "0.0.11331589",
      receiver: "0.0.11330954",
      amount: "750,000 tinybars",
      status: "SUCCESS",
      consensusTime: "1793925848.962423593",
      hashScanUrl: "https://hashscan.io/testnet/transaction/0.0.9185802-1793925842-587414987",
      memo: "AgentHire Subcontract Settlement - Research Agent",
    },
  ]);

  return (
    <Marketplace>
      <div className="space-y-6">
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

          <a
            href="https://hashscan.io/testnet/account/0.0.11331589"
            target="_blank"
            rel="noreferrer"
            className="pill-ghost text-xs hover:text-white inline-flex items-center gap-1.5"
          >
            <span>Inspect Payer 0.0.11331589</span>
            <span>↗</span>
          </a>
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
