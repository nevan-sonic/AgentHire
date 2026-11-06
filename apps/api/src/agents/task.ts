import type { ProcurementTask } from "@agenthire/shared";
import { validStatisticsInput } from "./statistics.js";
import { STATISTICS } from "./workers.js";

const taskFields = [
  "taskId", "taskType", "capability", "input", "maxBudgetTinybars",
  "deadlineMs", "minimumReliabilityBps", "selectionStrategy",
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function tinybars(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) &&
    BigInt(value) <= (1n << 63n) - 1n;
}

export function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function parseProcurementTask(value: unknown): ProcurementTask {
  if (
    !isRecord(value) || Object.keys(value).length !== taskFields.length ||
    Object.keys(value).some((key) => !taskFields.includes(key)) ||
    typeof value.taskId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.taskId) ||
    value.taskType !== STATISTICS || value.capability !== STATISTICS ||
    !validStatisticsInput(value.input) || !tinybars(value.maxBudgetTinybars) ||
    !integerIn(value.deadlineMs, 1, 60_000) || !integerIn(value.minimumReliabilityBps, 1, 10_000) ||
    (value.selectionStrategy !== "cheapest_eligible" && value.selectionStrategy !== "expected_cost")
  ) {
    throw new Error("Invalid statistics.summary procurement task");
  }
  return {
    taskId: value.taskId, taskType: value.taskType, capability: value.capability,
    input: [...value.input], maxBudgetTinybars: value.maxBudgetTinybars,
    deadlineMs: value.deadlineMs, minimumReliabilityBps: value.minimumReliabilityBps,
    selectionStrategy: value.selectionStrategy,
  };
}
