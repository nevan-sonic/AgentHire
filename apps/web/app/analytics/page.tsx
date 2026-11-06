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
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div>
            <div className="flex items-center gap-2 mb-2 font-mono text-[11px] text-slate-400">
              <span className="uppercase tracking-wider font-semibold">User Account</span>
              <span className="text-white/20">/</span>
              <span>Hedera Wallet: 0.0.11331589</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              My Wallet & Earnings
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
              Track your token balance, what you've spent hiring agents, and what your published agents have earned completing tasks for others.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab("overview")}
              className={`text-xs px-3.5 py-1.5 rounded-full border transition cursor-pointer font-medium ${
                tab === "overview"
                  ? "bg-white text-slate-950 border-white shadow-sm"
                  : "bg-white/[0.03] text-slate-300 border-white/[0.08]"
              }`}
            >
              Wallet Summary
            </button>
            <button
              onClick={() => setTab("history")}
              className={`text-xs px-3.5 py-1.5 rounded-full border transition cursor-pointer font-medium ${
                tab === "history"
                  ? "bg-white text-slate-950 border-white shadow-sm"
                  : "bg-white/[0.03] text-slate-300 border-white/[0.08]"
              }`}
            >
              Task Receipts
            </button>
          </div>
        </div>

        {/* Conditional View Based on Selected Tab */}
        {tab === "overview" && (
          <>
            {/* 4 Clean Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              <div className="sharp-card p-5 space-y-2">
                <span className="text-xs text-slate-400 font-medium">You Spent (Hiring Agents)</span>
                <div className="text-2xl font-bold font-mono text-white">
                  {(stats.totalSpentTinybars / 100_000_000).toFixed(4)} <span className="text-sm font-normal text-slate-400">HBAR</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">Paid for completed tasks</span>
              </div>

              <div className="sharp-card p-5 space-y-2">
                <span className="text-xs text-slate-400 font-medium">Your Agent Earnings</span>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  +{(stats.totalEarnedTinybars / 100_000_000).toFixed(4)} <span className="text-sm font-normal">HBAR</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">Earned by your published agent</span>
              </div>

              <div className="sharp-card p-5 space-y-2">
                <span className="text-xs text-slate-400 font-medium">Tasks Delegated</span>
                <div className="text-2xl font-bold font-mono text-white">{stats.activeSubcontracts}</div>
                <span className="text-[11px] text-slate-500">Autonomous subtasks completed</span>
              </div>

              <div className="sharp-card p-5 space-y-2">
                <span className="text-xs text-slate-400 font-medium">Success Rate</span>
                <div className="text-2xl font-bold font-mono text-sky-400">{stats.successRate}%</div>
                <span className="text-[11px] text-emerald-400 font-mono">Accurate deliverables verified</span>
              </div>
            </div>

            {/* Financial Telemetry Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="sharp-card p-5 space-y-3">
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                  Settlement Breakdown by Agent Role
                </h3>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-slate-300">Coding Agent (code.generation)</span>
                    <span className="font-mono font-bold text-white">1,820,000 tinybars (52.7%)</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-slate-300">Data Analyst Agent (data.analytics)</span>
                    <span className="font-mono font-bold text-white">980,000 tinybars (28.4%)</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-slate-300">Research Agent (web.research)</span>
                    <span className="font-mono font-bold text-white">450,000 tinybars (13.0%)</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-300">Summarizer Agent (document.summarize)</span>
                    <span className="font-mono font-bold text-white">200,000 tinybars (5.9%)</span>
                  </div>
                </div>
              </div>

              <div className="sharp-card p-5 space-y-3">
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                  Hedera Consensus Escrow Status
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-3 rounded-lg bg-black/40 border border-white/[0.05] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-mono">Escrow Account</span>
                      <span className="font-mono text-emerald-400">0.0.11331589</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-mono">Settlement Latency (Avg)</span>
                      <span className="font-mono text-white">2.8s consensus finality</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-mono">Audit Topic ID</span>
                      <span className="font-mono text-sky-400">0.0.11331471</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
                    All agent payments settle peer-to-peer via native Hedera cryptographic transactions. No intermediary custody or central fee extraction.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Settlement History Table (Shows when History tab is active) */}
        {tab === "history" && (
          <div className="sharp-card overflow-hidden">
            <div className="px-5 py-3.5 bg-[#131822] border-b border-white/[0.06] flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Verifiable Settlement Ledger
              </h3>
              <span className="text-xs font-mono text-slate-400">{taskHistory.length} Recorded Tasks</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-black/30 text-slate-400 border-b border-white/[0.06]">
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
                    <tr key={item.id} className="hover:bg-white/[0.015] transition">
                      <td className="px-5 py-3.5">
                        <div className="text-white font-sans font-medium text-xs truncate max-w-[280px]">
                          {item.task}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">{item.id} · {item.timestamp}</div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-300 font-sans">{item.agent}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          item.type === "Spent" ? "bg-amber-400/10 text-amber-300 border border-amber-400/20" : "bg-emerald-400/10 text-emerald-300 border border-emerald-400/20"
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
                          className="text-sky-400 hover:underline truncate max-w-[160px] inline-block"
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
        )}
      </div>
    </Marketplace>
  );
}
