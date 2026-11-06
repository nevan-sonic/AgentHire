"use client";

import { useEffect, useReducer } from "react";
import { initialReplay, replayReducer, stages } from "./replay-state";

export function Replay({ notes }: { notes: readonly string[] }) {
  const [state, dispatch] = useReducer(replayReducer, initialReplay);
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setTimeout(() => dispatch("tick"), 1400);
    return () => window.clearTimeout(timer);
  }, [state.playing, state.step]);

  return <section className="panel replay" aria-labelledby="replay-heading">
    <div className="replay-top">
      <div>
        <p className="eyebrow">Execution replay</p>
        <h2 id="replay-heading">Replay of verified testnet execution</h2>
        <p className="muted">Local playback of the completed run. No transactions are submitted.</p>
      </div>
      <button className="primary" onClick={() => dispatch("start")}>▷ Replay Procurement</button>
    </div>
    <div className="progress" aria-hidden="true">
      {stages.map((stage, index) => <span key={stage} data-active={index <= state.step} />)}
    </div>
    <p className="current" role="status"><span>{state.step + 1} / {stages.length}</span> {stages[state.step]} <small className="replay-note">{notes[state.step]}</small></p>
    <div className="actions">
      <button onClick={() => dispatch("play")} disabled={state.playing}>Play</button>
      <button onClick={() => dispatch("pause")} disabled={!state.playing}>Pause</button>
      <button onClick={() => dispatch("reset")}>Reset</button>
      <button onClick={() => dispatch("step")} disabled={state.step === stages.length - 1}>Step forward</button>
      <a className="button" href="#proof">View On-Chain Proof ↗</a>
    </div>
  </section>;
}
