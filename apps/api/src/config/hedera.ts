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

  const operatorAccountId = parseHederaAccountId(id, "HEDERA_OPERATOR_ID");
  const operatorKey = parseHederaPrivateKey(key, "HEDERA_OPERATOR_KEY");
  const mirrorNodeUrl = loadHederaMirrorNodeUrl(env);
  return { network, operatorAccountId, operatorKey, mirrorNodeUrl } as const;
}

export function loadHederaMirrorNodeUrl(env: NodeJS.ProcessEnv) {
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

  return mirrorNodeUrl;
}

export function parseHederaAccountId(id: string, label: string): AccountId {
  try {
    if (!/^\d+\.\d+\.\d+$/.test(id)) throw new Error();
    const accountId = AccountId.fromString(id);
    if (accountId.toString() !== id) throw new Error();
    return accountId;
  } catch {
    throw new Error(`${label} must be a numeric Hedera account ID`);
  }
}

export function parseHederaPrivateKey(key: string, label: string): PrivateKey {
  try {
    const raw = /^(?:(ed25519|ecdsa):)?([a-f0-9]{64})$/i.exec(key);
    if (raw) {
      const [, algorithm, hex] = raw;
      return algorithm?.toLowerCase() === "ecdsa"
        ? PrivateKey.fromStringECDSA(hex)
        : PrivateKey.fromStringED25519(hex);
    }
    if (/^(?:[a-f0-9]{2})+$/i.test(key) && PrivateKey.isDerKey(key)) {
      return PrivateKey.fromStringDer(key);
    }
    throw new Error();
  } catch {
    throw new Error(`${label} is not a supported Hedera private key`);
  }
}

export type HederaConfig = ReturnType<typeof loadHederaConfig>;
