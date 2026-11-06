export const COUNT_SCALE = 10_000;
export const PRIOR_STRENGTH = 2;
export type Beta = Readonly<{ alphaUnits: number; betaUnits: number }>;

export function beta(alphaUnits: number, betaUnits: number): Beta {
  if (![alphaUnits, betaUnits].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000)) {
    throw new Error("Beta parameters must be positive bounded counts in 1/10000 units");
  }
  return { alphaUnits, betaUnits };
}

export function assumedPrior(bps: number): Beta {
  if (!Number.isInteger(bps) || bps < 1 || bps > 10_000) throw new Error("Invalid reliability basis points");
  const bounded = Math.min(bps, 9999);
  return beta(PRIOR_STRENGTH * bounded, PRIOR_STRENGTH * (COUNT_SCALE - bounded));
}

export function observe(prior: Beta, passed: boolean): Beta {
  beta(prior.alphaUnits, prior.betaUnits);
  return beta(prior.alphaUnits + (passed ? COUNT_SCALE : 0), prior.betaUnits + (passed ? 0 : COUNT_SCALE));
}

export type Fraction = Readonly<{ n: bigint; d: bigint }>;
export const fraction = (n: bigint, d = 1n): Fraction => ({ n, d });
export const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const subtract = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
export const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);

export function compare(a: Fraction, b: Fraction) {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function predictive(prior: Beta) {
  beta(prior.alphaUnits, prior.betaUnits);
  const total = BigInt(prior.alphaUnits + prior.betaUnits);
  return { pass: fraction(BigInt(prior.alphaUnits), total), fail: fraction(BigInt(prior.betaUnits), total) };
}

export function exact(value: Fraction) {
  let a = value.n < 0n ? -value.n : value.n, b = value.d;
  while (b) [a, b] = [b, a % b];
  return { numerator: (value.n / a).toString(), denominator: (value.d / a).toString() };
}

export function describe(prior: Beta, source: "assumed_prior" | "posterior_estimate") {
  return { source, alpha: prior.alphaUnits / COUNT_SCALE, beta: prior.betaUnits / COUNT_SCALE,
    mean: exact(predictive(prior).pass) };
}
