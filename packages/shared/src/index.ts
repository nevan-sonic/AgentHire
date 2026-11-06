export type HealthEndpoint = {
  path: "/health";
  response: {
    status: "ok";
    service: "agenthire-api";
  };
};

export type SelectionStrategy = "cheapest_eligible" | "expected_cost" | "adaptive_pocp";

export type ProcurementTask = {
  taskId: string;
  taskType: "statistics.summary";
  capability: "statistics.summary";
  input: number[];
  maxBudgetTinybars: string;
  deadlineMs: number;
  minimumReliabilityBps: number;
  selectionStrategy: SelectionStrategy;
  pocp?: { failurePenaltyTinybars: string };
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
  reliabilitySource: "demo-assumption" | "bayesian-prior";
  kind: "demo-adapter" | "first-party-service";
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

export type PocpPaymentPlan = {
  test: { testId: string; workerId: string; priceTinybars: string } | null;
  testPaymentStatus: "not_required" | "simulated" | "pending" | "planned" | "quoted" |
    "authorized" | "submitted" | "settled" | "verified" | "failed" | "uncertain";
  finalWorker: ProcurementPaymentHandoff | null;
  finalBid: ProcurementBid | null;
  totalBudgetTinybars: string;
  remainingAfterTestTinybars: string;
  paymentAuthorized: false;
};

export type MarketplaceOffer = {
  bid: ProcurementBid;
  inputDigest: string;
  testPrice: string;
  testEndpoint: string;
  maxInput: number;
};

export type MarketplaceAgent = {
  id: string;
  name: string;
  description: string;
  maxInput: number;
  basePrice: number;
  reliabilityBps: number;
  health: "online" | "unavailable";
  merchant: string;
  endpoint: string;
  network: "hedera:testnet";
  asset: "0.0.0";
  capability: string;
  designation: "first-party";
  checkedAt: string;
  registration: "registered";
  verification: string;
  observations: { passed: number; failed: number };
};

export type GoalCapability = "web.research" | "document.report" | "verification.artifacts";

export type GoalStep = {
  id: string;
  capability: GoalCapability;
  objective: string;
  dependencies: string[];
  acceptance: string[];
  queries: string[];
};

export type MissionEnvelope = {
  protocol: "agenthire-a2a";
  version: "1.0";
  missionId: string;
  goalId: string;
  parentMissionId: string;
  sender: "lead-research";
  recipient: "research" | "report-writer" | "verification";
  capability: GoalCapability;
  objective: string;
  inputArtifacts: string[];
  expectedOutput: "source-collection" | "report" | "verification";
  acceptance: string[];
  authorization: { maxSpendTinybars: string; tools: ("github.search" | "github.read")[]; maxDelegationDepth: 0; expiresAt: string };
  inputDigest: string;
  idempotencyKey: string;
  status: "ready" | "running" | "completed" | "failed";
};
