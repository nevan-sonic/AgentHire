import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AccountId,
  PrivateKey,
  Status,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { runHtsDemo } from "../src/cli/hts-demo.js";
import { loadHederaConfig } from "../src/config/hedera.js";
import { createHederaClient } from "../src/hedera/client.js";
import {
  associateToken,
  createFungibleToken,
  hashScanTransactionUrl,
  readTokenBalance,
  transferFungibleToken,
  verifyDemoToken,
} from "../src/hedera/token.js";

const env = {
  HEDERA_OPERATOR_ID: "0.0.111",
  HEDERA_OPERATOR_KEY: PrivateKey.generateED25519().toStringDer(),
};
const tokenId = "0.0.222";
const recipient = "0.0.333";

function mockResponse(status: Status, id?: TokenId) {
  const query = {
    setValidateStatus(validate: boolean) {
      assert.equal(validate, false);
      return query;
    },
    execute: async () => ({ status, tokenId: id }),
  };
  return { getReceiptQuery: () => query };
}

test("creates fixed supply AHC with the operator treasury and returns its receipt", async (t) => {
  const client = createHederaClient(loadHederaConfig(env));
  t.after(() => client.close());
  const execute = t.mock.method(TokenCreateTransaction.prototype, "execute", async function (
    this: TokenCreateTransaction,
  ) {
    assert.equal(this.tokenName, "AgentHire Credit");
    assert.equal(this.tokenSymbol, "AHC");
    assert.equal(this.decimals?.toString(), "2");
    assert.equal(this.initialSupply?.toString(), "100000");
    assert.equal(this.maxSupply?.toString(), "100000");
    assert.equal(this.tokenType, TokenType.FungibleCommon);
    assert.equal(this.supplyType, TokenSupplyType.Finite);
    assert.equal(this.treasuryAccountId?.toString(), env.HEDERA_OPERATOR_ID);
    assert.equal(this.adminKey, null);
    assert.equal(this.supplyKey, null);
    assert.equal(this.regenerateTransactionId, false);
    return mockResponse(Status.Success, TokenId.fromString(tokenId));
  });
  const result = await createFungibleToken(client);
  assert.equal(result.receiptStatus, "SUCCESS");
  assert.equal(result.tokenId, tokenId);
  assert.match(result.transactionId, /^0\.0\.111@\d+\.\d+$/);
  assert.equal(result.hashScanUrl, hashScanTransactionUrl(result.transactionId));
  assert.equal(execute.mock.callCount(), 1);
});

test("requires a separate recipient signature and reports an existing association", async (t) => {
  const client = createHederaClient(loadHederaConfig(env));
  t.after(() => client.close());
  const key = PrivateKey.generateED25519();
  const sign = t.mock.method(TokenAssociateTransaction.prototype, "sign");
  const execute = t.mock.method(TokenAssociateTransaction.prototype, "execute", async function (
    this: TokenAssociateTransaction,
  ) {
    assert.equal(this.accountId?.toString(), recipient);
    assert.equal(this.tokenIds?.[0].toString(), tokenId);
    assert.equal(sign.mock.callCount(), 1);
    assert.equal(sign.mock.calls[0].arguments[0], key);
    return mockResponse(Status.TokenAlreadyAssociatedToAccount);
  });
  await assert.rejects(associateToken(client, { tokenId, recipient }), /must sign/);
  assert.equal(execute.mock.callCount(), 0);
  const result = await associateToken(client, { tokenId, recipient, recipientKey: key });
  assert.equal(result.alreadyAssociated, true);
  assert.equal(result.receiptStatus, "TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT");
  assert.equal(execute.mock.callCount(), 1);
});

