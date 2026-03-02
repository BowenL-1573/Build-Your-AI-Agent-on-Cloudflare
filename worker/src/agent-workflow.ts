import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { AgentSession } from "./agent-session";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

// Re-declare minimal Env (Workflow has its own env access)
interface Env {
  Sandbox: DurableObjectNamespace;
  AI_GATEWAY_BASE: string;
  AI_MODEL: string;
  CF_AIG_TOKEN: string;
  MAX_STEPS?: string;
  DB: D1Database;
  R2: R2Bucket;
}

interface TaskParams {
  taskId: string;
  userMessage: string;
  userId: string;
  username: string;
}

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

const TOOLS = [
  { type: "function" as const, function: { name: "search", description: "Search the web (Google) and return result links with snippets.", parameters: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] } } },
  { type: "function" as const, function: { name: "navigate", description: "Open a webpage in a headless browser, extract full text and take a screenshot. Slow — avoid if fetch can do the job.", parameters: { type: "object", properties: { url: { type: "string", description: "The URL to visit" } }, required: ["url"] } } },
  { type: "function" as const, function: { name: "extract", description: "Open a webpage in browser and extract content matching a CSS selector.", parameters: { type: "object", properties: { url: { type: "string", description: "The URL to visit" }, selector: { type: "string", description: "CSS selector" } }, required: ["url", "selector"] } } },
  { type: "function" as const, function: { name: "fetch", description: "HTTP GET a URL and return raw text. Fast — no browser. Best for APIs, static pages.", parameters: { type: "object", properties: { url: { type: "string", description: "The URL to fetch" }, max_length: { type: "number", description: "Max characters to return (default 8000)" } }, required: ["url"] } } },
  { type: "function" as const, function: { name: "read_file", description: "Read a file from the task workspace.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative path within workspace (e.g. 'report.md')" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "write_file", description: "Write content to a file in the task workspace.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative path within workspace (e.g. 'report.md')" }, content: { type: "string", description: "File content to write" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "python", description: "Execute a Python script in the sandbox. The script runs in the task workspace directory.", parameters: { type: "object", properties: { code: { type: "string", description: "Python code to execute" } }, required: ["code"] } } },
  { type: "function" as const, function: { name: "exec", description: "Execute a SINGLE-LINE shell command (ls, cat, grep, wc, etc). FORBIDDEN: heredoc (<<), multi-line scripts, file writing. Use write_file to create files, python tool for scripts.", parameters: { type: "object", properties: { command: { type: "string", description: "Single-line shell command only" }, timeout: { type: "number", description: "Timeout in seconds (default 15, max 30)" } }, required: ["command"] } } },
  { type: "function" as const, function: { name: "request_help", description: "Request human assistance when stuck. Use this when you've tried multiple approaches with no progress, or when you need clarification from the user.", parameters: { type: "object", properties: { message: { type: "string", description: "Explain what you tried, what failed, and what help you need" } }, required: ["message"] } } },
];

function getSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a Web Research Agent. Today: ${today}

