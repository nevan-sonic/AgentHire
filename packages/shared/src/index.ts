export type HealthEndpoint = {
  path: "/health";
  response: {
    status: "ok";
    service: "agenthire-api";
  };
};

export type SelectionStrategy = "cheapest_eligible" | "expected_cost";

export type ProcurementTask = {
  taskId: string;
  taskType: "statistics.summary";
  capability: "statistics.summary";
  input: number[];
  maxBudgetTinybars: string;
  deadlineMs: number;
  minimumReliabilityBps: number;
  selectionStrategy: SelectionStrategy;
};

export type WorkerProfile = {
  workerId: string;
  displayName: string;
  capabilities: readonly string[];
  description: string;
  taskTypes: readonly string[];
  endpoint: string;
  merchant: string;
  pricingPolicy: "flat-per-task";
  priceTinybars: string;
  estimatedLatencyMs: number;
  available: boolean;
  capabilityEvidenceRef?: string;
  reliabilityBps: number;
  reliabilitySource: "demo-assumption";
  kind: "demo-adapter";
};

export type ProcurementBid = {
  bidId: string;
  taskId: string;
  workerId: string;
  capability: "statistics.summary";
  priceTinybars: string;
  estimatedLatencyMs: number;
  reliabilityBps: number;
  expiresAt: string;
  merchant: string;
  endpoint: string;
  network: "hedera:testnet";
  asset: "0.0.0";
  status: "offered";
};

export type ProcurementPaymentHandoff = {
  workerId: string;
  endpoint: string;
  merchant: string;
  network: "hedera:testnet";
  asset: "0.0.0";
  maxAuthorizedPaymentTinybars: string;
  input: { values: number[] };
  taskId: string;
  bidId: string;
  expiresAt: string;
  paymentAuthorized: false;
};
