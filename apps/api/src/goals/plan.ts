import type { GoalCapability, GoalStep } from "@agenthire/shared";
import { isRecord } from "../agents/task.js";

const capabilities: GoalCapability[] = ["web.research", "document.report", "verification.artifacts"];
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const strings = (value: unknown, max: number, length: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every(entry => text(entry, length));

export function validatePlan(value: unknown): GoalStep[] {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.steps) ||
      value.steps.length < 3 || value.steps.length > 4) throw new Error("Invalid goal plan");
  const steps: GoalStep[] = value.steps.map(raw => {
    if (!isRecord(raw) || Object.keys(raw).length !== 6 || !text(raw.id, 24) || !/^[a-z][a-z0-9-]*$/.test(raw.id) ||
        !capabilities.includes(raw.capability as GoalCapability) || !text(raw.objective, 350) ||
        !strings(raw.dependencies, 3, 24) || new Set(raw.dependencies).size !== raw.dependencies.length ||
        !strings(raw.acceptance, 4, 180) || !raw.acceptance.length || !strings(raw.queries, 2, 90) ||
        (raw.capability === "web.research" ? !raw.queries.length || raw.dependencies.length > 0 : raw.queries.length > 0)) {
      throw new Error("Unsupported or malformed goal step");
    }
    return { id: raw.id, capability: raw.capability as GoalCapability, objective: raw.objective,
      dependencies: raw.dependencies, acceptance: raw.acceptance, queries: raw.queries };
  });
  const remaining = new Map(steps.map(step => [step.id, step]));
  if (remaining.size !== steps.length) throw new Error("Duplicate goal step");
  const ordered: GoalStep[] = [];
  while (remaining.size) {
    const next = [...remaining.values()].find(step => step.dependencies.every(id => ordered.some(done => done.id === id)));
    if (!next) throw new Error("Circular or unknown goal dependency");
    ordered.push(next);
    remaining.delete(next.id);
  }
  const research = ordered.filter(step => step.capability === "web.research");
  const reports = ordered.filter(step => step.capability === "document.report");
  const checks = ordered.filter(step => step.capability === "verification.artifacts");
  if (!research.length || reports.length !== 1 || checks.length !== 1 ||
      reports[0].dependencies.length !== research.length || !research.every(step => reports[0].dependencies.includes(step.id)) ||
      checks[0].dependencies.length !== 1 || checks[0].dependencies[0] !== reports[0].id) throw new Error("Invalid research-to-verification graph");
  return ordered;
}

export const planPrompt = "Return a single JSON object with a single key 'steps' containing an array of 3 or 4 step objects. Format: {\"steps\": [{\"id\": \"research\", \"capability\": \"web.research\", \"objective\": \"...\", \"dependencies\": [], \"acceptance\": [\"...\"], \"queries\": [\"search-term\"]}, {\"id\": \"report\", \"capability\": \"document.report\", \"objective\": \"...\", \"dependencies\": [\"research\"], \"acceptance\": [\"...\"], \"queries\": []}, {\"id\": \"verify\", \"capability\": \"verification.artifacts\", \"objective\": \"...\", \"dependencies\": [\"report\"], \"acceptance\": [\"...\"], \"queries\": []}]}. id must be a simple lowercase slug (e.g. 'research', 'report', 'verify') with only letters and hyphens (NO dots). Use 1 or 2 independent web.research steps with 1-2 search terms each and empty dependencies. Use exactly one document.report depending on all research step ids with empty queries, and exactly one verification.artifacts depending only on the report with empty queries. You cannot assign tools, permissions, prices or payments.";
