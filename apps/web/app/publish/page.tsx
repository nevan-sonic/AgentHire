"use client";

import { useState } from "react";
import Link from "next/link";
import { IDKitRequestWidget, proofOfHuman } from "@worldcoin/idkit";
import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { stringToHex } from "viem";
import { Marketplace } from "../marketplace";

type Challenge = { app_id: `app_${string}`; action: string; signal: string; rp_context: RpContext };

export default function PublishAgent() {
  const [formData, setFormData] = useState({
    name: "",
    capability: "web.research",
    description: "",
    basePrice: "120000",
    endpoint: "",
    ensName: "",
    merchantAccount: "",
    slaReliability: "98.5",
  });

  const [submitted, setSubmitted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // World ID Verification States
  const [worldIdVerified, setWorldIdVerified] = useState(false);
  const [verifyingWorldId, setVerifyingWorldId] = useState(false);
  const [worldIdProof, setWorldIdProof] = useState<IDKitResult | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);

  const [challenge, setChallenge] = useState<Challenge>();
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [signature, setSignature] = useState("");
  const listing = { name: formData.name, capability: formData.capability, description: formData.description,
    basePrice: Number(formData.basePrice), merchant: formData.merchantAccount, endpoint: formData.endpoint, ensName: formData.ensName };
  async function triggerWorldIDVerification() {
    setVerifyingWorldId(true);
    setError(null);
    try {
      const response = await fetch("/api/marketplace/publish/challenge", { method: "POST", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(listing) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start verification");
      const data: Challenge = result;
      const wallet = (window as Window & { ethereum?: { request(args: { method: string; params?: string[] }): Promise<unknown> } }).ethereum;
      if (!wallet) throw new Error("Connect the Ethereum wallet resolved by your ENS name.");
      const accounts = await wallet.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("No Ethereum wallet account connected");
      const message = `AgentHire publishing authorization\nListing: ${data.signal}\nWorld ID nonce: ${data.rp_context.nonce}`;
      const signed = await wallet.request({ method: "personal_sign", params: [stringToHex(message), accounts[0]] });
      if (typeof signed !== "string") throw new Error("Wallet signature unavailable");
      setSignature(signed);
      setChallenge(data);
      setWidgetOpen(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Publishing verification unavailable"); }
    finally { setVerifyingWorldId(false); }
  }

  // Alternative Path: Cancel / Revoke World ID verification (Judges requirement)
  function handleCancelWorldID() {
    setWorldIdVerified(false);
    setWorldIdProof(null);
    setVerificationFeedback(null);
    setError("World ID Agent Pass verification was cancelled. Publishing is blocked until human verification is completed.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Enforce World ID requirement (Sybil protection for agent publish)
    if (!worldIdVerified || !worldIdProof) {
      setError("World ID Agent Pass verification required before publishing. Please verify your human identity to proceed.");
      return;
    }

    setPublishing(true);

    try {
      const res = await fetch("/api/marketplace/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing, proof: worldIdProof, signature }),
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
      {challenge && <IDKitRequestWidget open={widgetOpen} onOpenChange={setWidgetOpen}
        app_id={challenge.app_id} action={challenge.action} rp_context={challenge.rp_context}
        allow_legacy_proofs={false} preset={proofOfHuman({ signal: challenge.signal })}
        onSuccess={proof => {
          setWorldIdProof(proof);
          setWorldIdVerified(true);
          setVerificationFeedback("Proof ready. Publish to verify it on the server.");
        }} onError={() => setError("World ID verification did not complete.")} />}
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Banner */}
        <div className="pb-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2 mb-2 font-mono text-[11px] text-slate-400">
            <span className="uppercase tracking-wider font-semibold">Provider Portal</span>
            <span className="text-white/20">/</span>
            <span>Hedera Agent Registry</span>
            <span className="text-white/20">/</span>
            <span className="text-sky-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              World ID Agent Pass Protected
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Publish Your Autonomous Agent
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
            Register your specialized AI agent into the decentralized marketplace. Protected by <strong>World ID Proof-of-Humanity</strong> to eliminate sybil attacks and malicious spam agents.
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
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20 text-xs font-mono">
              <span>🛡️ World ID Verified Creator</span>
            </div>
            <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
              Your agent <strong className="text-white font-mono">{formData.name}</strong> was added to the directory after World ID and ENS verification.
            </p>
            <div className="pt-4 flex items-center justify-center gap-3">
              <Link href="/agents" className="pill-action text-xs">
                View in Marketplace →
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setWorldIdVerified(false);
                }}
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
                <strong>Access Restricted:</strong> {error}
              </div>
            )}

            {/* World ID Agent Pass Trust Verification Box */}
            <div className="p-4 rounded-xl bg-[#131822] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">
                    W
                  </div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    World ID Agent Pass · Human Developer Safeguard
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Sybil Protection</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                To keep the AgentHire marketplace trusted and prevent rogue bots from publishing unvetted agents, every creator must complete a single World ID verification.
              </p>

              <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
                {worldIdVerified ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-mono font-semibold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      World ID proof ready for server verification
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelWorldID}
                      className="text-xs text-slate-500 hover:text-rose-400 underline font-mono cursor-pointer"
                    >
                      Clear verification
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={triggerWorldIDVerification}
                      disabled={verifyingWorldId}
                      className="pill-action text-xs bg-white text-slate-950 font-bold px-4 py-2 cursor-pointer flex items-center gap-2"
                    >
                      {verifyingWorldId ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-slate-950" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          <span>Verifying World ID...</span>
                        </>
                      ) : (
                        <>
                          <span>Verify with World ID Agent Pass</span>
                          <span>🛡️</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelWorldID}
                      className="pill-ghost text-xs text-slate-400 hover:text-rose-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {verificationFeedback && (
                <div className="text-[11px] font-mono text-emerald-400 pt-1">
                  {verificationFeedback}
                </div>
              )}
            </div>

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
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">ENS name</label>
                <input required placeholder="your-agent.eth" value={formData.ensName}
                  onChange={event => setFormData({ ...formData, ensName: event.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-black/40 border border-white/[0.09] text-white text-xs font-mono" />
                <p className="mt-1 text-xs text-slate-400">Set ENS text records agenthire.endpoint and agenthire.hedera to match your listing.</p>
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
                Saved to the agent directory after verification
              </span>
              <button
                type="submit"
                disabled={publishing || !worldIdVerified}
                className={`pill-action text-xs cursor-pointer ${
                  !worldIdVerified ? "opacity-50 cursor-not-allowed" : ""
                }`}
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
