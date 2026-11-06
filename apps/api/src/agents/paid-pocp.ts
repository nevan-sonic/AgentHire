import type { PrivateKey } from "@hiero-ledger/sdk";
import type { ProcurementTask } from "@agenthire/shared";
import { bindingBytes, CAPABILITY_EXTENSION, CAPABILITY_PATH, capabilityDigest } from "../x402/capability-binding.js";
import type { CapabilityRequest } from "../x402/capability-binding.js";
import type { OpenAttempt } from "../x402/capability-journal.js";
import { X402_ASSET, X402_NETWORK } from "../x402/config.js";
import { paymentExplorerUrl } from "../x402/protocol.js";
import { reconcilePayment } from "../x402/reconcile.js";
import { evaluateCapabilityTest } from "./capability-tests.js";
import { procure } from "./manager.js";
import { createPayerSigner, payForResource, PaymentAttemptError, SpendingPolicy } from "./payer.js";
import type { PaidTestResult } from "./pocp.js";
import { integerIn, isRecord, tinybars } from "./task.js";
import type { WorkerRegistry } from "./workers.js";

export type CapabilityAuthorization = {
  payer: string; taskId: string; workerId: string; testId: string; requestDigest: string;
  endpoint: string; merchant: string; network: typeof X402_NETWORK; asset: typeof X402_ASSET;
  amountTinybars: string; maxTotalTinybars: string; finalHireReserveTinybars: string; expiresAt: string;
};

