"use client";

import { useEffect, useState } from "react";

type Receipt = { title: string; at: string; data: { transactionId: string; amount: string; worker?: string; payer?: string;
  merchant?: string; consensusTimestamp: string } };

export function useVerifiedReceipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [status, setStatus] = useState("Loading verified receipts…");
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    Promise.all(["jobs", "goals"].map(async source => {
      const response = await fetch("/api/marketplace/receipts/" + source, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Receipts unavailable");
      return await response.json() as Receipt[];
    })).then(groups => {
      const rows = groups.flat().filter(row => /^\d+\.\d+\.\d+@\d+\.\d{9}$/.test(row.data.transactionId) && /^\d+$/.test(row.data.amount));
      setReceipts(rows.sort((a, b) => b.at.localeCompare(a.at)));
      setStatus(rows.length ? "" : "No independently verified payments in saved jobs or goals.");
    }).catch(() => { if (!controller.signal.aborted) setStatus("Verified receipts could not be loaded."); });
    return () => controller.abort();
  }, []);
  return { receipts, status };
}
