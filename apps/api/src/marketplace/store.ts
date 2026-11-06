import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProcurementTask } from "@agenthire/shared";

export type Job = {
  id: string; title: string; mode: "preview" | "live"; task: ProcurementTask; maxTest: string;
  status: string; createdAt: string;
};

export class JobStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, job TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS job_events ON events(job, id);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_challenges (nonce TEXT PRIMARY KEY, signal TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS verified_publishers (nullifier TEXT PRIMARY KEY, agent TEXT UNIQUE NOT NULL);
    `);
  }
  close() { this.db.close(); }
  create(job: Job) {
    this.atomic(() => {
      this.db.prepare("INSERT INTO jobs VALUES (?, ?, ?)").run(job.id, job.status, JSON.stringify(job));
      this.event(job.id, "job.created", { mode: job.mode });
    });
  }
  job(id: string): Job | null {
    const row = this.db.prepare("SELECT status, body FROM jobs WHERE id=?").get(id);
    return row ? { ...JSON.parse(String(row.body)), status: String(row.status) } : null;
  }
  list() {
    return this.db.prepare("SELECT id FROM jobs ORDER BY rowid DESC LIMIT 100").all().map(({ id }) => this.job(String(id)));
  }
  event(job: string, kind: string, data: object = {}) {
    this.db.prepare("INSERT INTO events(job, kind, data, at) VALUES (?, ?, ?, ?)").run(job, kind, JSON.stringify(data), new Date().toISOString());
  }
  events(job: string, cursor = 0) {
    return this.db.prepare("SELECT id, kind, data, at FROM events WHERE job=? AND id>? ORDER BY id LIMIT 200")
      .all(job, cursor).map(row => ({ id: Number(row.id), kind: String(row.kind), data: JSON.parse(String(row.data)), at: String(row.at) }));
  }
  transition(id: string, from: string, to: string, kind: string, data: object = {}) {
    return this.atomic(() => {
      if (!this.db.prepare("UPDATE jobs SET status=? WHERE id=? AND status=?").run(to, id, from).changes) return false;
      this.event(id, kind, data);
      return true;
    });
  }
  agent(id: string, data: object) {
    this.db.prepare("INSERT INTO agents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id, JSON.stringify(data));
  }
  savePublishChallenge(nonce: string, signal: string, expires: number) {
    this.db.prepare("DELETE FROM publish_challenges WHERE expires <= ?").run(Math.floor(Date.now() / 1000));
    this.db.prepare("INSERT INTO publish_challenges VALUES (?, ?, ?)").run(nonce, signal, expires);
  }
  hasPublishChallenge(nonce: string, signal: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM publish_challenges WHERE nonce=? AND signal=? AND expires>?")
      .get(nonce, signal, Math.floor(Date.now() / 1000)));
  }
  publishAgent(nonce: string, signal: string, nullifier: string, id: string, data: object) {
    this.atomic(() => {
      if (!this.hasPublishChallenge(nonce, signal)) throw new Error("Publishing challenge expired");
      this.db.prepare("INSERT INTO verified_publishers VALUES (?, ?)").run(nullifier, id);
      this.db.prepare("INSERT INTO agents VALUES (?, ?)").run(id, JSON.stringify(data));
      this.db.prepare("DELETE FROM publish_challenges WHERE nonce=?").run(nonce);
    });
  }
  listCustomAgents(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT body FROM agents JOIN verified_publishers ON agents.id=verified_publishers.agent ORDER BY agents.rowid DESC LIMIT 100")
      .all().map(row => JSON.parse(String(row.body)) as Record<string, unknown>);
  }
  observations(id: string) {
    const row = this.db.prepare(`SELECT count(*) FILTER (WHERE json_extract(data, '$.passed') = 1) AS passed,
      count(*) FILTER (WHERE json_extract(data, '$.passed') = 0) AS failed
      FROM events WHERE kind='capability_test.completed' AND json_extract(data, '$.workerId') = ?`).get(id);
    return { passed: Number(row?.passed ?? 0), failed: Number(row?.failed ?? 0) };
  }
  recoverable() {
    return this.db.prepare("SELECT id FROM jobs WHERE status IN ('queued','discovering','executing')").all().map(row => this.job(String(row.id)));
  }
  private atomic<T>(work: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
