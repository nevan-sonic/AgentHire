import type { ProcurementBid, ProcurementTask } from "@agenthire/shared";
import { runCapabilityTest, statisticsMicroTest } from "./capability-tests.js";
import type { CapabilityTest } from "./capability-tests.js";
import type { PaymentState } from "../x402/capability-journal.js";
import { add, assumedPrior, compare, describe, exact, fraction, multiply, observe, predictive, subtract } from "./reliability.js";
import type { Beta } from "./reliability.js";
import { integerIn, tinybars } from "./task.js";
import { compareWorkerIds } from "./workers.js";
import type { WorkerAdapter } from "./workers.js";

type Candidate = { bid: ProcurementBid; reliability: Beta };
const SCALE = 10_000n;

export type PaidTestResult = {
  state: PaymentState;
  spentTinybars: string;
  reservedTinybars: string;
  evidence?: { transactionId: string; explorer: string; independentStatus: string; feeTinybars?: string;
    consensusTimestamp?: string; payer: string; merchant: string; amountTinybars: string;
    network: ProcurementBid["network"]; asset: ProcurementBid["asset"]; requestDigest: string };
  result: Awaited<ReturnType<typeof runCapabilityTest>> | null;
  reason?: string;
};

export type PaidTestExecutor = {
  overheadMs: number;
  run(test: CapabilityTest, bid: ProcurementBid, finalHireReserve: bigint): Promise<PaidTestResult>;
};

