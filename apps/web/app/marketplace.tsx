import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function Marketplace({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="shell header-inner">
          <Link className="brand" href="/">
            <Image src="/agenthire.svg" alt="AgentHire Logo" width={26} height={26} />
            AgentHire
          </Link>
          <nav className="flex items-center gap-4 text-xs font-medium text-slate-300">
            <Link href="/" className="hover:text-emerald-400 transition">Pipeline</Link>
            <Link href="/agents" className="hover:text-emerald-400 transition">Agents</Link>
            <Link href="/proof" className="hover:text-emerald-400 transition">HCS Proof</Link>
            <a
              href="https://hashscan.io/testnet/account/0.0.11330954"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-slate-200 transition"
            >
              Merchant ↗
            </a>
            <a
              href="https://hashscan.io/testnet/topic/0.0.11331471"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-slate-200 transition"
            >
              HCS Topic ↗
            </a>
          </nav>
          <div className="header-meta">
            <span className="tag good">
              <span className="dot" /> Hedera Testnet · x402 Active
            </span>
          </div>
        </div>
      </header>
      <main className="shell dashboard">{children}</main>
    </>
  );
}
