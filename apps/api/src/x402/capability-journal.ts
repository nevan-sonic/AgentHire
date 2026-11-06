import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

export type PaymentState = "planned" | "quoted" | "authorized" | "submitted" | "settled" | "verified" | "failed" | "uncertain";
export type JournalEntry = { state: PaymentState; transactionId?: string };
export type OpenAttempt = (taskId: string, payer: string) => Promise<(entry: JournalEntry) => Promise<void>>;

export function fileCapabilityJournal(directory: string): OpenAttempt {
  return async (taskId, payer) => {
    await mkdir(directory, { recursive: true });
    const identity = createHash("sha256").update(taskId).digest("hex");
    const path = join(directory, `pocp-${identity}.jsonl`);
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A capability payment attempt already exists. Reconcile its journal before proceeding.");
      }
      throw error;
    }
    return async (entry) => {
      const handle = await open(path, "a", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ taskId, payer, ...entry }) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
    };
  };
}
