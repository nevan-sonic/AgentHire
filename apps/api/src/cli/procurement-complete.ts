import { fileURLToPath, pathToFileURL } from "node:url";
import { createDemoRegistry } from "../agents/workers.js";
import { HIRE_MERCHANT, HIRE_PAYER, HIRE_PRICE, HIRE_TASK_ID, HIRE_WORKER, loadHireCheckpoint } from "../agents/hire-checkpoint.js";
import { executeFinalHire, previewFinalHire } from "../agents/final-hire.js";
import { loadHederaMirrorNodeUrl, parseHederaAccountId, parseHederaPrivateKey } from "../config/hedera.js";
import { lookupPayerAccount } from "../x402/capability-binding.js";
import { fileCapabilityJournal, readAttempt } from "../x402/capability-journal.js";
import { loadX402Config, X402_ASSET, X402_NETWORK } from "../x402/config.js";
import { normalizeTransactionId, paymentExplorerUrl } from "../x402/protocol.js";
import { reconcilePayment } from "../x402/reconcile.js";

export async function completeProcurement(args: string[], env: NodeJS.ProcessEnv) {
  if (args.length && (args.length !== 1 || args[0] !== "--execute")) throw new Error("Use only the optional --execute flag");
  const execute = args.length === 1;
  if (execute && (env.HIRE_LIVE_ENABLED !== "true" || env.X402_ENABLED !== "true" ||
      env.HIRE_LIVE_TASK_ID !== HIRE_TASK_ID)) throw new Error("Exact live final-hire authorization is required");
  const port = Number(env.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid API_PORT");
  const { merchant } = loadX402Config(env, port);
  if (merchant !== HIRE_MERCHANT) throw new Error("Merchant differs from the verified procurement");
  const directory = fileURLToPath(new URL("../../../../.agenthire-x402/", import.meta.url));
  const mirror = loadHederaMirrorNodeUrl(env);
  const prior = await readAttempt(directory, HIRE_TASK_ID, "hire");
  if (prior !== null) {
    const transaction = [...prior].reverse().find((entry) => normalizeTransactionId(entry?.transactionId));
    const id = normalizeTransactionId(transaction?.transactionId);
    const last = prior.at(-1);
    const independent = id && last?.state !== "failed"
      ? await reconcilePayment(mirror, { transactionId: id, payer: HIRE_PAYER, merchant, amountTinybars: HIRE_PRICE })
      : null;
    const status = last?.state === "verified" && independent?.status === "verified"
      ? "already_verified" : "reconciliation_required";
    return { mode: "existing_attempt", status, taskId: HIRE_TASK_ID,
      transactionId: id, explorer: id && paymentExplorerUrl(id), independent };
  }

  const checkpoint = await loadHireCheckpoint(await readAttempt(directory, HIRE_TASK_ID, "pocp"),
    createDemoRegistry(port, merchant), mirror);
  const preview = await previewFinalHire(checkpoint);
  if (!execute) return { mode: "dry_run", ...preview };

  const payer = parseHederaAccountId(env.X402_PAYER_ID?.trim() ?? "", "X402_PAYER_ID").toString();
  if (payer !== HIRE_PAYER) throw new Error("Payer differs from the verified procurement");
  const key = parseHederaPrivateKey(env.X402_PAYER_KEY?.trim() ?? "", "X402_PAYER_KEY");
  const indexed = await lookupPayerAccount(mirror, payer);
  if (indexed.publicKey.toStringRaw() !== key.publicKey.toStringRaw() ||
      BigInt(indexed.balanceTinybars) < BigInt(checkpoint.bid.priceTinybars)) {
    throw new Error("Payer key or balance could not be verified");
  }
  const result = await executeFinalHire(checkpoint, {
    enabled: true, key, mirror, openAttempt: fileCapabilityJournal(directory, "hire"),
    authorization: {
      payer, merchant, endpoint: checkpoint.bid.endpoint, taskId: HIRE_TASK_ID, workerId: HIRE_WORKER,
      network: X402_NETWORK, asset: X402_ASSET, requestDigest: preview.requestDigest,
      amountTinybars: env.HIRE_LIVE_AUTHORIZED_TINYBARS ?? "", maxTotalTinybars: env.HIRE_LIVE_MAX_TOTAL_TINYBARS ?? "",
      expiresAt: env.HIRE_LIVE_EXPIRES_AT ?? "",
    },
  });
  return { mode: "live", ...result };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile(new URL("../../../../.env", import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not load local configuration");
    }
    const result = await completeProcurement(process.argv.slice(2), process.env);
    console.log(JSON.stringify(result, null, 2));
    if ((result.mode === "live" && result.status !== "task_completed") ||
        (result.mode === "existing_attempt" && result.status === "reconciliation_required")) {
      process.exitCode = 1;
    }
  } catch {
    console.error("Final hire stopped. Check the prior checkpoint, local authorization, and attempt journal before proceeding.");
    process.exitCode = 1;
  }
}
