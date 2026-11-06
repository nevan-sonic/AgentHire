import { procure } from "../agents/manager.js";
import { createDemoRegistry, STATISTICS } from "../agents/workers.js";

const now = () => Date.parse("2026-01-01T00:00:00.000Z");
const registry = createDemoRegistry(3001, undefined, now);
const decisions = [];
for (const selectionStrategy of ["cheapest_eligible", "expected_cost"] as const) {
  const decision = await procure({
    taskId: `demo-${selectionStrategy}`, taskType: STATISTICS, capability: STATISTICS,
    input: [2, 4, 6, 8], maxBudgetTinybars: "1000000", deadlineMs: 1000,
    minimumReliabilityBps: 6000, selectionStrategy,
  }, registry, { now });
  decisions.push(decision);
}
console.log(JSON.stringify(decisions, null, 2));
