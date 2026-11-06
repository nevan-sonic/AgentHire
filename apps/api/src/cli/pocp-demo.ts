import { procure } from "../agents/manager.js";
import { createDemoRegistry, STATISTICS } from "../agents/workers.js";

const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const scenarios = [
  { id: "test-worth-buying", budget: "1000000", penalty: "400000", behavior: "correct" },
  { id: "test-not-worth-price", budget: "1000000", penalty: "100000", behavior: "correct" },
  { id: "no-affordable-hire-after-test", budget: "600000", penalty: "400000", behavior: "correct" },
  { id: "test-fails", budget: "1000000", penalty: "400000", behavior: "incorrect" },
] as const;

const decisions = [];
for (const { id, budget, penalty, behavior } of scenarios) {
  const registry = createDemoRegistry(3001, undefined, now, { economy: behavior });
  decisions.push(await procure({
    taskId: id, taskType: STATISTICS, capability: STATISTICS, input: [2, 4, 6, 8],
    maxBudgetTinybars: budget, deadlineMs: 1000, minimumReliabilityBps: 3500,
    selectionStrategy: "adaptive_pocp", pocp: { failurePenaltyTinybars: penalty },
  }, registry, { now }));
}
console.log(JSON.stringify(decisions, null, 2));
