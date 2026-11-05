import { MirrorNodeAccountBalanceQuery } from "@hiero-ledger/sdk";
import type { AccountId, Client } from "@hiero-ledger/sdk";

export async function getOperatorHbarBalance(client: Client, operatorAccountId: AccountId) {
  const balance = await new MirrorNodeAccountBalanceQuery()
    .setAccountId(operatorAccountId)
    .execute(client, 5_000);

  const tinybars = balance.hbars.toTinybars().toString().padStart(9, "0");
  return `${tinybars.slice(0, -8)}.${tinybars.slice(-8)}`;
}
