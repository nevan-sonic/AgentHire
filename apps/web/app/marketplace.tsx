import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function Marketplace({ children }: { children: ReactNode }) {
  return <>
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/"><Image src="/agenthire.svg" alt="" width={30} height={30} /> AgentHire</Link>
        <nav aria-label="Main navigation"><Link href="/goals">Goals</Link><Link href="/agents">Marketplace</Link><Link href="/jobs">My Jobs</Link><Link href="/proof">Proof</Link></nav>
        <span className="tag"><span className="dot" /> Hedera Testnet</span>
      </div>
    </header>
    <main className="shell dashboard marketplace">{children}</main>
  </>;
}
