"use client";

import { useEffect, useState, useRef } from "react";
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

type AgentLogEntry = {
  timestamp: string;
  agent: string;
  stage: "THINKING" | "DECISION" | "DISCOVERY" | "NEGOTIATION" | "PAYMENT" | "VERIFICATION" | "SYNTHESIS";
  thought: string;
  data?: Record<string, unknown>;
};

type FinalResult = {
  prompt: string;
  specialistAgent?: string;
  specialistRole?: string;
  primaryAgent: string;
  subcontractedAgent?: string;
  status: string;
  completedAt: string;
  computation?: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median?: number;
  };
  sources?: Array<{
    id: string;
    url: string;
    title: string;
    excerpt: string;
  }>;
  payment?: {
    payer: string;
    recipient: string;
    amountTinybars: string;
    transactionId?: string;
    explorerUrl?: string;
    status: string;
    scheme: string;
  };
  finalOutput: string;
};

const stageBadge: Record<AgentLogEntry["stage"], { badge: string; text: string }> = {
  THINKING: { badge: "bg-purple-400/10 text-purple-300 border-purple-400/20", text: "text-purple-300" },
  DECISION: { badge: "bg-sky-400/10 text-sky-300 border-sky-400/20", text: "text-sky-300" },
  DISCOVERY: { badge: "bg-cyan-400/10 text-cyan-300 border-cyan-400/20", text: "text-cyan-300" },
  NEGOTIATION: { badge: "bg-amber-400/10 text-amber-300 border-amber-400/20", text: "text-amber-300" },
  PAYMENT: { badge: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20", text: "text-emerald-300" },
  VERIFICATION: { badge: "bg-teal-400/10 text-teal-300 border-teal-400/20", text: "text-teal-300" },
  SYNTHESIS: { badge: "bg-indigo-400/10 text-indigo-300 border-indigo-400/20", text: "text-indigo-300" },
};

export default function AgentsMarketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState("all");

  // Interactive Invoke Panel modal state
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/marketplace/agents")
      .then((res) => res.json())
      .then((data) => {
        setAgents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const categories = [
    { id: "all", label: "All Specialists" },
    { id: "web.research", label: "Research & Deep Thinking" },
    { id: "code.generation", label: "Coding & APIs" },
    { id: "data.analytics", label: "Data Analytics" },
    { id: "document.report", label: "Report Generation" },
    { id: "document.summarize", label: "Doc Summarization" },
  ];

  const filtered = selectedTag === "all" ? agents : agents.filter((a) => a.capability === selectedTag);

  function openInvokePanel(agent: Agent) {
    setActiveAgent(agent);
    setLogs([]);
    setResult(null);
    setError(null);
    setAttachedFile(null);

    // Contextual starter prompt based on capability
    if (agent.capability === "code.generation") {
      setTaskPrompt("Create a TypeScript function to construct and sign an HCS message transaction using @hiero-ledger/sdk.");
    } else if (agent.capability === "data.analytics") {
      setTaskPrompt("Analyze dataset [12, 45, 68, 92, 104, 230, 48] ms and compute summary statistics.");
    } else if (agent.capability === "document.report") {
      setTaskPrompt("Generate an executive report analyzing decentralized agent micro-settlement advantages over traditional SaaS billing.");
    } else if (agent.capability === "document.summarize") {
      setTaskPrompt("Summarize key findings from decentralized AI compliance whitepapers into bulleted takeaways.");
    } else {
      setTaskPrompt("Investigate Hedera Consensus Service audit logging architecture and deep think on how it prevents agent collusion.");
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setAttachedFile({
        name: file.name,
        content: text || "",
      });
    };
    reader.readAsText(file);
  }

  function executeSubcontract(e: React.FormEvent) {
    e.preventDefault();
    if (!taskPrompt.trim() || running || !activeAgent) return;

    setRunning(true);
    setLogs([]);
    setResult(null);
    setError(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    let url = `${apiUrl}/api/orchestrator/stream?prompt=${encodeURIComponent(taskPrompt.trim())}&targetCapability=${encodeURIComponent(activeAgent.capability)}`;
    if (attachedFile) {
      url += `&fileName=${encodeURIComponent(attachedFile.name)}&fileContent=${encodeURIComponent(attachedFile.content.slice(0, 4000))}`;
    }
    const eventSource = new EventSource(url);

    eventSource.addEventListener("log", (e: MessageEvent) => {
      try {
        const entry: AgentLogEntry = JSON.parse(e.data);
        setLogs((prev) => [...prev, entry]);
      } catch (err) {
        console.error("Log parse error", err);
      }
    });

    eventSource.addEventListener("done", (e: MessageEvent) => {
      try {
        const finalData: FinalResult = JSON.parse(e.data);
        setResult(finalData);
        setRunning(false);
        eventSource.close();
      } catch (err) {
        console.error("Done parse error", err);
        setRunning(false);
        eventSource.close();
      }
    });

    eventSource.addEventListener("error", (e: any) => {
      if (e?.data) {
        try {
          const errObj = JSON.parse(e.data);
          setError(errObj.error || "Execution halted");
        } catch {
          setError("Task failed during execution");
        }
      }
      setRunning(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setRunning(false);
      eventSource.close();
    };
  }

  const showFileUpload = activeAgent && (
    activeAgent.capability === "data.analytics" ||
    activeAgent.capability === "document.summarize" ||
    /excel|sheet|spreadsheet|csv|tabular|pdf|word|docx|document|summar/i.test(taskPrompt)
  );

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
              Browse and subcontract autonomous AI specialists. Click <strong>"Invoke Agent"</strong> on any card to open the interactive input panel and delegate tasks directly.
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
                  <button
                    type="button"
                    onClick={() => openInvokePanel(agent)}
                    className="pill-action text-xs cursor-pointer py-1.5 px-3.5"
                  >
                    <span>Invoke Agent</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Slide-Over / Modal: Direct Agent Input Panel */}
        {activeAgent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="sharp-card w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#10141b] border border-white/20 shadow-2xl p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-sky-400 uppercase tracking-wider font-semibold">
                      {activeAgent.capability}
                    </span>
                    <span className="text-slate-500 font-mono text-xs">·</span>
                    <span className="text-xs font-mono text-slate-300">
                      Fee: {(activeAgent.basePrice / 100_000_000).toFixed(4)} HBAR
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Invoke: {activeAgent.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveAgent(null)}
                  className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white flex items-center justify-center text-sm cursor-pointer transition"
                >
                  ✕
                </button>
              </div>

              {/* Task Form */}
              <form onSubmit={executeSubcontract} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Task Instructions for {activeAgent.name}
                  </label>
                  <textarea
                    rows={4}
                    value={taskPrompt}
                    onChange={(e) => setTaskPrompt(e.target.value)}
                    placeholder="Enter your task requirements for this agent..."
                    className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.1] text-white placeholder-slate-500 focus:outline-none focus:border-white/30 text-xs sm:text-sm leading-relaxed resize-none"
                    required
                  />
                </div>

                {/* Optional file upload for Data Analyst / Document Summarizer */}
                {showFileUpload && (
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs">
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept=".csv,.xlsx,.xls,.tsv,.pdf,.docx,.doc,.txt,.json,.md"
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="pill-ghost text-xs cursor-pointer py-1 px-3"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span>Attach File (Spreadsheet / Document)</span>
                      </button>

                      {attachedFile && (
                        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-white font-mono text-[11px]">
                          <span className="truncate max-w-[180px]">{attachedFile.name}</span>
                          <button
                            type="button"
                            onClick={() => setAttachedFile(null)}
                            className="hover:text-white cursor-pointer"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] font-mono text-slate-400">
                    Settlement: x402 Micropayment on Hedera
                  </span>
                  <button
                    type="submit"
                    disabled={running || !taskPrompt.trim()}
                    className="pill-action text-xs cursor-pointer"
                  >
                    {running ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-slate-950" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        <span>Executing Task...</span>
                      </>
                    ) : (
                      <>
                        <span>Submit to {activeAgent.name}</span>
                        <span>→</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {error && (
                <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono">
                  <strong>Error:</strong> {error}
                </div>
              )}

              {/* Real-time Activity Logs inside modal */}
              {(logs.length > 0 || running) && (
                <div className="sharp-card overflow-hidden bg-black/40">
                  <div className="px-4 py-2.5 bg-[#131822] border-b border-white/[0.06] flex items-center justify-between text-xs font-mono">
                    <span className="text-white font-semibold flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${running ? "bg-sky-400 animate-ping" : "bg-emerald-400"}`} />
                      Live Agent Activity
                    </span>
                    <span className="text-slate-400">{logs.length} events</span>
                  </div>
                  <div
                    ref={logContainerRef}
                    className="p-4 max-h-[220px] overflow-y-auto space-y-2 font-mono text-xs scroll-smooth"
                  >
                    {logs.map((log, idx) => {
                      const badge = stageBadge[log.stage] || stageBadge.THINKING;
                      return (
                        <div key={idx} className="p-2.5 rounded bg-white/[0.02] border border-white/[0.05]">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className={`px-2 py-0.2 rounded text-[10px] font-bold ${badge.badge} border`}>
                              {log.stage}
                            </span>
                            <time className="text-slate-500 text-[10px]">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </time>
                          </div>
                          <p className="text-slate-300 text-xs font-sans whitespace-pre-wrap">{log.thought}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Task Deliverable Result */}
              {result && (
                <div className="sharp-card p-4 space-y-3 bg-[#131822]">
                  <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                    <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      ✓ Deliverable Verified
                    </h3>
                    {result.payment?.explorerUrl && (
                      <a
                        href={result.payment.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:underline font-mono text-[11px]"
                      >
                        HashScan Receipt ↗
                      </a>
                    )}
                  </div>
                  <div className="prose prose-invert max-w-none text-slate-200 text-xs leading-relaxed whitespace-pre-wrap font-sans max-h-[260px] overflow-y-auto">
                    {result.finalOutput}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Marketplace>
  );
}
