import type { DatabaseSync } from "node:sqlite";
import { isRecord, tinybars } from "../agents/task.js";
import { validPayer } from "../x402/protocol.js";
import { X402_ASSET, X402_MAX_FEE, X402_NETWORK } from "../x402/config.js";
import type { ResearchBid, ResearchTask } from "./research-protocol.js";

export type ResearchScope = {
  goalId: string; parentId: string; missionId: string; planHash: string; payer: string;
  merchants: string[]; endpoints: string[]; capability: "web.research"; network: typeof X402_NETWORK; asset: typeof X402_ASSET;
  total: string; parentAllocation: string; childAllocation: string; maxTest: string; maxHire: string;
  maxPerPayment: string; maxPayments: number; maxSponsoredFee: string; expiresAt: string;
  maxAuditMessages: number; maxAuditFee: string; maxDelegationDepth: 1;
};
const keys = ["goalId", "parentId", "missionId", "planHash", "payer", "merchants", "endpoints", "capability", "network", "asset",
  "total", "parentAllocation", "childAllocation", "maxTest", "maxHire", "maxPerPayment", "maxPayments", "maxSponsoredFee",
  "expiresAt", "maxAuditMessages", "maxAuditFee", "maxDelegationDepth"];
export const researchAuditFee = 10_000_000n;
export function validateResearchScope(raw: unknown, task: ResearchTask, planHash: string, bids: ResearchBid[],
  budget: string, maxTest: string, payer: string | undefined): ResearchScope {
  if (!isRecord(raw) || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key)) ||
      raw.goalId !== task.goalId || raw.parentId !== task.parentId || raw.missionId !== task.missionId ||
      raw.planHash !== planHash || raw.payer !== payer || typeof raw.payer !== "string" || raw.capability !== "web.research" ||
      raw.network !== X402_NETWORK || raw.asset !== X402_ASSET || raw.maxDelegationDepth !== 1 ||
      !Array.isArray(raw.merchants) || raw.merchants.length < 1 || raw.merchants.length > 2 ||
      !raw.merchants.every(merchant => typeof merchant === "string" && validPayer(payer, merchant) && bids.some(bid => bid.merchant === merchant)) ||
      !Array.isArray(raw.endpoints) || raw.endpoints.length < 1 || raw.endpoints.length > 4 ||
      !raw.endpoints.every(endpoint => bids.some(bid => [bid.endpoint, bid.testEndpoint].includes(endpoint) && (raw.merchants as string[]).includes(bid.merchant))) ||
      !tinybars(raw.total) || !tinybars(raw.parentAllocation) || !tinybars(raw.childAllocation) || !tinybars(raw.maxTest) ||
      !tinybars(raw.maxHire) || !tinybars(raw.maxPerPayment) || !tinybars(raw.maxAuditFee) ||
      BigInt(raw.total) > BigInt(budget) || BigInt(raw.parentAllocation) > BigInt(raw.total) ||
      BigInt(raw.childAllocation) > BigInt(raw.parentAllocation) || raw.childAllocation === "0" ||
      BigInt(raw.maxTest) > BigInt(maxTest) || BigInt(raw.maxHire) > BigInt(raw.childAllocation) || raw.maxHire === "0" ||
      BigInt(raw.maxTest) > BigInt(raw.childAllocation) || BigInt(raw.maxPerPayment) > BigInt(raw.childAllocation) ||
      (raw.maxPayments !== 1 && raw.maxPayments !== 2) || raw.maxSponsoredFee !== X402_MAX_FEE.toString() ||
      typeof raw.expiresAt !== "string" || !Number.isFinite(Date.parse(raw.expiresAt)) ||
      Date.parse(raw.expiresAt) <= Date.now() || Date.parse(raw.expiresAt) > Date.now() + 600_000 ||
      typeof raw.maxAuditMessages !== "number" || !Number.isInteger(raw.maxAuditMessages) ||
      raw.maxAuditMessages < 0 || raw.maxAuditMessages > 12 || BigInt(raw.maxAuditFee) > BigInt(raw.maxAuditMessages) * researchAuditFee) {
    throw new Error("Invalid delegated authorization");
  }
  return raw as ResearchScope;
}

type State = "reserved" | "submitted" | "uncertain" | "settled" | "released";
type Intent = { id: string; phase: "test" | "hire"; amount: string; workerId: string; merchant: string; state: State; transactionId?: string; fee?: string };