export async function adaptiveProcurement(
  task: ProcurementTask,
  bids: ProcurementBid[],
  workers: WorkerAdapter[],
  deadlineAt: number,
  now: () => number,
  executor?: PaidTestExecutor,
) {
  if (!task.pocp) throw new Error("PoCP requires a failure penalty");
  const penalty = BigInt(task.pocp.failurePenaltyTinybars);
  const budget = BigInt(task.maxBudgetTinybars);
  const noHireLoss = fraction(budget + penalty + 1n);
  const candidates = bids.map((bid) => ({ bid, reliability: assumedPrior(bid.reliabilityBps) }));
  const timestamp = now();

  function hires(choices: Candidate[], available: bigint, at: number) {
    return choices.flatMap(({ bid, reliability }) => {
      const amount = BigInt(bid.priceTinybars);
      const { pass, fail } = predictive(reliability);
      if (amount > available || Date.parse(bid.expiresAt) <= at || bid.estimatedLatencyMs > deadlineAt - at ||
          compare(pass, fraction(BigInt(task.minimumReliabilityBps), SCALE)) < 0) return [];
      return [{
        bid, loss: add(fraction(amount), multiply(fraction(penalty), fail)),
        expectedCost: fraction(amount * pass.d, pass.n),
      }];
    }).sort((a, b) => compare(a.loss, b.loss) || compare(a.expectedCost, b.expectedCost) ||
      compare(fraction(BigInt(a.bid.priceTinybars)), fraction(BigInt(b.bid.priceTinybars))) ||
      a.bid.estimatedLatencyMs - b.bid.estimatedLatencyMs || compareWorkerIds(a.bid.workerId, b.bid.workerId));
  }

  const baseline = hires(candidates, budget, timestamp)[0];
  const baselineLoss = baseline?.loss ?? noHireLoss;
  const candidatesAfter = (workerId: string, passed: boolean) => candidates.map((candidate) =>
    candidate.bid.workerId === workerId ? { ...candidate, reliability: observe(candidate.reliability, passed) } : candidate);

  const valuations = candidates.map(({ bid, reliability }) => {
    const worker = workers.find((adapter) => adapter.profile.workerId === bid.workerId);
    const offer = worker?.capabilityTest;
    const blocked = (reason: string) => ({ workerId: bid.workerId, status: "unavailable" as const, reason });
    if (!offer) return { trace: blocked("test_not_supported") };
    if (!tinybars(offer.priceTinybars) || offer.priceTinybars === "0" || !integerIn(offer.timeoutMs, 1, 60_000)) {
      return { trace: blocked("invalid_test_offer") };
    }
    const price = BigInt(offer.priceTinybars);
    if (price > budget) return { trace: { ...blocked("test_over_budget"), priceTinybars: offer.priceTinybars } };
    const available = budget - price;
    const after = timestamp + offer.timeoutMs + (executor?.overheadMs ?? 0);
    if (!bids.some((bid) => BigInt(bid.priceTinybars) <= available)) {
      return { trace: { ...blocked("no_affordable_post_test_hire"), priceTinybars: offer.priceTinybars } };
    }
    const passHire = hires(candidatesAfter(bid.workerId, true), available, after)[0];
    const failHire = hires(candidatesAfter(bid.workerId, false), available, after)[0];
    if (!passHire && !failHire) return { trace: { ...blocked("no_eligible_post_test_hire"), priceTinybars: offer.priceTinybars } };
    if (executor && (!passHire || !failHire)) {
      return { trace: { ...blocked("live_test_requires_hire_in_both_branches"), priceTinybars: offer.priceTinybars } };
    }
    const reserve = [passHire, failHire].reduce((max, hire) => {
      const amount = BigInt(hire?.bid.priceTinybars ?? "0");
      return amount > max ? amount : max;
    }, 0n);

    const { pass, fail } = predictive(reliability);
    const passLoss = passHire?.loss ?? noHireLoss;
    const failLoss = failHire?.loss ?? noHireLoss;
    const expectedLoss = add(fraction(price), add(multiply(pass, passLoss), multiply(fail, failLoss)));
    const netValue = subtract(baselineLoss, expectedLoss);
    return {
      offer, netValue, price, bid, reserve,
      trace: {
        workerId: bid.workerId, status: "valued" as const, priceTinybars: offer.priceTinybars,
        finalHireReserveTinybars: reserve.toString(),
        pass: { probability: exact(pass), workerId: passHire?.bid.workerId ?? null, lossTinybars: exact(passLoss) },
        fail: { probability: exact(fail), workerId: failHire?.bid.workerId ?? null, lossTinybars: exact(failLoss) },
        expectedLossTinybars: exact(expectedLoss), netValueOfInformationTinybars: exact(netValue),
      },
    };
  });

  const chosen = valuations.flatMap(({ offer, netValue, price, bid, reserve, trace }) =>
    offer && netValue && price !== undefined && bid && reserve !== undefined && compare(netValue, fraction(0n)) > 0
      ? [{ offer, netValue, price, bid, reserve, trace }] : [],
  ).sort((a, b) => compare(b.netValue, a.netValue) || compare(fraction(a.price), fraction(b.price)) ||
      compareWorkerIds(a.trace.workerId, b.trace.workerId))[0];
  const chosenTest = chosen?.offer
    ? statisticsMicroTest(task.taskId, chosen.trace.workerId, chosen.offer.priceTinybars, chosen.offer.timeoutMs) : null;
  const payment = chosenTest && chosen && executor ? await executor.run(chosenTest, chosen.bid, chosen.reserve) : null;
  const result = payment ? payment.result
    : chosenTest && chosen && !executor ? await runCapabilityTest(chosenTest, chosen.offer.run) : null;
  const simulatedCost = chosenTest && !executor ? BigInt(chosenTest.priceTinybars) : 0n;
  const spent = BigInt(payment?.spentTinybars ?? "0");
  const reserved = BigInt(payment?.reservedTinybars ?? "0");
  const remaining = budget - simulatedCost - spent - reserved;
  const posteriors = chosenTest && result ? candidatesAfter(chosenTest.workerId, result.passed) : candidates;
  const finalHires = payment?.state === "uncertain" ? [] : hires(posteriors, remaining, now());
  const winningBid = finalHires[0]?.bid ?? null;
  const finalPrice = BigInt(winningBid?.priceTinybars ?? "0");

  return {
    winningBid, chosenTest, result, payment,
    trace: {
      priors: candidates.map(({ bid, reliability }) => ({ workerId: bid.workerId, ...describe(reliability, "assumed_prior") })),
      baselineWorkerId: baseline?.bid.workerId ?? null, baselineLossTinybars: exact(baselineLoss),
      failurePenaltyTinybars: penalty.toString(), noHireLossTinybars: exact(noHireLoss),
      valuations: valuations.map(({ trace }) => trace),
      action: chosenTest ? "TEST" as const : "SKIP" as const,
      executionMode: executor ? "live" as const : "simulation" as const,
      payment,
      reason: chosenTest ? "highest_positive_net_value" : "no_positive_feasible_test",
      chosenTest, result,
      posteriors: posteriors.map(({ bid, reliability }) => ({ workerId: bid.workerId,
        ...describe(reliability, result && chosenTest?.workerId === bid.workerId ? "posterior_estimate" : "assumed_prior") })),
      finalWorkerId: winningBid?.workerId ?? null,
      finalScores: finalHires.map(({ bid, loss, expectedCost }) => ({
        workerId: bid.workerId, lossTinybars: exact(loss), expectedCostPerSuccessTinybars: exact(expectedCost),
      })),
      budget: {
        totalTinybars: budget.toString(), committedTinybars: spent.toString(), simulatedTestTinybars: simulatedCost.toString(),
        remainingAfterTestTinybars: remaining.toString(), projectedHireTinybars: finalPrice.toString(),
        projectedTotalTinybars: (simulatedCost + spent + reserved + finalPrice).toString(),
        projectedRemainingTinybars: (remaining - finalPrice).toString(),
      },
      ...(executor ? { paymentBudget: {
        initialBudgetTinybars: budget.toString(), testPriceTinybars: chosenTest?.priceTinybars ?? "0",
        testSpentTinybars: spent.toString(), reservedTinybars: reserved.toString(),
        testPaymentStatus: payment?.state ?? "not_required", finalWorkerBidTinybars: finalPrice.toString(),
        remainingBudgetTinybars: remaining.toString(), finalHireAffordable: winningBid !== null,
      } } : {}),
    },
  };
}
