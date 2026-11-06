import { createPublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";

export async function resolveAgentName(rpc: string | undefined, raw: string, endpoint: string, merchant: string, network = "mainnet") {
  if (network !== "mainnet" && network !== "sepolia") throw new Error("ENS_NETWORK must be mainnet or sepolia");
  const chain = network === "sepolia" ? sepolia : mainnet;
  if (!rpc || new URL(rpc).protocol !== "https:") throw new Error("ENS RPC is not configured");
  const name = normalize(raw);
  if (!name.endsWith(".eth")) throw new Error("Enter a valid .eth name");
  const client = createPublicClient({ chain, transport: http(rpc, { timeout: 4000, retryCount: 0 }), ccipRead: false });
  if (await client.getChainId() !== chain.id) throw new Error("ENS RPC is on the wrong network");
  const [address, registeredEndpoint, registeredMerchant] = await Promise.all([
    client.getEnsAddress({ name }), client.getEnsText({ name, key: "agenthire.endpoint" }),
    client.getEnsText({ name, key: "agenthire.hedera" }),
  ]);
  if (!address || registeredEndpoint !== endpoint || registeredMerchant !== merchant) throw new Error("ENS records do not match the agent");
  return { name, address };
}
