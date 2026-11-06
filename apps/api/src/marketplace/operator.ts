import { requestResourceQuote, SpendingPolicy } from "../agents/payer.js";
import { capabilityDigest, parseCapabilityRequest } from "../x402/capability-binding.js";
import { DEMO_MERCHANT } from "../agents/workers.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUDIT_TOPIC } from "../audit/completed-procurement.js";
import { X402_ASSET, X402_FEE_PAYER, X402_MAX_FEE, X402_NETWORK } from "../x402/config.js";
import { validPayer } from "../x402/protocol.js";
import { inspectLiveInfrastructure } from "./live.js";
import { JobStore } from "./store.js";

try {
  try { process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const [command, value] = process.argv.slice(2);
  if (command === "authorize" && value) {
    const policy = JSON.parse(await readFile(value, "utf8"));
    const token = process.env.MARKETPLACE_OPERATOR_TOKEN;
    if (typeof token !== "string" || token.length < 32 || !/^[0-9a-f-]{36}$/.test(policy.jobId)) throw new Error();
    const port = Number(process.env.API_PORT ?? "3001");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    const response = await fetch(`http://localhost:${port}/api/marketplace/jobs/${policy.jobId}/authorize`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(policy),
    });
    if (!response.ok) throw new Error();
    console.log(JSON.stringify(await response.json(), null, 2));
  } else if (command === "preflight" && value && /^[0-9a-f-]{36}$/.test(value)) {
    const store = new JobStore(fileURLToPath(new URL("../../../../.agenthire-marketplace/jobs.sqlite", import.meta.url)));
    try {
      const job = store.job(value);
      const events = store.events(value);
      const payer = process.env.X402_PAYER_ID;
      const merchant = process.env.X402_MERCHANT_ID ?? DEMO_MERCHANT;
      if (!job || job.status !== "awaiting_authorization" || !merchant || !payer || !validPayer(payer, merchant) ||
          events.some(row => /^(authorization\.granted|payment\.|audit\.)/.test(row.kind))) throw new Error();
      const { payerBalance, operatorBalance, topicHead } = await inspectLiveInfrastructure(job.id, payer, process.env);
      const plan = events.filter(row => row.kind === "authorization.required").at(-1)?.data;
      const decision = events.filter(row => row.kind === "pocp.evaluated").at(-1)?.data;
      const bids = events.filter(row => row.kind === "bid.received").map(row => row.data);
      const workers = events.filter(row => row.kind === "worker.discovered").map(row => row.data.id);
      if (!plan?.planHash || !decision) throw new Error();
      const valuation = decision.valuations.find((row: { workerId: string }) => row.workerId === plan.test?.workerId);
      const branchIds = plan.test ? [valuation?.pass?.workerId, valuation?.fail?.workerId] : [plan.projectedHire.workerId];
      const selected = bids.filter(row => branchIds.includes(row.bid.workerId));
      if (!selected.length || branchIds.some((id: string) => !selected.some(row => row.bid.workerId === id))) throw new Error();
      const quoteChecks = selected.map(row => ({ phase: "hire", endpoint: row.bid.endpoint, workerId: row.bid.workerId,
        amount: row.bid.priceTinybars, input: job.task.input }));
      if (plan.test) {
        const row = bids.find(row => row.bid.workerId === plan.test.workerId);
        if (!row) throw new Error();
        quoteChecks.unshift({ phase: "test", endpoint: row.testEndpoint, workerId: row.bid.workerId,
          amount: row.testPrice, input: plan.test.input });
      }
      const quotes = await Promise.all(quoteChecks.map(async ({ phase, endpoint, workerId, amount, input }) => {
        const request = parseCapabilityRequest({ taskId: job.id, testId: `${job.id}-${workerId}-statistics-v1`,
          workerId, capability: job.task.capability, input });
        if (!request) throw new Error();
        const cap = BigInt(amount);
        const { requirement } = await requestResourceQuote(new SpendingPolicy(endpoint, merchant, cap, cap), request);
        if (requirement.amount !== amount || requirement.extra?.capabilityRequest !== capabilityDigest(request)) throw new Error();
        return { phase, endpoint, workerId, amount };
      }));
      const count = bids.length + (plan.test ? 7 : 4);
      const maxAuditFee = String(count * 10_000_000);
      if (BigInt(payerBalance) < BigInt(job.task.maxBudgetTinybars) || BigInt(operatorBalance) < BigInt(maxAuditFee)) throw new Error();
      console.log(JSON.stringify({ job, workers, bids, decision, plan, quotes, payer, merchant, payerBalance, operatorBalance,
        network: X402_NETWORK, asset: X402_ASSET, feePayer: X402_FEE_PAYER, maxSponsoredFee: X402_MAX_FEE.toString(),
        topic: AUDIT_TOPIC, topicHead, maxAuditMessages: count, maxAuditFee, previousPayment: false }, null, 2));
    } finally { store.close(); }
  } else {
    throw new Error();
  }
} catch {
  console.error("Marketplace command stopped. Check the job, local configuration, trusted journals, and policy.");
  process.exitCode = 1;
}
