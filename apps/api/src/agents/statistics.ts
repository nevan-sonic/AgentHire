export function validStatisticsInput(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 100 &&
    value.every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 1e9);
}
