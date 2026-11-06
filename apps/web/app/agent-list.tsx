"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MarketplaceAgent } from "@agenthire/shared";

export function AgentList({ id }: { id?: string }) {
  const [agents, setAgents] = useState<MarketplaceAgent[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]);
    const path = id ? "/" + encodeURIComponent(id) : "?capability=statistics.summary";
    fetch("/api/marketplace/agents" + path, { signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? "Agent not found." : "Worker registry unavailable.");
      const data = await response.json();
      setAgents(id ? [data] : data);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Worker registry unavailable.");
    });
    return () => controller.abort();
  }, [id]);
  if (error) return <p className="panel evidence" role="alert">{error} <Link href="/proof">View historical proof</Link></p>;
  if (!agents) return <p className="muted" role="status">Checking registered worker services…</p>;
  if (!agents.length) return <p className="muted">No workers match this capability.</p>;
  return <div className={id ? "agent-detail" : "workers"}>
    {agents.map(agent => <article className="panel worker" key={agent.id}>
      <p className="eyebrow">First-party worker agent</p>
      <h3>{id ? agent.name : <Link href={`/agents/${agent.id}`}>{agent.name} ↗</Link>}</h3>
      <p className="muted">{agent.description}</p>
      <span className={`tag ${agent.health === "online" ? "good" : "fail"}`}>{agent.health}</span>
      <dl className="budget">
        <div><dt>Capability</dt><dd><code>{agent.capability}</code></dd></div>
        <div><dt>Starting bid</dt><dd>{agent.basePrice.toLocaleString()} tinybars</dd></div>
        <div><dt>Model prior</dt><dd>{agent.reliabilityBps / 100}%</dd></div>
        <div><dt>Verified tests</dt><dd>{agent.observations.passed} pass · {agent.observations.failed} fail</dd></div>
        <div><dt>Dataset limit</dt><dd>{agent.maxInput} values</dd></div>
      </dl>
      {id && <p className="muted">Service <code>{agent.endpoint}</code><br />Merchant {agent.merchant} · {agent.network}<br />Health checked {new Date(agent.checkedAt).toLocaleString()}<br />Reliability is an explicit Bayesian prior. Observations appear in the jobs that collected them.</p>}
    </article>)}
  </div>;
}
