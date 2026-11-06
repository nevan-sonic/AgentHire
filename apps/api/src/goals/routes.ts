import { eventStreams } from "../marketplace/sse.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { createGoal, executeGoal } from "./workflow.js";
import type { Goal } from "./workflow.js";

export function registerGoals(app: FastifyInstance, env: NodeJS.ProcessEnv, databasePath =
  fileURLToPath(new URL("../../../../.agenthire-marketplace/goals.sqlite", import.meta.url))) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO goals VALUES (?, ?)");
  const update = db.prepare("UPDATE goals SET body=? WHERE id=?");
  const select = db.prepare("SELECT body FROM goals WHERE id=?");
  const selectRecent = db.prepare("SELECT body FROM goals ORDER BY rowid DESC LIMIT 50");
  const active = new Set<Promise<void>>();
  const streams = eventStreams(24);
  const find = (id: string): Goal | null => {
    const row = select.get(id);
    return row ? JSON.parse(String(row.body)) as Goal : null;
  };
  function save(goal: Goal, kind: string, detail: object = {}) {
    goal.events.push({ id: goal.events.length + 1, kind, detail, at: new Date().toISOString() });
    update.run(JSON.stringify(goal), goal.id);
  }

  for (const row of db.prepare("SELECT body FROM goals WHERE json_extract(body, '$.status') IN ('queued','running')").all()) {
    const goal = JSON.parse(String(row.body)) as Goal;
    goal.status = "interrupted";
    save(goal, "goal.interrupted", { reason: "Process restarted. Previous records are retained for review." });
  }
  app.addHook("preClose", async () => { streams.close(); });
  app.addHook("onClose", async () => { await Promise.allSettled(active); db.close(); });
  app.get("/api/marketplace/goals", async () => selectRecent.all().map(row => {
    const goal = JSON.parse(String(row.body)) as Goal;
    return { id: goal.id, objective: goal.objective, status: goal.status, createdAt: goal.createdAt };
  }));
  let windowStart = Date.now();
  let created = 0;
  app.post("/api/marketplace/goals", { bodyLimit: 8192 }, async (request, reply) => {
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); created = 0; }
    if (active.size >= 2 || created >= 4) return reply.code(429).send({ error: "Goal execution limit reached" });
    let goal;
    try { goal = createGoal(request.body); } catch { return reply.code(400).send({ error: "Invalid goal or deliverable" }); }
    created++;
    const snapshot = structuredClone(goal);
    insert.run(goal.id, JSON.stringify(goal));
    const work = executeGoal(goal, env, (kind, detail) => save(goal, kind, detail));
    active.add(work);
    void work.catch(() => app.log.warn("Goal persistence stopped")).finally(() => active.delete(work));
    return reply.code(201).send(snapshot);
  });
  type Params = { goalId: string };
  app.get<{ Params: Params }>("/api/marketplace/goals/:goalId", async (request, reply) =>
    find(request.params.goalId) ?? reply.code(404).send({ error: "Goal not found" }));
  app.get<{ Params: Params; Querystring: { cursor?: string } }>("/api/marketplace/goals/:goalId/events", (request, reply) => {
    if (!find(request.params.goalId)) return reply.code(404).send({ error: "Goal not found" });
    return streams.open(reply, request.headers["last-event-id"] ?? request.query.cursor ?? "0",
      cursor => find(request.params.goalId)?.events.filter(event => event.id > cursor) ?? []);
  });
}
