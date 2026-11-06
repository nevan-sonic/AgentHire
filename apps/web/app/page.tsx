"use client";

import { useState } from "react";
import { Marketplace } from "./marketplace";

type AgentTaskStep = {
  step: number;
  agent: string;
  action: string;
  details: string;
  payment?: {
    payer: string;
    recipient: string;
    amountTinybars: string;
    transactionId?: string;
    explorerUrl?: string;
    status: string;
    scheme: string;
  };
};

type RunResult = {
  prompt: string;
  status: string;
  completedAt: string;
  primaryAgent: string;
  subcontractedAgent: string;
  steps: AgentTaskStep[];
  computation: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median?: number;
  };
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

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    "Analyze server traffic latency spikes [24, 56, 120, 310, 45, 29, 680, 52] ms and provide recommendations",
    "Evaluate quarterly revenue data [14000, 22000, 18500, 31000, 42000, 68000] USD for volatility and trend",
    "Process IoT battery sensor metrics [3.2, 3.1, 2.9, 3.3, 2.7, 2.4, 3.0, 1.8] V to identify degradation risk"
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const res = await fetch(`${apiUrl}/api/orchestrator/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to execute agent task");
      }

      const data: RunResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Marketplace>
      <div className="max-w-4xl mx-auto space-y-8 py-4">
        {/* Header */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Autonomous Agent-to-Agent Marketplace
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-100">
            AI Agent <span className="text-emerald-400">Collaboration & x402 Micropayments</span>
          </h1>
          <p className="text-slate-400 text-sm md:text-base mt-2 max-w-2xl leading-relaxed">
            Enter a prompt. The Lead Agent takes the job, verifies capabilities, hires a specialized worker agent for subtasks, pays it in real-time through the x402 protocol settled on Hedera, and synthesizes the verified outcome.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <label className="block text-sm font-medium text-slate-200">
            Task Prompt
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Analyze our sensor latency metrics [15, 34, 78, 210, 42, 19, 450, 62] and provide an action plan..."
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
                  onClick={() => setPrompt(preset)}
                  className="text-xs px-2.5 py-1 rounded-md bg-slate-800/70 hover:bg-slate-800 text-slate-300 border border-slate-700/50 transition cursor-pointer"
                >
                  Example {idx + 1}
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
                  <span>Executing Agent Task…</span>
                </>
              ) : (
                "Run Task →"
              )}
            </button>
          </div>
        </form>

        {error && (
          <div className="p-4 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-sm">
            <strong>Execution Error:</strong> {error}
          </div>
        )}

        {/* Live Execution Timeline & Results */}
        {result && (
          <div className="space-y-6 animate-fade-in">
            {/* Step-by-Step Agent Collaboration Lifecycle */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                  Autonomous Agent Workflow & Payment Trail
                </h2>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded border border-emerald-800">
                  Status: Completed
                </span>
              </div>

              <div className="mt-4 space-y-4">
                {result.steps.map((s) => (
                  <div key={s.step} className="flex gap-3.5 items-start text-sm">
                    <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-slate-300 shrink-0 mt-0.5">
                      {s.step}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">{s.agent}</span>
                        <span className="text-xs font-mono text-slate-400">{s.action}</span>
                      </div>
                      <p className="text-slate-300 text-xs md:text-sm leading-relaxed">{s.details}</p>

                      {/* Payment Card if Step contains x402 details */}
                      {s.payment && (
                        <div className="mt-2.5 p-3 rounded-lg bg-slate-950 border border-emerald-900/50 space-y-1.5 text-xs font-mono">
                          <div className="flex items-center justify-between text-emerald-400 font-semibold">
                            <span>x402 Micropayment Settled</span>
                            <span>{Number(s.payment.amountTinybars).toLocaleString()} tinybars</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-slate-400 pt-1 border-t border-slate-800/80">
                            <div>Payer: <span className="text-slate-300">{s.payment.payer}</span></div>
                            <div>Merchant: <span className="text-slate-300">{s.payment.recipient}</span></div>
                            <div className="md:col-span-2 flex items-center gap-2">
                              <span>Tx: {s.payment.transactionId}</span>
                              {s.payment.explorerUrl && (
                                <a
                                  href={s.payment.explorerUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-emerald-400 underline hover:text-emerald-300 ml-auto"
                                >
                                  View on HashScan ↗
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Final Delivered Output */}
            <div className="bg-slate-900 border border-emerald-800/60 rounded-xl p-5 shadow-lg space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-base font-semibold text-emerald-400 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  Verified Final Deliverable
                </h3>
                <span className="text-xs text-slate-400">Synthesized by Lead Agent</span>
              </div>

              <div className="prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                {result.finalOutput}
              </div>

              {result.computation && (
                <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-4 text-xs font-mono text-slate-400">
                  <span className="text-slate-300">Subtask Metrics:</span>
                  <span>Count: <strong className="text-slate-200">{result.computation.count}</strong></span>
                  <span>Min: <strong className="text-slate-200">{result.computation.min}</strong></span>
                  <span>Max: <strong className="text-slate-200">{result.computation.max}</strong></span>
                  <span>Mean: <strong className="text-slate-200">{result.computation.mean.toFixed(2)}</strong></span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Marketplace>
  );
}