## Tools
| Tool | Use |
|------|-----|
| **search** | Google search via Serper. Returns links + snippets. |
| **fetch** | HTTP GET → Markdown. No JS rendering. Fails on anti-bot sites (CSDN, Zhihu, etc). |
| **navigate** | Real browser (Playwright). Use for JS-rendered or anti-bot pages. Takes screenshot. |
| **extract** | Real browser + CSS selector extraction. |
| **read_file** | Read LOCAL file from workspace (e.g. \`report.md\`). NEVER pass a URL. |
| **write_file** | Write file to workspace. Use for final report. |
| **python** | Execute Python. Good for data processing. |
| **exec** | Shell commands (ls, cat, grep, etc). |
| **request_help** | Ask human for help when stuck. |

## Language Rule
ALWAYS respond in the same language as the user's input.

## Critical Rules
1. NEVER fabricate URLs, data, dates, or facts. If a tool fails, report the failure.
2. If fetch returns empty/login-wall, switch to **navigate** or try a different URL. NEVER retry the same failing URL.
3. Max 2 retries per approach. After that, move on.
4. **Max 5 tool calls per response.** They run in PARALLEL, so use all 5 to fetch/search multiple sources at once. More will be skipped.
5. **Budget awareness**: You have limited steps. Prioritize breadth over depth — gather key info from search snippets first, only fetch/navigate pages that are truly essential.
6. Keep reasoning under 50 words.
7. **Act autonomously.** You have full authority to search, fetch, navigate, and write files. NEVER ask the user for permission or confirmation — just do it. Only use **request_help** when you are truly stuck and cannot proceed.
8. **NEVER visit the same URL twice.** If a page returned no useful content, move on to a different source.

## Workflow
1. Follow the plan steps IN ORDER. After each plan step, assess: do I have enough info?
2. **Search snippets are often sufficient.** Only fetch a page if the snippet lacks critical details.
3. When you have enough information (even if imperfect), STOP researching and write the report.
4. Use **write_file** to save the final report as \`report.md\`, then your NEXT response (with NO tool calls) MUST be a complete summary of the report in the user's language. This summary IS the final answer the user sees.

## Final Answer
- MUST be a substantial summary of the report (at least 200 chars). NOT a status update like "report written" or "task complete".
- MUST directly answer the user's question with a structured, complete response.
- NEVER end with "next steps" or "plan to do more research".
- If info is incomplete after reasonable effort, write what you have and note the gaps.`;
}

function parsePlanJSON(raw: string): PlanStep[] | null {
  try {
    const match = raw.match(/\{[\s\S]*"steps"[\s\S]*\}/);
    if (match) {
      const steps = JSON.parse(match[0]).steps.map((s: any, i: number) => ({ id: s.id || i + 1, description: s.description, status: "pending" }));
      if (steps.length > 1) return steps;
    }
  } catch {}
  return null;
}

function compact(action: string, fullText: string): string {
  if (action === "extract" || action === "search") return fullText;
  if (fullText.length > 2000) return fullText.substring(0, 2000) + `\n\n[truncated — use read_result for full content]`;
  return fullText;
}

async function callLLM(env: Env, messages: ChatMessage[], withTools: boolean): Promise<any> {
  const body: any = { model: env.AI_MODEL, messages };
  if (withTools) body.tools = TOOLS;
  const res = await fetch(`${env.AI_GATEWAY_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CF_AIG_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function uploadScreenshot(sandbox: Sandbox, ssPath: string, taskId: string, env: Env): Promise<string | undefined> {
  try {
    const img = await sandbox.readFile(ssPath, { encoding: "base64" });
    const imgBytes = Uint8Array.from(atob(img.content), c => c.charCodeAt(0));
    const key = `screenshots/${taskId}/${Date.now()}.png`;
    await env.R2.put(key, imgBytes);
    return `https://api.agents.cloudc.top/api/r2/${key}`;
  } catch { return undefined; }
}

