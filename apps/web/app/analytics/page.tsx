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
        {/* Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-mono uppercase tracking-widest text-blue-400 font-semibold">Ledger & Economics</span>
              <span className="text-white/20">/</span>
              <span className="text-[11px] text-slate-400">Micro-Settlement Audit</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Agent Earnings & Spending
            </h1>
            <p className="text-slate-400 text-xs md:text-sm mt-1 max-w-2xl">
              Real-time financial telemetry tracking task micropayments settled via x402 on the Hedera testnet.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab("overview")}
              className={`text-xs px-3.5 py-1.5 rounded-full border transition cursor-pointer font-medium ${
                tab === "overview"
                  ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30"
                  : "bg-white/[0.03] text-slate-300 border-white/[0.08]"
              }`}
            >
              Economics Overview
            </button>
            <button
              onClick={() => setTab("history")}
              className={`text-xs px-3.5 py-1.5 rounded-full border transition cursor-pointer font-medium ${
                tab === "history"
                  ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30"
                  : "bg-white/[0.03] text-slate-300 border-white/[0.08]"
              }`}
            >
              Task Settlement History
            </button>
          </div>
        </div>

        {/* 4 Stats Cards with frosted glass styling */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="glass-panel p-5 space-y-2 border border-white/[0.08]">
            <span className="text-xs text-slate-400 font-medium">Total Micro-Spending</span>
            <div className="text-2xl font-bold font-mono text-white">
              {(stats.totalSpentTinybars / 100_000_000).toFixed(4)} <span className="text-sm text-blue-400">HBAR</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">3,450,000 tinybars paid</span>
          </div>

          <div className="glass-panel p-5 space-y-2 border border-white/[0.08]">
            <span className="text-xs text-slate-400 font-medium">Total Agent Payouts Earned</span>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              +{(stats.totalEarnedTinybars / 100_000_000).toFixed(4)} <span className="text-sm">HBAR</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">2,850,000 tinybars collected</span>
          </div>

          <div className="glass-panel p-5 space-y-2 border border-white/[0.08]">
            <span className="text-xs text-slate-400 font-medium">Subcontracts Awarded</span>
            <div className="text-2xl font-bold font-mono text-white">{stats.activeSubcontracts}</div>
            <span className="text-[11px] text-slate-500">Autonomous A2A handoffs</span>
          </div>

          <div className="glass-panel p-5 space-y-2 border border-white/[0.08]">
            <span className="text-xs text-slate-400 font-medium">Settlement Success Rate</span>
            <div className="text-2xl font-bold font-mono text-blue-400">{stats.successRate}%</div>
            <span className="text-[11px] text-emerald-400 font-mono">0 SLA violations</span>
          </div>
        </div>

        {/* Table of tasks */}
        <div className="glass-panel overflow-hidden border border-white/[0.08]">
          <div className="px-5 py-4 bg-black/30 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
              Verifiable Settlement Ledger
            </h3>
            <span className="text-xs font-mono text-slate-400">{taskHistory.length} Recorded Tasks</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-black/20 text-slate-400 border-b border-white/[0.06]">
                <tr>
                  <th className="px-5 py-3 font-medium">Task & Context</th>
                  <th className="px-5 py-3 font-medium">Assigned Agent</th>
                  <th className="px-5 py-3 font-medium">Flow</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Consensus Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {taskHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition">
                    <td className="px-5 py-3.5">
                      <div className="text-white font-sans font-medium text-xs truncate max-w-[280px]">
                        {item.task}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">{item.id} · {item.timestamp}</div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300">{item.agent}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                        item.type === "Spent" ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-white">{item.amount}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-emerald-400 flex items-center gap-1.5 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {item.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <a
                        href={`https://hashscan.io/testnet/transaction/${item.txId.replace("@", "-")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline truncate max-w-[160px] inline-block"
                      >
                        {item.txId} ↗
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
