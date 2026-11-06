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
  taskType?: "numerical" | "research";
  status: string;
  completedAt: string;
  primaryAgent: string;
  subcontractedAgent: string;
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

const stageColors: Record<AgentLogEntry["stage"], { bg: string; text: string; border: string }> = {
  THINKING: { bg: "bg-purple-950/50", text: "text-purple-300", border: "border-purple-800/60" },
  DECISION: { bg: "bg-blue-950/50", text: "text-blue-300", border: "border-blue-800/60" },
  DISCOVERY: { bg: "bg-cyan-950/50", text: "text-cyan-300", border: "border-cyan-800/60" },
  NEGOTIATION: { bg: "bg-amber-950/50", text: "text-amber-300", border: "border-amber-800/60" },
  PAYMENT: { bg: "bg-emerald-950/60", text: "text-emerald-400", border: "border-emerald-700/80" },
  VERIFICATION: { bg: "bg-teal-950/50", text: "text-teal-300", border: "border-teal-800/60" },
  SYNTHESIS: { bg: "bg-indigo-950/50", text: "text-indigo-300", border: "border-indigo-800/60" },
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const presets = [
    { label: "Data Analysis", prompt: "Analyze server traffic latency spikes [24, 56, 120, 310, 45, 29, 680, 52] ms and provide recommendations" },
    { label: "Quick Research", prompt: "Investigate Hedera x402 payment standard specifications and key facilitator features" },
    { label: "Deep Research", prompt: "Perform deep research and comparative analysis of Hedera Agent Kit versus traditional web3 agent frameworks" },
  ];

  // Auto-scroll logs as new entries stream in
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  function startStreamingTask(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setLogs([]);
    setResult(null);
    setError(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    const url = `${apiUrl}/api/orchestrator/stream?prompt=${encodeURIComponent(prompt.trim())}`;
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
      <div className="max-w-5xl mx-auto space-y-6 py-4">
        {/* Header */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Autonomous Agent-to-Agent Marketplace · x402 Micropayments
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-100">
            Real-Time Agent <span className="text-emerald-400">Thinking & Hiring Pipeline</span>
          </h1>
          <p className="text-slate-400 text-sm md:text-base mt-2 max-w-2xl leading-relaxed">
            Enter a prompt. Watch the Lead Agent reason, detect capability boundaries, discover worker agents, negotiate terms, pay over x402 on Hedera testnet, and verify the final outcome live.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={startStreamingTask} className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <label className="block text-sm font-medium text-slate-200">
            Task Prompt
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Analyze latency data [24, 56, 120, 310, 45, 29, 680, 52] ms and recommend infrastructure optimizations..."
              rows={3}
              className="w-full mt-2 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700/80 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-400 text-sm transition"
              required
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 font-mono">Quick test:</span>
              {presets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  className="text-xs px-2.5 py-1 rounded-md bg-slate-800/70 hover:bg-slate-800 text-slate-300 border border-slate-700/50 transition cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="px-5 py-2 rounded-lg bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-semibold text-sm transition shadow flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-slate-950" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                  </svg>
                  <span>Agents Collaborating…</span>
                </>
              ) : (
                "Run Agent Task →"
              )}
            </button>
          </div>
        </form>

        {error && (
          <div className="p-4 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-sm">
            <strong>Execution Error:</strong> {error}
          </div>
        )}

        {/* Live Activity & Reasoning Logs */}
        {(logs.length > 0 || loading) && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/90 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${loading ? "bg-amber-400 animate-ping" : "bg-emerald-400"}`} />
                <h2 className="text-sm font-semibold text-slate-200">
                  Live Agent Activity & Chain-of-Thought Stream
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                <span>{logs.length} events logged</span>
                {loading && <span className="text-amber-400 font-semibold animate-pulse">· Processing</span>}
              </div>
            </div>

            <div
              ref={logContainerRef}
              className="p-5 max-h-[380px] overflow-y-auto space-y-3 font-mono text-xs scroll-smooth bg-slate-950/50"
            >
              {logs.map((log, idx) => {
                const style = stageColors[log.stage] || stageColors.THINKING;
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${style.bg} ${style.border} transition-all duration-300`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${style.text} border ${style.border}`}>
                          {log.stage}
                        </span>
                        <span className="text-slate-300 font-semibold">{log.agent}</span>
                      </div>
                      <time className="text-slate-500 text-[10px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="text-slate-200 leading-relaxed text-xs font-sans whitespace-pre-wrap">
                      {log.thought}
                    </p>

                    {/* Data payload if any */}
                    {log.data && Object.keys(log.data).length > 0 && (
                      <pre className="mt-2 p-2 rounded bg-black/40 border border-slate-800/80 text-[11px] text-slate-400 overflow-x-auto">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-1 pl-1 font-sans">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0.4s]" />
                  <span className="italic ml-1">Autonomous agents communicating and settling transactions...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Final Synthesized Output & Verified Proof */}
        {result && (
          <div className="space-y-4 animate-fade-in">
            {/* Settlement Details */}
            {result.payment && (
              <div className="p-4 rounded-xl bg-slate-900 border border-emerald-900/60 shadow flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <strong className="text-emerald-400 text-sm">x402 Micropayment Settled</strong>
                    <span className="text-slate-400">({Number(result.payment.amountTinybars).toLocaleString()} tinybars)</span>
                  </div>
                  <div className="text-slate-400">
                    Payer: <span className="text-slate-300">{result.payment.payer}</span> · Merchant: <span className="text-slate-300">{result.payment.recipient}</span>
                  </div>
                  <div className="text-slate-400">
                    Tx ID: <span className="text-slate-300">{result.payment.transactionId}</span>
                  </div>
                </div>

                {result.payment.explorerUrl && (
                  <a
                    href={result.payment.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-700 hover:bg-emerald-900 transition text-xs font-semibold shrink-0"
                  >
                    <span>View on HashScan</span>
                    <span>↗</span>
                  </a>
                )}
              </div>
            )}

            {/* Deliverable Box */}
            <div className="bg-slate-900 border border-emerald-800/80 rounded-xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-base font-semibold text-emerald-400 flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  Verified Final Task Deliverable
                </h3>
                <span className="text-xs text-slate-400 font-mono">Synthesized by Lead Agent</span>
              </div>

              <div className="prose prose-invert max-w-none text-slate-200 text-sm md:text-base leading-relaxed whitespace-pre-wrap font-sans">
                {result.finalOutput}
              </div>

              {result.sources && result.sources.length > 0 && (
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="text-xs font-semibold text-slate-300 font-mono">
                    Retrieved & Verified Multi-Source Evidence ({result.sources.length} sources):
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {result.sources.map((s, idx) => (
                      <div key={idx} className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-1">
                        <div className="font-semibold text-emerald-400 truncate">{s.title}</div>
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
                <div className="pt-3 border-t border-slate-800/80 flex flex-wrap gap-4 text-xs font-mono text-slate-400">
                  <span className="text-slate-300 font-semibold">Subtask Mathematical Computation:</span>
                  <span>Count: <strong className="text-emerald-400">{result.computation.count}</strong></span>
                  <span>Min: <strong className="text-emerald-400">{result.computation.min}</strong></span>
                  <span>Max: <strong className="text-emerald-400">{result.computation.max}</strong></span>
                  <span>Mean: <strong className="text-emerald-400">{result.computation.mean.toFixed(2)}</strong></span>
                  {result.computation.median !== undefined && (
                    <span>Median: <strong className="text-emerald-400">{result.computation.median}</strong></span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Marketplace>
  );
}
