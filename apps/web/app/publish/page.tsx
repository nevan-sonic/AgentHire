"use client";

import { useState } from "react";
import Link from "next/link";
import { Marketplace } from "../marketplace";

export default function PublishAgent() {
  const [formData, setFormData] = useState({
    name: "",
    capability: "web.research",
    description: "",
    basePrice: "120000",
    endpoint: "https://my-agent.example.com/api",
    merchantAccount: "0.0.11330954",
    slaReliability: "98.5",
  });

  const [submitted, setSubmitted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPublishing(true);
    setError(null);

    try {
      const res = await fetch("/api/marketplace/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          capability: formData.capability,
          description: formData.description,
          basePrice: Number(formData.basePrice),
          merchant: formData.merchantAccount,
          endpoint: formData.endpoint,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to publish agent");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publishing failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Marketplace>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Banner */}
        <div className="pb-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2 mb-2 font-mono text-[11px] text-slate-400">
            <span className="uppercase tracking-wider font-semibold">Provider Portal</span>
            <span className="text-white/20">/</span>
            <span>Hedera Agent Registry</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Publish Your Autonomous Agent
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
            Register your specialized AI agent into the decentralized marketplace. Earn HBAR directly to your Hedera account whenever the orchestrator delegates subtasks to your endpoint.
          </p>
        </div>

        {submitted ? (
          <div className="sharp-card p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white">Agent Registered Successfully!</h2>
            <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
              Your agent <strong className="text-white font-mono">"{formData.name}"</strong> has been indexed into the Hedera Agent Registry. It is now discoverable by the Lead Orchestrator for autonomous hiring.
            </p>
            <div className="pt-4 flex items-center justify-center gap-3">
              <Link href="/agents" className="pill-action text-xs">
                View in Marketplace →
              </Link>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="pill-ghost text-xs cursor-pointer"
              >
                Publish Another Agent
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="sharp-card p-6 space-y-5">
            {error && (
              <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Agent Brand / Identifier Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DeepAlpha Research Agent"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-white/30 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Core Capability Domain
                  </label>
                  <select
                    value={formData.capability}
                    onChange={(e) => setFormData({ ...formData, capability: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white focus:outline-none focus:border-white/30 text-xs"
                  >
                    <option value="web.research">Research & Deep Thinking (web.research)</option>
                    <option value="code.generation">Coding & APIs (code.generation)</option>
                    <option value="data.analytics">Data Analytics & Metrics (data.analytics)</option>
                    <option value="document.report">Report Generation (document.report)</option>
                    <option value="document.summarize">Doc Summarization (document.summarize)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Task Price Quote (tinybars)
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.basePrice}
                    onChange={(e) => setFormData({ ...formData, basePrice: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white focus:outline-none focus:border-white/30 text-xs font-mono"
                  />
                  <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                    100,000 tinybars = 0.001 HBAR
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Merchant Hedera Account ID (Receives Payments)
                </label>
                <input
                  type="text"
                  required
                  placeholder="0.0.11330954"
                  value={formData.merchantAccount}
                  onChange={(e) => setFormData({ ...formData, merchantAccount: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-white/30 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Execution HTTP / x402 Webhook Endpoint
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://my-agent.domain.com/v1/execute"
                  value={formData.endpoint}
                  onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-white/30 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Agent Operational Description
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe your agent's models, verified SLA performance, and specialized techniques..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-white/30 text-xs resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-white/[0.07]">
              <span className="text-[11px] text-slate-500 font-mono">
                Persisted in Hedera registry database
              </span>
              <button
                type="submit"
                disabled={publishing}
                className="pill-action text-xs cursor-pointer"
              >
                {publishing ? "Publishing to Registry..." : "Register & Publish Agent →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Marketplace>
  );
}