export async function executePaidPocp(task: ProcurementTask, registry: WorkerRegistry, options: {
  enabled: boolean; authorization: CapabilityAuthorization; key: PrivateKey; mirror: URL; openAttempt: OpenAttempt;
  now?: () => number;
}) {
  if (!options.enabled || task.selectionStrategy !== "adaptive_pocp") {
    throw new Error("Live PoCP requires server-side enablement and the adaptive strategy");
  }
  const { authorization: auth, key, mirror, openAttempt } = options;
  const now = options.now ?? Date.now;
  return procure(task, registry, {
    now, paymentEnabled: true,
    paidTestExecutor: {
      overheadMs: 15_000,
      async run(test, bid, requiredReserve): Promise<PaidTestResult> {
        const request: CapabilityRequest = {
          taskId: test.taskId, testId: test.testId, workerId: test.workerId,
          capability: test.capability, input: [...test.input],
        };
        const endpoint = new URL(CAPABILITY_PATH, bid.endpoint).href;
        const expiry = Date.parse(auth.expiresAt);
        const approved = () => Number.isFinite(expiry) && new Date(expiry).toISOString() === auth.expiresAt && now() < expiry &&
          Date.parse(bid.expiresAt) > now() &&
          auth.taskId === test.taskId && auth.testId === test.testId && auth.workerId === test.workerId &&
          auth.requestDigest === capabilityDigest(request) &&
          auth.endpoint === endpoint && auth.merchant === bid.merchant &&
          auth.network === bid.network && auth.asset === bid.asset && auth.amountTinybars === test.priceTinybars &&
          tinybars(auth.maxTotalTinybars) && tinybars(auth.finalHireReserveTinybars) &&
          tinybars(auth.amountTinybars) && auth.amountTinybars !== "0" &&
          BigInt(auth.finalHireReserveTinybars) >= requiredReserve &&
          BigInt(task.maxBudgetTinybars) <= BigInt(auth.maxTotalTinybars) &&
          BigInt(auth.finalHireReserveTinybars) + BigInt(auth.amountTinybars) <= BigInt(task.maxBudgetTinybars) &&
          BigInt(auth.finalHireReserveTinybars) + BigInt(auth.amountTinybars) <= BigInt(auth.maxTotalTinybars);

        const fail = (reason: string): PaidTestResult =>
          ({ state: "failed", spentTinybars: "0", reservedTinybars: "0", result: null, reason });
        if (!approved()) return fail("authorization_or_final_hire_reserve_rejected");
        let record: Awaited<ReturnType<OpenAttempt>>;
        try {
          record = await openAttempt(test.taskId, auth.payer);
          await record({ state: "planned" });
        } catch {
          // A prior process may have submitted before crashing. Protect the reservation.
          return { state: "uncertain", spentTinybars: "0", reservedTinybars: test.priceTinybars,
            result: null, reason: "attempt_exists_or_journal_unavailable" };
        }

        const price = BigInt(test.priceTinybars);
        const policy = new SpendingPolicy(endpoint, bid.merchant, price, price);
        const sign = createPayerSigner(auth.payer, key);
        let transactionId: string | undefined;
        let settled = false;
        let output: unknown;
        let failure: "failed" | "uncertain" = "failed";
        try {
          const response = await payForResource(policy, request, auth.payer, async (quote) => {
            if (!approved()) throw new Error("Authorization expired");
            const payload = await sign(quote);
            const transaction = payload.payload.transaction;
            if (typeof transaction !== "string") throw new Error("Missing signed transaction");
            return { ...payload, extensions: { ...payload.extensions, [CAPABILITY_EXTENSION]:
              Buffer.from(key.sign(bindingBytes(request, endpoint, quote.accepts[0], transaction))).toString("hex") } };
          }, {
            async authorize(quote) {
              await record({ state: "quoted" });
              if (!approved() || quote.accepts[0].amount !== test.priceTinybars ||
                  quote.accepts[0].extra?.capabilityRequest !== auth.requestDigest) throw new Error("Quote rejected");
              await record({ state: "authorized" });
            },
            async submitted(id) {
              if (!approved()) throw new Error("Authorization expired before submission");
              await record({ state: "submitted", transactionId: id });
              transactionId = id;
            },
            async settled(id) {
              settled = true;
              await record({ state: "settled", transactionId: id });
            },
          });
          output = response.worker;
        } catch (error) {
          if (transactionId && (!(error instanceof PaymentAttemptError) || error.state === "uncertain")) failure = "uncertain";
        }

        const independent = transactionId && (settled || failure === "uncertain")
          ? await reconcilePayment(mirror, { transactionId, payer: auth.payer, merchant: bid.merchant,
            amountTinybars: test.priceTinybars }) : null;
        const state = independent?.status === "verified" ? "verified"
          : independent?.status === "invalid" ? "uncertain" : settled ? "settled" : failure;
        const paid = state === "verified" || state === "settled";
        const result = paid && isRecord(output) && Object.keys(output).length === 6 &&
          output.taskId === request.taskId && output.testId === request.testId && output.workerId === request.workerId &&
          Object.hasOwn(output, "output") && integerIn(output.durationMs, 0, 60_000) &&
          (output.failure === null || output.failure === "timeout" || output.failure === "worker_error")
          ? { ...evaluateCapabilityTest(test, output.output, output.failure ?? undefined), durationMs: output.durationMs }
          : null;
        await record({ state, transactionId });
        return {
          state, spentTinybars: paid ? test.priceTinybars : "0",
          reservedTinybars: state === "uncertain" ? test.priceTinybars : "0", result,
          ...(state === "failed" ? { reason: "payment_or_quote_rejected" }
            : state === "uncertain" ? { reason: "reconciliation_required" } : {}),
          ...(transactionId ? { evidence: {
            transactionId, explorer: paymentExplorerUrl(transactionId), independentStatus: independent?.status ?? "not_checked",
            payer: auth.payer, merchant: bid.merchant, amountTinybars: test.priceTinybars,
            network: bid.network, asset: bid.asset, requestDigest: auth.requestDigest,
            ...(independent?.status === "verified" ? {
              feeTinybars: independent.feeTinybars, consensusTimestamp: independent.consensusTimestamp,
            } : {}),
          } } : {}),
        };
      },
    },
  });
}
