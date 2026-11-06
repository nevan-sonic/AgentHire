import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function Marketplace({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0c10] text-[#f8fafc]">
      {/* Top Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#0c0f15]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 font-semibold text-white group">
            <div className="w-7 h-7 rounded-lg bg-white/[0.08] border border-white/[0.12] flex items-center justify-center">
              <Image src="/agenthire.svg" alt="AgentHire" width={16} height={16} className="opacity-90 group-hover:opacity-100 transition" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-white">AgentHire</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.08]">A2A Mesh</span>
          </Link>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            <Link href="/" className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] transition">
              Run Tasks
            </Link>
            <Link href="/agents" className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.05] transition">
              Explore Agents
            </Link>
            <Link href="/publish" className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.05] transition">
              Monetize / Publish Agent
            </Link>
            <Link href="/analytics" className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.05] transition">
              My Wallet & Earnings
            </Link>
            <Link href="/transactions" className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.05] transition">
              Receipts
            </Link>
          </nav>

          {/* Right Network Indicator */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Hedera Testnet</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
        {children}
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-white/[0.06] py-5 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-[11px]">
          <span>AgentHire · Autonomous Agent Trust & x402 Micropayment Protocol</span>
          <div className="flex items-center gap-4 text-slate-400">
            <span>PoCP Verified</span>
            <span>·</span>
            <span>Hedera Consensus Service (HCS)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