async function callSandbox(env: Env, sandbox: Sandbox, taskDir: string, name: string, args: any, taskId: string, username: string): Promise<any> {
  // Ensure env vars are set (idempotent, survives container restarts)
  if ((env as any).SERPER_API_KEY) await sandbox.setEnvVars({ SERPER_API_KEY: (env as any).SERPER_API_KEY, ...((env as any).JINA_API_KEY ? { JINA_API_KEY: (env as any).JINA_API_KEY } : {}) });

  if (name === "search") {
    const r = await sandbox.exec(`python3 /workspace/search.py '${args.query.replace(/'/g, "'\\''")}'`, { timeout: 30000 });
    if (!r.success) return { text: `search failed: ${r.stderr}`, metadata: {} };
    console.log(`[search] stdout=${r.stdout.substring(0, 500)}, stderr=${r.stderr?.substring(0, 200)}`);
    const items = JSON.parse(r.stdout);
    if (items.length === 0) return { text: "search returned 0 results, try different query", metadata: { title: "Search results", url: `bing.com/search?q=${args.query}` } };
    const text = items.map((i: any) => `${i.title}\n${i.url}\n${i.snippet}`).join("\n\n");
    return { text, metadata: { title: "Search results", url: `bing.com/search?q=${args.query}` } };
  }

  if (name === "navigate") {
    const ssPath = `${taskDir}/tmp/ss-${Date.now()}.png`;
    const r = await sandbox.exec(`python3 /workspace/browse.py navigate '${args.url.replace(/'/g, "'\\''")}' '${ssPath}'`, { timeout: 30000 });
    if (!r.success) return { text: `navigate failed: ${r.stderr}`, metadata: {} };
    const data = JSON.parse(r.stdout);
    const screenshot_url = await uploadScreenshot(sandbox, ssPath, taskId, env);
    return { text: data.text, metadata: { title: data.title, url: data.url }, screenshot_url };
  }

  if (name === "extract") {
    const r = await sandbox.exec(`python3 /workspace/extract.py '${args.url.replace(/'/g, "'\\''")}' '${args.selector.replace(/'/g, "'\\''")}'`, { timeout: 20000 });
    if (!r.success) return { text: `extract failed: ${r.stderr}`, metadata: {} };
    const data = JSON.parse(r.stdout);
    const text = data.items.map((i: any) => i.href ? `${i.text} → ${i.href}` : i.text).join("\n");
    return { text, metadata: { title: data.title, url: data.url } };
  }

  if (name === "fetch") {
    const maxLen = args.max_length || 8000;
    const r = await sandbox.exec(`python3 /workspace/fetch_url.py '${args.url.replace(/'/g, "'\\''")}' ${maxLen}`, { timeout: 30000 });
    if (!r.success) return { text: `fetch failed: ${r.stderr}`, metadata: {} };
    return { text: r.stdout, metadata: { title: "", url: args.url } };
  }

  if (name === "read_file") {
    const filePath = `${taskDir}/${args.path}`;
    try {
      const f = await sandbox.readFile(filePath);
      return { text: f.content, metadata: { path: args.path } };
    } catch (e: any) { return { text: `read_file failed: ${e.message}`, metadata: {} }; }
  }

  if (name === "write_file") {
    const filePath = `${taskDir}/${args.path}`;
    await sandbox.exec(`mkdir -p $(dirname '${filePath}')`);
    await sandbox.writeFile(filePath, args.content);
    return { text: `wrote ${args.content.length} chars to ${args.path}`, metadata: { path: args.path } };
  }

  if (name === "python") {
    const scriptPath = `${taskDir}/tmp/_run.py`;
    await sandbox.writeFile(scriptPath, args.code);
    const r = await sandbox.exec(`python3 ${scriptPath}`, { timeout: 30000, cwd: taskDir });
    return { text: r.stdout + (r.stderr ? `\nSTDERR: ${r.stderr}` : ""), metadata: { exitCode: r.exitCode } };
  }

  if (name === "exec") {
    const timeout = Math.min((args.timeout || 15) * 1000, 30000);
    const r = await sandbox.exec(args.command, { timeout, cwd: taskDir });
    return { text: r.stdout + (r.stderr ? `\nSTDERR: ${r.stderr}` : ""), metadata: { exitCode: r.exitCode } };
  }

  return { text: `Unknown tool: ${name}`, metadata: {} };
}

