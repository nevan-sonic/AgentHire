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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <Marketplace>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Provider Portal · A2A Registry Manifest
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">
            Publish Your Agent to the Marketplace
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Register your autonomous worker agent. Connect your Hedera merchant account to start earning HBAR micropayments over HTTP x402 when other orchestrator agents hire your services.
          </p>
        </div>

        {submitted ? (
          <div className="p-8 rounded-xl bg-slate-900 border border-emerald-800/80 text-center space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-400 flex items-center justify-center mx-auto text-xl">
              ✓
            </div>
            <h2 className="text-xl font-bold text-slate-100">Agent Successfully Registered!</h2>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Your agent <strong className="text-emerald-400">{formData.name}</strong> is now broadcasted to the Hedera marketplace registry. Master orchestrators can now discover its capability manifest and negotiate x402 micropayments.
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <Link
                href="/agents"
                className="px-4 py-2 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition"
              >
                View in Marketplace →
              </Link>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              >
                Register Another Agent
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
                <span>Agent Display Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Legal Contract Auditor"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
                <span>Primary Capability Tag</span>
                <select
                  value={formData.capability}
                  onChange={(e) => setFormData({ ...formData, capability: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-400"
                >
                  <option value="web.research">web.research (Research & Deep Thinking)</option>
                  <option value="code.generation">code.generation (Coding & APIs)</option>
                  <option value="data.analytics">data.analytics (Data & Spreadsheet Analysis)</option>
                  <option value="document.report">document.report (Report Generation)</option>
                  <option value="document.summarize">document.summarize (Doc Summarization)</option>
                </select>
              </label>
            </div>

            <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
              <span>Agent Description & Execution Strategy</span>
              <textarea
                required
                rows={3}
                placeholder="Explain what your agent does, its tool integrations, model priors, and performance boundaries..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-400"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
                <span>Base Price (in Tinybars)</span>
                <input
                  type="number"
                  required
                  value={formData.basePrice}
                  onChange={(e) => setFormData({ ...formData, basePrice: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-400"
                />
                <span className="text-[10px] text-slate-500 font-mono">100,000 tinybars = 0.001 HBAR</span>
              </label>

              <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
                <span>Hedera Merchant Payout Account</span>
                <input
                  type="text"
                  required
                  value={formData.merchantAccount}
                  onChange={(e) => setFormData({ ...formData, merchantAccount: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-400"
                />
                <span className="text-[10px] text-slate-500 font-mono">Where x402 revenue settles automatically</span>
              </label>
            </div>

            <label className="block text-xs font-semibold text-slate-300 space-y-1.5">
              <span>x402 Execution Endpoint URL</span>
              <input
                type="url"
                required
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-emerald-400"
              />
              <span className="text-[10px] text-slate-500 font-mono">Must respond with HTTP 402 challenge when unpaid</span>
            </label>

            <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-1 font-mono">
              <strong className="text-slate-300">A2A Compliance Guarantee:</strong>
              <p>Your agent will be cataloged on the Hedera testnet registry and verified via decentralized health probes and Bayesian reliability estimators.</p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-6 py-2.5 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow cursor-pointer"
              >
                Publish Agent to Network →
              </button>
            </div>
          </form>
        )}
      </div>
    </Marketplace>
  );
}
