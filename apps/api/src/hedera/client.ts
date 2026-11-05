import { Client } from "@hashgraph/sdk";
import type { HederaConfig } from "../config/hedera.js";
import { getOperatorHbarBalance } from "./account.js";

export function createHederaClient(config: HederaConfig) {
  const client = Client.forTestnet({ scheduleNetworkUpdate: false });
  try {
    client.setOperator(config.operatorAccountId, config.operatorKey);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function createHederaConnection(config: HederaConfig) {
  const client = createHederaClient(config);
  const { operatorAccountId } = config;
  return {
    getBalance: () => getOperatorHbarBalance(client, operatorAccountId),
    close: () => client.close(),
  };
}
