import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function Marketplace({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col selection:bg-blue-500/30 selection:text-blue-200">
      {/* Top Floating Glass Navigation Bar */}
      <header className="sticky top-0 z-50 px-4 pt-3 pb-2">
        <div className="max-w-7xl mx-auto glass-panel px-5 py-3 flex items-center justify-between border border-white/10 backdrop-blur-2xl">
          {/* Logo & Brand */}
          <Link className="flex items-center gap-3 font-semibold text-slate-100 hover:text-white transition group" href="/">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-400 p-[1px] shadow-lg shadow-blue-500/25">
              <div className="w-full h-full rounded-[11px] bg-slate-950 flex items-center justify-center">
                <Image src="/agenthire.svg" alt="AgentHire" width={18} height={18} className="brightness-125" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                AgentHire <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">A2A</span>
              </span>
              <span className="text-[10px] text-slate-400 tracking-wider">Hedera Autonomous Layer</span>
            </div>
          </Link>

          {/* Center Clean Glass Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] p-1 rounded-full border border-white/[0.06]">
            <Link href="/" className="px-4 py-1.5 rounded-full text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.06] transition">
              Pipeline Workspace
            </Link>
            <Link href="/agents" className="px-4 py-1.5 rounded-full text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition">
              Marketplace
            </Link>
            <Link href="/publish" className="px-4 py-1.5 rounded-full text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition">
              Publish Agent
            </Link>
            <Link href="/analytics" className="px-4 py-1.5 rounded-full text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition">
              Economics & Ledger
            </Link>
            <Link href="/transactions" className="px-4 py-1.5 rounded-full text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition">
              On-Chain Explorer
            </Link>
          </nav>

          {/* Right Live Hedera Status Badge */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-950/40 border border-blue-500/30 text-[11px] font-mono text-blue-300 shadow-sm shadow-blue-500/10">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span>Hedera Testnet</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 md:py-6">
        {children}
      </main>

      {/* Minimal Clean Footer */}
      <footer className="py-6 border-t border-white/[0.05] text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>AgentHire Autonomous Trust & x402 Micropayment Protocol</span>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Proof-of-Capability Procurement (PoCP)</span>
            <span>·</span>
            <span>Hedera Consensus Service (HCS)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
