import { AgentSession } from "./agent-session";

export { AgentSession };

export interface Env {
  AGENT_SESSION: DurableObjectNamespace;
  SANDBOX_URL: string;
  AI_GATEWAY_BASE: string;
  AI_MODEL: string;
  CF_AIG_TOKEN: string;
  MAX_STEPS?: string;
  DB: D1Database;
  R2: R2Bucket;
}

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

// Wrap DO response with CORS headers
async function withCors(resp: Response): Promise<Response> {
  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Token format: base64(userId:username:role)
function makeToken(userId: string, username: string, role: string) {
  return btoa(`${userId}:${username}:${role}`);
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // POST /api/login
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { username, password } = await request.json() as any;
      const user = await env.DB.prepare("SELECT id, username, role FROM users WHERE username = ? AND password = ?").bind(username, password).first();
      if (!user) return json({ error: "invalid credentials" }, 401);
      // Ensure tasks table exists
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, status TEXT DEFAULT 'running',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`).run();
      const role = (user.role as string) || "user";
      return json({ id: user.id, username: user.username, role, token: makeToken(user.id as string, user.username as string, role) });
    }

    // GET /api/tasks — list user's tasks
    if (url.pathname === "/api/tasks" && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const { results } = await env.DB.prepare(
        "SELECT id, title, status, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
      ).bind(user.userId).all();
      return json({ tasks: results });
    }

    // GET /api/tasks/:id — get task details from DO
    if (url.pathname.startsWith("/api/tasks/") && request.method === "GET" && !url.pathname.endsWith("/tasks/")) {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const taskId = url.pathname.split("/api/tasks/")[1];
      const doId = `${user.userId}:${taskId}`;
      const id = env.AGENT_SESSION.idFromName(doId);
      const stub = env.AGENT_SESSION.get(id);
      return withCors(await stub.fetch(new Request(`https://do/?taskId=${taskId}`)));
    }

    // DELETE /api/tasks/:id
    if (url.pathname.startsWith("/api/tasks/") && request.method === "DELETE") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "unauthorized" }, 401);
      const taskId = url.pathname.split("/api/tasks/")[1];
      await env.DB.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").bind(taskId, user.userId).run();
      try {
        const doId = `${user.userId}:${taskId}`;
        const id = env.AGENT_SESSION.idFromName(doId);
        const stub = env.AGENT_SESSION.get(id);
        await stub.fetch(new Request("https://do/delete", { method: "DELETE" }));
      } catch {}
      return json({ ok: true });
    }

    // --- Admin APIs ---

    // GET /api/admin/overview — all users, all tasks, DO stats
    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user || user.role !== "admin") return json({ error: "forbidden" }, 403);

      const users = await env.DB.prepare("SELECT id, username, role, created_at FROM users").all();
      const tasks = await env.DB.prepare(
        "SELECT t.id, t.user_id, t.title, t.status, t.created_at, t.updated_at, u.username FROM tasks t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 100"
      ).all();

      return json({ users: users.results, tasks: tasks.results });
    }

    // GET /api/admin/task/:userId/:taskId — admin read any task's DO
    if (url.pathname.startsWith("/api/admin/task/") && request.method === "GET") {
      const user = authFromRequest(request);
      if (!user || user.role !== "admin") return json({ error: "forbidden" }, 403);
      const parts = url.pathname.replace("/api/admin/task/", "").split("/");
      const [userId, taskId] = parts;
      if (!userId || !taskId) return json({ error: "need userId/taskId" }, 400);
      const doId = `${userId}:${taskId}`;
      const id = env.AGENT_SESSION.idFromName(doId);
      const stub = env.AGENT_SESSION.get(id);
      return withCors(await stub.fetch(new Request(`https://do/?taskId=${taskId}`)));
    }

    // GET /api/r2/* — proxy R2 images (auth required, key unguessable)
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

    // WebSocket: /ws?token=xxx&task=xxx
    if (url.pathname === "/ws") {
      const user = authFromRequest(request);
      if (!user) return json({ error: "token required" }, 401);

      const taskId = url.searchParams.get("task") || crypto.randomUUID();
      const title = url.searchParams.get("title") || "";

      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, status TEXT DEFAULT 'running',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )`).run();
      await env.DB.prepare(
        `INSERT INTO tasks (id, user_id, title, status) VALUES (?, ?, ?, 'running')
         ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
      ).bind(taskId, user.userId, title).run();

      const doId = `${user.userId}:${taskId}`;
      const id = env.AGENT_SESSION.idFromName(doId);
      const stub = env.AGENT_SESSION.get(id);
      return stub.fetch(request);
    }

    return json({ status: "cf-agent ok" });
  },
};
