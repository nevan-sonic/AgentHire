export function validStatisticsInput(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 100 &&
    value.every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 1e9);
}

export function summarizeStatistics(values: readonly number[]) {
  return {
    count: values.length, min: Math.min(...values), max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}
