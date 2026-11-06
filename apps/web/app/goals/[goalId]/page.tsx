import { Marketplace } from "../../marketplace";
import { GoalWorkspace } from "../workspace";

export default async function GoalPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  return <Marketplace><GoalWorkspace id={goalId} /></Marketplace>;
}
