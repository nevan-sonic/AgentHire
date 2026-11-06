import Link from "next/link";
import Image from "next/image";
import { loadRecordedDemo, transactionUrl } from "../demo-data";
import { EvidenceStatus } from "../evidence-status";
import { Replay } from "../replay";

const number = new Intl.NumberFormat("en-US");
const hbar = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const format = (value: number) => number.format(value);
const topicUrl = (id: string) => `https://hashscan.io/testnet/topic/${id}`;

function ProofLink({ id }: { id: string }) {
  return <a className="tx" href={transactionUrl(id)} title={id}>{id} ↗</a>;
}

export default function Home() {
  let demo;
  try {
    demo = loadRecordedDemo();
  } catch {
    return <main className="shell"><h1>AgentHire</h1><p role="alert">The recorded evidence failed validation. The procurement details are unavailable.</p></main>;
  }
  const [testPayment, hirePayment] = demo.payments;
  const spent = testPayment.amount + hirePayment.amount;
  const remaining = demo.budget - spent;
  const [economy] = demo.workers;

  return <>
    <header className="site-header">
      <div className="shell header-inner">
        <span className="brand"><Image src="/agenthire.svg" alt="" width={30} height={30} /> AgentHire</span>
        <nav aria-label="Dashboard sections"><Link href="/agents">Marketplace</Link><a href="#decision">Decision</a><a href="#proof">Proof</a><a href="#audit">Audit</a></nav>
        <span className="tag"><span className="dot" /> Hedera Testnet</span>
      </div>
    </header>
    <main className="shell dashboard">
      <section className="intro">
        <div className="intro-meta"><p className="eyebrow">Verified historical testnet execution</p><span className="tag good">✓ Completed procurement</span></div>
        <h1>Autonomous procurement,<br className="desktop-break" /> <span>verified on Hedera.</span></h1>
        <p className="lede">A manager paid for evidence before committing to a hire. One failed test changed the winning worker.</p>
        <p className="record"><strong>{demo.source}</strong><span>{demo.task}</span><span>{demo.capability}</span><a href={topicUrl(demo.topic)}>HCS topic ↗</a></p>
        <EvidenceStatus task={demo.task} manifest={demo.manifest} />
      </section>
      <section className="metrics" aria-label="Procurement overview">
        {[
          ["Final worker", demo.selected, "Production result passed"],
          ["Total worker payments", format(spent), "tinybars · capability test + hire"],
          ["Remaining budget", format(remaining), "tinybars · 0.00245 HBAR"],
          ["HCS audit events", `${demo.audit.length} verified`, "Consensus sequences 2–9"],
        ].map(([label, value, detail]) => <div className="panel metric" key={label}><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>)}
      </section>
      <Replay notes={[
        demo.capability,
        demo.workers.map(worker => worker.name).join(" · "),
        demo.workers.map(worker => `${worker.name} ${format(worker.bid)}`).join(" · ") + " tinybars",
        `+${format(demo.test.value)} tinybars estimated net value`,
        `${format(testPayment.amount)} tinybars settled through x402`,
        `Returned mean ${demo.test.actual.mean}, expected ${demo.test.expected.mean}`,
        `${economy.name} model estimate: ${economy.prior}% → ${economy.posterior}%`,
        `${demo.selected} takes the lead after independent evaluation`,
        `${format(hirePayment.amount)} tinybars settled through x402`,
        `Independent check: ${demo.result.status} · mean ${demo.result.output.mean}`,
        `${demo.audit.length} verified events · topic ${demo.topic}`,
      ]} />
      <section id="decision" className="section">
        <p className="eyebrow">01 / Decision and evaluation</p>
        <h2>One small test changed the hire</h2>
        <div className="two">
          <article className="panel feature">
            <span className="tag good">{demo.test.decision}</span>
            <h3>+{format(demo.test.value)} <small>tinybars</small></h3>
            <p className="muted">Estimated net value of testing. The expected reduction in selection loss exceeded the {format(testPayment.amount)}-tinybar cost of testing {demo.test.worker}.</p>
            <details><summary>How expected value is calculated</summary><p className="muted">Expected loss without a test − expected loss with a test − test price.</p></details>
          </article>
          <article className="panel feature">
            <span className="tag fail">Independent evaluation · {demo.test.status}</span>
            <h3>{economy.prior}% <span className="arrow">→</span> {economy.posterior}%</h3>
            <p className="muted">Economy model estimate · {demo.test.prior} → {demo.test.posterior}</p>
            <div className="switch"><span>Economy</span><span aria-hidden="true">→</span><strong>Balanced</strong></div>
          </article>
        </div>
        <div className="panel evidence">
          <h3>Capability test evidence</h3>
          <p className="muted">The manager independently checked the result for <code>{JSON.stringify(demo.test.input)}</code>. Economy returned a mean of {demo.test.actual.mean}. The correct mean was {demo.test.expected.mean}.</p>
          <div className="two"><div><small>Worker output</small><pre>{JSON.stringify(demo.test.actual)}</pre></div><div><small>Expected output</small><pre>{JSON.stringify(demo.test.expected)}</pre></div></div>
          <details><summary>Test evidence SHA-256</summary><code className="wrap">{demo.test.evidence}</code></details>
        </div>
      </section>
      <section className="section">
        <p className="eyebrow">02 / Worker marketplace</p>
        <h2>Three bids for one task</h2>
        <p className="muted">Local demo worker adapters. Reliability figures are model estimates.</p>
        <div className="workers">
          {demo.workers.map(worker => <article key={worker.name} className={`panel worker ${worker.name === demo.selected ? "selected" : ""}`}>
            <h3>{worker.name}</h3><strong>{format(worker.bid)}</strong> <small>tinybars</small>
            <p className="muted">Reliability estimate · {worker.prior}%{"posterior" in worker ? ` → ${worker.posterior}%` : ""}</p>
            <span className={`tag ${worker.name === demo.selected ? "good" : worker.name === economy.name ? "fail" : ""}`}>{worker.note}</span>
          </article>)}
        </div>
      </section>
      <section id="proof" className="section">
        <p className="eyebrow">03 / Settlement evidence</p>
        <h2>Two verified x402 payments</h2>
        <p className="muted">Native HBAR · Hedera testnet · Official x402 facilitator</p>
        <div className="two">
          {demo.payments.map(payment => <article className="panel feature" key={payment.id}>
            <span className="tag good">Settled · Mirror Node {payment.status}</span>
            <h3>{hbar.format(payment.amount / 100_000_000)} <small>HBAR</small></h3>
            <p>{payment.label} · {payment.worker} · {format(payment.amount)} tinybars</p>
            <p className="muted">Payer {demo.payer} → merchant {demo.merchant}</p>
            <ProofLink id={payment.id} />
            <details><summary>Full transaction ID</summary><code className="wrap">{payment.id}</code></details>
          </article>)}
        </div>
      </section>
      <section className="section">
        <p className="eyebrow">04 / Production outcome</p>
        <h2>Balanced delivered the correct result</h2>
        <div className="two">
          <article className="panel feature">
            <span className="tag good">Independent evaluation · {demo.result.status}</span>
            <p>Input <code>{JSON.stringify(demo.result.input)}</code></p>
            <pre>{JSON.stringify(demo.result.output)}</pre>
            <p className="muted">Final status <code>{demo.status}</code></p>
            <details><summary>Final-result evidence SHA-256</summary><code className="wrap">{demo.result.evidence}</code></details>
          </article>
          <article className="panel feature">
            <h3 className="budget-title">Budget ledger <small>tinybars</small></h3>
            <dl className="budget">
              <div><dt>Initial budget</dt><dd>{format(demo.budget)}</dd></div>
              <div><dt>Capability test</dt><dd>−{format(testPayment.amount)}</dd></div>
              <div><dt>Final hire</dt><dd>−{format(hirePayment.amount)}</dd></div>
              <div><dt>Remaining</dt><dd>{format(remaining)}</dd></div>
            </dl>
          </article>
        </div>
      </section>
      <section id="audit" className="section">
        <p className="eyebrow">05 / Consensus audit</p>
        <h2>Eight events, in consensus order</h2>
        <p className="muted">Sequences 2–9 · <a href={topicUrl(demo.topic)}>Open HCS topic {demo.topic} on HashScan ↗</a></p>
        <ol className="panel timeline">
          {demo.audit.map(event => <li key={event.eventId}>
            <details>
              <summary><span className="seq">{event.sequence}</span><span><strong>{event.type}</strong><small>{event.description}</small></span><span className="tag good">✓ Verified</span></summary>
              <div className="audit-detail">
                <p>Event ID <code className="wrap">{event.eventId}</code></p>
                <p>Payload SHA-256 <code className="wrap">{event.payloadHash}</code></p>
                <p>Consensus timestamp <code>{event.timestamp}</code></p>
                <ProofLink id={event.transactionId} />
                <code className="wrap">{event.transactionId}</code>
              </div>
            </details>
          </li>)}
        </ol>
        <details><summary>Approved manifest SHA-256</summary><code className="wrap">{demo.manifest}</code></details>
      </section>
      <footer><strong>AgentHire</strong><span>AHC infrastructure token <a href={`https://hashscan.io/testnet/token/${demo.token}`}>{demo.token} ↗</a> · Both x402 payments used native HBAR.</span></footer>
    </main>
  </>;
}
