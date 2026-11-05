import { HBAR_ASSET_ID, HEDERA_TESTNET_CAIP2 } from "@x402/hedera";
import { parseHederaAccountId } from "../config/hedera.js";

export const X402_NETWORK = HEDERA_TESTNET_CAIP2;
export const X402_ASSET = HBAR_ASSET_ID;
export const X402_FACILITATOR = "https://x402.org/facilitator";
export const X402_FEE_PAYER = "0.0.9185802";
export const X402_PRICE = "1000000";
export const X402_MAX_FEE = 100_000_000n;
export const WORKER_PATH = "/api/workers/analyze";
export const QUOTE_TIMEOUT_SECONDS = 120;

export function loadX402Config(env: NodeJS.ProcessEnv, port: number) {
  if ((env.HEDERA_NETWORK?.trim() ?? "testnet") !== "testnet") {
    throw new Error("The x402 demo requires Hedera testnet");
  }
  const merchant = parseHederaAccountId(env.X402_MERCHANT_ID?.trim() ?? "", "X402_MERCHANT_ID").toString();
  if (merchant === X402_FEE_PAYER || merchant === "0.0.0") {
    throw new Error("Configure a separate, nonzero x402 merchant account");
  }
  return { merchant, endpoint: `http://localhost:${port}${WORKER_PATH}` };
}
