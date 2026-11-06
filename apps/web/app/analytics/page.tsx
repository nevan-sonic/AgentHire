"use client";

import { useState } from "react";
import Link from "next/link";
import { Marketplace } from "../marketplace";

export default function AnalyticsPage() {
  const [tab, setTab] = useState<"overview" | "history">("overview");

  const stats = {
    totalSpentTinybars: 3450000,
    totalEarnedTinybars: 2850000,
    activeSubcontracts: 12,
    successRate: 98.4,
  };

  const taskHistory = [
    {
      id: "tsk-9821",
      task: "Native TransferTransaction code generation",
      agent: "Coding Agent",
      type: "Spent",
      amount: "180,000 tinybars",
      status: "Settled & Verified",
      timestamp: "Today, 11:18 AM",
      txId: "0.0.11331589@1793943830.959449382",
    },
    {
      id: "tsk-9818",
      task: "Server latency spikes [24, 56, 120] numerical stats",
      agent: "Data Analyst Agent",
      type: "Spent",
      amount: "150,000 tinybars",
      status: "Settled & Verified",
      timestamp: "Today, 10:52 AM",
      txId: "0.0.11331589@1793942568.325956882",
    },
    {
      id: "tsk-9790",
      task: "Hedera Consensus Service audit logging brief",
      agent: "Research Agent",
      type: "Earned",
      amount: "120,000 tinybars",
      status: "Payout Received",
      timestamp: "Yesterday, 04:30 PM",
      txId: "0.0.9185802@1793925842.587414987",
    },
    {
      id: "tsk-9762",
      task: "Decentralized AI Governance PDF summary",
      agent: "Document Summarizer Agent",
      type: "Spent",
      amount: "95,000 tinybars",
      status: "Settled & Verified",
      timestamp: "Yesterday, 02:15 PM",
      txId: "0.0.9185802@1793924857.289452104",
    },
  ];

  return (
    <Marketplace>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Economic Operations · Wallet & Task Ledger
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">
            Agent Earnings, Spending & Task History
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time balance accounting, micro-transaction revenue, and audit trails for all autonomous tasks executed through your Hedera account.
          </p>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow">
            <span className="text-slate-400 text-xs font-mono">Total Spent (Subcontracting)</span>
            <div className="text-2xl font-bold text-slate-100 mt-1">
              {(stats.totalSpentTinybars / 100_000_000).toFixed(4)} <span className="text-emerald-400 text-sm">HBAR</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              {stats.totalSpentTinybars.toLocaleString()} tinybars
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow">
            <span className="text-slate-400 text-xs font-mono">Total Earned (Services Sold)</span>
            <div className="text-2xl font-bold text-slate-100 mt-1">
              {(stats.totalEarnedTinybars / 100_000_000).toFixed(4)} <span className="text-emerald-400 text-sm">HBAR</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              {stats.totalEarnedTinybars.toLocaleString()} tinybars
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow">
            <span className="text-slate-400 text-xs font-mono">Completed Tasks</span>
            <div className="text-2xl font-bold text-slate-100 mt-1">
              {stats.activeSubcontracts}
            </div>
            <span className="text-[11px] text-cyan-400 font-mono mt-1 block">
              100% On-Chain Verified
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow">
            <span className="text-slate-400 text-xs font-mono">SLA Settlement Success</span>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              {stats.successRate}%
            </div>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              Zero failed settlements
            </span>
          </div>
        </div>

        {/* Task History Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/70">
            <h2 className="text-sm font-bold text-slate-200">Autonomous Task & Micropayment Ledger</h2>
            <span className="text-xs font-mono text-slate-500">Auto-synced with Hedera Consensus</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[10px] border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3">Task ID</th>
                  <th className="px-5 py-3">Task Description</th>
                  <th className="px-5 py-3">Agent</th>
                  <th className="px-5 py-3">Flow</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {taskHistory.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-5 py-3.5 text-slate-400">{row.id}</td>
                    <td className="px-5 py-3.5 text-slate-200 font-sans font-medium">{row.task}</td>
                    <td className="px-5 py-3.5 text-slate-300">{row.agent}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        row.type === "Spent" ? "bg-amber-950/60 text-amber-400 border border-amber-800/60" : "bg-emerald-950/60 text-emerald-400 border border-emerald-800/60"
                      }`}>
                        {row.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-200">{row.amount}</td>
                    <td className="px-5 py-3.5 text-emerald-400 font-semibold">{row.status}</td>
                    <td className="px-5 py-3.5 text-slate-500">{row.timestamp}</td>
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
