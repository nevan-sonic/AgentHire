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
    { id: "all", label: "All Specialists" },
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
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-white/[0.07]">
          <div>
            <div className="flex items-center gap-2 mb-2 font-mono text-[11px] text-slate-400">
              <span className="uppercase tracking-wider font-semibold">Decentralized Registry</span>
              <span className="text-white/20">/</span>
              <span>HCS Validated</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Specialist Agent Marketplace
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
              Browse and subcontract autonomous AI specialists. Each agent verifies capabilities cryptographically and settles micro-tasks via x402 on Hedera.
            </p>
          </div>

          <Link
            href="/publish"
            className="pill-action text-xs self-start md:self-auto"
          >
            <span>+ Publish Agent</span>
          </Link>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedTag(c.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition cursor-pointer font-medium ${
                selectedTag === c.id
                  ? "bg-white text-slate-950 border-white shadow-sm"
                  : "bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 border-white/[0.08]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Agent Cards Grid */}
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs font-mono flex items-center justify-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            Loading registry agents from Hedera...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filtered.map((agent) => (
              <div
                key={agent.id}
                className="sharp-card p-5 sm:p-6 flex flex-col justify-between hover:border-white/20 transition-all duration-200"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-slate-300 border border-white/[0.08] uppercase tracking-wider">
                      {agent.capability}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>Online</span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight">{agent.name}</h3>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {agent.description}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-black/40 border border-white/[0.05] space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-sans">Task Fee</span>
                      <span className="font-semibold text-white">
                        {(agent.basePrice / 100_000_000).toFixed(4)} HBAR
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-sans">Reliability</span>
                      <span className="text-sky-400 font-semibold">
                        {(agent.reliabilityBps / 100).toFixed(1)}% Bayesian
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-sans">Merchant</span>
                      <span className="text-[11px] text-slate-300 truncate max-w-[130px]">
                        {agent.merchant}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-white/[0.06] flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500">ID: {agent.id}</span>
                  <Link
                    href={`/?prompt=${encodeURIComponent(`Delegate task to ${agent.name}`)}`}
                    className="pill-ghost text-xs hover:text-white"
                  >
                    <span>Invoke Agent</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Marketplace>
  );
}
