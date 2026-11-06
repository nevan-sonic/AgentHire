"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Marketplace } from "../../marketplace";

export default function NewJob() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState("preview");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const input: unknown = JSON.parse(String(form.get("input")));
      if (!Array.isArray(input) || input.length < 1 || input.length > 100 ||
          input.some(value => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e9)) {
        throw new Error("Enter a JSON array with 1–100 finite numbers between −1 billion and 1 billion.");
      }
      const payload = { ...Object.fromEntries(form), input, mode };
      const response = await fetch("/api/marketplace/jobs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Job creation failed.");
      router.push(`/jobs/${result.id}`);
    } catch (failure) {
      setError(failure instanceof SyntaxError ? "Use JSON array syntax, for example [2,4,6,8]."
        : failure instanceof Error ? failure.message : "Job creation failed.");
      setPending(false);
    }
  }
  return <Marketplace><p className="eyebrow">New procurement</p><h1>Create a job</h1>
    <form className="panel job-form" onSubmit={submit}>
      <label>Job title<input name="title" required maxLength={100} placeholder="Summarize sensor readings" /></label>
      <label>Capability<select name="capability"><option value="statistics.summary">Statistics summary</option></select></label>
      <label>Input dataset<textarea name="input" rows={4} required placeholder="[10,20,30,40,50]" /></label>
      <div className="two">
        <label>Maximum budget (tinybars)<input name="budget" type="number" min={1} max={10000000} defaultValue={1000000} required /></label>
        <label>Failure penalty (tinybars)<input name="penalty" type="number" min={0} max={10000000} defaultValue={450000} required /></label>
      </div>
      <label>Maximum capability-test spending (tinybars)<input name="maxTest" type="number" min={0} max={10000000} defaultValue={5000} required /></label>
      <label>Execution mode<select name="mode" value={mode} onChange={event => setMode(event.target.value)}>
        <option value="preview">Preview · plan only</option><option value="live">Live testnet · authorization required</option>
      </select></label>
      <p className="muted">{mode === "live" ? "Real testnet HBAR may be spent after the operator separately authorizes the job, payment limits, and HCS fee budget."
        : "Preview discovers workers, requests bids, and calculates a payment plan without signing or executing protected tasks."}</p>
      {error && <p role="alert" className="tag fail">{error}</p>}
      <button className="primary" disabled={pending}>{pending ? "Creating…" : "Start Job"}</button>
    </form>
  </Marketplace>;
}
