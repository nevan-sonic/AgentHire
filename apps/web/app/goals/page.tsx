"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Marketplace } from "../marketplace";

export default function Goals() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<{ id: string; objective: string; status: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketplace/goals", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
      .then(response => response.ok ? response.json() : []).then(setRecent).catch(() => {});
    return () => controller.abort();
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/marketplace/goals", { method: "POST", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Goal creation failed");
      router.push(`/goals/${result.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Goal creation failed");
      setBusy(false);
    }
  }
  return <Marketplace><p className="eyebrow">Research workspace</p><h1>Create a goal</h1>
    <form className="panel job-form" onSubmit={create}>
      <label>Goal description<textarea name="objective" required maxLength={2000} rows={5}
        placeholder="Compare three open-source AI agent frameworks for a small startup" /></label>
      <label>Desired deliverable<input name="deliverable" required maxLength={300} placeholder="A cited recommendation report" /></label>
      <p className="muted">Research goals use Groq when the server enables inference. Goal text is sent to Groq and search terms to GitHub. The blockchain spending allowance is zero.</p>
      <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create Goal"}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    {recent.length > 0 && <section className="section"><h2>Saved goals</h2><ul className="panel job-list">{recent.map(goal => <li key={goal.id}><Link href={`/goals/${goal.id}`}>{goal.objective}</Link><span className="tag">{goal.status}</span></li>)}</ul></section>}
  </Marketplace>;
}
