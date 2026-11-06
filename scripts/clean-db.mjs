import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(".agenthire-marketplace/jobs.sqlite");
const allowed = ["researcher", "coder", "data-analyst", "report-writer", "doc-summarizer"];

// Remove all legacy / demo / extra agents from the database
db.exec(`
  DELETE FROM agents 
  WHERE id NOT IN ('researcher', 'coder', 'data-analyst', 'report-writer', 'doc-summarizer')
`);

console.log("Current persistent agents in database:", db.prepare("SELECT id FROM agents").all());
