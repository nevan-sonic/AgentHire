import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEvent } from "../hedera/audit-event.js";

export type PublicationEntry = {
  eventId: string; payloadHash: string; feeCapTinybars: string;
  status: "prepared" | "submitting" | "submitted" | "verified" | "uncertain";
  transactionId?: string; sequenceNumber?: string; consensusTimestamp?: string;
  transactionConfirmed?: boolean;
};

export function publicationJournal(directory: string) {
  const path = (event: AuditEvent) => {
    if (!/^[a-f0-9]{64}$/.test(event.eventId)) throw new Error("Invalid publication identity");
    return join(directory, `hcs-audit-${event.eventId}.jsonl`);
  };
  async function persist(event: AuditEvent, entry: PublicationEntry, flag: "wx" | "a") {
    const handle = await open(path(event), flag, 0o600);
    try {
      await handle.writeFile(JSON.stringify(entry) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return {
    async read(event: AuditEvent): Promise<PublicationEntry | null> {
      let data: string;
      try {
        data = await readFile(path(event), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      const entries: PublicationEntry[] = data.trim().split("\n").map((line) => JSON.parse(line));
      const entry = entries.at(-1);
      if (!entry || entries[0].status !== "prepared" || entries.some((row) =>
        row.eventId !== event.eventId || row.payloadHash !== event.payloadHash ||
        !/^[1-9]\d{0,7}$/.test(row.feeCapTinybars) || row.feeCapTinybars !== entry.feeCapTinybars ||
        !["prepared", "submitting", "submitted", "verified", "uncertain"].includes(row.status))) {
        throw new Error("Invalid or conflicting publication journal");
      }
      return entry;
    },
    async claim(event: AuditEvent, feeCapTinybars: string) {
      await mkdir(directory, { recursive: true });
      await persist(event, { eventId: event.eventId, payloadHash: event.payloadHash, feeCapTinybars, status: "prepared" }, "wx");
    },
    async write(event: AuditEvent, entry: PublicationEntry) { await persist(event, entry, "a"); },
  };
}
