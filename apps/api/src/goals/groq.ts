import { setTimeout as delay } from "node:timers/promises";
import { isRecord } from "../agents/task.js";
import { readBounded } from "./tools.js";

const maxCalls = 10;
const maxTokens = 64_000;
const outputLimit = 4096;

export class GroqClient {
  private requests = 0;
  private reserved = 0;
  constructor(private readonly env: NodeJS.ProcessEnv,
    private readonly usage: (record: object) => void,
    private readonly transport = fetch, prior: { requests: number; tokens: number } = { requests: 0, tokens: 0 }) {
    this.requests = prior.requests;
    this.reserved = prior.tokens;
  }

  async json(role: "MANAGER" | "WORKER" | "VERIFIER", instruction: string, data: unknown) {
    const key = this.env.GROQ_API_KEY?.trim();
    if (this.env.GROQ_GOALS_ENABLED !== "true" || !key) throw new Error("Groq goals require server configuration and usage enablement");
    const content = JSON.stringify(data);
    if (content.length + instruction.length > 14_000) throw new Error("Inference input exceeds the goal limit");
    // Conservative UTF-8 byte reservation accounts for unknown usage after a timeout.
    const reserve = Buffer.byteLength(content + instruction) + outputLimit + 256;
    const model = this.env[`GROQ_${role}_MODEL`] ?? "openai/gpt-oss-20b";
    if (!/^[a-z0-9][a-z0-9./_-]{0,99}$/i.test(model)) throw new Error("Invalid Groq model configuration");
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.requests >= maxCalls || this.reserved + reserve > maxTokens) throw new Error("Goal inference budget exhausted");
      this.requests++;
      this.reserved += reserve;
      this.usage({ role, model, reservedTokens: reserve, attempt: this.requests });
      let response: Response;
      try {
        response = await this.transport("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model, response_format: { type: "json_object" }, max_completion_tokens: outputLimit,
            messages: [{ role: "system", content: instruction }, { role: "user", content }] }),
        });
      } catch { throw new Error("Groq request failed or timed out"); }
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get("retry-after");
        await response.body?.cancel();
        const seconds = retry === null ? 0.3 : Number(retry);
        if (attempt === 0 && Number.isFinite(seconds) && seconds >= 0 && seconds <= 2) {
          await delay(seconds * 1000);
          continue;
        }
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Groq rejected the request (HTTP ${response.status})`);
      }
      const payload = await readBounded(response, 64_000).catch(() => { throw new Error("Invalid or oversized Groq response"); });
      if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.usage)) throw new Error("Invalid Groq response");
      const choice = payload.choices[0];
      const text = choice?.message?.content;
      const total = payload.usage.total_tokens;
      if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) throw new Error("Invalid Groq usage");
      this.reserved += total - reserve;
      this.usage({ role, model, totalTokens: total, consumedOrReservedTokens: this.reserved });
      if (this.reserved > maxTokens || choice?.finish_reason !== "stop" || choice?.message?.tool_calls ||
          typeof text !== "string" || text.length > 12_000) throw new Error("Incomplete or unsupported Groq output");
      try { return JSON.parse(text) as unknown; } catch { throw new Error("Groq output was not JSON"); }
    }
    throw new Error("Groq temporarily unavailable");
  }
}
