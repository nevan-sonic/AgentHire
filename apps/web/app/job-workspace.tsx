"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Job = {
  id: string; title: string; mode: "preview" | "live"; status: string; createdAt: string; maxTest: string;
  task: { input: number[]; maxBudgetTinybars: string; capability: string; pocp: { failurePenaltyTinybars: string } };
};
type JobEvent = { id: number; kind: string; data: Record<string, unknown>; at: string };
const statuses: Record<string, string> = {
  "job.planning": "discovering", "preview.ready": "preview_ready", "authorization.required": "awaiting_authorization",
  "authorization.granted": "executing", "job.completed": "completed", "job.failed": "failed",
  "job.interrupted": "needs_reconciliation",
};
const humanize = (status: string) => status.replaceAll(/[._]/g, " ");
const tinybars = (value: string) => BigInt(value).toLocaleString("en-US") + " tinybars";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function JobsList() {
  const [jobs, setJobs] = useState<Job[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketplace/jobs", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(setJobs).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  if (error) return <p role="alert">The job service is unavailable. Refresh after the API starts.</p>;
  if (!jobs) return <p role="status">Loading saved jobs…</p>;
  if (!jobs.length) return <p>No jobs yet. <Link href="/jobs/new">Create your first job ↗</Link></p>;
  return <ul className="panel job-list">{jobs.map(job => <li key={job.id}>
    <Link href={`/jobs/${job.id}`}>{job.title} ↗</Link><span className="muted">{job.mode} · {humanize(job.status)}</span>
  </li>)}</ul>;
}

export function JobWorkspace({ id }: { id: string }) {
  const [job, setJob] = useState<Job>();
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connection, setConnection] = useState("Connecting…");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let stream: EventSource | undefined;
    const path = "/api/marketplace/jobs/" + encodeURIComponent(id);
    async function connect() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]);
        const response = await fetch(path, { signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "Job not found." : "Job service unavailable.");
        const snapshot: { job: Job; events: JobEvent[] } = await response.json();
        if (controller.signal.aborted) return;
        setJob(snapshot.job);
        setEvents(snapshot.events);
        stream = new EventSource(path + "/events?cursor=" + (snapshot.events.at(-1)?.id ?? 0));
        stream.onopen = () => setConnection("Connected · persisted events");
        stream.onerror = () => setConnection("Reconnecting · saved events remain visible");
        stream.onmessage = message => {
          try {
            const event: JobEvent = JSON.parse(message.data);
            setEvents(current => current.some(row => row.id === event.id) ? current : [...current, event]);
            const status = event.kind === "job.failed" && event.data.reason === "writes_may_have_occurred_do_not_retry"
              ? "needs_reconciliation" : statuses[event.kind];
            if (status) setJob(current => current && { ...current, status });
          } catch { setConnection("Invalid event · refresh to reload saved state"); }
        };
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Job service unavailable.");
      }
    }
    void connect();
    return () => { controller.abort(); stream?.close(); };
  }, [id]);
  if (error) return <p role="alert">{error} <Link href="/jobs">Back to My Jobs</Link></p>;
  if (!job) return <p role="status">Loading saved job…</p>;

  const latest = (kind: string) => events.findLast(event => event.kind === kind)?.data;
  const plan = latest("pocp.evaluated");
  const proposed = plan?.chosenTest as { workerId: string; priceTinybars: string } | null | undefined;
  const valuations = plan?.valuations as { workerId: string; netValueOfInformationTinybars?: { numerator: string; denominator: string } }[] | undefined;
  const value = valuations?.find(row => row.workerId === proposed?.workerId)?.netValueOfInformationTinybars;
  const netValue = value && new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
    .format(Number(value.numerator) / Number(value.denominator));
  const result = latest("task.verification.completed");
  const authorizationPlan = latest("authorization.required") ?? latest("preview.ready");
  const payment = events.filter(event => event.kind.startsWith("payment.") || event.kind.startsWith("audit."));
  const start = events.findLastIndex(event => event.kind === "discovery.started");
  const bids = events.slice(Math.max(start, 0)).filter(event => event.kind === "bid.received");
  return <>
    <div className="intro-meta"><p className="eyebrow">Procurement workspace</p><span className="tag">{job.mode === "live" ? "Live testnet" : "Preview"}</span></div>
    <h1>{job.title}</h1>
    <div className="record"><code>{id}</code><span className="tag good">{humanize(job.status)}</span><span role="status">{connection}</span></div>
    <div className="workspace">
      <section className="panel work-column">
        <p className="eyebrow">01 / Job and bids</p><h2>Task details</h2>
        <p className="muted">{job.task.capability}</p><pre>{JSON.stringify(job.task.input)}</pre>
        <dl className="budget">
          <div><dt>Budget</dt><dd>{tinybars(job.task.maxBudgetTinybars)}</dd></div>
          <div><dt>Test cap</dt><dd>{tinybars(job.maxTest)}</dd></div>
          <div><dt>Failure penalty</dt><dd>{tinybars(job.task.pocp.failurePenaltyTinybars)}</dd></div>
        </dl>
        <h3>Task-specific bids</h3>
        {!bids.length && <p className="muted">No accepted bids yet.</p>}
        {bids.map(event => {
          const bid = event.data.bid as { workerId: string; priceTinybars: string };
          return <details key={event.id}><summary>{bid.workerId} · {tinybars(bid.priceTinybars)}</summary><pre>{pretty(event.data)}</pre></details>;
        })}
      </section>
      <section className="panel work-column">
        <p className="eyebrow">02 / Manager activity</p><h2>Procurement decision</h2>
        {plan ? <div className="decision-box">
          <span className="tag good">{String(plan.action)}</span>
          <p>Baseline worker <strong>{String(plan.baselineWorkerId ?? "none")}</strong></p>
          <p className="muted">{plan.action === "TEST" ? "The model found a test with positive expected net value." : "No feasible test had positive expected net value."}</p>
          {proposed && <p>Proposed test <strong>{proposed.workerId}</strong> · {tinybars(proposed.priceTinybars)}{netValue && <> · expected net value <strong>+{netValue} tinybars</strong></>}</p>}
          <details><summary>Exact loss estimates and Bayesian priors</summary><pre>{pretty(plan)}</pre></details>
        </div> : <p className="muted">Waiting for actual bids and model evaluation.</p>}
        {result && <div className="decision-box"><strong>Independent evaluation · {result.passed ? "PASS" : "FAIL"}</strong><pre>{pretty(result)}</pre></div>}
        <ol className="activity">{events.map(event => <li key={event.id}>
          <details><summary>{humanize(event.kind)} <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time></summary>
            <pre>{pretty(event.data)}</pre>
          </details>
        </li>)}</ol>
      </section>
      <section className="panel work-column">
        <p className="eyebrow">03 / Authorization and proof</p><h2>Settlement</h2>
        {job.mode === "preview" && <p className="muted">Planning only. Protected execution and blockchain writes are disabled for this job.</p>}
        {job.status === "awaiting_authorization" && <p role="status">Awaiting authenticated operator authorization. Starting the job did not approve spending.</p>}
        {job.status === "needs_reconciliation" && <p role="alert">Execution stopped. Reconcile the recorded transaction IDs before taking further action.</p>}
        {authorizationPlan && <details><summary>Review proposed payment plan</summary><pre>{pretty(authorizationPlan)}</pre></details>}
        {!payment.length && <p className="muted">No settlement or audit records yet.</p>}
        {payment.map(event => <details key={event.id}>
          <summary>{humanize(event.kind)}</summary>
          {typeof event.data.explorer === "string" && event.data.explorer.startsWith("https://hashscan.io/testnet/") &&
            <a href={event.data.explorer}>Open HashScan ↗</a>}
          <pre>{pretty(event.data)}</pre>
        </details>)}
        <Link href="/proof">View historical proof ↗</Link>
      </section>
    </div>
  </>;
}
