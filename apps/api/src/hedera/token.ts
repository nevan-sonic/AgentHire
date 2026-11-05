import {
  Hbar,
  Status,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import type { Client, PrivateKey, Transaction } from "@hiero-ledger/sdk";
import { parseHederaAccountId } from "../config/hedera.js";

export const AHC = {
  name: "AgentHire Credit",
  symbol: "AHC",
  decimals: 2,
  initialSupply: 100_000n,
} as const;

export const HTS_FEE_CAPS = { create: 50, associate: 5, transfer: 5 } as const;

export type HtsTransactionResult = {
  transactionId: string;
  receiptStatus: string;
  hashScanUrl: string;
};
export type CreateTokenResult = HtsTransactionResult & { tokenId: string };
export type AssociateTokenInput = { tokenId: string; recipient: string; recipientKey?: PrivateKey };
export type AssociateTokenResult = HtsTransactionResult & { alreadyAssociated: boolean };
export type TransferTokenInput = { tokenId: string; recipient: string; amount: bigint };
export type TransferTokenResult = HtsTransactionResult & {
  tokenId: string;
  sender: string;
  recipient: string;
  amount: string;
};

export function parseTokenId(value: string) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error("Expected a numeric Hedera token ID");
  const id = TokenId.fromString(value);
  if (id.toString() !== value || id.num.isZero()) throw new Error("Expected a numeric Hedera token ID");
  return id;
}

export function hashScanTransactionUrl(transactionId: string) {
  return `https://hashscan.io/testnet/transaction/${transactionId.replace(/@(\d+)\.(\d+)$/, "-$1-$2")}`;
}

function operatorId(client: Client) {
  if (!client.operatorAccountId) throw new Error("Configure a testnet operator");
  return client.operatorAccountId;
}

async function submit(client: Client, transaction: Transaction, signer?: PrivateKey) {
  let frozen: Transaction;
  try {
    frozen = transaction.setRegenerateTransactionId(false).freezeWith(client);
    if (signer) await frozen.sign(signer);
  } catch {
    throw new Error("Could not prepare or sign the HTS transaction");
  }
  const transactionId = frozen.transactionId?.toString();
  if (!transactionId) throw new Error("Could not assign a transaction ID");
  const hashScanUrl = hashScanTransactionUrl(transactionId);

  try {
    const response = await frozen.execute(client, 15_000);
    const receipt = await response.getReceiptQuery(client).setValidateStatus(false).execute(client, 20_000);
    return { receipt, transactionId, receiptStatus: receipt.status.toString(), hashScanUrl };
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status instanceof Status) {
      throw new Error(`Transaction ${transactionId} returned ${error.status.toString()}. ${hashScanUrl}`);
    }
    throw new Error(`Could not confirm transaction ${transactionId}. Check ${hashScanUrl} before retrying.`);
  }
}

function requireSuccess(result: HtsTransactionResult) {
  if (result.receiptStatus !== Status.Success.toString()) {
    throw new Error(`Transaction ${result.transactionId} returned ${result.receiptStatus}. ${result.hashScanUrl}`);
  }
}

