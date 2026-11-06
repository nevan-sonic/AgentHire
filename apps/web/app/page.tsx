"use client";

import { useState, useRef, useEffect } from "react";
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
  };
  finalOutput: string;
};

const stageTheme: Record<AgentLogEntry["stage"], { badge: string; border: string }> = {
  THINKING: { badge: "bg-purple-500/10 text-purple-300 border-purple-500/20", border: "border-purple-500/20" },
  DECISION: { badge: "bg-blue-500/10 text-blue-300 border-blue-500/20", border: "border-blue-500/20" },
  DISCOVERY: { badge: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20", border: "border-cyan-500/20" },
  NEGOTIATION: { badge: "bg-amber-500/10 text-amber-300 border-amber-500/20", border: "border-amber-500/20" },
  PAYMENT: { badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", border: "border-emerald-500/20" },
  VERIFICATION: { badge: "bg-sky-500/10 text-sky-300 border-sky-500/20", border: "border-sky-500/20" },
  SYNTHESIS: { badge: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20", border: "border-indigo-500/20" },
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

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    let url = `${apiUrl}/api/orchestrator/stream?prompt=${encodeURIComponent(prompt.trim())}`;
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
        setLoading(false);
        eventSource.close();
      } catch (err) {
        console.error("Done parse error", err);
        setLoading(false);
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
      setLoading(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setLoading(false);
      eventSource.close();
    };
  }

  return (
    <Marketplace>
      <div className="space-y-6">
        {/* Top Control Header with pill action */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-mono uppercase tracking-widest text-blue-400 font-semibold">Autonomous A2A Protocol</span>
              <span className="text-white/20">/</span>
              <span className="text-[11px] text-slate-400">Micro-Settlement Pipeline</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Agent Orchestration <span className="text-blue-400 font-medium">& Execution Mesh</span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Active Hierarchy:</span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white border border-white/10 backdrop-blur-md">
              1 Master + 5 Specialists
            </span>
          </div>
        </div>

        {/* Dynamic Canvas-Style Grid: Left Active Agent Card + Right Prompt/Workspace Input */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left Column: Featured Glowing Active Specialist Card (Styled exactly like the highlighted blue glass card in reference image) */}
          <div className="lg:col-span-4 flex flex-col justify-between p-6 glass-card-glow relative overflow-hidden">
            {/* Subtle radial inner glow */}
            <div className="absolute top-0 right-0 w-44 h-44 bg-blue-400/20 rounded-full blur-3xl pointer-events-none" />

            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-400/10 border border-blue-400/30 text-[11px] font-mono text-blue-200">
                  <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-amber-400 animate-ping" : "bg-emerald-400"}`} />
                  <span>{loading ? "Analyzing Task" : "Ready"}</span>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  {result?.specialistAgent || (selectedCategory ? presets.find(p => p.key === selectedCategory)?.label : "Lead Orchestrator")}
                </h3>
                <p className="text-xs text-blue-200/70 mt-0.5">
                  Autonomous Subcontracting & PoCP Procurement
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-xs text-blue-100/90 bg-black/20 p-2 rounded-lg border border-white/5">
                  <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Verifiable execution SLA guarantees</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-100/90 bg-black/20 p-2 rounded-lg border border-white/5">
                  <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>On-chain micro-settlement over HTTP 402</span>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-white/10 space-y-3 relative z-10">
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-200/70">Reliability Score</span>
                <span className="font-mono font-semibold text-white">98.5% Bayesian</span>
              </div>
              <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-blue-400 to-indigo-400 h-full rounded-full transition-all duration-500" style={{ width: "98%" }} />
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-blue-200/70">Protocol Layer</span>
                <span className="font-mono text-white text-[11px] bg-white/10 px-2 py-0.5 rounded-full border border-white/10">Hedera + Groq Llama3</span>
              </div>
            </div>
          </div>

          {/* Right Column: Clean Dark Glass Workspace Form (styled like central node card in reference) */}
          <div className="lg:col-span-8 glass-panel p-6 flex flex-col justify-between space-y-5 border border-white/[0.08]">
            <form onSubmit={startStreamingTask} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">Instruct Agent Pipeline</span>
                  <span className="text-[10px] font-mono text-slate-500 px-2 py-0.5 rounded-full bg-white/[0.04]">Prompt Input</span>
                </div>

                {/* Quick Presets as clean dark pills */}
                <div className="hidden sm:flex items-center gap-1.5">
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
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition cursor-pointer ${
                        selectedCategory === preset.key
                          ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30"
                          : "bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/[0.08]"
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
                  placeholder="Plan the successful deployment of our smart contract or analyze complex datasets across agents..."
                  rows={4}
                  className="w-full px-4 py-3.5 rounded-xl bg-black/40 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/50 text-sm leading-relaxed transition resize-none"
                  required
                />
              </div>

              {/* Contextual File Upload Pill */}
              {showFileUpload && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-blue-950/20 border border-blue-500/20 text-xs">
                  <div className="flex items-center gap-2.5">
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
                      className="pill-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1.5 cursor-pointer font-medium"
                    >
                      <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span>Attach Document / Spreadsheet</span>
                    </button>

                    {attachedFile && (
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 font-mono text-[11px]">
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
                  <span className="text-[11px] text-slate-400 font-mono">Supported: .csv, .xlsx, .pdf, .docx</span>
                </div>
              )}

              {/* Bottom Form Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
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
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition cursor-pointer ${
                        selectedCategory === preset.key
                          ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30"
                          : "bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/[0.08]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  className="pill-primary px-6 py-2.5 text-xs tracking-wide uppercase font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-slate-950" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      <span>Agents Running...</span>
                    </>
                  ) : (
                    <>
                      <span>Execute Task</span>
                      <span className="text-slate-950">→</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Live Reasoning Logs & Synthetic Capability Trace */}
        {(logs.length > 0 || loading) && (
          <div className="glass-panel overflow-hidden border border-white/[0.08]">
            <div className="px-5 py-3.5 bg-black/30 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${loading ? "bg-blue-400 animate-ping" : "bg-emerald-400"}`} />
                <h2 className="text-xs font-semibold text-slate-200 uppercase tracking-wider font-mono">
                  Autonomous Activity Stream & Negotiation Trace
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                <span>{logs.length} events logged</span>
                {loading && <span className="text-blue-400 font-semibold animate-pulse">· Delegating</span>}
              </div>
            </div>

            <div
              ref={logContainerRef}
              className="p-5 max-h-[380px] overflow-y-auto space-y-3 font-mono text-xs scroll-smooth bg-black/20"
            >
              {logs.map((log, idx) => {
                const style = stageTheme[log.stage] || stageTheme.THINKING;
                return (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl bg-white/[0.02] border ${style.border} transition-all duration-300`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${style.badge} border`}>
                          {log.stage}
                        </span>
                        <span className="text-slate-200 font-semibold">{log.agent}</span>
                      </div>
                      <time className="text-slate-500 text-[10px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-xs font-sans whitespace-pre-wrap">
                      {log.thought}
                    </p>

                    {/* Data payload (includes synthetic test query [3, 6, 9] inspection) */}
                    {log.data && Object.keys(log.data).length > 0 && (
                      <pre className="mt-2.5 p-3 rounded-lg bg-black/60 border border-white/[0.08] text-[11px] text-blue-200/90 overflow-x-auto">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-1 pl-1 font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0.4s]" />
                  <span className="italic ml-1">Agents negotiating terms and computing deliverables...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Deliverable & Hedera Settlement */}
        {result && (
          <div className="space-y-4 animate-fade-in">
            {/* Settlement Card */}
            {result.payment && (
              <div className="p-4 rounded-xl glass-panel border border-blue-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <strong className="text-white text-sm">x402 Micropayment Settled</strong>
                    <span className="text-blue-300">({Number(result.payment.amountTinybars).toLocaleString()} tinybars)</span>
                  </div>
                  <div className="text-slate-400">
                    Payer: <span className="text-slate-200">{result.payment.payer}</span> · Merchant: <span className="text-slate-200">{result.payment.recipient}</span>
                  </div>
                  <div className="text-slate-400">
                    Tx ID: <span className="text-slate-200">{result.payment.transactionId}</span>
                  </div>
                </div>

                {result.payment.explorerUrl && (
                  <a
                    href={result.payment.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pill-secondary px-4 py-2 text-xs font-medium inline-flex items-center gap-1.5 hover:text-white"
                  >
                    <span>View on HashScan</span>
                    <span>↗</span>
                  </a>
                )}
              </div>
            )}

            {/* Deliverable Result */}
            <div className="glass-panel p-6 border border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  Verified Final Task Deliverable
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-mono">Completed by:</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30 font-semibold font-mono">
                    {result.specialistAgent || result.subcontractedAgent || "Specialist Agent"}
                  </span>
                </div>
              </div>

              <div className="prose prose-invert max-w-none text-slate-200 text-sm md:text-base leading-relaxed whitespace-pre-wrap font-sans">
                {result.finalOutput}
              </div>

              {result.sources && result.sources.length > 0 && (
                <div className="pt-4 border-t border-white/[0.08] space-y-2.5">
                  <div className="text-xs font-semibold text-slate-300 font-mono">
                    Retrieved Multi-Source Evidence ({result.sources.length} sources):
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                    {result.sources.map((s, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-black/40 border border-white/[0.06] space-y-1">
                        <div className="font-semibold text-blue-300 truncate">{s.title}</div>
                        <p className="text-slate-400 text-[11px] line-clamp-2">{s.excerpt}</p>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline text-[10px] truncate block">
                          {s.url} ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.computation && (
                <div className="pt-3 border-t border-white/[0.08] flex flex-wrap gap-4 text-xs font-mono text-slate-400">
                  <span className="text-slate-300 font-semibold">Mathematical Verification:</span>
                  <span>Count: <strong className="text-blue-400">{result.computation.count}</strong></span>
                  <span>Min: <strong className="text-blue-400">{result.computation.min}</strong></span>
                  <span>Max: <strong className="text-blue-400">{result.computation.max}</strong></span>
                  <span>Mean: <strong className="text-blue-400">{result.computation.mean.toFixed(2)}</strong></span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Marketplace>
  );
}
