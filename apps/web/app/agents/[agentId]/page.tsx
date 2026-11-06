import { AgentList } from "../../agent-list";
import { Marketplace } from "../../marketplace";

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <Marketplace><p className="eyebrow">Worker profile</p><h1>Agent details</h1><AgentList id={agentId} /></Marketplace>;
}
