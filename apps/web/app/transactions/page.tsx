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
      memo: "x402 Subcontract Settlement",
    },
    {
      id: "0.0.9185802-1793924857-289452104",
      type: "PoCP Capability Test",
      sender: "0.0.11331589",
      receiver: "0.0.11330954",
      amount: "5,000 tinybars",
      status: "SUCCESS",
      consensusTime: "1793924865.052733981",
      hashScanUrl: "https://hashscan.io/testnet/transaction/0.0.9185802-1793924857-289452104",
      memo: "Micro-Challenge Evaluation",
    },
  ]);

  return (
    <Marketplace>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              On-Chain Verification Layer · Hedera Testnet
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-100">
              Blockchain Transactions & Explorer
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Immutable ledger of all settled HTTP x402 payments, capability test challenges, and consensus receipts.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://hashscan.io/testnet/account/0.0.11330954"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono transition"
            >
              Merchant Account ↗
            </a>
            <a
              href="https://hashscan.io/testnet/topic/0.0.11331471"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-emerald-400 text-xs font-mono transition font-semibold"
            >
              HCS Topic 0.0.11331471 ↗
            </a>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/80">
            <h2 className="text-sm font-bold text-slate-200">Settled Hedera Consensus Transactions</h2>
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Mirror Node Connected
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3.5">Transaction ID</th>
                  <th className="px-5 py-3.5">Operation Type</th>
                  <th className="px-5 py-3.5">Transfer (Payer → Merchant)</th>
                  <th className="px-5 py-3.5">Amount</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">HashScan Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-5 py-3.5 text-slate-300 font-semibold truncate max-w-[200px]" title={tx.id}>
                      {tx.id}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">
                      <span className="text-slate-200">{tx.type}</span>
                      <span className="block text-[10px] text-slate-500 font-sans">{tx.memo}</span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">
                      <span className="text-slate-300">{tx.sender}</span> → <span className="text-emerald-400">{tx.receiver}</span>
                    </td>
                    <td className="px-5 py-3.5 text-emerald-400 font-bold">{tx.amount}</td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <a
                        href={tx.hashScanUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 hover:underline font-semibold"
                      >
                        <span>View on HashScan</span>
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
