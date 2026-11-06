import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

try {
  try { process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const [action, input] = process.argv.slice(2);
  const token = process.env.MARKETPLACE_OPERATOR_TOKEN;
  if (!input || !token || token.length < 32 || !["preflight", "authorize", "reconcile"].includes(action)) throw new Error();
  const policy = action === "authorize" ? JSON.parse(await readFile(input, "utf8")) : undefined;
  const id = policy?.goalId ?? input;
  const port = Number(process.env.API_PORT ?? "3001");
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  const response = await fetch(`http://localhost:${port}/api/marketplace/goals/${id}/${action}`, {
    method: policy ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(25_000),
    headers: { authorization: "Bearer " + token, ...(policy ? { "content-type": "application/json" } : {}) },
    ...(policy ? { body: JSON.stringify(policy) } : {}),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
} catch {
  console.error("Research operator command stopped. Verify the action, operator token, goal, and exact reviewed scope.");
  process.exitCode = 1;
}
