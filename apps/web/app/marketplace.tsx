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
