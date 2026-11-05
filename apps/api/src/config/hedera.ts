import { AccountId, PrivateKey } from "@hiero-ledger/sdk";

export function loadHederaConfig(env: NodeJS.ProcessEnv) {
  const network = env.HEDERA_NETWORK?.trim() ?? "testnet";
  if (network !== "testnet") {
    throw new Error("HEDERA_NETWORK must be testnet");
  }

  const id = env.HEDERA_OPERATOR_ID?.trim();
  const key = env.HEDERA_OPERATOR_KEY?.trim();
  if (!id || !key) {
    throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are required");
  }

  let operatorAccountId: AccountId;
  try {
    if (!/^\d+\.\d+\.\d+$/.test(id)) throw new Error();
    operatorAccountId = AccountId.fromString(id);
    if (operatorAccountId.toString() !== id) throw new Error();
  } catch {
    throw new Error("HEDERA_OPERATOR_ID must be a numeric Hedera account ID");
  }

  let operatorKey: PrivateKey;
  try {
    const raw = /^(?:(ed25519|ecdsa):)?([a-f0-9]{64})$/i.exec(key);
    if (raw) {
      const [, algorithm, hex] = raw;
      operatorKey = algorithm?.toLowerCase() === "ecdsa"
        ? PrivateKey.fromStringECDSA(hex)
        : PrivateKey.fromStringED25519(hex);
    } else if (/^(?:[a-f0-9]{2})+$/i.test(key) && PrivateKey.isDerKey(key)) {
      operatorKey = PrivateKey.fromStringDer(key);
    } else {
      throw new Error();
    }
  } catch {
    throw new Error("HEDERA_OPERATOR_KEY is not a supported Hedera private key");
  }

  let mirrorNodeUrl: URL;
  try {
    mirrorNodeUrl = new URL(
      env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com",
    );
    if (
      mirrorNodeUrl.protocol !== "https:" ||
      mirrorNodeUrl.username || mirrorNodeUrl.password ||
      mirrorNodeUrl.search || mirrorNodeUrl.hash ||
      !["/", "/api/v1", "/api/v1/"].includes(mirrorNodeUrl.pathname)
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("HEDERA_MIRROR_NODE_URL must be an HTTPS base URL without credentials");
  }

  return { network, operatorAccountId, operatorKey, mirrorNodeUrl };
}

export type HederaConfig = ReturnType<typeof loadHederaConfig>;
