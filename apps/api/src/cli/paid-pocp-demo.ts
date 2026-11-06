import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProcurementTask } from "@agenthire/shared";
import { loadHederaMirrorNodeUrl, parseHederaAccountId, parseHederaPrivateKey } from "../config/hedera.js";
import { createDemoRegistry, STATISTICS } from "../agents/workers.js";
import { procure } from "../agents/manager.js";
import { statisticsMicroTest } from "../agents/capability-tests.js";
import { executePaidPocp } from "../agents/paid-pocp.js";
import { CAPABILITY_PATH, capabilityDigest, lookupPayerAccount } from "../x402/capability-binding.js";
import { fileCapabilityJournal } from "../x402/capability-journal.js";
import { loadX402Config, X402_ASSET, X402_NETWORK } from "../x402/config.js";
import { capabilityTestPrice } from "../x402/capability-config.js";

export async function runPaidPocpDemo(args: string[], env: NodeJS.ProcessEnv) {
  if (args.length && (args.length !== 1 || args[0] !== "--execute")) throw new Error("Use only the optional --execute flag");
  const execute = args.length === 1;
  if (execute && (env.POCP_LIVE_ENABLED !== "true" || env.X402_ENABLED !== "true")) {
    throw new Error("Enable the local x402 worker and separately authorize live PoCP");
  }
  const price = capabilityTestPrice(env);
  const port = Number(env.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid API_PORT");
  const task: ProcurementTask = {
    taskId: execute ? env.POCP_LIVE_TASK_ID?.trim() ?? "" : "paid-pocp-preview",
    taskType: STATISTICS, capability: STATISTICS, input: [2, 4, 6, 8], maxBudgetTinybars: "1000000",
    deadlineMs: 60_000, minimumReliabilityBps: 3500, selectionStrategy: "adaptive_pocp",
    pocp: { failurePenaltyTinybars: "400000" },
  };
  if (!execute) {
    const result = await procure(task, createDemoRegistry(port, undefined, Date.now, { economy: "incorrect" }, price));
    const valuation = result.pocp?.valuations.find((row) => row.workerId === result.pocp?.chosenTest?.workerId);
    return { mode: "simulation", result,
      finalHireReserveTinybars: valuation?.status === "valued" ? valuation.finalHireReserveTinybars : "0" };
  }

  const { merchant, endpoint } = loadX402Config(env, port);
  const payer = parseHederaAccountId(env.X402_PAYER_ID?.trim() ?? "", "X402_PAYER_ID").toString();
  if (payer === merchant) throw new Error("Payer and merchant must differ");
  const key = parseHederaPrivateKey(env.X402_PAYER_KEY?.trim() ?? "", "X402_PAYER_KEY");
  const mirror = loadHederaMirrorNodeUrl(env);
  const account = await lookupPayerAccount(mirror, payer);
  if (account.publicKey.toStringRaw() !== key.publicKey.toStringRaw() ||
      BigInt(account.balanceTinybars) < BigInt(price)) throw new Error("Payer key or available balance could not be verified");
  const workerId = "economy";
  const micro = statisticsMicroTest(task.taskId, workerId, price, 50);
  const result = await executePaidPocp(task, createDemoRegistry(port, merchant, Date.now, {}, price), {
    enabled: true, key, mirror,
    openAttempt: fileCapabilityJournal(fileURLToPath(new URL("../../../../.agenthire-x402/", import.meta.url))),
    authorization: {
      payer, taskId: task.taskId, workerId, testId: micro.testId,
      requestDigest: capabilityDigest({ ...micro, input: [...micro.input] }),
      endpoint: new URL(CAPABILITY_PATH, endpoint).href, merchant, network: X402_NETWORK, asset: X402_ASSET,
      amountTinybars: env.POCP_LIVE_AUTHORIZED_PRICE_TINYBARS ?? "",
      maxTotalTinybars: env.POCP_LIVE_MAX_TOTAL_TINYBARS ?? "",
      finalHireReserveTinybars: env.POCP_LIVE_FINAL_HIRE_RESERVE_TINYBARS ?? "",
      expiresAt: env.POCP_LIVE_EXPIRES_AT ?? "",
    },
  });
  return { mode: "live", result };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile(new URL("../../../../.env", import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not load local configuration");
    }
    const result = await runPaidPocpDemo(process.argv.slice(2), process.env);
    console.log(JSON.stringify(result, null, 2));
    if (result.mode === "live" && ["failed", "uncertain"].includes(result.result.pocp?.payment?.state ?? "")) process.exitCode = 1;
  } catch {
    console.error("Paid PoCP stopped. Check local authorization, payer setup, and the attempt journal before retrying.");
    process.exitCode = 1;
  }
}
