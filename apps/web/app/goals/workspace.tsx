"use client";

import { useEffect, useState } from "react";
import type { GoalStep, MissionEnvelope } from "@agenthire/shared";

type Event = { id: number; kind: string; at: string; detail: { reason?: string; explorer?: string; transactionId?: string; amount?: string; worker?: string; buyer?: string; payer?: string; merchant?: string; sequence?: string; consensusTimestamp?: string; feeTinybars?: string; eventType?: string; evidenceHash?: string; passed?: boolean } };
type Artifact = { id: string; missionId: string; type: string; content: unknown; hash: string; verification: string };
type Goal = { objective: string; deliverable: string; status: string; rootMissionId: string;
  procurement?: { budget: string; maxTest: string; auditStatus?: string; plan?: {
    planHash: string;
    bids: { bidId: string; workerId: string; priceTinybars: string; expiresAt: string; merchant: string }[];
    decision: { action: string; reason: string; baseline: string; branches: { pass: string; fail: string }; testPrice: string;
      priors: { worker: string; alpha: number; beta: number }[];
      valuation?: { netValueOfInformationTinybars?: { numerator: string; denominator: string }; expectedLossTinybars?: { numerator: string; denominator: string } };
    };
  } };
  ledger?: { scope: { total: string; parentAllocation: string; childAllocation: string; maxAuditFee: string }; reserved: string;
    settled: string; available: string; released: string; unallocatedGoal: string; unallocatedParent: string; sponsoredFees: string } | null;
  plan: GoalStep[]; missions: MissionEnvelope[]; artifacts: Artifact[]; events: Event[] };

