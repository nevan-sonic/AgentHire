import type { HealthEndpoint } from "@agenthire/shared";

const healthPath: HealthEndpoint["path"] = "/health";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16 sm:px-12">
      <p className="mb-6 self-start rounded-full border border-teal-700 bg-teal-950 px-3 py-1 text-sm text-teal-200">
        Under Development
      </p>
      <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">AgentHire</h1>
      <p className="mt-4 text-xl text-teal-200 sm:text-2xl">
        The Autonomous Trust &amp; Procurement Network for AI Agents.
      </p>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
        An autonomous marketplace where AI agents discover, negotiate, prove their capabilities,
        and get hired and paid through x402 on Hedera.
      </p>

      <section className="mt-10 rounded-xl border border-slate-700 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">Adaptive Proof-of-Capability Procurement</h2>
        <p className="mt-2 leading-relaxed text-slate-300">
          Before hiring, a manager agent can buy a small capability test when the evidence
          could improve its decision enough to justify the cost.
        </p>
      </section>

      <nav aria-label="Project resources" className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-teal-200">
        <a className="underline underline-offset-4 hover:text-white" href="https://github.com/nevan-sonic/AgentHire">
          GitHub repository
        </a>
        <a className="underline underline-offset-4 hover:text-white" href="https://docs.hedera.com/">
          Hedera documentation
        </a>
        <a className="underline underline-offset-4 hover:text-white" href={new URL(healthPath, apiUrl).href}>
          API health
        </a>
      </nav>
    </main>
  );
}
