import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isRecord } from "./task.js";

export type StatisticsSummary = { count: number; min: number; max: number; mean: number };
export type CapabilityTest = {
  testId: string; taskId: string; workerId: string; capability: "statistics.summary";
  input: readonly number[]; expected: StatisticsSummary; priceTinybars: string; timeoutMs: number;
};

export function statisticsMicroTest(taskId: string, workerId: string, priceTinybars: string, timeoutMs: number): CapabilityTest {
  // Independent, known reference for this test vector.
  return { testId: `${taskId}-${workerId}-statistics-v1`, taskId, workerId,
    capability: "statistics.summary", input: [3, 6, 9], expected: { count: 3, min: 3, max: 9, mean: 6 },
    priceTinybars, timeoutMs };
}

type Reason = "matches_reference" | "wrong_answer" | "malformed_output" | "timeout" | "worker_error";

export function sanitizeStatisticsOutput(value: unknown): StatisticsSummary | null {
  if (!isRecord(value) || Object.keys(value).length !== 4) return null;
  const { count, min, max, mean } = value;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100 ||
      typeof min !== "number" || typeof max !== "number" || typeof mean !== "number" ||
      [min, max, mean].some((number) => !Number.isFinite(number) || Math.abs(number) > 1e9)) return null;
  return { count, min, max, mean };
}

export function evaluateCapabilityTest(test: CapabilityTest, output: unknown, failure?: "timeout" | "worker_error") {
  const observed = failure ? null : sanitizeStatisticsOutput(output);
  const passed = observed !== null && observed.count === test.expected.count && observed.min === test.expected.min &&
    observed.max === test.expected.max && observed.mean === test.expected.mean;
  const reason: Reason = failure ?? (observed === null ? "malformed_output" : passed ? "matches_reference" : "wrong_answer");
  const evidence = JSON.stringify({ input: test.input, observed, passed, reason });
  return { source: "observed_test_result" as const, passed, reason, observed,
    evidenceHash: createHash("sha256").update(evidence, "utf8").digest("hex") };
}

export async function runCapabilityTest(
  test: CapabilityTest, execute: (input: readonly number[], signal: AbortSignal) => Promise<unknown>,
) {
  const { output, failure, durationMs } = await runCapabilityAdapter(test.input, test.timeoutMs, execute);
  return { ...evaluateCapabilityTest(test, output, failure), durationMs };
}

export async function runCapabilityAdapter(
  input: readonly number[], timeoutMs: number,
  execute: (input: readonly number[], signal: AbortSignal) => Promise<unknown>,
): Promise<{ output?: unknown; failure?: "timeout" | "worker_error"; durationMs: number }> {
  const start = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      new Promise<{ failure: "timeout" }>((resolve) => {
        timer = setTimeout(() => { resolve({ failure: "timeout" }); controller.abort(); }, timeoutMs);
      }),
      Promise.resolve().then(() => execute([...input], controller.signal)).then(
        (output) => ({ output }), () => ({ failure: "worker_error" }) as const,
      ),
    ]);
    return { ...outcome, durationMs: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(timer);
  }
}