test("transfers precise base units from the operator and rejects invalid inputs before submission", async (t) => {
  const client = createHederaClient(loadHederaConfig(env));
  t.after(() => client.close());
  const amount = 9_007_199_254_740_993n;
  const execute = t.mock.method(TransferTransaction.prototype, "execute", async function (
    this: TransferTransaction,
  ) {
    const transfers = this.tokenTransfers.get(TokenId.fromString(tokenId));
    assert.equal(transfers?.get(AccountId.fromString(env.HEDERA_OPERATOR_ID))?.toString(), (-amount).toString());
    assert.equal(transfers?.get(AccountId.fromString(recipient))?.toString(), amount.toString());
    return mockResponse(Status.Success);
  });
  const getBalance = async (sender: string, id: string) => {
    assert.equal(sender, env.HEDERA_OPERATOR_ID);
    assert.equal(id, tokenId);
    return amount;
  };
  await assert.rejects(transferFungibleToken(client, { tokenId, recipient, amount }, async () => 1n), /Insufficient/);
  await assert.rejects(transferFungibleToken(client, { tokenId: "bad", recipient, amount }, getBalance), /token ID/);
  await assert.rejects(transferFungibleToken(client, { tokenId, recipient: "bad", amount }, getBalance), /account ID/);
  await assert.rejects(transferFungibleToken(client, { tokenId, recipient, amount: 0n }, getBalance), /positive/);
  assert.equal(execute.mock.callCount(), 0);
  const result = await transferFungibleToken(client, { tokenId, recipient, amount }, getBalance);
  assert.equal(result.amount, amount.toString());
  assert.equal(result.sender, env.HEDERA_OPERATOR_ID);
  assert.equal(result.recipient, recipient);
  assert.equal(result.receiptStatus, "SUCCESS");
});

test("retains the transaction ID and HashScan link on failed or unknown receipts", async (t) => {
  const client = createHederaClient(loadHederaConfig(env));
  t.after(() => client.close());
  let attempt = 0;
  t.mock.method(TokenCreateTransaction.prototype, "execute", async () => {
    if (attempt++ === 0) return mockResponse(Status.InvalidSignature);
    throw new Error("internal test marker");
  });
  await assert.rejects(createFungibleToken(client), /INVALID_SIGNATURE.*https:\/\/hashscan.io\/testnet\/transaction\//);
  await assert.rejects(createFungibleToken(client), /Could not confirm transaction .*Check https:\/\/hashscan.io/);
  assert.equal(
    hashScanTransactionUrl("0.0.111@1793920000.123456789"),
    "https://hashscan.io/testnet/transaction/0.0.111-1793920000-123456789",
  );
});

test("reads large indexed balances without rounding JSON integers", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.href, "https://mirror.example.test/api/v1/accounts/0.0.111/tokens?token.id=0.0.222&limit=1");
    return new Response('{"tokens":[{"token_id":"0.0.222","balance":9007199254740993}]}');
  });
  assert.equal(
    await readTokenBalance(new URL("https://mirror.example.test"), env.HEDERA_OPERATOR_ID, tokenId),
    9_007_199_254_740_993n,
  );
});

test("the CLI previews every operation and rejects execute without an explicit operation", async (t) => {
  const mocks = [TokenCreateTransaction, TokenAssociateTransaction, TransferTransaction]
    .map((transaction) => t.mock.method(transaction.prototype, "execute", () => assert.fail("Unexpected write")));
  const lines: string[] = [];
  const settings = {
    ...env,
    HEDERA_HTS_TOKEN_ID: tokenId,
    HEDERA_HTS_RECIPIENT_ID: recipient,
    HEDERA_HTS_RECIPIENT_KEY: PrivateKey.generateED25519().toStringDer(),
  };
  for (const operation of [[], ["--create"], ["--associate"], ["--transfer"]]) {
    await runHtsDemo(operation, settings, (line) => lines.push(line));
  }
  await assert.rejects(runHtsDemo(["--execute"], settings), /Choose one/);
  await assert.rejects(runHtsDemo(["--create", "--transfer", "--execute"], settings), /Choose one/);
  assert.ok(lines.every((line) => JSON.parse(line).mode === "dry-run"));
  assert.ok(lines.every((line) => !line.includes(settings.HEDERA_HTS_RECIPIENT_KEY) && !line.includes(env.HEDERA_OPERATOR_KEY)));
  assert.ok(mocks.every((mock) => mock.mock.callCount() === 0));
});

test("the demo checks token identity and treasury before using an existing token", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.pathname, "/api/v1/tokens/0.0.222");
    return Response.json({
      name: "AgentHire Credit", symbol: "AHC", decimals: "2", type: "FUNGIBLE_COMMON",
      deleted: false, treasury_account_id: env.HEDERA_OPERATOR_ID,
    });
  });
  const mirror = new URL("https://mirror.example.test");
  await verifyDemoToken(mirror, tokenId, env.HEDERA_OPERATOR_ID);
  await assert.rejects(verifyDemoToken(mirror, tokenId, recipient), /active AHC token for this treasury/);
});
