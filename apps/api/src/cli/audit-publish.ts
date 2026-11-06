import { fileURLToPath, pathToFileURL } from "node:url";
import { Hbar } from "@hiero-ledger/sdk";
import { loadHederaConfig } from "../config/hedera.js";
import { createHederaClient } from "../hedera/client.js";
import { submitAuditEvent, verifyAuditEvent } from "../hedera/consensus.js";
import { readAttempt } from "../x402/capability-journal.js";
import { paymentExplorerUrl } from "../x402/protocol.js";
import { AUDIT_MANIFEST_HASH, AUDIT_TASK, AUDIT_TOPIC, loadCompletedAudit } from "../audit/completed-procurement.js";
import { publicationJournal } from "../audit/publication-journal.js";
import { checkAuditTopic, readVerifiedHistory } from "../audit/topic.js";
import { inspectPublication, publishAudit } from "../audit/publisher.js";

function fee(value: string | undefined) {
  if (!value || !/^[1-9]\d{0,7}$/.test(value)) throw new Error("Use an explicit positive fee cap in tinybars");
  return BigInt(value);
}

export async function runAuditPublish(args: string[], env: NodeJS.ProcessEnv,
  directory = fileURLToPath(new URL("../../../../.agenthire-x402/", import.meta.url))) {
  if (args.length && (args.length !== 1 || args[0] !== "--execute")) throw new Error("Use only the optional --execute flag");
  const execute = args.length === 1;
  if (execute && env.AUDIT_LIVE_ENABLED !== "true") throw new Error("Separate live publication authorization is required");
  const config = loadHederaConfig(env);
  const topicId = env.HEDERA_HCS_TOPIC_ID?.trim() || AUDIT_TOPIC;
  const operator = config.operatorAccountId.toString();
  const mirror = config.mirrorNodeUrl;
  const [completed, balance, history] = await Promise.all([
    Promise.all([readAttempt(directory, AUDIT_TASK, "hire"), readAttempt(directory, AUDIT_TASK, "pocp")])
      .then(([hire, test]) => loadCompletedAudit(hire, test, mirror)),
    checkAuditTopic(mirror, topicId, operator, config.operatorKey.publicKey),
    readVerifiedHistory(mirror),
  ]);
  const journal = publicationJournal(directory);
  const inspection = await inspectPublication(completed.events, history, journal);
  const maxSubmissions = execute ? Number(env.AUDIT_LIVE_MAX_SUBMISSIONS) : 8;
  const perSubmissionTinybars = execute ? fee(env.AUDIT_LIVE_PER_MESSAGE_TINYBARS) : 10_000_000n;
  const aggregateTinybars = execute ? fee(env.AUDIT_LIVE_AGGREGATE_TINYBARS) : 80_000_000n;
  const initialMissing = inspection.reports.filter(({ status }) => status === "missing").length;
  const needed = BigInt(initialMissing) * perSubmissionTinybars;
  let reports = inspection.reports;
  if (execute) {
    const client = createHederaClient(config);
    try {
      reports = await publishAudit(completed.events, history, {
        authorization: {
          enabled: true, taskId: env.AUDIT_LIVE_TASK_ID ?? "", topicId: env.AUDIT_LIVE_TOPIC_ID ?? "",
          manifestHash: env.AUDIT_LIVE_MANIFEST_HASH ?? "", expiresAt: env.AUDIT_LIVE_EXPIRES_AT ?? "",
          maxSubmissions, perSubmissionTinybars, aggregateTinybars,
        },
        balanceTinybars: BigInt(balance), journal,
        submit: (event, cap, beforeSubmit) => submitAuditEvent(client, topicId, event, {
          network: config.network, maxFee: Hbar.fromTinybars(cap.toString()), beforeSubmit,
        }),
        verify: (sequence) => verifyAuditEvent(mirror, topicId, sequence),
      });
    } finally {
      client.close();
    }
  }

  return {
    mode: execute ? "execute" : "read_only", taskId: completed.taskId, topicId, operator,
    procurementStatus: completed.procurementStatus, manifestHash: AUDIT_MANIFEST_HASH,
    topicHashScan: `https://hashscan.io/testnet/topic/${topicId}`,
    priorDemo: { sequenceNumber: "1", verification: "verified" },
    indexedTopicSequenceBefore: history.at(-1)?.sequenceNumber,
    payments: Object.fromEntries(Object.entries(completed.payments).map(([key, payment]) =>
      [key, { ...payment, hashScanUrl: paymentExplorerUrl(payment.transactionId) }])),
    eventCount: reports.length, events: reports, remainingUnpublished: reports.filter(({ status }) => status !== "verified").length,
    alreadyPublishedBefore: inspection.reports.filter(({ status }) => status === "verified").length,
    initialMissing, maxSubmissions, perSubmissionFeeCapTinybars: perSubmissionTinybars.toString(),
    aggregateFeeCapTinybars: aggregateTinybars.toString(), operatorBalanceTinybars: balance,
    operatorHasSufficientBalance: BigInt(balance) >= needed, submitKeyMatches: true, additionalKeyActionRequired: false,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile(new URL("../../../../.env", import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not load local configuration");
    }
    const report = await runAuditPublish(process.argv.slice(2), process.env);
    console.log(JSON.stringify(report, null, 2));
    if ((report.mode === "execute" && report.remainingUnpublished) ||
        report.events.some(({ status }) => status === "conflict" || status === "uncertain")) process.exitCode = 1;
  } catch {
    console.error("Audit publication stopped. Check the completed journals, testnet evidence, topic key, and authorization before proceeding.");
    process.exitCode = 1;
  }
}
