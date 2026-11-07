"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { openTaskStream } from "./task-stream";
import { Marketplace } from "./marketplace";

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
    role?: string;
  };
  payments?: Array<{
    payer: string;
    recipient: string;
    amountTinybars: string;
    transactionId?: string;
    explorerUrl?: string;
    status: string;
    role?: string;
  }>;
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

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"RESEARCH" | "CODING" | "DATA_ANALYST" | "REPORT_WRITER" | "DOC_SUMMARIZER" | null>(null);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presets = [
    { key: "RESEARCH" as const, label: "Research Agent", prompt: "Investigate Hedera Consensus Service (HCS) and conduct deep thinking on how tamper-evident audit logs secure autonomous agent workflows" },
    { key: "CODING" as const, label: "Coding Agent", prompt: "Create a TypeScript function to construct, sign, and execute a native TransferTransaction with error handling using @hiero-ledger/sdk" },
    { key: "DATA_ANALYST" as const, label: "Data Analyst", prompt: "Analyze server latency spikes [24, 56, 120, 310, 45, 29, 680, 52] ms, compute statistics, and identify anomalies" },
    { key: "REPORT_WRITER" as const, label: "Report Agent", prompt: "Generate a comprehensive executive report on the economic benefits of agent micropayments over HTTP 402" },
    { key: "DOC_SUMMARIZER" as const, label: "Summarizer Agent", prompt: "Summarize a research paper on decentralized AI agent governance and extract core takeaways and action items" },
  ];

  const showFileUpload = selectedCategory === "DATA_ANALYST" ||
    selectedCategory === "DOC_SUMMARIZER" ||
    /excel|sheet|spreadsheet|csv|tabular|pdf|word|docx|document|summar/i.test(prompt);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|tsv|txt|json|md)$/i.test(file.name) || file.size > 4000) {
      setError("Attach a text, CSV, TSV, JSON, or Markdown file up to 4 KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setAttachedFile({
        name: file.name,
        content: text || "",
      });
      if (!prompt.trim()) {
        if (/\.(csv|tsv|xlsx|xls)$/i.test(file.name)) {
          setPrompt(`Analyze the attached spreadsheet ${file.name}, compute key metrics, and identify anomalies.`);
        } else {
          setPrompt(`Summarize the attached document ${file.name} and provide executive takeaways.`);
        }
      }
    };
    reader.readAsText(file);
  }

  function startStreamingTask(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setLogs([]);
    setResult(null);
    setError(null);

    const categoryMap: Record<string, string> = {
      RESEARCH: "web.research",
      CODING: "code.generation",
      DATA_ANALYST: "data.analytics",
      REPORT_WRITER: "document.report",
      DOC_SUMMARIZER: "document.summarize",
    };
    const eventSource = openTaskStream({ prompt: prompt.trim(), targetCapability: selectedCategory ? categoryMap[selectedCategory] : undefined,
      fileName: attachedFile?.name, fileContent: attachedFile?.content.slice(0, 4000) });

    eventSource.addEventListener("log", (event: Event) => {
      try {
        const entry: AgentLogEntry = JSON.parse((event as MessageEvent).data);
        setLogs((prev) => [...prev, entry]);
      } catch (err) {
        console.error("Log parse error", err);
      }
    });

    eventSource.addEventListener("done", (event: Event) => {
      try {
        const finalData: FinalResult = JSON.parse((event as MessageEvent).data);
        setResult(finalData);
        setLoading(false);
        eventSource.close();
      } catch (err) {
        console.error("Done parse error", err);
        setLoading(false);
        eventSource.close();
      }
    });

    eventSource.addEventListener("error", (event: Event) => {
      if ((event as MessageEvent).data) {
        try {
          const errObj = JSON.parse((event as MessageEvent).data);
          setError(errObj.error || "Execution halted");
        } catch {
          setError("Task failed during execution");
        }
      }
      setLoading(false);
      eventSource.close();
    });

  }

  return (
    <Marketplace>
      <div className="space-y-6">
        {/* Title Header with Clean Alignment */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold">Autonomous A2A Protocol</span>
              <span className="text-white/20">/</span>
              <span className="text-[11px] text-slate-500 font-mono">Hedera Settlement Layer</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Agent Orchestration & Execution Mesh
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Run a specialist directly, or open a procurement workspace to compare real bids and review an authorized Hedera x402 payment.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-slate-400 self-start sm:self-auto">
            <span className="px-2.5 py-1 rounded bg-white/[0.04] border border-white/[0.08]">
              Hierarchy: 1 Orchestrator + 5 Specialists
            </span>
          </div>
        </div>

        {/* 2-Column Sharp Layout: Left Specialist State + Right Workspace Form */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left Column: Focused Specialist Card (Clean dark theme with subtle cyan border, matching reference image) */}
          <div className="lg:col-span-4 sharp-card-highlight p-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-slate-300">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] font-mono text-slate-300">
                  <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-amber-400 animate-ping" : "bg-emerald-400"}`} />
                  <span>{loading ? "Analyzing Intent" : "Idle / Standby"}</span>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  {result?.specialistAgent || (selectedCategory ? presets.find(p => p.key === selectedCategory)?.label : "Lead Orchestrator Agent")}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dynamic Discovery & PoCP Procurement
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-xs text-slate-300 bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.05]">
                  <svg className="w-3.5 h-3.5 text-sky-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Cryptographic SLA verification</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300 bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.05]">
                  <svg className="w-3.5 h-3.5 text-sky-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <Link href="/goals">Research procurement</Link><Link href="/jobs/new">Statistics procurement</Link>
                </div>
              </div>
            </div>

            <div className="pt-5 mt-4 border-t border-white/[0.08] space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-sans">Reliability Score</span>
                <span className="font-semibold text-white">98.5% Bayesian</span>
              </div>
              <div className="w-full bg-white/[0.05] h-1.5 rounded-full overflow-hidden">
                <div className="bg-sky-400 h-full rounded-full transition-all duration-500" style={{ width: "98.5%" }} />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-400 font-sans">Inference Engine</span>
                <span className="text-slate-300 text-[11px] bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.06]">
                  Llama-3.3-70b-versatile
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Clean Workspace Form */}
          <div className="lg:col-span-8 sharp-card p-5 sm:p-6 flex flex-col justify-between space-y-4">
            <form onSubmit={startStreamingTask} className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">Task Specification</span>
                  <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">Prompt</span>
                </div>

                {/* Quick Presets as clean pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {presets.slice(0, 3).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(preset.key);
                        setPrompt(preset.prompt);
                        if (preset.key !== "DATA_ANALYST" && preset.key !== "DOC_SUMMARIZER") {
                          setAttachedFile(null);
                        }
                      }}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition cursor-pointer font-medium ${
                        selectedCategory === preset.key
                          ? "bg-white text-slate-950 border-white shadow-sm"
                          : "bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 border-white/[0.08]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea */}
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your objective, e.g. 'Investigate Hedera Consensus Service audit logging' or 'Analyze spreadsheet data'..."
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-white/30 text-xs sm:text-sm leading-relaxed transition resize-none"
                  required
                />
              </div>

              {/* Contextual File Upload Pill */}
              {showFileUpload && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".csv,.tsv,.txt,.json,.md"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="pill-ghost text-xs cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span>Attach Document / Spreadsheet</span>
                    </button>

                    {attachedFile && (
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.1] text-white font-mono text-[11px]">
                        <span className="truncate max-w-[200px]">{attachedFile.name}</span>
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
                  <span className="text-[11px] text-slate-500 font-mono">Supported: .csv, .xlsx, .pdf, .docx</span>
                </div>
              )}

              {/* Form Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-1.5">
                  {presets.slice(3).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(preset.key);
                        setPrompt(preset.prompt);
                        if (preset.key !== "DATA_ANALYST" && preset.key !== "DOC_SUMMARIZER") {
                          setAttachedFile(null);
                        }
                      }}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition cursor-pointer font-medium ${
                        selectedCategory === preset.key
                          ? "bg-white text-slate-950 border-white shadow-sm"
                          : "bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 border-white/[0.08]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  className="pill-action cursor-pointer"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-slate-950" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      <span>Running Pipeline...</span>
                    </>
                  ) : (
                    <>
                      <span>Execute Workflow</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Live Logs Stream */}
        {(logs.length > 0 || loading) && (
          <div className="sharp-card overflow-hidden">
            <div className="px-5 py-3 bg-[#131822] border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${loading ? "bg-sky-400 animate-ping" : "bg-emerald-400"}`} />
                <h2 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                  Autonomous Activity & Negotiation Trace
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                <span>{logs.length} events logged</span>
                {loading && <span className="text-sky-400 font-semibold animate-pulse">· Streaming</span>}
              </div>
            </div>

            <div
              ref={logContainerRef}
              className="p-5 max-h-[360px] overflow-y-auto space-y-2.5 font-mono text-xs scroll-smooth bg-black/20"
            >
              {logs.map((log, idx) => {
                const badge = stageBadge[log.stage] || stageBadge.THINKING;
                return (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg bg-white/[0.015] border border-white/[0.06] transition"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${badge.badge} border`}>
                          {log.stage}
                        </span>
                        <span className="text-white font-semibold">{log.agent}</span>
                      </div>
                      <time className="text-slate-500 text-[10px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-xs font-sans whitespace-pre-wrap">
                      {log.thought}
                    </p>

                    {/* Data Payload Display (includes synthetic test queries) */}
                    {log.data && Object.keys(log.data).length > 0 && (
                      <pre className="mt-2.5 p-3 rounded bg-black/60 border border-white/[0.07] text-[11px] text-slate-300 overflow-x-auto">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-1 font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce [animation-delay:0.4s]" />
                  <span className="italic ml-1">Specialists collaborating and validating requirements...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Deliverable Section */}
        {result && (
          <div className="space-y-4 animate-fade-in">
            {/* Settlement Bar / Multi-Payment Cards */}
            {((result.payments && result.payments.length > 0) ? result.payments : (result.payment ? [result.payment] : [])).map((pmt, idx) => (
              <div key={pmt.transactionId || idx} className="p-4 rounded-xl sharp-card-subtle flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <strong className="text-white text-sm font-sans font-semibold">
                      {pmt.role ? `x402 Settlement (${pmt.role})` : "x402 Micropayment Settled"}
                    </strong>
                    <span className="text-slate-400">({Number(pmt.amountTinybars).toLocaleString()} tinybars)</span>
                  </div>
                  <div className="text-slate-400">
                    Payer: <span className="text-slate-200">{pmt.payer}</span> · Merchant: <span className="text-slate-200">{pmt.recipient}</span>
                  </div>
                  <div className="text-slate-400">
                    Tx ID: <span className="text-slate-200">{pmt.transactionId}</span>
                  </div>
                </div>

                {pmt.explorerUrl && (
                  <a
                    href={pmt.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pill-ghost text-xs hover:text-white"
                  >
                    <span>View on HashScan</span>
                    <span>↗</span>
                  </a>
                )}
              </div>
            ))}

            {/* Deliverable Box */}
            <div className="sharp-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  Task Deliverable
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-mono">Executed by:</span>
                  <span className="text-xs px-2.5 py-0.5 rounded bg-white/[0.06] text-white border border-white/[0.08] font-semibold font-mono">
                    {result.specialistAgent || result.subcontractedAgent || "Specialist Agent"}
                  </span>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-slate-200 text-sm md:text-base leading-relaxed whitespace-pre-wrap font-sans">
                {result.finalOutput}
              </div>

              {result.sources && result.sources.length > 0 && (
                <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                  <div className="text-xs font-semibold text-slate-300 font-mono">
                    Multi-Source Ground Truth ({result.sources.length} sources):
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                    {result.sources.map((s, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-black/40 border border-white/[0.05] space-y-1">
                        <div className="font-semibold text-slate-200 truncate">{s.title}</div>
                        <p className="text-slate-400 text-[11px] line-clamp-2">{s.excerpt}</p>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline text-[10px] truncate block font-mono">
                          {s.url} ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.computation && (
                <div className="pt-3 border-t border-white/[0.07] flex flex-wrap gap-4 text-xs font-mono text-slate-400">
                  <span className="text-slate-200 font-semibold font-sans">Mathematical Verification:</span>
                  <span>Count: <strong className="text-white">{result.computation.count}</strong></span>
                  <span>Min: <strong className="text-white">{result.computation.min}</strong></span>
                  <span>Max: <strong className="text-white">{result.computation.max}</strong></span>
                  <span>Mean: <strong className="text-white">{result.computation.mean.toFixed(2)}</strong></span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Marketplace>
  );
}
