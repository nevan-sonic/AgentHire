import { pathToFileURL } from "node:url";
import { loadHederaConfig, loadHederaMirrorNodeUrl } from "../config/hedera.js";
import { createHederaClient } from "../hedera/client.js";
import { createAuditEvent, serializeAuditEvent } from "../hedera/audit-event.js";
import {
  AUDIT_TOPIC_MEMO, createAuditTopic, parseAuditTopicId, parseHcsFee, submitAuditEvent, verifyAuditEvent,
} from "../hedera/consensus.js";

export async function runHcsDemo(
  args: string[],
  env: NodeJS.ProcessEnv,
  print: (line: string) => void = console.log,
) {
  const [operation = "create-topic", ...flags] = args;
  if (!["create-topic", "submit-event", "verify-event"].includes(operation)) {
    throw new Error("Choose create-topic, submit-event, or verify-event");
  }

  const allowed = operation === "verify-event" ? ["--sequence"] : ["--execute", "--max-fee-hbar"];
  const options = new Map<string, string>();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (!allowed.includes(flag) || options.has(flag)) throw new Error("Unexpected or duplicate HCS option");
    const value = flag === "--execute" ? "true" : flags[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options.set(flag, value);
  }

  const topic = env.HEDERA_HCS_TOPIC_ID?.trim() ?? "";
  if (operation === "verify-event") {
    const sequence = options.get("--sequence");
    if (!sequence) throw new Error("Use --sequence to select the message to verify");
    const result = await verifyAuditEvent(loadHederaMirrorNodeUrl(env), topic, sequence);
    print(JSON.stringify(result));
    return result.status === "verified" ? 0 : 1;
  }

  const execute = options.has("--execute");
  const fee = options.get("--max-fee-hbar");
  if (execute && !fee) throw new Error("Supply --max-fee-hbar explicitly before executing an HCS write");
  const maxFee = fee === undefined ? undefined : parseHcsFee(fee);
  if (operation === "create-topic" && topic) throw new Error("An audit topic is already configured");
  if (operation === "submit-event") parseAuditTopicId(topic);
  const config = loadHederaConfig(env);
  const event = operation === "submit-event" ? createAuditEvent({
    version: 1,
    eventId: "demo-event-001",
    eventType: "JOB_CREATED",
    jobId: "demo-job-001",
    agentId: "demo-manager-001",
    timestamp: "2026-01-01T00:00:00.000Z",
    metadata: {},
  }) : undefined;

  print(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    network: config.network,
    operation,
    maxFeeHbar: fee ?? null,
    ...(event ? { topicId: topic, message: serializeAuditEvent(event) } : {
      memo: AUDIT_TOPIC_MEMO, submitKey: "operator", adminKey: null,
    }),
  }));
  if (!execute || !maxFee) return 0;

  let client;
  try {
    client = createHederaClient(config);
  } catch {
    throw new Error("Could not initialize the Hedera client");
  }

  try {
    const writeOptions = { network: config.network, maxFee };
    if (event) {
      print(JSON.stringify(await submitAuditEvent(client, topic, event, writeOptions)));
    } else {
      const result = await createAuditTopic(client, { ...writeOptions, existingTopicId: topic });
      print(JSON.stringify({
        ...result, topicHashScanUrl: `https://hashscan.io/${config.network}/topic/${result.topicId}`,
      }));
    }
  } finally {
    client.close();
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile(new URL("../../../../.env", import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not read the local .env file");
    }
    process.exitCode = await runHcsDemo(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "HCS demo failed");
    process.exitCode = 1;
  }
}
