import { routeAgentRequest, getAgentByName } from "agents";
import { AgentSession } from "./agent-session";
import { AgentTaskWorkflow } from "./agent-workflow";

export { AgentSession, AgentTaskWorkflow };
export { Sandbox } from "@cloudflare/sandbox";
export type { Env } from "./agent-session";

type Env = {
  AgentSession: DurableObjectNamespace;
  AGENT_TASK_WORKFLOW: any;
  SANDBOX_URL: string;
  AI_GATEWAY_BASE: string;
  AI_MODEL: string;
  CF_AIG_TOKEN: string;
  MAX_STEPS?: string;
  DB: D1Database;
  R2: R2Bucket;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...CORS },
  });
}

function parseToken(token: string): { userId: string; username: string; role: string } | null {
  try {
    const parts = atob(token).split(":");
    const userId = parts[0], username = parts[1], role = parts[2] || "user";
    return userId && username ? { userId, username, role } : null;
  } catch { return null; }
}

function authFromRequest(request: Request): { userId: string; username: string; role: string } | null {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("Authorization")?.replace("Bearer ", "");
  return token ? parseToken(token) : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // === Existing API routes (unchanged) ===

    // POST /api/login
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { username, password } = await request.json() as any;
      const user = await env.DB.prepare("SELECT id, username, role FROM users WHERE username = ? AND password = ?").bind(username, password).first();
      if (!user) return json({ error: "invalid credentials" }, 401);
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, status TEXT DEFAULT 'running',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`).run();
      const role = (user.role as string) || "user";
      const token = btoa(`${user.id}:${user.username}:${role}`);
      return json({ id: user.id, username: user.username, role, token });
    }

    // GET /api/tasks
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const { results } = await env.DB.prepare(
        "SELECT id, title, status, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
      ).bind(user.userId).all();
      return json({ tasks: results });
    }

    // GET /api/tasks/:id — get task details from Agent
    if (url.pathname.startsWith("/api/tasks/") && request.method === "GET" && !url.pathname.endsWith("/tasks/")) {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const taskId = url.pathname.split("/api/tasks/")[1];
      const doId = `${user.userId}:${taskId}`;
      const agent = await getAgentByName(env.AgentSession, doId);
      const resp = await agent.fetch(new Request(`https://do/`));
      const body = await resp.text();
      return new Response(body, { status: resp.status, headers: { "Content-Type": "application/json", ...CORS } });
    }

    // DELETE /api/tasks/:id
    if (url.pathname.startsWith("/api/tasks/") && request.method === "DELETE") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const taskId = url.pathname.split("/api/tasks/")[1];
      await env.DB.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").bind(taskId, user.userId).run();
      try {
        const doId = `${user.userId}:${taskId}`;
        const agent = await getAgentByName(env.AgentSession, doId);
        await agent.fetch(new Request("https://do/delete", { method: "DELETE" }));
      } catch {}
      return json({ ok: true });
    }

    // GET /api/admin/overview
    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user || user.role !== "admin") return json({ error: "forbidden" }, 403);
      const users = await env.DB.prepare("SELECT id, username, role, created_at FROM users").all();
      const tasks = await env.DB.prepare(
        "SELECT t.id, t.user_id, t.title, t.status, t.created_at, t.updated_at, u.username FROM tasks t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 100"
      ).all();
      return json({ users: users.results, tasks: tasks.results });
    }

    // GET /api/admin/task/:userId/:taskId
    if (url.pathname.startsWith("/api/admin/task/") && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user || user.role !== "admin") return json({ error: "forbidden" }, 403);
      const parts = url.pathname.replace("/api/admin/task/", "").split("/");
      const [userId, taskId] = parts;
      if (!userId || !taskId) return json({ error: "need userId/taskId" }, 400);
      const doId = `${userId}:${taskId}`;
      const agent = await getAgentByName(env.AgentSession, doId);
      const resp = await agent.fetch(new Request(`https://do/`));
      const body = await resp.text();
      return new Response(body, { status: resp.status, headers: { "Content-Type": "application/json", ...CORS } });
    }

    // POST /api/sandbox-exec — debug endpoint
    if (url.pathname === "/api/sandbox-exec" && request.method === "POST") {
      const user = authFromRequest(request);
      if (!user || user.role !== "admin") return json({ error: "admin only" }, 403);
      const { cmd } = await request.json() as { cmd: string };
      const { getSandbox } = await import("@cloudflare/sandbox");
      const sandbox = await getSandbox(env.Sandbox, "debug");
      const r = await sandbox.exec(cmd, { timeout: 30000 });
      return json({ success: r.success, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }, 200);
    }

    // GET /api/r2/*
    if (url.pathname.startsWith("/api/r2/") && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const key = url.pathname.replace("/api/r2/", "");
      const obj = await env.R2.get(key);
      if (!obj) return new Response("Not found", { status: 404, headers: CORS });
      return new Response(obj.body, {
        headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png", "Cache-Control": "public, max-age=86400", ...CORS },
      });
    }

    // === WebSocket: /ws?token=xxx&task=xxx (legacy compat) ===
    if (url.pathname === "/ws") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "token required" }, 401);
      const taskId = url.searchParams.get("task") || crypto.randomUUID();
      const title = url.searchParams.get("title") || "";

      // Ensure tasks table + upsert
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, status TEXT DEFAULT 'running',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`).run();
      await env.DB.prepare(
        `INSERT INTO tasks (id, user_id, title, status) VALUES (?, ?, ?, 'running')
         ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
      ).bind(taskId, user.userId, title).run();

      // Forward to Agent instance (custom routing per docs)
      const doId = `${user.userId}:${taskId}`;
      const agent = await getAgentByName(env.AgentSession, doId);
      return agent.fetch(request);
    }

    // === Agent SDK routing (for /agents/* paths) ===
    const agentResponse = await routeAgentRequest(request, env, { cors: true });
    if (agentResponse) return agentResponse;

    return json({ status: "cf-agent ok" });
  },
};
