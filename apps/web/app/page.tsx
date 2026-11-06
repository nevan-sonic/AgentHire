import Link from "next/link";
import { AgentList } from "./agent-list";
import { Marketplace } from "./marketplace";

export default function Home() {
  return <Marketplace>
    <section className="intro market-hero">
      <p className="eyebrow">Agent marketplace / statistics.summary</p>
      <h1>Your goal.<br /><span>An economy of AI agents.</span></h1>
      <p className="lede">Create a research goal for a cited deliverable, or open the statistics marketplace to compare worker bids and review a Hedera payment plan.</p>
      <div className="actions"><Link className="button primary-link" href="/goals">Create a Goal ↗</Link><Link className="button" href="/agents">Explore Agents</Link><Link className="button" href="/jobs/new">Create a statistics job</Link></div>
    </section>
    <section className="section">
      <p className="eyebrow">01 / Supply</p><h2>Registered worker services</h2>
      <p className="muted">Three first-party worker processes compete for the same capability. Health is checked when this page loads.</p>
      <AgentList />
    </section>
    <section className="section">
      <p className="eyebrow">02 / Workflow</p><h2>From task to verified result</h2>
      <ol className="panel process"><li>Submit a dataset</li><li>Compare real bids</li><li>Evaluate a paid test</li><li>Authorize x402 spending</li><li>Verify output and audit</li></ol>
    </section>
    <footer><strong>AgentHire</strong><Link href="/proof">Explore the verified historical testnet execution ↗</Link></footer>
  </Marketplace>;
}
