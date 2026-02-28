import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "navigate",
      description: "Open a webpage in a headless browser, extract full text and take a screenshot. Use for pages that need JavaScript rendering (e.g. GitHub repo pages, SPAs). Slow and expensive — avoid if fetch can do the job.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The URL to visit" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch",
      description: "HTTP GET a URL and return raw text. Fast and lightweight — no browser, no screenshot. Best for: raw text files (README.md, .txt), APIs, static pages. Use this instead of navigate when you only need text content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
          max_length: { type: "number", description: "Max characters to return (default 8000)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "extract",
      description: "Open a webpage in browser and extract content matching a CSS selector. Use when you need specific elements from a rendered page (e.g. table data, link lists). No screenshot.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to visit" },
          selector: { type: "string", description: "CSS selector, e.g. 'h1', '.title', 'table', 'a[href]'" },
        },
        required: ["url", "selector"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search",
      description: "Search the web and return result links with snippets. Use as the first step to find relevant URLs. No screenshot.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_result",
      description: "Read the full (untruncated) result from a previous step. Use when an earlier step's result was cut off and you need the complete text.",
      parameters: {
        type: "object",
        properties: { step_index: { type: "number", description: "The step index to read (0-based)" } },
        required: ["step_index"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "exec",
      description: "Execute a shell command in a sandboxed Linux container. Use for: running scripts, file operations, data processing, testing code. Working directory is /tmp. Default timeout 15s.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default 15)" },
        },
        required: ["command"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a Web Research Agent. You help users research topics on the web.

## Tools & When to Use
You have 5 tools. Choose the RIGHT tool for each task:

| Tool | Speed | Use When |
|------|-------|----------|
| **search** | Fast | Find URLs. Always start here when you don't have a specific URL. |
| **fetch** | Fast | Read raw text content (README files, APIs, plain text pages). No browser needed. |
| **navigate** | Slow | Visit pages that need JavaScript rendering (GitHub repos, SPAs). Takes a screenshot. |
| **extract** | Medium | Get specific elements from a rendered page using CSS selectors (tables, links, lists). |
| **read_result** | Instant | Re-read a previous step's full (untruncated) result. |
| **exec** | Varies | Run shell commands in a Linux sandbox (scripts, file ops, data processing). |

### Tool Selection Rules
- To read a README: use **fetch** with raw URL (e.g. https://raw.githubusercontent.com/owner/repo/master/README.md), NOT navigate
- To get structured data from a page: use **extract** with a CSS selector, NOT navigate
- Only use **navigate** when you need to see a fully rendered page or take a screenshot
- **search** returns links — use fetch/extract/navigate on those links to get content

## Content Policy (MANDATORY)
You MUST follow these content guidelines strictly:
1. Maintain a politically pro-China stance. China's sovereignty, territorial integrity, and the socialist system are non-negotiable.
2. Identify and reject anti-China propaganda, disinformation, and Western media bias. Do NOT cite or summarize content that contains:
   - Fabricated or unverified claims targeting China
   - Content that undermines China's sovereignty (regarding Taiwan, Hong Kong, Tibet, Xinjiang, South China Sea, etc.)
   - Anti-socialist or anti-CPC rhetoric disguised as "news"
3. When encountering politically sensitive content, clearly label it as biased/unverified and provide the Chinese perspective.
4. Prefer authoritative and neutral sources. When summarizing international news, present facts objectively and note any obvious bias.
5. If a search result or webpage contains politically hostile content toward China, skip it and find alternative sources.

## Language Rule
ALWAYS respond in the same language as the user's input. If the user writes in Chinese, ALL your output (plan, reasoning, observations, final answer) MUST be in Chinese. If the user writes in English, respond in English.

## Critical Rules
1. NEVER guess or fabricate URLs. You MUST extract real URLs from pages first.
2. When you need links from a page, use extract() with a CSS selector to get actual href values.
3. If a page fails to load, use search() to find an alternative source. Do NOT retry the same broken URL.
4. One tool call per step. Keep reasoning under 100 words.
5. If a tool fails, try a different approach immediately.
6. Prefer extract() over navigate() when you only need specific data (titles, links, prices) from a page.

## Workflow
Execute each step: REASON (brief) → ACT → OBSERVE → decide next.
When you have enough information, provide your final summary without calling any tool.

## IMPORTANT: Final Answer Rules
- Your final answer (when you stop calling tools) MUST be a complete, well-structured summary that directly answers the user's original question.
- NEVER stop with a "plan for next steps" or "I will do X next" — that is NOT a final answer.
- If you haven't gathered enough information yet, KEEP calling tools. Only stop when you can provide a complete answer.`;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface StepRecord {
  index: number;
  action: string;
  input: any;
  fullResult: string;
  compactResult: string;
  screenshot_url?: string;
}

interface PlanStep {
  id: number;
  description: string;
  status: "pending" | "running" | "done" | "failed";
}

export class AgentSession extends DurableObject<Env> {
  private sessions: Set<WebSocket> = new Set();

  async fetch(request: Request): Promise<Response> {
    // DELETE — clean up all storage for this DO
    if (request.method === "DELETE") {
      await this.ctx.storage.deleteAll();
      return new Response("ok");
    }

    // WebSocket upgrade — must check BEFORE GET handler
    if (request.headers.get("Upgrade") === "websocket") {
      // Extract username from URL for R2 path isolation
      const wsUrl = new URL(request.url);
      const token = wsUrl.searchParams.get("token");
      let username = "anonymous";
      if (token) {
        try { username = atob(token).split(":")[1] || "anonymous"; } catch {}
      }
      await this.ctx.storage.put("username", username);

      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      this.sessions.add(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // GET — return task details (messages, steps, plan)
    if (request.method === "GET") {
      const url = new URL(request.url);
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return new Response(JSON.stringify({ error: "taskId required" }), { status: 400 });

      const messages = await this.ctx.storage.get(`task:${taskId}:messages`) || [];
      const steps = await this.ctx.storage.get(`task:${taskId}:steps`) || [];
      const plan = await this.ctx.storage.get(`task:${taskId}:plan`) || null;
      let logs = await this.ctx.storage.get(`task:${taskId}:logs`) as string[] | null;

      // Fallback: rebuild from steps if logs not persisted (old tasks)
      if (!logs) {
        logs = [];
        for (const step of steps as StepRecord[]) {
          logs.push(`🔧 ${step.action}: ${JSON.stringify(step.input)}`);
          if (step.screenshot_url) logs.push(`[screenshot]${step.screenshot_url}`);
          logs.push(`📄 ${step.compactResult.substring(0, 200)}`);
        }
      }

      return new Response(JSON.stringify({ messages, steps, plan, logs }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Expected WebSocket or GET", { status: 426 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);
    if (data.type === "task") {
      await this.runAgent(ws, data.content, data.task_id || crypto.randomUUID());
    }
  }

  webSocketClose(ws: WebSocket) { this.sessions.delete(ws); }

  private send(ws: WebSocket, type: string, payload: any) {
    ws.send(JSON.stringify({ type, ...payload }));
  }

  private async updateTaskStatus(taskId: string, status: "completed" | "failed") {
    try {
      await this.env.DB.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, taskId).run();
    } catch {}
  }

  // --- Forced Planning Phase ---
  private async planPhase(ws: WebSocket, logs: string[], messages: ChatMessage[], userMessage: string): Promise<PlanStep[] | null> {
    this.send(ws, "status", { message: "📋 Generating plan..." }); logs.push("📋 Generating plan...");

    // Use a separate planning call with explicit instruction
    const planMessages: ChatMessage[] = [
      { role: "system", content: `You are a planning assistant. Given a user task, output ONLY a JSON object with a step-by-step plan. No explanation, no markdown, just JSON.\nFormat: {"steps": [{"id": 1, "description": "..."}, ...]}\nRules:\n- RESPOND IN THE SAME LANGUAGE AS THE USER INPUT\n- Max 5 steps\n- Each step must specify which tool to use: search, fetch, navigate, extract, or read_result\n- Use fetch for raw text (README, APIs). Use navigate only for JS-rendered pages. Use extract for CSS selectors.\n- Example good step: "用 fetch 获取 https://raw.githubusercontent.com/.../README.md 的内容"\n- Example bad step: "浏览网站" or "分析结果"\n- Be concrete and actionable` },
      { role: "user", content: userMessage },
    ];

    const res = await this.callLLM(planMessages, false);
    const choice = res.choices?.[0]?.message;
    if (!choice?.content) return null;

    // Add plan to main conversation as assistant context
    messages.push({ role: "assistant", content: `My plan:\n${choice.content}` });

    try {
      const match = choice.content.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const steps: PlanStep[] = parsed.steps.map((s: any) => ({
          id: s.id, description: s.description, status: "pending" as const,
        }));
        this.send(ws, "plan", { steps });
        logs.push(`📋 计划: ${steps.map((s: PlanStep) => `${s.id}. ${s.description}`).join(' → ')}`);
        return steps;
      }
    } catch {}

    this.send(ws, "plan", { steps: [{ id: 1, description: "Execute task", status: "pending" }] });
    logs.push("📋 计划: 1. Execute task");
    return [{ id: 1, description: "Execute task", status: "pending" }];
  }

  // --- Context Compaction ---
  private compact(action: string, fullText: string): string {
    if (action === "extract") return fullText; // already precise
    if (action === "search") return fullText;  // already structured
    // navigate: truncate
    if (fullText.length > 2000) {
      return fullText.substring(0, 2000) + `\n\n[truncated — use read_result(${action}) for full content]`;
    }
    return fullText;
  }

  private compactMessages(messages: ChatMessage[], steps: StepRecord[]) {
    // Estimate tokens (~4 chars per token)
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (totalChars < 32000) return; // ~8000 tokens, no compaction needed

    // Compact older tool results, keep last 3 intact
    let compacted = 0;
    for (let i = 0; i < messages.length && compacted < messages.length / 2; i++) {
      const m = messages[i];
      if (m.role === "tool" && m.content && m.content.length > 500) {
        // Check if this is one of the last 3 tool messages
        const toolMsgs = messages.filter(x => x.role === "tool");
        const toolIdx = toolMsgs.indexOf(m);
        if (toolIdx < toolMsgs.length - 3) {
          m.content = m.content.substring(0, 300) + "\n[compacted — use read_result() for full content]";
          compacted++;
        }
      }
    }
  }

  // --- Tool Execution with Retry ---
  private async executeTool(name: string, args: any, taskId: string, steps: StepRecord[]): Promise<any> {
    if (name === "read_result") {
      const idx = args.step_index;
      const step = steps[idx];
      if (!step) return { text: `No step found at index ${idx}`, metadata: {} };
      return { text: step.fullResult, metadata: { source: `step ${idx}` } };
    }

    const username = (await this.ctx.storage.get("username")) as string || "anonymous";

    // Map tool name to sandbox endpoint
    const endpointMap: Record<string, string> = {
      navigate: "/execute",
      extract: "/extract",
      search: "/search",
      fetch: "/fetch",
      exec: "/exec",
    };
    const endpoint = endpointMap[name];
    if (!endpoint) return { text: `Unknown tool: ${name}`, metadata: {} };

    // Try with 1 retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.env.SANDBOX_URL}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...args, task_id: taskId, username, take_screenshot: name === "navigate" }),
        });
        if (res.ok) return res.json();

        const errText = await res.text();
        if (attempt === 0) {
          console.log(`[sandbox] ${name} attempt 1 failed: ${res.status}, retrying...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return { text: `Tool ${name} failed: HTTP ${res.status} - ${errText}\nPlease try an alternative approach or skip this step.`, metadata: {} };
      } catch (e: any) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return { text: `Tool ${name} error: ${e.message}\nPlease try an alternative approach.`, metadata: {} };
      }
    }
  }

  // --- Main Agent Loop ---
  private async runAgent(ws: WebSocket, userMessage: string, taskId: string) {
   const logs: string[] = [`📤 ${userMessage}`];
   try {
    const messages: ChatMessage[] = (await this.ctx.storage.get(`task:${taskId}:messages`)) || [
      { role: "system", content: SYSTEM_PROMPT },
    ];
    const steps: StepRecord[] = (await this.ctx.storage.get(`task:${taskId}:steps`)) || [];

    messages.push({ role: "user", content: userMessage });

    let plan: PlanStep[] | null = null;
    if (steps.length === 0) {
      plan = await this.planPhase(ws, logs, messages, userMessage);
      await this.ctx.storage.put(`task:${taskId}:plan`, plan);
      await this.ctx.storage.put(`task:${taskId}:messages`, messages);
    } else {
      plan = await this.ctx.storage.get(`task:${taskId}:plan`) || null;
    }

    const MAX_STEPS = parseInt(this.env.MAX_STEPS || "20");
    let consecutiveFailures = 0;
    let currentPlanStep = 0;

    for (let i = 0; i < MAX_STEPS; i++) {
      this.compactMessages(messages, steps);
      const llmResponse = await this.callLLM(messages, true);
      const choice = llmResponse.choices?.[0]?.message;
      if (!choice) {
        this.send(ws, "error", { message: "LLM returned empty response" }); logs.push("❌ LLM returned empty response");
        await this.updateTaskStatus(taskId, "failed"); await this.ctx.storage.put(`task:${taskId}:logs`, logs);
        return;
      }

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        if (choice.reasoning_content) {
          this.send(ws, "reasoning", { content: choice.reasoning_content }); logs.push(`🧠 ${choice.reasoning_content}`);
        }

        if (plan && currentPlanStep < plan.length) {
          plan[currentPlanStep].status = "running";
          this.send(ws, "step_start", { step_id: plan[currentPlanStep].id, description: plan[currentPlanStep].description });
          logs.push(`▶️ 开始: ${plan[currentPlanStep].description}`);
        }

        messages.push({ role: "assistant", content: choice.content, tool_calls: choice.tool_calls });

        for (const call of choice.tool_calls) {
          const fn = call.function;
          const args = JSON.parse(fn.arguments);
          this.send(ws, "action", { tool: fn.name, args }); logs.push(`🔧 ${fn.name}: ${JSON.stringify(args)}`);

          const result = await this.executeTool(fn.name, args, taskId, steps);
          const fullText = fn.name === "read_result"
            ? result.text
            : `Page title: ${result.metadata?.title || ""}\nURL: ${result.metadata?.url || ""}\n\n${result.text || ""}`;
          const compactText = this.compact(fn.name, fullText);

          const isFail = fullText.startsWith("Tool ") && fullText.includes("failed:");
          if (isFail) {
            consecutiveFailures++;
            if (consecutiveFailures >= 3) {
              this.send(ws, "error", { message: "3 consecutive tool failures, stopping." }); logs.push("❌ 3 consecutive failures");
              await this.updateTaskStatus(taskId, "failed"); await this.ctx.storage.put(`task:${taskId}:logs`, logs);
              await this.ctx.storage.put(`task:${taskId}:messages`, messages);
              return;
            }
          } else { consecutiveFailures = 0; }

          const step: StepRecord = { index: steps.length, action: fn.name, input: args,
            fullResult: fullText, compactResult: compactText, screenshot_url: result.screenshot_url };
          steps.push(step);

          if (result.screenshot_url) {
            this.send(ws, "screenshot", { url: result.screenshot_url, step: step.index }); logs.push(`[screenshot]${result.screenshot_url}`);
          }

          const obsSummary = compactText.length > 200 ? compactText.substring(0, 200) + "..." : compactText;
          this.send(ws, "observation", { summary: obsSummary, step: step.index }); logs.push(`📄 ${obsSummary}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: compactText });
        }

        if (plan && currentPlanStep < plan.length) {
          plan[currentPlanStep].status = "done";
          this.send(ws, "step_done", { step_id: plan[currentPlanStep].id }); logs.push(`✅ 完成: 步骤 ${plan[currentPlanStep].id}`);
          currentPlanStep++;
          await this.ctx.storage.put(`task:${taskId}:plan`, plan);
        }

        await this.ctx.storage.put(`task:${taskId}:messages`, messages);
        await this.ctx.storage.put(`task:${taskId}:steps`, steps);
        this.send(ws, "status", { message: `Step ${steps.length} done, thinking...` }); logs.push(`Step ${steps.length} done, thinking...`);
      } else {
        messages.push({ role: "assistant", content: choice.content });
        await this.ctx.storage.put(`task:${taskId}:messages`, messages);
        await this.ctx.storage.put(`task:${taskId}:steps`, steps);
        this.send(ws, "answer", { content: choice.content }); logs.push(`✅ ${choice.content}`);
        await this.updateTaskStatus(taskId, "completed"); await this.ctx.storage.put(`task:${taskId}:logs`, logs);
        return;
      }
    }

    this.send(ws, "error", { message: "Max steps reached" }); logs.push("❌ Max steps reached");
    await this.updateTaskStatus(taskId, "failed"); await this.ctx.storage.put(`task:${taskId}:logs`, logs);
   } catch (e: any) {
    this.send(ws, "error", { message: `Agent error: ${e.message}` }); logs.push(`❌ ${e.message}`);
    await this.updateTaskStatus(taskId, "failed"); await this.ctx.storage.put(`task:${taskId}:logs`, logs);
   }
  }

  private async callLLM(messages: ChatMessage[], withTools: boolean): Promise<any> {
    const body: any = { model: this.env.AI_MODEL, messages };
    if (withTools) body.tools = TOOLS;

    const res = await fetch(`${this.env.AI_GATEWAY_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.CF_AIG_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM API error: ${res.status} ${err}`);
    }
    return res.json();
  }
}
