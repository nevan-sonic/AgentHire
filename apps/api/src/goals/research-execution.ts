import { createPayerSigner, payForResource, SpendingPolicy } from "../agents/payer.js";
import { isRecord } from "../agents/task.js";
import { inspectLiveInfrastructure } from "../marketplace/live.js";
import { digest } from "../marketplace/protocol.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { paymentExplorerUrl } from "../x402/protocol.js";
import { ResearchTools } from "./tools.js";
import type { Source } from "./tools.js";
import { bidFor } from "./research-plan.js";
import type { ResearchPlan, ResearchQuote } from "./research-plan.js";
import { paidResearchRequest, RESEARCH_BINDING, researchBinding, researchWorkers, testRepository } from "./research-protocol.js";
import type { ResearchLedger, ResearchScope } from "./research-ledger.js";

export function assertResearchPlanScope(plan: ResearchPlan, scope: ResearchScope) {
  const { planHash, ...unsigned } = plan;
  if (digest(unsigned) !== planHash) throw new Error("Reviewed research plan integrity mismatch");
  const test = plan.quotes.find(quote => quote.phase === "test");
  const maxHire = plan.quotes.filter(quote => quote.phase === "hire").reduce((max, quote) =>
    BigInt(quote.amount) > max ? BigInt(quote.amount) : max, 0n);
  if (scope.planHash !== plan.planHash || scope.goalId !== plan.task.goalId || scope.missionId !== plan.task.missionId ||
      scope.parentId !== plan.task.parentId || Date.now() >= Date.parse(scope.expiresAt) ||
      plan.quotes.some(quote => !scope.endpoints.includes(quote.endpoint) || !scope.merchants.includes(quote.merchant) ||
        BigInt(quote.amount) > BigInt(scope.maxPerPayment) || Date.now() >= Date.parse(bidFor(plan, quote).expiresAt)) ||
      BigInt(test?.amount ?? "0") > BigInt(scope.maxTest) || maxHire > BigInt(scope.maxHire) ||
      BigInt(test?.amount ?? "0") + maxHire > BigInt(scope.childAllocation) || scope.maxPayments < (test ? 2 : 1)) {
    throw new Error("Delegated scope does not cover the reviewed payment branches");
  }
}

class ResearchVerificationUnavailable extends Error {}

export async function verifyResearchOutput(value: unknown, intentId: string, quote: ResearchQuote, count: number, tools: ResearchTools, queries: readonly string[] = []) {
  if (!isRecord(value) || value.intentId !== intentId || value.workerId !== quote.workerId || !Array.isArray(value.sources) ||
      value.sources.length !== count) throw new Error("Invalid paid research artifact");
  const candidates = new Set<string>();
  if (quote.phase === "hire" && queries.length) {
    const worker = researchWorkers.find(worker => worker.id === quote.workerId);
    if (!worker) throw new Error("Unknown research strategy");
    for (const query of queries.slice(0, worker.searches)) {
      const found = await tools.dispatch("github.search", query, ["github.search"]).catch(() => { throw new ResearchVerificationUnavailable(); });
      if (!Array.isArray(found)) throw new ResearchVerificationUnavailable();
      for (const name of found) candidates.add(name);
    }
  }
  const names = new Set<string>();
  return Promise.all(value.sources.map(async (source: unknown): Promise<Source> => {
    if (!isRecord(source) || typeof source.repository !== "string" ||
        (quote.phase === "test" && source.repository !== testRepository) ||
        (quote.phase === "hire" && queries.length > 0 && !candidates.has(source.repository)) || names.has(source.repository) ||
        typeof source.retrievedAt !== "string" || !Number.isFinite(Date.parse(source.retrievedAt)) ||
        Date.parse(source.retrievedAt) > Date.now() + 30_000 || Date.parse(source.retrievedAt) < Date.now() - 600_000) {
      throw new Error("Invalid source identity");
    }
    names.add(source.repository);
    const independent = await tools.dispatch("github.read", source.repository, ["github.read"]).catch(() => { throw new ResearchVerificationUnavailable(); });
    if (Array.isArray(independent) || independent.id !== source.id || independent.url !== source.url ||
        independent.excerpt !== source.excerpt) throw new Error("Paid source does not match independent retrieval");
    return { ...independent, retrievedAt: source.retrievedAt };
  }));
}

