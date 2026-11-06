import { reconcilePayment } from "../x402/reconcile.js";
import { fileURLToPath } from "node:url";
import { mkdir, open } from "node:fs/promises";
import Fastify from "fastify";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerPaidResource } from "../routes/x402-worker.js";
import { loadHederaMirrorNodeUrl } from "../config/hedera.js";
import { filePaymentClaims } from "../x402/replay.js";
import { lookupPayerAccount } from "../x402/capability-binding.js";
import { X402_FACILITATOR } from "../x402/config.js";
import { workerQuote } from "../x402/protocol.js";
import { digest } from "../marketplace/protocol.js";
import { isRecord } from "../agents/task.js";
import { ResearchTools } from "./tools.js";
import type { Source } from "./tools.js";
import { paidResearchRequest, parseResearchTask, RESEARCH_BINDING, researchBid, researchBinding, testRepository,
  verifyResearchBid, workerMerchant, workerOrigin } from "./research-protocol.js";
import type { ResearchTask, ResearchWorker } from "./research-protocol.js";

export async function retrieveResearch(worker: ResearchWorker, task: ResearchTask, tools: ResearchTools) {
  const allowed = ["github.search", "github.read"];
  const groups: string[][] = [];
  for (const query of task.queries.slice(0, worker.searches)) {
    const results = await tools.dispatch("github.search", query, allowed);
    if (!Array.isArray(results)) throw new Error("Invalid research search result");
    groups.push(results);
  }
  const names = [...new Set(Array.from({ length: 4 }, (_, index) => groups.map(group => group[index])).flat().filter(Boolean))];
  const found = await Promise.allSettled(names.slice(0, worker.reads).map(name => tools.dispatch("github.read", name, allowed)));
  const sources: Source[] = [];
  for (const result of found) {
    if (result.status === "fulfilled" && !Array.isArray(result.value) && !sources.some(item => item.id === (result.value as Source).id)) {
      sources.push(result.value);
    }
    if (sources.length === task.sourceCount) break;
  }
  if (sources.length !== task.sourceCount) throw new Error("Worker could not retrieve the required sources");
  return sources;
}

type WorkerDependencies = {
  facilitator?: Pick<HTTPFacilitatorClient, "verify" | "settle">;
  lookup?: typeof lookupPayerAccount;
  reconcile?: typeof reconcilePayment;
  claimPayment?: ReturnType<typeof filePaymentClaims>;
  claimIntent?: (id: string) => Promise<boolean>;
  tools?: () => ResearchTools;
};

export function createResearchWorker(worker: ResearchWorker, env: NodeJS.ProcessEnv, deps: WorkerDependencies = {}) {
  const app = Fastify({ bodyLimit: 4096 });
  const merchant = workerMerchant(worker, env);
  const base = workerOrigin(worker);
  const facilitator = deps.facilitator ?? new HTTPFacilitatorClient({ url: X402_FACILITATOR, timeoutMs: 12_000 });
  const mirror = loadHederaMirrorNodeUrl(env);
  const payer = env.X402_PAYER_ID;
  const directory = fileURLToPath(new URL("../../../../.agenthire-x402/", import.meta.url));
  const claimPayment = deps.claimPayment ?? filePaymentClaims(directory);
  app.get("/agent", async () => ({ id: worker.id, label: worker.label, merchant, capability: "web.research",
    capabilities: worker.id === "quick-research" ? ["web.research", "web.source_collection"] :
      ["web.research", "web.deep_research", "web.comparison"], base, firstParty: true }));
  app.get("/health", async () => ({ status: "ok", id: worker.id }));
  app.post("/bid", async (request, reply) => {
    try { return researchBid(worker, parseResearchTask(request.body), merchant, new Date(Date.now() + 600_000).toISOString()); }
    catch { return reply.code(400).send({ error: "Invalid research task" }); }
  });
  for (const phase of ["test", "hire"] as const) {
    const path = phase === "test" ? "/capability-test" : "/execute";
    const endpoint = base + path;
    registerPaidResource(app, { endpoint, merchant, facilitator, path, async claimPayment(id) {
      return claimPayment(id);
    } }, {
      prepare(input) {
        try {
          if (!isRecord(input) || input.phase !== phase || Object.keys(input).length !== 4) return null;
          const task = parseResearchTask(input.task);
          const bid = verifyResearchBid(input.bid, worker, task, merchant);
          const request = paidResearchRequest(task, bid, phase);
          if (input.intentId !== request.intentId) return null;
          const requestDigest = digest(request);
          const amount = phase === "test" ? bid.testPrice : bid.priceTinybars;
          const quote = workerQuote(endpoint, merchant, amount);
          quote.accepts[0].extra = { ...quote.accepts[0].extra, researchRequest: requestDigest };
          return { quote, async verifyBinding(payload, payingAccount) {
            if (!payer || payingAccount !== payer || Date.now() >= Date.parse(bid.expiresAt)) return false;
            const signature = payload.extensions?.[RESEARCH_BINDING];
            const transaction = payload.payload.transaction;
            if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature) || typeof transaction !== "string" ||
                payload.accepted.extra?.researchRequest !== requestDigest) return false;
            const { publicKey } = await (deps.lookup ?? lookupPayerAccount)(mirror, payingAccount);
            return publicKey.verify(researchBinding(requestDigest, endpoint, amount, merchant, transaction), Buffer.from(signature, "hex"));
          }, async verifySettlement(transactionId, payer) {
            return (await (deps.reconcile ?? reconcilePayment)(mirror, { transactionId, payer, merchant, amountTinybars: amount })).status === "verified";
          }, async claimIntent() {
            if (Date.now() >= Date.parse(bid.expiresAt)) return false;
            if (deps.claimIntent) return deps.claimIntent(request.intentId);
            try {
              await mkdir(directory, { recursive: true });
              const file = await open(directory + "research-" + request.intentId, "wx", 0o600);
              await file.close();
              return true;
            } catch { return false; }
          }, async execute() {
            const tools = deps.tools?.() ?? new ResearchTools();
            const sources = phase === "test" ? [await tools.dispatch("github.read", testRepository, ["github.read"])]
              : await retrieveResearch(worker, task, tools);
            return { intentId: request.intentId, workerId: worker.id, sources };
          } };
        } catch { return null; }
      },
    });
  }
  return app;
}
