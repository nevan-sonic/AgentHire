"use client";

import { useEffect, useState } from "react";
import type { GoalStep, MissionEnvelope } from "@agenthire/shared";

type Event = { id: number; kind: string; at: string; detail: { reason?: string } };
type Artifact = { id: string; missionId: string; type: string; content: unknown; hash: string; verification: string };
type Goal = { objective: string; deliverable: string; status: string; rootMissionId: string;
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
        <p>Blockchain spending allowance <strong>0 tinybars</strong></p>
        <ol className="activity">{goal.events.map(event => <li key={event.id}>
          <strong>{event.kind}</strong>{event.detail.reason && <p role="alert">{event.detail.reason}</p>}
        </li>)}</ol>
      </section>
    </div>
  </>;
}
