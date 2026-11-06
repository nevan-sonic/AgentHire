import { tinybars } from "../agents/task.js";

export const DEFAULT_CAPABILITY_PRICE = "5000";

export function capabilityTestPrice(env: NodeJS.ProcessEnv) {
  const price = env.POCP_TEST_PRICE_TINYBARS ?? DEFAULT_CAPABILITY_PRICE;
  if (!tinybars(price) || price === "0" || BigInt(price) > 100_000n) {
    throw new Error("POCP_TEST_PRICE_TINYBARS must be an integer from 1 to 100000");
  }
  return price;
}
