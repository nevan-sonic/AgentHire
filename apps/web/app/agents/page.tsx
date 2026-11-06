import { AgentList } from "../agent-list";
import { Marketplace } from "../marketplace";

export default function Agents() {
  return <Marketplace><p className="eyebrow">Marketplace</p><h1>Worker agents</h1>
    <p className="muted">Live registered autonomous workers · Hedera testnet x402 endpoints</p>
    <AgentList />
  </Marketplace>;
}