export class AgentTaskWorkflow extends AgentWorkflow<AgentSession, TaskParams> {
  async run(event: AgentWorkflowEvent<TaskParams>, step: AgentWorkflowStep) {
    const { taskId, userMessage, userId, username } = event.payload;
    const env = this.env as unknown as Env;
    const MAX_STEPS = parseInt((env as any).MAX_STEPS || "30");

    // Durably mark Agent as running
    await step.mergeAgentState({ status: "running", currentTask: taskId });

    // Pre-warm container and initialize workspace (retry on cold start / updating)
    let sandbox!: Sandbox;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        sandbox = await getSandbox(env.Sandbox, "shared");
        break;
      } catch (e: any) {
        if (attempt < 4) {
          console.log(`[sandbox] attempt ${attempt + 1} failed: ${e.message}, retrying in 5s...`);
          await this.reportProgress({ type: "log", message: `⏳ 沙盒启动中...（第 ${attempt + 2} 次尝试）` });
          await new Promise(r => setTimeout(r, 5000));
        } else {
          throw e;
        }
      }
    }
    if ((env as any).SERPER_API_KEY) await sandbox.setEnvVars({ SERPER_API_KEY: (env as any).SERPER_API_KEY, ...((env as any).JINA_API_KEY ? { JINA_API_KEY: (env as any).JINA_API_KEY } : {}) });
    const taskDir = `/workspace/${taskId}`;
    await sandbox.exec(`mkdir -p ${taskDir}/tmp`);

    try {

    // Log user task
    await this.reportProgress({ type: "log", message: `📝 任务: ${userMessage}` });

    // Step 1: Plan
    const planSysPrompt = `You are a planning assistant. Output ONLY a JSON object. No explanation, no markdown.\nFormat: {"steps": [{"id": 1, "description": "..."}, ...]}\nRules:\n- RESPOND IN THE SAME LANGUAGE AS THE USER INPUT\n- Max 5 steps. Each step can involve MULTIPLE tool calls.\n- Be concrete: specify what to search/fetch in each step\n- Reserve the LAST step for writing the final report (write_file)\n- Prefer search snippets over fetching full pages when possible`;
    const plan = await step.do("plan", { retries: { limit: 2, delay: "3 seconds" } }, async () => {
      const msgs: ChatMessage[] = [
        { role: "system", content: planSysPrompt },
        { role: "user", content: userMessage },
      ];
      const res1 = await callLLM(env, msgs, false);
      const raw1 = res1.choices?.[0]?.message?.content || res1.choices?.[0]?.message?.reasoning_content || "";
      console.log(`[plan] attempt 1 (${raw1.length} chars): ${raw1.substring(0, 500)}`);
      const parsed1 = parsePlanJSON(raw1);
      if (parsed1) return parsed1;

      // Retry once with feedback
      msgs.push({ role: "assistant", content: raw1 });
      msgs.push({ role: "user", content: "JSON parse failed. Output ONLY valid JSON: {\"steps\": [{\"id\": 1, \"description\": \"...\"}]}. No markdown." });
      const res2 = await callLLM(env, msgs, false);
      const raw2 = res2.choices?.[0]?.message?.content || res2.choices?.[0]?.message?.reasoning_content || "";
      console.log(`[plan] attempt 2 (${raw2.length} chars): ${raw2.substring(0, 500)}`);
      return parsePlanJSON(raw2) || [{ id: 1, description: "Research and analyze the topic", status: "pending" }, { id: 2, description: "Write final report with write_file", status: "pending" }];
    });

    // Plan review loop: generate → review → feedback → regenerate
    let currentPlan = plan;
    const planMsgs: ChatMessage[] = [
      { role: "system", content: planSysPrompt },
      { role: "user", content: userMessage },
      { role: "assistant", content: JSON.stringify({ steps: plan.map((s: PlanStep) => ({ id: s.id, description: s.description })) }) },
    ];

    for (let round = 0; round < 3; round++) {
      await step.mergeAgentState({ plan: currentPlan });
      await this.reportProgress({ type: "plan", steps: currentPlan });
      await this.reportProgress({ type: "log", message: `📋 计划: ${currentPlan.map((s: PlanStep) => `${s.id}. ${s.description}`).join(' → ')}` });
      await this.reportProgress({ type: "plan_review", workflowId: this.instanceId, message: `请确认执行计划，或提供修改建议：\n${currentPlan.map((s: PlanStep) => `${s.id}. ${s.description}`).join('\n')}`, timeout: 30 });

      let outcome: "approved" | "rejected" | "timeout" = "timeout";
      let feedback = "";
      try {
        const res = await this.waitForApproval(step, { timeout: "30 seconds" });
        feedback = (res as any)?.metadata?.userInput || (res as any)?.userInput || "";
        outcome = "approved";
      } catch (e: any) {
        outcome = e?.message?.includes("timed out") ? "timeout" : "rejected";
      }

      if (outcome === "rejected") {
        await this.reportProgress({ type: "log", message: `❌ 用户拒绝了计划，任务终止` });
        return { success: false, reason: "User rejected the plan" };
      }
      if (outcome === "timeout" || !feedback) {
        await this.reportProgress({ type: "log", message: outcome === "timeout" ? `⏱️ 自动执行` : `✅ 用户已确认` });
        break;
      }
      // Has feedback → re-plan
      await this.reportProgress({ type: "log", message: `🔄 根据反馈重新规划: ${feedback}` });
      planMsgs.push({ role: "user", content: `User feedback: ${feedback}\nRegenerate the plan. Output ONLY JSON.` });
      const reRes = await callLLM(env, planMsgs, false);
      const reRaw = reRes.choices?.[0]?.message?.content || reRes.choices?.[0]?.message?.reasoning_content || "";
      const newPlan = parsePlanJSON(reRaw);
      if (newPlan) {
        currentPlan = newPlan;
        planMsgs.push({ role: "assistant", content: JSON.stringify({ steps: newPlan.map((s: PlanStep) => ({ id: s.id, description: s.description })) }) });
      }
    }

    // Initialize messages
    const messages: ChatMessage[] = [
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: userMessage },
      { role: "assistant", content: `My plan:\n${JSON.stringify({ steps: currentPlan })}` },
    ];
    const steps: StepRecord[] = [];
    let consecutiveFailures = 0;
    const failedUrls = new Set<string>();
    let reportWritten = false;

    // Step 2-N: ReAct loop
    let lastActiveStep = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      // Inject remaining plan context
      const planStatus = currentPlan.map((s: PlanStep) => `${s.id}. [${s.status}] ${s.description}`).join('\n');

      // LLM decision
      const remaining = MAX_STEPS - i;
      const budgetHint = remaining <= 5 ? `\n\n⚠️ ONLY ${remaining} steps left. Wrap up NOW — either use write_file to save the report OR directly provide your complete final answer.` : remaining <= 10 ? `\n\n📊 ${remaining} steps remaining. Start wrapping up soon.` : "";
      
      const llmResult = await step.do(`llm-${i}`, { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, async () => {
        // Compact older messages before calling LLM
        const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        if (totalChars > 32000) {
          const toolMsgs = messages.filter(x => x.role === "tool");
          for (let j = 0; j < toolMsgs.length - 3; j++) {
            if (toolMsgs[j].content && toolMsgs[j].content!.length > 500) {
              toolMsgs[j].content = toolMsgs[j].content!.substring(0, 300) + "\n[compacted]";
            }
          }
        }
        // Inject plan status + budget hint as last system message
        const augmented = [...messages, { role: "system" as const, content: `Current plan:\n${planStatus}\n\nIMPORTANT: Start your response with [STEP:N] where N is the plan step number you are currently working on.${budgetHint}` }];
        return await callLLM(env, augmented, true);
      });

      const choice = llmResult.choices?.[0]?.message;
      if (!choice) {
        await this.reportProgress({ type: "log", message: "❌ LLM returned empty response" });
        await this.reportProgress({ type: "error", message: "LLM returned empty response" });
        await step.do(`update-status-${i}`, async () => {
          await env.DB.prepare("UPDATE tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(taskId).run();
        });
        return { status: "failed", error: "LLM empty response" };
      }

      // Final answer (no tool calls)
      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        const answer = choice.content || choice.reasoning_content || "";

        // Detect raw <tool_call> XML — GLM sometimes outputs XML instead of function calls
        if (answer.includes("<tool_call>")) {
          console.log(`[llm-${i}] detected raw <tool_call> XML, nudging model`);
          messages.push({ role: "assistant", content: answer });
          messages.push({ role: "user", content: "ERROR: You output raw <tool_call> XML which cannot be executed. You MUST use the proper function calling format. If you want to call tools, use the tools provided. If you are done researching, write the final report with write_file and then provide a summary." });
          continue;
        }

        // Report already written → this is the final summary, accept it
        if (reportWritten && answer.length > 50) {
          console.log(`[llm-${i}] final answer after report written (${answer.length} chars)`);
          messages.push({ role: "assistant", content: answer });
          await this.reportProgress({ type: "answer", content: answer });
          await this.reportProgress({ type: "log", message: `✅ ${answer}` });
          for (const s of currentPlan) {
            if (s.status !== "done") { s.status = "done"; await this.reportProgress({ type: "step_done", step_id: s.id }); }
          }
          await step.do("update-status-done", async () => {
            await env.DB.prepare("UPDATE tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(taskId).run();
          });
          return { status: "completed", answer };
        }

        // Report NOT written yet → LLM is slacking, kick it back to work
        console.log(`[llm-${i}] no tool calls and no report written yet, nudging to continue`);
        messages.push({ role: "assistant", content: answer || "" });
        messages.push({ role: "user", content: "You have NOT written the final report yet. Do NOT stop or ask questions. Continue executing the plan: call tools to gather information, then use write_file to save the report as report.md, and finally provide a summary." });
        continue;
      }

      // Tool calls
      if (choice.reasoning_content) {
        await this.reportProgress({ type: "reasoning", content: choice.reasoning_content });
        await this.reportProgress({ type: "log", message: `🧠 ${choice.reasoning_content}` });
      }

      // Detect current plan step from LLM output
      const llmText = choice.content || choice.reasoning_content || "";
      const stepMatch = llmText.match(/\[STEP:(\d+)\]/);
      if (stepMatch) {
        const stepNum = parseInt(stepMatch[1]);
        if (stepNum !== lastActiveStep && stepNum >= 1 && stepNum <= currentPlan.length) {
          if (lastActiveStep > 0) {
            const prev = currentPlan.find(s => s.id === lastActiveStep);
            if (prev) prev.status = "done";
            await this.reportProgress({ type: "step_done", step_id: lastActiveStep });
          }
          const cur = currentPlan.find(s => s.id === stepNum);
          if (cur) cur.status = "running";
          lastActiveStep = stepNum;
          await this.reportProgress({ type: "step_start", step_id: stepNum, description: cur?.description });
        }
      }

      messages.push({ role: "assistant", content: choice.content, tool_calls: choice.tool_calls });

      // Limit to 5 tool calls per round — execute first 5, stub the rest
      const maxCalls = 5;
      const activeCalls = choice.tool_calls.slice(0, maxCalls);
      const skippedCalls = choice.tool_calls.slice(maxCalls);

      for (const call of skippedCalls) {
        messages.push({ role: "tool", tool_call_id: call.id, content: "[skipped — max 5 tool calls per round. Call again next round if needed.]" });
      }

      // Separate interactive vs parallelizable calls
      const interactiveCalls = activeCalls.filter(c => c.function.name === "request_help");
      const parallelCalls = activeCalls.filter(c => c.function.name !== "request_help");

      // Execute parallel calls concurrently
      const parallelResults = await Promise.all(parallelCalls.map(async (call) => {
        const fn = call.function;
        const args = JSON.parse(fn.arguments);

        // Skip URLs that already failed (404, blocked, etc)
        const toolUrl = args.url || args.query || "";
        if (toolUrl && failedUrls.has(toolUrl)) {
          await this.reportProgress({ type: "log", message: `⏭️ ${fn.name}: 跳过已失败的 URL` });
          return { call, fn, args, toolResult: { text: `Skipped: this URL already failed. Use a different source.`, metadata: {} } };
        }

        await this.reportProgress({ type: "action", tool: fn.name, args });
        await this.reportProgress({ type: "log", message: `🔧 ${fn.name}: ${JSON.stringify(args)}` });

        let toolResult: any;
        try {
          toolResult = await step.do(`tool-${i}-${fn.name}-${call.id.slice(-4)}`, { retries: { limit: 1, delay: "5 seconds" } }, async () => {
            if (fn.name === "read_result") {
              const s = steps[args.step_index];
              return s ? { text: s.fullResult, metadata: { source: `step ${args.step_index}` } } : { text: `No step at index ${args.step_index}`, metadata: {} };
            }
            try {
              return await callSandbox(env, sandbox, taskDir, fn.name, args, taskId, username);
            } catch (e: any) {
              if (e.message?.includes("WebSocket")) {
                console.log(`[${fn.name}] WebSocket error, reconnecting sandbox...`);
                sandbox = await getSandbox(env.Sandbox, "shared");
                if ((env as any).SERPER_API_KEY) await sandbox.setEnvVars({ SERPER_API_KEY: (env as any).SERPER_API_KEY, ...((env as any).JINA_API_KEY ? { JINA_API_KEY: (env as any).JINA_API_KEY } : {}) });
                await sandbox.exec(`mkdir -p ${taskDir}/tmp`);
                return await callSandbox(env, sandbox, taskDir, fn.name, args, taskId, username);
              }
              throw e;
            }
          });
        } catch (e: any) {
          toolResult = { text: `Tool ${fn.name} failed: ${e.message}`, metadata: {} };
          await this.reportProgress({ type: "log", message: `⚠️ ${fn.name} 失败: ${e.message}` });
        }
        return { call, fn, args, toolResult };
      }));

      // Process parallel results
      for (const { call, fn, args, toolResult } of parallelResults) {
        const fullText = fn.name === "read_result"
          ? toolResult.text
          : `Page title: ${toolResult.metadata?.title || ""}\nURL: ${toolResult.metadata?.url || ""}\n\n${toolResult.text || ""}`;
        const compactText = compact(fn.name, fullText);

        const isFail = (toolResult.text || "").startsWith("Tool ") && (toolResult.text || "").includes("failed:");
        const is404 = (toolResult.text || "").includes("404") || (toolResult.text || "").includes("Page not found") || (toolResult.text || "").includes("Skipped:");
        if (isFail || is404) {
          consecutiveFailures++;
          const failUrl = args.url || args.query || "";
          if (failUrl) failedUrls.add(failUrl);
        } else { consecutiveFailures = 0; }

        const record: StepRecord = { index: steps.length, action: fn.name, input: args, fullResult: fullText, compactResult: compactText, screenshot_url: toolResult.screenshot_url };
        if (fn.name === "write_file" && !isFail && !is404) reportWritten = true;
        steps.push(record);
        await this.reportProgress({ type: "step_record", record });
        if (toolResult.screenshot_url) {
          await this.reportProgress({ type: "screenshot", url: toolResult.screenshot_url, step: record.index });
          await this.reportProgress({ type: "log", message: `[screenshot]${toolResult.screenshot_url}` });
        }
        const obsSummary = compactText.length > 200 ? compactText.substring(0, 200) + "..." : compactText;
        await this.reportProgress({ type: "observation", summary: obsSummary, step: record.index });
        await this.reportProgress({ type: "log", message: `📄 ${obsSummary}` });
        messages.push({ role: "tool", tool_call_id: call.id, content: compactText });
      }

      // Check consecutive failures after parallel batch
      if (consecutiveFailures >= 3) {
        await this.reportProgress({ type: "log", message: "⚠️ 连续工具失败，通知 Agent 调整策略" });
        messages.push({ role: "user", content: "WARNING: Multiple tools have failed (likely sandbox connection issue). Do NOT keep retrying failed tools. Use the information you already have to write the final report NOW with write_file, then provide your summary." });
        consecutiveFailures = 0;
      }

      // Execute interactive calls sequentially
      for (const call of interactiveCalls) {
        const fn = call.function;
        const args = JSON.parse(fn.arguments);
        await this.reportProgress({ type: "action", tool: fn.name, args });
        await this.reportProgress({ type: "log", message: `🔧 ${fn.name}: ${JSON.stringify(args)}` });
        await this.reportProgress({ type: "approval_required", workflowId: this.instanceId, message: `🆘 ${args.message}` });
        await this.reportProgress({ type: "log", message: `🆘 请求帮助: ${args.message}` });
        const approval = await this.waitForApproval(step, { timeout: "10 minutes" });
        const helpResponse = (approval as any)?.metadata?.userInput || (approval as any)?.userInput || "User approved without specific guidance.";
        await this.reportProgress({ type: "log", message: `💡 收到建议: ${helpResponse}` });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Human assistance: ${helpResponse}` });
      }

      await this.reportProgress({ type: "status", message: `Step ${i + 1}/${MAX_STEPS}` });
      await this.reportProgress({ type: "log", message: `Step ${i + 1}/${MAX_STEPS}` });
    }

    // Max steps reached
    await this.reportProgress({ type: "error", message: "Max steps reached" });
    await this.reportProgress({ type: "log", message: "❌ Max steps reached" });
    await step.do("update-status-max", async () => {
      await env.DB.prepare("UPDATE tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(taskId).run();
    });
    return { status: "failed", error: "Max steps reached" };
    } finally {
      // Cleanup workspace
      await sandbox.exec(`rm -rf ${taskDir}`).catch(() => {});
    }
  }
}
