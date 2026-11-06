import { createHash } from "node:crypto";
import { isRecord } from "../agents/task.js";

export type Source = { id: string; url: string; repository: string; excerpt: string };
const repository = /^[a-z0-9_.-]{1,80}\/[a-z0-9_.-]{1,100}$/i;

export async function readBounded(response: Response, limit: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Research source unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Research response exceeds size limit"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}

export class ResearchTools {
  private searches = 0;
  private reads = 0;
  constructor(private readonly transport = fetch) {}
  async dispatch(name: string, input: unknown, allowed: readonly string[]) {
    if (!allowed.includes(name) || typeof input !== "string") throw new Error("Tool permission denied");
    const endpoint = new URL("https://api.github.com");
    if (name === "github.search") {
      if (input.trim().length < 2 || input.length > 90 || this.searches >= 4) throw new Error("Search limit or invalid query");
      this.searches++;
      endpoint.pathname = "/search/repositories";
      endpoint.searchParams.set("q", input + " is:public fork:false archived:false");
      endpoint.searchParams.set("per_page", "4");
      const result = await this.get(endpoint);
      if (!isRecord(result) || !Array.isArray(result.items)) throw new Error("Invalid repository search output");
      return result.items.flatMap((item: unknown) => isRecord(item) && typeof item.full_name === "string" &&
        repository.test(item.full_name) && item.private === false && isRecord(item.license) &&
        typeof item.license.spdx_id === "string" && item.license.spdx_id !== "NOASSERTION" ? [item.full_name] : []);
    }
    if (name === "github.read") {
      if (!repository.test(input) || input.split("/").some(part => part === "." || part === "..") ||
          this.reads >= 8) throw new Error("Read limit or invalid repository");
      this.reads++;
      endpoint.pathname = "/repos/" + input.split("/").map(encodeURIComponent).join("/") + "/readme";
      const result = await this.get(endpoint);
      if (!isRecord(result) || result.encoding !== "base64" || typeof result.content !== "string" ||
          typeof result.sha !== "string" || !/^[0-9a-f]{40}$/.test(result.sha)) throw new Error("Invalid README response");
      const encoded = result.content.replace(/\s/g, "");
      const bytes = Buffer.from(encoded, "base64");
      const blob = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
      if (bytes.toString("base64") !== encoded || blob !== result.sha) throw new Error("README blob integrity mismatch");
      const excerpt = bytes.toString("utf8").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 950);
      if (excerpt.length < 40) throw new Error("Repository has insufficient source evidence");
      return { id: result.sha, url: `https://github.com/${input}`, repository: input, excerpt };
    }
    throw new Error("Unknown tool");
  }

  private async get(endpoint: URL) {
    return readBounded(await this.transport(endpoint, { redirect: "error", signal: AbortSignal.timeout(7000),
      headers: { accept: "application/vnd.github+json", "user-agent": "AgentHire-research" } }), 150_000);
  }
}
