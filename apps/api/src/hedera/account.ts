import { AccountBalanceQuery } from "@hashgraph/sdk";
import type { AccountId, Client } from "@hashgraph/sdk";

export async function getOperatorHbarBalance(client: Client, operatorAccountId: AccountId) {
  const balance = await new AccountBalanceQuery()
    .setAccountId(operatorAccountId)
    .setMaxAttempts(1)
    .setGrpcDeadline(5_000)
    .execute(client, 5_000);

  const tinybars = balance.hbars.toTinybars().toString().padStart(9, "0");
  return `${tinybars.slice(0, -8)}.${tinybars.slice(-8)}`;
}
