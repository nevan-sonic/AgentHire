import { pathToFileURL } from "node:url";
import {
  loadHederaConfig,
  parseHederaAccountId,
  parseHederaPrivateKey,
} from "../config/hedera.js";
import { createHederaClient } from "../hedera/client.js";
import {
  AHC,
  HTS_FEE_CAPS,
  associateToken,
  createFungibleToken,
  parseTokenId,
  readTokenBalance,
  transferFungibleToken,
  verifyDemoToken,
} from "../hedera/token.js";

const DEMO_AMOUNT = 100n;

export async function runHtsDemo(
  args: string[],
  env: NodeJS.ProcessEnv,
  print: (line: string) => void = console.log,
) {
  const operations = ["--create", "--associate", "--transfer"] as const;
  const selected = operations.filter((flag) => args.includes(flag));
  const execute = args.includes("--execute");
  if (
    args.some((arg) => arg !== "--execute" && !operations.some((flag) => flag === arg))
    || new Set(args).size !== args.length
    || selected.length > 1
    || (execute && selected.length !== 1)
  ) {
    throw new Error("Choose one of --create, --associate, or --transfer. Add --execute to submit.");
  }

  const operation = selected[0] ?? "--create";
  const config = loadHederaConfig(env);
  const tokenId = env.HEDERA_HTS_TOKEN_ID?.trim() ?? "";
  const recipient = env.HEDERA_HTS_RECIPIENT_ID?.trim() ?? "";
  const recipientKeyValue = env.HEDERA_HTS_RECIPIENT_KEY?.trim();
  const treasury = config.operatorAccountId.toString();
  const feeCap = operation === "--create" ? HTS_FEE_CAPS.create
    : operation === "--associate" ? HTS_FEE_CAPS.associate : HTS_FEE_CAPS.transfer;

  let recipientKey;
  if (operation !== "--create") {
    parseTokenId(tokenId);
    parseHederaAccountId(recipient, "HEDERA_HTS_RECIPIENT_ID");
    if (recipient === treasury) throw new Error("Configure a recipient separate from the treasury");
    if (operation === "--associate") {
      if (!recipientKeyValue) throw new Error("HEDERA_HTS_RECIPIENT_KEY is required for explicit association");
      recipientKey = parseHederaPrivateKey(recipientKeyValue, "HEDERA_HTS_RECIPIENT_KEY");
    }
  }

  print(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    network: config.network,
    operation,
    treasury,
    maxTransactionFeeHbar: feeCap,
    ...(operation === "--create"
      ? { name: AHC.name, symbol: AHC.symbol, decimals: AHC.decimals, initialSupply: AHC.initialSupply.toString() }
      : { tokenId, recipient, ...(operation === "--transfer" ? { amount: DEMO_AMOUNT.toString() } : {}) }),
  }));
  if (!execute) return;

  if (operation !== "--create") {
    await verifyDemoToken(config.mirrorNodeUrl, tokenId, treasury);
  }

  let client;
  try {
    client = createHederaClient(config);
  } catch {
    throw new Error("Could not initialize the Hedera client");
  }

  try {
    if (operation === "--create") {
      const result = await createFungibleToken(client);
      print(JSON.stringify({
        ...result,
        tokenHashScanUrl: `https://hashscan.io/testnet/token/${result.tokenId}`,
      }));
    } else if (operation === "--associate") {
      print(JSON.stringify(await associateToken(client, { tokenId, recipient, recipientKey })));
    } else {
      const result = await transferFungibleToken(
        client,
        { tokenId, recipient, amount: DEMO_AMOUNT },
        (sender, id) => readTokenBalance(config.mirrorNodeUrl, sender, id),
      );
      print(JSON.stringify(result));
    }
  } finally {
    client.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile(new URL("../../../../.env", import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Could not read the local .env file");
      }
    }
    await runHtsDemo(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "HTS demo failed");
    process.exitCode = 1;
  }
}
