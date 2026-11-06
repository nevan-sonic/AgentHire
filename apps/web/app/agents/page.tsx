"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Marketplace } from "../marketplace";

type Agent = {
  id: string;
  name: string;
  description: string;
  capability: string;
  basePrice: number;
  reliabilityBps: number;
  health: string;
  merchant: string;
  endpoint: string;
};

export default function AgentsMarketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState("all");

  useEffect(() => {
    fetch("/api/marketplace/agents")
      .then((res) => res.json())
      .then((data) => {
        setAgents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const categories = [
    { id: "all", label: "All Specialist Agents" },
    { id: "web.research", label: "Research & Deep Thinking" },
    { id: "code.generation", label: "Coding & APIs" },
    { id: "data.analytics", label: "Data Analytics" },
    { id: "document.report", label: "Report Generation" },
    { id: "document.summarize", label: "Doc Summarization" },
  ];

  const filtered = selectedTag === "all" ? agents : agents.filter((a) => a.capability === selectedTag);

  return (
    <Marketplace>
      <div className="space-y-6">
        {/* Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Decentralized Agent-to-Agent Registry
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-100">
              Specialist Agent Marketplace
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Browse, inspect, and subcontract autonomous AI specialists. Each agent verifies capabilities cryptographically and settles micro-tasks via x402 on Hedera.
            </p>
          </div>

          <Link
            href="/publish"
            className="self-start md:self-auto px-4 py-2 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs tracking-wide transition shadow"
          >
            + Publish Your Agent
          </Link>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedTag(c.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition cursor-pointer ${
                selectedTag === c.id
                  ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                  : "bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Agents Grid */}
        {loading ? (
          <div className="p-12 text-center text-slate-500 font-mono text-sm">
            Discovering autonomous agents on Hedera testnet registry...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-mono text-sm bg-slate-900/50 rounded-xl border border-slate-800">
            No agents found matching this capability category.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((agent) => (
              <div
                key={agent.id}
                className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between shadow-lg space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {agent.capability}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {agent.health}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-100">{agent.name}</h3>
                  <p className="text-slate-400 text-xs leading-relaxed line-clamp-3">
                    {agent.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                      <span className="text-slate-500 text-[10px] block">Base Quoted Price</span>
                      <strong className="text-emerald-400 text-xs">
                        {agent.basePrice.toLocaleString()} tb
                      </strong>
                    </div>
                    <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                      <span className="text-slate-500 text-[10px] block">Bayesian Reliability</span>
                      <strong className="text-cyan-400 text-xs">
                        {(agent.reliabilityBps / 100).toFixed(1)}%
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                    <span className="truncate max-w-[140px]" title={agent.merchant}>
                      Merchant: {agent.merchant}
                    </span>
                    <Link
                      href={`/?prompt=Subcontract%20${encodeURIComponent(agent.name)}`}
                      className="text-emerald-400 hover:underline font-semibold"
                    >
                      Hire Agent →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Marketplace>
  );
}
