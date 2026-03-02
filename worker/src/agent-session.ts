import { Agent, type Connection, type ConnectionContext } from "agents";

export interface Env {
  AgentSession: DurableObjectNamespace;
  Sandbox: DurableObjectNamespace;
  AGENT_TASK_WORKFLOW: any;
  AI_GATEWAY_BASE: string;
  AI_MODEL: string;
  CF_AIG_TOKEN: string;
  MAX_STEPS?: string;
  DB: D1Database;
  R2: R2Bucket;
}

interface AgentState {
  status: "idle" | "running" | "completed" | "failed" | "waiting_approval";
  currentWorkflow?: string;
  currentTask?: string;
  plan: any[] | null;
}

interface ConnState {
  userId: string;
  username: string;
  role: string;
}

export class AgentSession extends Agent<Env, AgentState> {
  initialState: AgentState = { status: "idle", plan: null };

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS steps (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`;
  }

  shouldSendProtocolMessages(_connection: Connection): boolean { return false; }

  onConnect(connection: Connection<ConnState>, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");
    if (!token) { connection.close(4001, "Unauthorized"); return; }
    try {
      const parts = atob(token).split(":");
      const [userId, username] = parts;
      const role = parts[2] || "user";
      if (!userId || !username) { connection.close(4001, "Invalid token"); return; }
      connection.setState({ userId, username, role });
    } catch { connection.close(4001, "Invalid token"); return; }
  }

  async onMessage(connection: Connection<ConnState>, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    const data = JSON.parse(message);
    const user = connection.state;
    if (!user) { connection.send(JSON.stringify({ type: "error", message: "Not authenticated" })); return; }

    if (data.type === "task") {
      if (this.state.status === "running" || this.state.status === "waiting_approval") {
        connection.send(JSON.stringify({ type: "error", message: "任务正在执行中，请等待完成" }));
        return;
      }
      const taskId = data.task_id || crypto.randomUUID();
      // Clear previous task data
      this.sql`DELETE FROM logs`;
      this.sql`DELETE FROM steps`;
      this.sql`INSERT INTO logs (message) VALUES (${`📤 ${data.content}`})`;
      this.setState({ status: "running", currentTask: taskId, plan: null });

      try {
        const instanceId = await this.runWorkflow("AGENT_TASK_WORKFLOW", {
          taskId, userMessage: data.content, userId: user.userId, username: user.username,
        });
        this.setState({ ...this.state, currentWorkflow: instanceId });
      } catch (e: any) {
        this.broadcast(JSON.stringify({ type: "error", message: `Failed to start workflow: ${e.message}` }));
        this.setState({ ...this.state, status: "failed" });
      }
    }

    if (data.type === "approve" && this.state.currentWorkflow) {
      await this.approveWorkflow(this.state.currentWorkflow, {
        reason: "User approved", metadata: { approvedBy: user.username, userInput: data.userInput || "" },
      });
      this.setState({ ...this.state, status: "running" });
    }

    if (data.type === "reject" && this.state.currentWorkflow) {
      await this.rejectWorkflow(this.state.currentWorkflow, {
        reason: data.reason || "User rejected",
      });
      this.setState({ ...this.state, status: "failed" });
      this.broadcast(JSON.stringify({ type: "error", message: `用户拒绝: ${data.reason || "无原因"}` }));
    }
  }

  async onWorkflowProgress(_workflowName: string, _instanceId: string, progress: unknown) {
    const p = progress as any;

    if (p.type === "log") {
      this.sql`INSERT INTO logs (message) VALUES (${p.message})`;
      return; // don't broadcast log events
    }
    if (p.type === "plan") {
      // plan already set via step.mergeAgentState() in Workflow — just broadcast
    } else if (p.type === "approval_required") {
      this.setState({ ...this.state, status: "waiting_approval" });
    } else if (p.type === "step_record") {
      // Workflow sends step records for persistence
      this.sql`INSERT INTO steps (data) VALUES (${JSON.stringify(p.record)})`;
      return; // don't broadcast
    }
    this.broadcast(JSON.stringify(p));
  }

  async onWorkflowComplete(_workflowName: string, _instanceId: string, _result?: unknown) {
    this.setState({ ...this.state, status: "completed" });
    this.broadcast(JSON.stringify({ type: "workflow_complete" }));
  }

  async onWorkflowError(_workflowName: string, _instanceId: string, error: string) {
    this.setState({ ...this.state, status: "failed" });
    this.broadcast(JSON.stringify({ type: "error", message: error }));
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.sql`DELETE FROM logs`;
      this.sql`DELETE FROM steps`;
      this.setState(this.initialState);
      return new Response("ok");
    }
    if (request.method === "GET") {
      const logs = (this.sql<{ message: string }>`SELECT message FROM logs ORDER BY id`).map(r => r.message);
      const steps = (this.sql<{ data: string }>`SELECT data FROM steps ORDER BY id`).map(r => JSON.parse(r.data));
      return new Response(JSON.stringify({
        messages: [], // LLM messages live in Workflow steps, not persisted here
        steps,
        plan: this.state.plan,
        logs,
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not found", { status: 404 });
  }
}