function download(artifact: Artifact) {
  if (artifact.type === "report" && artifact.content && typeof artifact.content === "object" &&
      "markdown" in artifact.content && typeof artifact.content.markdown === "string") {
    return { filename: "research-report.md", url: "data:text/markdown;charset=utf-8," + encodeURIComponent(artifact.content.markdown) };
  }
  return { filename: artifact.type + ".json", url: "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(artifact.content, null, 2)) };
}

export function GoalWorkspace({ id }: { id: string }) {
  const [goal, setGoal] = useState<Goal>();
  const [selected, select] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  useEffect(() => {
    const controller = new AbortController();
    const path = "/api/marketplace/goals/" + encodeURIComponent(id);
    let stream: EventSource | undefined;
    let loading = false;
    let dirty = false;
    async function refresh() {
      if (loading) { dirty = true; return; }
      loading = true;
      try {
        do {
          dirty = false;
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]);
          const response = await fetch(path, { signal, cache: "no-store" });
          if (!response.ok) throw new Error(response.status === 404 ? "Goal not found" : "Goal service unavailable");
          const snapshot: Goal = await response.json();
          if (controller.signal.aborted) return;
          setGoal(snapshot);
          setError("");
          if (!stream) {
            stream = new EventSource(path + "/events?cursor=" + (snapshot.events.at(-1)?.id ?? 0));
            stream.onopen = () => setConnection("Connected");
            stream.onerror = () => setConnection("Reconnecting");
            stream.onmessage = () => { void refresh(); };
          }
        } while (dirty);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Goal service unavailable");
      } finally { loading = false; }
    }
    void refresh();
    return () => { controller.abort(); stream?.close(); };
  }, [id]);
  if (!goal) return <p role={error ? "alert" : "status"}>{error || "Loading saved goal…"}</p>;
  const plan = goal.procurement?.plan;
  const ledger = goal.ledger;
  const moneyEvents = goal.events.filter(event => /^(research\.(payment|audit|observation)\.)/.test(event.kind) && event.kind !== "research.audit.manifest");
  const mission = goal.missions.find(entry => entry.missionId === selected);
  return <>
    <p className="eyebrow">Goal workspace</p><h1>Research goal</h1>
    <p>{goal.objective}</p><p className="muted">{goal.deliverable}</p>
    <p className="record"><span className="tag">{goal.status}</span><span role="status">{connection}</span><code className="wrap">{id}</code></p>
    {error && <p role="alert">{error}. Saved state remains visible.</p>}
    <div className="workspace">
      <section className="panel work-column"><h2>Plan and missions</h2>
        <ol className="activity">{goal.plan.map(step => <li key={step.id}><strong>{step.id}</strong> · {step.capability}
          <p className="muted">{step.objective}</p>{step.dependencies.length > 0 && <small>Depends on {step.dependencies.join(", ")}</small>}</li>)}</ol>
        <h3>Lead Research</h3>
        <ul className="activity">{goal.missions.map(item => <li key={item.missionId}>
          <button onClick={() => select(item.missionId)} aria-pressed={selected === item.missionId}>{item.recipient} · {item.status}</button>
        </li>)}</ul>
        {mission && <pre>{JSON.stringify(mission, null, 2)}</pre>}
      </section>
      <section className="panel work-column"><h2>Artifacts</h2>
        {!goal.artifacts.length && <p className="muted">Artifacts will appear as missions complete.</p>}
        {goal.artifacts.filter(item => !mission || item.missionId === mission.missionId).map(item => <details key={item.id}>
          <summary>{item.type} · {item.verification}</summary><p className="wrap">SHA-256 {item.hash}</p>
          <pre>{JSON.stringify(item.content, null, 2)}</pre>
          <a download={download(item).filename} href={download(item).url}>Download artifact</a>
        </details>)}
      </section>
      <section className="panel work-column"><h2>Activity and budget</h2>
        {ledger ? <dl className="budget">
          <div><dt>Goal authorized</dt><dd>{ledger.scope.total} tinybars</dd></div>
          <div><dt>Parent allocation</dt><dd>{ledger.scope.parentAllocation}</dd></div>
          <div><dt>Child allocation</dt><dd>{ledger.scope.childAllocation}</dd></div>
          <div><dt>Reserved / settled</dt><dd>{ledger.reserved} / {ledger.settled}</dd></div>
          <div><dt>Unallocated goal / parent</dt><dd>{ledger.unallocatedGoal} / {ledger.unallocatedParent}</dd></div>
          <div><dt>Released / available</dt><dd>{ledger.released} / {ledger.available}</dd></div>
          <div><dt>Actual sponsored fees</dt><dd>{ledger.sponsoredFees}</dd></div>
          <div><dt>HCS fee ceiling</dt><dd>{ledger.scope.maxAuditFee}</dd></div>
        </dl> : <p>Authorized blockchain spending <strong>0 tinybars</strong></p>}
        <ol className="activity">{goal.events.map(event => <li key={event.id}>
          <strong>{event.kind}</strong>{event.detail.reason && <p role="alert">{event.detail.reason}</p>}
        </li>)}</ol>
      </section>
    </div>
    {plan && <section className="section two">
      <article className="panel work-column">
        <h2>Competing research bids</h2>
        {plan.bids.map(bid => <div key={bid.bidId} className="decision-box">
          <strong>{bid.workerId} · {bid.priceTinybars} tinybars</strong>
          <p>web.research · merchant {bid.merchant}</p>
          <p>Expires <time dateTime={bid.expiresAt}>{new Date(bid.expiresAt).toLocaleString()}</time></p>
          {plan.decision.priors.filter(prior => prior.worker === bid.workerId).map(prior => <small key={prior.worker}>Model Beta({prior.alpha}, {prior.beta})</small>)}
        </div>)}
        <h3>PoCP · {plan.decision.action}</h3>
        <p>{plan.decision.reason.replaceAll("_", " ")}</p>
        <p>Test price {plan.decision.testPrice} tinybars · baseline {plan.decision.baseline}</p>
        <p>Hire branches · pass {plan.decision.branches.pass} · fail {plan.decision.branches.fail}</p>
        {plan.decision.valuation?.netValueOfInformationTinybars && <p>Net value {plan.decision.valuation.netValueOfInformationTinybars.numerator}/{plan.decision.valuation.netValueOfInformationTinybars.denominator} tinybars</p>}
        {plan.decision.valuation?.expectedLossTinybars && <p>Expected loss with test {plan.decision.valuation.expectedLossTinybars.numerator}/{plan.decision.valuation.expectedLossTinybars.denominator} tinybars</p>}
        {goal.status === "awaiting_authorization" && <p role="status">Reviewed plan awaits authenticated operator approval.</p>}
        <details><summary>Plan SHA-256</summary><code className="wrap">{plan.planHash}</code></details>
      </article>
      <article className="panel work-column">
        <h2>Payments and HCS evidence</h2>
        <p>HCS status · {goal.procurement?.auditStatus ?? "no publication"}</p>
        {!moneyEvents.length && <p className="muted">No payment or publication records.</p>}
        {moneyEvents.map(event => <details key={event.id}>
          <summary>{event.kind} {event.detail.eventType}</summary>
          {event.detail.buyer && <p>Buyer {event.detail.buyer} · worker {event.detail.worker} · payer {event.detail.payer} · merchant {event.detail.merchant}</p>}
          {event.detail.amount && <p>{event.detail.amount} tinybars</p>}
          {event.detail.transactionId && <code className="wrap">{event.detail.transactionId}</code>}
          {event.detail.explorer?.startsWith("https://hashscan.io/testnet/") && <p><a href={event.detail.explorer}>HashScan transaction ↗</a></p>}
          {event.detail.feeTinybars && <p>Network fee {event.detail.feeTinybars} tinybars</p>}
          {event.detail.sequence && <p>Sequence {event.detail.sequence} · {event.detail.consensusTimestamp}</p>}
          {event.detail.evidenceHash && <p className="wrap">Observation {event.detail.passed ? "pass" : "fail"} · {event.detail.evidenceHash}</p>}
        </details>)}
      </article>
    </section>}
  </>;
}
