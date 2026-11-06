import type { FastifyInstance } from "fastify";
import { GroqClient } from "../goals/groq.js";

export type AgentLogEntry = {
  timestamp: string;
  agent: string;
  stage: "THINKING" | "DECISION" | "DISCOVERY" | "NEGOTIATION" | "PAYMENT" | "VERIFICATION" | "SYNTHESIS";
  thought: string;
  data?: Record<string, unknown>;
};

// 5 Dedicated Autonomous Specialist Workers underneath the Orchestrator Agent:
export const SPECIALIST_AGENTS = {
  RESEARCH: {
    id: "researcher",
    name: "Research Agent",
    capability: "web.research",
    description: "Web searching, source collection, and deep thinking on complex topics.",
    basePrice: "120000",
    reliability: "95%",
  },
  CODING: {
    id: "coder",
    name: "Coding Agent",
    capability: "code.generation",
    description: "Function creation, API design, code debugging, and software implementation.",
    basePrice: "180000",
    reliability: "98%",
  },
  DATA_ANALYST: {
    id: "data-analyst",
    name: "Data Analyst Agent",
    capability: "data.analytics",
    description: "Spreadsheet, CSV, and tabular data analysis with numerical computation.",
    basePrice: "150000",
    reliability: "97%",
  },
  REPORT_WRITER: {
    id: "report-writer",
    name: "Report Generation Agent",
    capability: "document.report",
    description: "Structured multi-section executive reports with citations and findings.",
    basePrice: "110000",
    reliability: "96%",
  },
  DOC_SUMMARIZER: {
    id: "doc-summarizer",
    name: "Document Summarizer Agent",
    capability: "document.summarize",
    description: "Condensing PDFs, Word documents, research papers, and technical memos.",
    basePrice: "95000",
    reliability: "95%",
  },
} as const;

