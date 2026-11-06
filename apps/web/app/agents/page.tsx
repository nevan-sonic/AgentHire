import { AgentList } from "../agent-list";
import { Marketplace } from "../marketplace";

export default function Agents() {
  return <Marketplace><p className="eyebrow">Marketplace</p><h1>Worker agents</h1>
    <p className="muted">Capability filter <code>statistics.summary</code> · First-party worker agents</p>
    <AgentList />
  </Marketplace>;
}