const dependencies = { inspectLiveInfrastructure, payForResource, reconcilePayment, tools: () => new ResearchTools() };
export async function executePaidResearch(plan: ResearchPlan, scope: ResearchScope, ledger: ResearchLedger,
  env: NodeJS.ProcessEnv, save: (kind: string, detail?: object) => void, deps: typeof dependencies = dependencies) {
  assertResearchPlanScope(plan, scope);
  if (ledger.intents(scope.goalId).length) throw new Error("Existing research intent requires reconciliation");
  const infrastructure = await deps.inspectLiveInfrastructure(scope.goalId, scope.payer, env);
  if (BigInt(infrastructure.payerBalance) < BigInt(scope.childAllocation) ||
      BigInt(infrastructure.operatorBalance) < BigInt(scope.maxAuditFee)) throw new Error("Insufficient testnet balance");
  const { key, config } = infrastructure;
  const sign = createPayerSigner(scope.payer, key);

  async function purchase(quote: ResearchQuote) {
    assertResearchPlanScope(plan, scope);
    const bid = bidFor(plan, quote);
    const request = paidResearchRequest(plan.task, bid, quote.phase);
    const requestDigest = digest(request);
    const id = request.intentId;
    const amount = BigInt(quote.amount);
    const policy = new SpendingPolicy(quote.endpoint, quote.merchant, amount, amount);
    const publicPayment = { id, worker: quote.workerId, phase: quote.phase, buyer: "lead-research",
      goalId: scope.goalId, parentId: scope.parentId, missionId: scope.missionId, payer: scope.payer, merchant: quote.merchant, amount: quote.amount };
    let transactionId: string | undefined;
    let reserved = false;
    let settled = false;
    async function reconcile() {
      if (!transactionId) throw new Error("Payment transaction not recorded");
      const evidence = await deps.reconcilePayment(config.mirrorNodeUrl, { transactionId, payer: scope.payer,
        merchant: quote.merchant, amountTinybars: quote.amount });
      if (evidence.status !== "verified") throw new Error("Research settlement requires reconciliation");
      ledger.mark(id, ["submitted", "uncertain"], "settled", { transactionId, fee: evidence.feeTinybars });
      settled = true;
      save("research.payment.verified", { ...publicPayment, transactionId, explorer: paymentExplorerUrl(transactionId), ...evidence });
    }
    try {
      const result = await deps.payForResource(policy, request, scope.payer, async challenge => {
        assertResearchPlanScope(plan, scope);
        const payload = await sign(challenge);
        const transaction = payload.payload.transaction;
        if (typeof transaction !== "string") throw new Error("Invalid signed payment");
        return { ...payload, extensions: { ...payload.extensions, [RESEARCH_BINDING]:
          Buffer.from(key.sign(researchBinding(requestDigest, quote.endpoint, quote.amount, quote.merchant, transaction))).toString("hex") } };
      }, {
        timeoutMs: 70_000,
        async authorize(challenge) {
          assertResearchPlanScope(plan, scope);
          if (challenge.accepts[0].amount !== quote.amount || challenge.accepts[0].extra?.researchRequest !== requestDigest) {
            throw new Error("Research quote changed");
          }
          ledger.reserve(scope, { id, phase: quote.phase, amount: quote.amount, workerId: quote.workerId, merchant: quote.merchant },
            quote.endpoint, quote.merchant);
          reserved = true;
          save("research.payment.reserved", publicPayment);
        },
        async submitted(tx) {
          assertResearchPlanScope(plan, scope);
          ledger.mark(id, ["reserved"], "submitted", { transactionId: tx });
          transactionId = tx;
          save("research.payment.submitted", { ...publicPayment, transactionId: tx, explorer: paymentExplorerUrl(tx) });
        },
        async settled(tx) { save("research.payment.facilitator_confirmed", { ...publicPayment, transactionId: tx }); },
      });
      await reconcile();
      const sources = await verifyResearchOutput(result.worker, id, quote, quote.phase === "test" ? 1 : plan.task.sourceCount, deps.tools(), plan.task.queries);
      const evidenceHash = digest(sources);
      ledger.observe(quote.workerId, quote.phase, id, true, { ...publicPayment, transactionId, evidenceHash });
      save("research.observation", { ...publicPayment, passed: true, evidenceHash });
      return { passed: true as const, sources, worker: quote.workerId };
    } catch (error) {
      if (error instanceof ResearchVerificationUnavailable) {
        save("research.verification.unavailable", { ...publicPayment, transactionId });
        throw new Error("Paid research awaits independent source verification");
      }
      if (transactionId && !settled) {
        try { await reconcile(); }
        catch {
          ledger.mark(id, ["submitted"], "uncertain", { transactionId });
          save("research.payment.uncertain", { ...publicPayment, transactionId, explorer: paymentExplorerUrl(transactionId) });
          throw new Error("Research payment requires reconciliation; further purchases are blocked");
        }
      } else if (reserved && !transactionId) {
        ledger.mark(id, ["reserved"], "released");
        save("research.payment.released", publicPayment);
      }
      if (!settled) throw new Error("Research payment stopped before submission");
      const evidenceHash = digest([id, transactionId, "no_verified_artifact"]);
      ledger.observe(quote.workerId, quote.phase, id, false, { ...publicPayment, transactionId, evidenceHash });
      save("research.observation", { ...publicPayment, passed: false, evidenceHash });
      return { passed: false as const, sources: [], worker: quote.workerId };
    }
  }

  const test = plan.quotes.find(quote => quote.phase === "test");
  const observed = test ? await purchase(test) : null;
  const worker = observed?.passed === false ? plan.decision.branches.fail : plan.decision.branches.pass;
  const hire = plan.quotes.find(quote => quote.phase === "hire" && quote.workerId === worker);
  if (!hire) throw new Error("Selected branch is outside the reviewed plan");
  save("research.worker.selected", { worker, buyer: "lead-research", missionId: scope.missionId, basedOnProbe: observed !== null });
  const result = await purchase(hire);
  if (!result.passed) throw new Error("Paid research completed without a verified artifact");
  return result;
}
