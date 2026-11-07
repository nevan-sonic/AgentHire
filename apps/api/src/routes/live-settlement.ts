import { Client, TransferTransaction, Hbar } from "@hiero-ledger/sdk";
import { parseHederaPrivateKey } from "../config/hedera.js";
import { paymentExplorerUrl } from "../x402/protocol.js";

export async function executeLiveHederaSettlement(
  payerId: string,
  payerKeyStr: string,
  merchantId: string,
  amountTinybars: string,
  memo: string
): Promise<{ transactionId: string; explorerUrl: string; consensusTimestamp: string }> {
  const payerKey = parseHederaPrivateKey(payerKeyStr, "X402_PAYER_KEY");
  const client = Client.forTestnet({ scheduleNetworkUpdate: false });
  client.setOperator(payerId, payerKey);
  try {
    const amount = Number(amountTinybars) || 10_000;
    const tx = await new TransferTransaction()
      .addHbarTransfer(payerId, Hbar.fromTinybars(-amount))
      .addHbarTransfer(merchantId, Hbar.fromTinybars(amount))
      .setTransactionMemo(memo.slice(0, 100))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const rawTxId = tx.transactionId.toString();
    // Normalize format: e.g. "0.0.11331589@1794016942.449268858"
    const normalizedTxId = rawTxId.includes("@")
      ? rawTxId
      : rawTxId.replace(/^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/, "$1@$2.$3");

    const consensusTimestamp = Date.now().toString();
    return {
      transactionId: normalizedTxId,
      explorerUrl: paymentExplorerUrl(normalizedTxId),
      consensusTimestamp,
    };
  } finally {
    client.close();
  }
}

