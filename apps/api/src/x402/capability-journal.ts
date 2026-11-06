import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

export type PaymentState = "planned" | "quoted" | "authorized" | "submitted" | "settled" | "verified" | "failed" | "uncertain";
export type JournalEntry = { state: PaymentState; transactionId?: string; detail?: object };
export type OpenAttempt = (taskId: string, payer: string) => Promise<(entry: JournalEntry) => Promise<void>>;

function attemptPath(directory: string, taskId: string, operation: "pocp" | "hire") {
  return join(directory, `${operation}-${createHash("sha256").update(taskId).digest("hex")}.jsonl`);
}

export async function readAttempt(directory: string, taskId: string, operation: "pocp" | "hire") {
  try {
    const contents = await readFile(attemptPath(directory, taskId, operation), "utf8");
    return contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function fileCapabilityJournal(directory: string, operation: "pocp" | "hire" = "pocp"): OpenAttempt {
  return async (taskId, payer) => {
    await mkdir(directory, { recursive: true });
    const path = attemptPath(directory, taskId, operation);
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A payment attempt already exists. Reconcile its journal before proceeding.");
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
