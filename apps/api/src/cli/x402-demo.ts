import { pathToFileURL } from "node:url";
import { createPayerSigner, payWorker, requestWorkerQuote, SpendingPolicy } from "../agents/payer.js";
import { loadHederaMirrorNodeUrl, parseHederaAccountId, parseHederaPrivateKey } from "../config/hedera.js";
import {
  loadX402Config, X402_ASSET, X402_FACILITATOR, X402_FEE_PAYER, X402_MAX_FEE, X402_NETWORK, X402_PRICE,
} from "../x402/config.js";
import { reconcilePayment } from "../x402/reconcile.js";

export async function runX402Demo(args: string[], env: NodeJS.ProcessEnv, print = console.log) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--execute")) throw new Error("Use only the optional --execute flag");
  const port = Number(env.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid API_PORT");
  const { endpoint, merchant } = loadX402Config(env, port);
  const values = [2, 4, 6, 8];
  const policy = new SpendingPolicy(endpoint, merchant, BigInt(X402_PRICE), BigInt(X402_PRICE));
  if (!args.length) {
    const { requirement } = await requestWorkerQuote(policy, values);
    print(JSON.stringify({
      mode: "dry-run", endpoint, merchant, network: X402_NETWORK, asset: X402_ASSET,
      amountTinybars: requirement.amount, totalBudgetTinybars: X402_PRICE, perPaymentLimitTinybars: X402_PRICE,
      facilitator: X402_FACILITATOR, feePayer: X402_FEE_PAYER, maxNetworkFeeTinybars: X402_MAX_FEE.toString(),
      flow: "402 challenge → policy → payer signature → facilitator verification and settlement → worker result",
      paymentMade: false,
    }));
    return 0;
  }

  const payer = parseHederaAccountId(env.X402_PAYER_ID?.trim() ?? "", "X402_PAYER_ID").toString();
  const privateKey = parseHederaPrivateKey(env.X402_PAYER_KEY?.trim() ?? "", "X402_PAYER_KEY");
  const mirror = loadHederaMirrorNodeUrl(env);
  const evidence = await payWorker(policy, values, payer, createPayerSigner(payer, privateKey));
  print(JSON.stringify({ ...evidence, facilitator: X402_FACILITATOR, feePayer: X402_FEE_PAYER }));
  const mirrorResult = await reconcilePayment(mirror, evidence);
  print(JSON.stringify({ mirror: mirrorResult }));
  return mirrorResult.status === "verified" ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile(new URL("../../../../.env", import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not read the local .env file");
    }
    process.exitCode = await runX402Demo(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "x402 demo failed");
    process.exitCode = 1;
  }
}
