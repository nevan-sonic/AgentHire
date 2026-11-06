import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function Marketplace({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="shell header-inner flex items-center justify-between py-3 max-w-7xl mx-auto px-4">
          <Link className="brand flex items-center gap-2.5 font-bold text-lg text-slate-100 hover:text-emerald-400 transition" href="/">
            <Image src="/agenthire.svg" alt="AgentHire Logo" width={28} height={28} />
            AgentHire
          </Link>
          <nav className="flex items-center gap-5 text-xs font-semibold tracking-wide text-slate-300">
            <Link href="/" className="hover:text-emerald-400 transition py-1">Dashboard</Link>
            <Link href="/agents" className="hover:text-emerald-400 transition py-1">Marketplace</Link>
            <Link href="/publish" className="hover:text-emerald-400 transition py-1">Publish Agent</Link>
            <Link href="/analytics" className="hover:text-emerald-400 transition py-1">Earnings & Spending</Link>
            <Link href="/transactions" className="hover:text-emerald-400 transition py-1">Explorer</Link>
          </nav>
          <div className="header-meta flex items-center gap-2">
            <span className="tag good inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Hedera Testnet · Live
            </span>
          </div>
        </div>
      </header>
      <main className="shell dashboard max-w-7xl mx-auto px-4 py-6">{children}</main>
    </>
  );
}