export async function createFungibleToken(client: Client): Promise<CreateTokenResult> {
  const transaction = new TokenCreateTransaction()
    .setTokenName(AHC.name)
    .setTokenSymbol(AHC.symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(AHC.decimals)
    .setInitialSupply(AHC.initialSupply)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(AHC.initialSupply)
    .setTreasuryAccountId(operatorId(client))
    .setMaxTransactionFee(new Hbar(HTS_FEE_CAPS.create));
  const { receipt, ...result } = await submit(client, transaction);
  requireSuccess(result);
  if (!receipt.tokenId) {
    throw new Error(`Token ID missing from successful receipt. Check ${result.hashScanUrl} before retrying.`);
  }
  return { ...result, tokenId: receipt.tokenId.toString() };
}

export async function associateToken(client: Client, input: AssociateTokenInput): Promise<AssociateTokenResult> {
  const tokenId = parseTokenId(input.tokenId);
  const recipient = parseHederaAccountId(input.recipient, "Recipient");
  const isOperator = recipient.toString() === operatorId(client).toString();
  if (!isOperator && !input.recipientKey) throw new Error("A separate recipient must sign the association");

  const transaction = new TokenAssociateTransaction()
    .setAccountId(recipient)
    .setTokenIds([tokenId])
    .setMaxTransactionFee(new Hbar(HTS_FEE_CAPS.associate));
  const { receipt, ...result } = await submit(client, transaction, isOperator ? undefined : input.recipientKey);
  const alreadyAssociated = receipt.status.toString() === Status.TokenAlreadyAssociatedToAccount.toString();
  if (!alreadyAssociated) requireSuccess(result);
  return { ...result, alreadyAssociated };
}

export async function verifyDemoToken(mirrorNodeUrl: URL, tokenId: string, treasury: string) {
  const id = parseTokenId(tokenId).toString();
  const url = new URL(`/api/v1/tokens/${id}`, mirrorNodeUrl);
  let token: {
    name?: string;
    symbol?: string;
    decimals?: string | number;
    treasury_account_id?: string;
    type?: string;
    deleted?: boolean;
  };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error();
    token = await response.json();
  } catch {
    throw new Error("Could not verify the AHC token on the Mirror Node");
  }
  if (
    token?.name !== AHC.name || token.symbol !== AHC.symbol ||
    String(token.decimals) !== String(AHC.decimals) ||
    token.treasury_account_id !== treasury ||
    token.type !== "FUNGIBLE_COMMON" || token.deleted !== false
  ) {
    throw new Error("The configured token is not an active AHC token for this treasury");
  }
}

// Mirror Node relationships include the treasury's indexed balance in base units.
export async function readTokenBalance(mirrorNodeUrl: URL, accountId: string, tokenId: string): Promise<bigint> {
  const url = new URL(`/api/v1/accounts/${accountId}/tokens`, mirrorNodeUrl);
  url.searchParams.set("token.id", tokenId);
  url.searchParams.set("limit", "1");
  let data: { tokens?: { token_id: string; balance: unknown }[] };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error();
    data = JSON.parse(await response.text(), (key, value, context?: { source: string }) => {
      if (key === "balance" && typeof value === "number" && context && /^\d+$/.test(context.source)) {
        return context.source;
      }
      return value;
    });
  } catch {
    throw new Error("Could not read the treasury token balance from the Mirror Node");
  }
  if (!Array.isArray(data?.tokens)) throw new Error("Invalid Mirror Node token balance response");
  const relationship = data.tokens.find((token) => token.token_id === tokenId);
  if (!relationship) return 0n;
  const { balance } = relationship;
  if (typeof balance !== "string" || !/^\d+$/.test(balance)) {
    throw new Error("Invalid Mirror Node token balance");
  }
  return BigInt(balance);
}

export async function transferFungibleToken(
  client: Client,
  input: TransferTokenInput,
  getTreasuryBalance: (sender: string, tokenId: string) => Promise<bigint>,
): Promise<TransferTokenResult> {
  const tokenId = parseTokenId(input.tokenId);
  const recipient = parseHederaAccountId(input.recipient, "Recipient");
  const sender = operatorId(client);
  if (recipient.toString() === sender.toString()) throw new Error("Recipient must differ from treasury");
  if (typeof input.amount !== "bigint" || input.amount <= 0n || input.amount > (1n << 63n) - 1n) {
    throw new Error("Amount must be a positive signed 64-bit integer in base units");
  }
  if (await getTreasuryBalance(sender.toString(), tokenId.toString()) < input.amount) {
    throw new Error("Insufficient indexed treasury token balance");
  }

  const transaction = new TransferTransaction()
    .addTokenTransfer(tokenId, sender, -input.amount)
    .addTokenTransfer(tokenId, recipient, input.amount)
    .setMaxTransactionFee(new Hbar(HTS_FEE_CAPS.transfer));
  const { transactionId, receiptStatus, hashScanUrl } = await submit(client, transaction);
  const result = { transactionId, receiptStatus, hashScanUrl };
  requireSuccess(result);
  return {
    ...result,
    tokenId: tokenId.toString(),
    sender: sender.toString(),
    recipient: recipient.toString(),
    amount: input.amount.toString(),
  };
}
