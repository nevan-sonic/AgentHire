import { JobWorkspace } from "../../job-workspace";
import { Marketplace } from "../../marketplace";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <Marketplace><JobWorkspace id={jobId} /></Marketplace>;
}
