import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

export type ClaimPayment = (transactionId: string) => Promise<boolean>;

export function postgresPaymentClaims(connectionString: string): ClaimPayment {
  const sql = neon(connectionString);
  return async transactionId => {
    const hash = createHash("sha256").update(transactionId).digest("hex");
    const rows = await sql`
      INSERT INTO agenthire_payment_claims (transaction_hash)
      VALUES (${hash})
      ON CONFLICT (transaction_hash) DO NOTHING
      RETURNING transaction_hash
    `;
    return rows.length === 1;
  };
}

export function filePaymentClaims(directory: string): ClaimPayment {
  return async (transactionId) => {
    await mkdir(directory, { recursive: true });
    const name = createHash("sha256").update(transactionId).digest("hex");
    try {
      const claim = await open(join(directory, name), "wx", 0o600);
      await claim.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };
}
