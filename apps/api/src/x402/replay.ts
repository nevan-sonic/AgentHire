import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

export type ClaimPayment = (transactionId: string) => Promise<boolean>;

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
