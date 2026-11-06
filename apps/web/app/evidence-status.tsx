"use client";

import { useEffect, useState } from "react";

export function EvidenceStatus({ task, manifest }: { task: string; manifest: string }) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  const [status, setStatus] = useState<"recorded" | "checking" | "verified" | "unavailable">(base ? "checking" : "recorded");
  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    let active = true;
    async function check() {
      try {
        const url = new URL(`/api/demo/procurement/${task}`, base);
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Evidence unavailable");
        const evidence = await response.json();
        if (evidence.status !== "verified" || evidence.task !== task || evidence.manifest !== manifest ||
            evidence.payments?.length !== 2 || evidence.audit?.length !== 8 ||
            ![...evidence.payments, ...evidence.audit].every(row => row.status === "verified")) {
          throw new Error("Evidence mismatch");
        }
        if (active) setStatus("verified");
      } catch {
        if (active) setStatus("unavailable");
      } finally {
        window.clearTimeout(timer);
      }
    }
    void check();
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [base, manifest, task]);
  if (status === "recorded") return null;
  return <span role="status" className="tag">
    {status === "checking" ? "Checking read-only evidence…" :
      status === "verified" ? "Mirror Node recheck passed" : "Recheck unavailable · showing recorded evidence"}
  </span>;
}