export class ResearchLedger {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS research_authorizations(goal TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_intents(id TEXT PRIMARY KEY, goal TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_observations(intent TEXT PRIMARY KEY, worker TEXT NOT NULL, phase TEXT NOT NULL,
        passed INTEGER NOT NULL, body TEXT NOT NULL);`);
  }
  scope(goalId: string) {
    const row = this.db.prepare("SELECT body FROM research_authorizations WHERE goal=?").get(goalId);
    return row ? JSON.parse(String(row.body)) as ResearchScope : null;
  }
  approve(scope: ResearchScope) {
    this.db.prepare("INSERT INTO research_authorizations VALUES (?, ?)").run(scope.goalId, JSON.stringify(scope));
  }
  intents(goalId: string) {
    return this.db.prepare("SELECT body FROM research_intents WHERE goal=? ORDER BY rowid").all(goalId)
      .map(row => JSON.parse(String(row.body)) as Intent);
  }
  summary(goalId: string) {
    const scope = this.scope(goalId);
    if (!scope) return null;
    const intents = this.intents(goalId);
    const sum = (states: State[]) => intents.filter(row => states.includes(row.state)).reduce((total, row) => total + BigInt(row.amount), 0n);
    const reserved = sum(["reserved", "submitted", "uncertain"]);
    const settled = sum(["settled"]);
    const fee = intents.reduce((total, row) => total + BigInt(row.fee ?? "0"), 0n);
    return { scope, intents, reserved: reserved.toString(), settled: settled.toString(), released: sum(["released"]).toString(),
      available: (BigInt(scope.childAllocation) - reserved - settled).toString(),
      unallocatedGoal: (BigInt(scope.total) - BigInt(scope.parentAllocation)).toString(),
      unallocatedParent: (BigInt(scope.parentAllocation) - BigInt(scope.childAllocation)).toString(), sponsoredFees: fee.toString() };
  }
  reserve(scope: ResearchScope, intent: Omit<Intent, "state">, endpoint: string, merchant: string) {
    this.atomic(() => {
      const summary = this.summary(scope.goalId);
      if (!summary || JSON.stringify(summary.scope) !== JSON.stringify(scope) || Date.now() >= Date.parse(scope.expiresAt) ||
          !scope.endpoints.includes(endpoint) || !scope.merchants.includes(merchant) ||
          !tinybars(intent.amount) || intent.amount === "0" || summary.intents.length >= scope.maxPayments ||
          summary.intents.some(row => row.phase === intent.phase || row.state === "reserved" || row.state === "submitted" || row.state === "uncertain") || BigInt(intent.amount) > BigInt(summary.available) ||
          BigInt(intent.amount) > BigInt(scope.maxPerPayment) ||
          BigInt(intent.amount) > BigInt(intent.phase === "test" ? scope.maxTest : scope.maxHire)) throw new Error("Research budget rejected");
      this.db.prepare("INSERT INTO research_intents VALUES (?, ?, ?)").run(intent.id, scope.goalId,
        JSON.stringify({ ...intent, state: "reserved" }));
    });
  }
  mark(id: string, from: State[], state: State, fields: Pick<Intent, "transactionId" | "fee"> = {}) {
    this.atomic(() => {
      const row = this.db.prepare("SELECT body FROM research_intents WHERE id=?").get(id);
      const current = row ? JSON.parse(String(row.body)) as Intent : null;
      if (!current || !from.includes(current.state) || current.state === "settled" || current.state === "released") {
        throw new Error("Invalid payment intent transition");
      }
      this.db.prepare("UPDATE research_intents SET body=? WHERE id=?").run(JSON.stringify({ ...current, ...fields, state }), id);
    });
  }
  observe(worker: string, phase: "test" | "hire", intent: string, passed: boolean, evidence: object) {
    this.db.prepare("INSERT OR IGNORE INTO research_observations VALUES (?, ?, ?, ?, ?)").run(intent, worker, phase, Number(passed),
      JSON.stringify({ ...evidence, capability: "web.research", at: new Date().toISOString() }));
  }
  observations(worker: string) {
    return this.db.prepare("SELECT passed FROM research_observations WHERE worker=? ORDER BY rowid").all(worker)
      .map(row => Number(row.passed) === 1);
  }
  private atomic(work: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try { work(); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