export function registerAgentOrchestrator(app: FastifyInstance, env: NodeJS.ProcessEnv) {
  // Live Streaming SSE Endpoint for Agent Activity Logs & Real-Time Thinking
  let active = 0;
  app.post<{ Body: { prompt: string; fileName?: string; fileContent?: string; targetCapability?: string } }>("/api/orchestrator/stream", { bodyLimit: 8192 }, async (request, reply) => {
    const { body } = request;
    if (!body || typeof body.prompt !== "string" || body.prompt.length > 2000 ||
        [body.fileName, body.fileContent, body.targetCapability].some(value => value !== undefined && typeof value !== "string")) {
      return reply.code(400).send({ error: "Invalid specialist task" });
    }
    const prompt = body.prompt.trim();
    const fileName = request.body?.fileName?.trim();
    const fileContent = request.body?.fileContent?.trim();
    const targetCapability = request.body?.targetCapability?.trim();
    if (!prompt) {
      return reply.code(400).send({ error: "Please provide a task prompt" });
    }

    if (active >= 2) return reply.code(429).send({ error: "Specialist capacity reached" });
    active++;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "http://localhost:3000",
    });

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const emitLog = (
      agent: string,
      stage: AgentLogEntry["stage"],
      thought: string,
      data?: Record<string, unknown>
    ) => {
      const entry: AgentLogEntry = {
        timestamp: new Date().toISOString(),
        agent,
        stage,
        thought,
        data,
      };
      sendEvent("log", entry);
    };

    try {
      // 1. Initial Intake & Internal Reasoning by Top-Level Orchestrator Agent
      if (fileName) {
        emitLog(
          "Orchestrator Agent (Master)",
          "THINKING",
          `User attached document/spreadsheet: "${fileName}" (${fileContent ? fileContent.length : 0} characters). Parsing content into context stream...`
        );
      }

      emitLog(
        "Orchestrator Agent (Master)",
        "THINKING",
        `Analyzing user prompt: "${prompt}"${fileName ? ` with attached file '${fileName}'` : ""}. Evaluating task domain, technical intent, and selecting the optimal specialist agent from the hierarchy...`
      );

      let specialistKey: keyof typeof SPECIALIST_AGENTS;
      let reasoning = "";
      let analysisContext: Record<string, unknown> = {};

      try {
        const groq = new GroqClient(env, (usage) => {
          emitLog("Orchestrator Agent (Master)", "THINKING", `Allocated reasoning tokens on Groq LLM layer`, usage as Record<string, unknown>);
        });

        const effectivePrompt = fileName && fileContent
          ? `${prompt}\n\n[Attached File: ${fileName}]\n${fileContent.slice(0, 4000)}`
          : prompt;

        const decision = (await groq.json(
          "MANAGER",
          `You are the Master Orchestrator AI Agent at the top of an autonomous agent hierarchy.
Your primary role is GOVERNANCE, INTENT VERIFICATION, and ROUTING.
You must first evaluate if the user's prompt is a valid, coherent task, or if it is random gibberish, spam, or totally irrelevant nonsense (e.g. "asdfghjkl", "blah blah 1234", "qwerty", disconnected random characters).
Also, if targetCapability is specified ("${targetCapability || ""}"), you must strictly check if the prompt is relevant to that specialist's capability:
- "web.research": deep inquiry, questions, research topics, concepts.
- "code.generation": writing functions, scripts, APIs, debugging software.
- "data.analytics": numbers, dataset metrics, statistics, spreadsheets, tabular calculations.
- "document.report": structured comprehensive report writing.
- "document.summarize": condensing text, papers, articles, pdfs.

Return JSON:
{
  "isRelevant": true | false,
  "rejectionReason": "Specific explanation if the prompt is gibberish, nonsensical, or irrelevant to the selected agent",
  "selectedAgent": "RESEARCH" | "CODING" | "DATA_ANALYST" | "REPORT_WRITER" | "DOC_SUMMARIZER",
  "reasoning": "brief reason for the routing decision",
  "searchQuery": "search query if research",
  "language": "language/framework if coding",
  "extractedNumbers": [number, number, ...] if data analysis
}`,
          { prompt: effectivePrompt, fileName, targetCapability }
        )) as {
          isRelevant?: boolean;
          rejectionReason?: string;
          selectedAgent?: keyof typeof SPECIALIST_AGENTS;
          reasoning?: string;
          searchQuery?: string;
          language?: string;
          extractedNumbers?: number[];
        };

        // Enforce strict relevance constraint
        if (decision.isRelevant === false) {
          const reason = decision.rejectionReason || "Input prompt is invalid, nonsensical, or irrelevant to the selected agent's scope.";
          emitLog(
            "Orchestrator Agent (Master)",
            "DECISION",
            `[TASK REJECTED] Governance & Scope Violation: ${reason}`,
            { rejectedPrompt: prompt, reason, status: "SCOPE_MISMATCH_OR_GIBBERISH" }
          );
          sendEvent("error", {
            error: `Task Rejected by Orchestrator Governance: ${reason}`,
            details: "AgentHire enforces task relevance. Random inputs, gibberish, or tasks misaligned with the target agent's capability scope are prevented from executing or spending funds."
          });
          return;
        }

        if (decision.isRelevant !== true || !decision.selectedAgent || !Object.hasOwn(SPECIALIST_AGENTS, decision.selectedAgent) ||
            (targetCapability && SPECIALIST_AGENTS[decision.selectedAgent].capability !== targetCapability)) {
          throw new Error("Invalid specialist decision");
        }
        specialistKey = decision.selectedAgent;
        reasoning = decision.reasoning || `Delegating task to ${SPECIALIST_AGENTS[specialistKey].name}.`;
        analysisContext = decision;
      } catch { throw new Error("Task classification failed. Check the configured Groq service."); }

      const specialist = SPECIALIST_AGENTS[specialistKey];

      // 2. Orchestrator Decision
      emitLog(
        "Orchestrator Agent (Master)",
        "DECISION",
        `Decision reached: ${reasoning} Selected specialist '${specialist.name}' [Capability: ${specialist.capability}].`,
        { specialistId: specialist.id, capability: specialist.capability, details: analysisContext }
      );

      emitLog(specialist.name, "THINKING", "Running the specialist directly. This invocation has no payment authorization.");

      let specialistDeliverable = "";
      let computationData: Record<string, unknown> | undefined;
      let sourcesData: Array<{ id: string; url: string; title: string; excerpt: string }> | undefined;

      const groq = new GroqClient(env, () => {});

      if (specialistKey === "RESEARCH") {
        const { ResearchTools } = await import("../goals/tools.js");
        const rTools = new ResearchTools();
        const sources: Array<{ id: string; url: string; title: string; excerpt: string }> = [];

        try {
          const query = (analysisContext.searchQuery as string) || prompt.slice(0, 40);
          const foundRepos = (await rTools.dispatch("github.search", query, ["github.search", "github.read"])) as string[];
          if (Array.isArray(foundRepos)) {
            for (const repo of foundRepos.slice(0, 3)) {
              try {
                const rawSrc = (await rTools.dispatch("github.read", repo, ["github.search", "github.read"])) as unknown as {
                  id: string;
                  url: string;
                  repository?: string;
                  excerpt: string;
                };
                if (rawSrc && !sources.some((s) => s.id === rawSrc.id)) {
                  sources.push({
                    id: rawSrc.id,
                    url: rawSrc.url,
                    title: rawSrc.repository || repo,
                    excerpt: rawSrc.excerpt,
                  });
                }
              } catch {}
            }
          }
        } catch {}

        if (!sources.length) throw new Error("No real research sources could be retrieved.");
        sourcesData = sources;
        const res = (await groq.json(
          "WORKER",
          `You are the Research Agent. Conduct deep thinking and return structured findings based on the prompt and retrieved sources.
Return JSON:
{
  "title": "Clear research title",
  "deepThinkingSummary": "Comprehensive conceptual analysis",
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "conclusion": "Forward-looking strategic perspective"
}`,
          { prompt, sources }
        )) as { title?: string; deepThinkingSummary?: string; keyFindings?: string[]; conclusion?: string };

        specialistDeliverable = `## ${res.title || "Research & Deep Thinking Brief"}\n\n${res.deepThinkingSummary || ""}\n\n### Key Research Insights:\n` +
          (res.keyFindings ? res.keyFindings.map((f) => `- ${f}`).join("\n") : "") +
          `\n\n### Strategic Conclusion:\n${res.conclusion || ""}`;

      } else if (specialistKey === "CODING") {
        const res = (await groq.json(
          "WORKER",
          `You are the Coding Agent. Write a clean, production-ready function or API implementation according to the user prompt.
Provide valid JSON without markdown code blocks inside the JSON string properties.
Return JSON:
{
  "language": "TypeScript",
  "explanation": "concise walkthrough of the implementation",
  "code": "concise typescript code snippet with types and error handling",
  "usageExample": "quick usage call"
}`,
          { prompt }
        )) as { language?: string; explanation?: string; code?: string; usageExample?: string };

        if (typeof res.code !== "string" || !res.code.trim()) throw new Error("The model returned no implementation.");
        specialistDeliverable = `### Code Implementation (${res.language || "TypeScript"})\n\n${res.explanation || ""}\n\n\`\`\`${(res.language || "typescript").toLowerCase()}\n${res.code}\n\`\`\`\n\n#### Usage Example:\n\`\`\`${(res.language || "typescript").toLowerCase()}\n${res.usageExample || ""}\n\`\`\``;

      } else if (specialistKey === "DATA_ANALYST") {
        const textToAnalyze = fileContent ?? prompt;
        const matches = textToAnalyze.match(/-?\d+(\.\d+)?/g);
        const numbers = matches?.map(Number) ?? [];
        if (!numbers.length || numbers.some(value => !Number.isFinite(value))) throw new Error("Provide a valid numeric dataset.");
        const count = numbers.length;
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        const sum = numbers.reduce((a, b) => a + b, 0);
        const mean = sum / count;
        const sorted = [...numbers].sort((a, b) => a - b);
        const median = count % 2 ? sorted[Math.floor(count / 2)] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;

        computationData = { count, min, max, mean: Number(mean.toFixed(2)), median };

        const res = (await groq.json(
          "WORKER",
          `You are the Data Analyst Agent. Analyze the tabular/spreadsheet metrics and numerical computations provided.
Provide statistical breakdown, anomaly detection, volatility, and recommendations.
Return JSON:
{
  "executiveSummary": "overview of the data distribution",
  "dataTrends": ["trend 1", "trend 2"],
  "anomaliesDetected": "anomalies or outliers if any",
  "dataRecommendations": "strategic analytical recommendation"
}`,
          { prompt, fileName, sampleData: fileContent ? fileContent.slice(0, 2000) : undefined, numbers: numbers.slice(0, 50), stats: computationData }
        )) as { executiveSummary?: string; dataTrends?: string[]; anomaliesDetected?: string; dataRecommendations?: string };

        specialistDeliverable = `### Quantitative Data & Spreadsheet Analytics${fileName ? ` (${fileName})` : ""}\n\n${res.executiveSummary || ""}\n\n` +
          `| Metric | Value |\n| :--- | :--- |\n| Data Points Analyzed | **${count}** |\n| Minimum | **${min}** |\n| Maximum | **${max}** |\n| Mean (Average) | **${mean.toFixed(2)}** |\n| Median | **${median}** |\n\n` +
          `#### Key Trends & Outliers:\n` +
          (res.dataTrends ? res.dataTrends.map((t) => `- ${t}`).join("\n") : "") +
          `\n- **Anomaly Note:** ${res.anomaliesDetected || "No model assessment returned."}\n\n` +
          `#### Analytical Recommendation:\n${res.dataRecommendations || ""}`;

      } else if (specialistKey === "REPORT_WRITER") {
        const res = (await groq.json(
          "WORKER",
          `You are the Report Generation Agent. Generate an executive report based on the prompt.
Return JSON:
{
  "reportTitle": "Title of report",
  "executiveOverview": "Executive overview paragraph",
  "sections": [
    { "heading": "Section Heading", "content": "Detailed paragraphs" }
  ],
  "recommendations": ["rec 1", "rec 2"]
}`,
          { prompt, fileContext: fileContent ? fileContent.slice(0, 2000) : undefined }
        )) as { reportTitle?: string; executiveOverview?: string; sections?: Array<{ heading: string; content: string }>; recommendations?: string[] };

        specialistDeliverable = `# ${res.reportTitle || "Formal Executive Report"}\n\n**Executive Overview:**\n${res.executiveOverview || ""}\n\n` +
          (res.sections ? res.sections.map((s) => `### ${s.heading}\n${s.content}\n`).join("\n") : "") +
          `### Strategic Recommendations:\n` +
          (res.recommendations ? res.recommendations.map((r) => `- ${r}`).join("\n") : "");

      } else {
        // DOC_SUMMARIZER
        const documentText = fileContent ? fileContent.slice(0, 3500) : prompt;
        const res = (await groq.json(
          "WORKER",
          `You are the Document Summarizer Agent. Condense the document or text topic from the user prompt into a structured executive summary.
Return JSON:
{
  "documentTitle": "Document title or subject",
  "executiveBrief": "Concise high-impact executive brief",
  "coreTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "actionItems": ["action item 1", "action item 2"]
}`,
          { prompt, fileName, documentText }
        )) as { documentTitle?: string; executiveBrief?: string; coreTakeaways?: string[]; actionItems?: string[] };

        specialistDeliverable = `## Summary: ${fileName ? `${fileName} — ` : ""}${res.documentTitle || "Executive Document Brief"}\n\n**Executive Brief:**\n${res.executiveBrief || ""}\n\n### Core Takeaways:\n` +
          (res.coreTakeaways ? res.coreTakeaways.map((t) => `- ${t}`).join("\n") : "") +
          `\n\n### Actionable Next Steps:\n` +
          (res.actionItems ? res.actionItems.map((a) => `1. ${a}`).join("\n") : "");
      }

      // 7. Master Synthesis & Final Output
      emitLog(
        "Orchestrator Agent (Master)",
        "SYNTHESIS",
        `Reviewing and packaging final deliverable received from '${specialist.name}' for user presentation.`
      );

      sendEvent("done", {
        prompt,
        specialistAgent: specialist.name,
        specialistRole: specialist.description,
        primaryAgent: "Orchestrator Agent (Master)",
        computation: computationData,
        sources: sourcesData,

        finalOutput: specialistDeliverable,
        status: "completed",
        completedAt: new Date().toISOString(),
      });

    } catch (err) {
      sendEvent("error", { error: err instanceof Error ? err.message : "Execution failed" });
    } finally { active--; reply.raw.end(); }
  });

}
