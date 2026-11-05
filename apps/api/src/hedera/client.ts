import { Client } from "@hiero-ledger/sdk";
import type { HederaConfig } from "../config/hedera.js";
import { getOperatorHbarBalance } from "./account.js";

export function createHederaClient(config: HederaConfig) {
  const client = Client.forTestnet({ scheduleNetworkUpdate: false });
  try {
    const { hostname, port, origin } = config.mirrorNodeUrl;
    client.setMirrorNetwork(`${hostname}:${port || "443"}`);
    if (new URL(client.mirrorRestApiBaseUrl).origin !== origin) {
      throw new Error("Unsupported HTTPS Mirror Node origin");
    }
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
