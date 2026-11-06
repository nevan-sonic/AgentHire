import Link from "next/link";
import { JobsList } from "../job-workspace";
import { Marketplace } from "../marketplace";

export default function Jobs() {
  return <Marketplace><p className="eyebrow">Procurement history</p><h1>My Jobs</h1>
    <Link className="button primary-link" href="/jobs/new">Create a Job ↗</Link>
    <section className="section"><JobsList /></section>
  </Marketplace>;
}
