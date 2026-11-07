export function openTaskStream(body: { prompt: string; targetCapability?: string; fileName?: string; fileContent?: string; maxBudgetTinybars?: string }) {
  const events = new EventTarget();
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch("/api/orchestrator/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? "Specialist service unavailable");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      try {
        while (!finished) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += chunk.value;
          if (buffer.length > 262144) throw new Error("Specialist response exceeded the stream limit");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const name = /^event: (log|done|error)$/m.exec(frame)?.[1];
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (name && data) events.dispatchEvent(new MessageEvent(name, { data }));
            if (name === "done" || name === "error") finished = true;
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!finished && !controller.signal.aborted) throw new Error("Specialist stream ended without a result");
    } catch (error) {
      if (!controller.signal.aborted) events.dispatchEvent(new MessageEvent("error", {
        data: JSON.stringify({ error: error instanceof Error ? error.message : "Specialist service unavailable" }),
      }));
    }
  })();
  return { addEventListener: events.addEventListener.bind(events), close: () => controller.abort() };
}
