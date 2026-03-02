# Workflow 改造任务 (Agent SDK 方案)

> 基线版本: `67392d8` (production 分支, tag: v1.0)
> 回退方式: `git checkout v1.0 && cd worker && npx wrangler deploy`

## 目标

用 Cloudflare Agent SDK 重写 DO + Worker，并引入 Workflow 实现持久执行。

## 关键发现（来自文档）

1. **Agent SDK 自带路由** — `routeAgentRequest(request, env)` 自动处理 `/agents/{name}/{instance}` 路径，包括 WebSocket upgrade。我们现在 index.ts 里手写的路由和 WebSocket upgrade 逻辑可以大幅简化。

2. **WebSocket 是 Agent 内置的** — `onConnect(connection, ctx)` / `onMessage(connection, message)` / `this.broadcast()` 替代我们手动的 `acceptWebSocket` + `webSocketMessage`。`connection.send()` 替代 `ws.send()`。

3. **Agent SDK 用 SQLite 不是 KV** — `new_sqlite_classes` 替代 `new_classes`。`this.sql` 可以直接执行 SQL。`this.state` / `this.setState()` 自动持久化 + 广播给前端。

4. **前端用 `useAgent` hook** — 自动 WebSocket 连接、状态同步、RPC 调用。替代我们手写的 `new WebSocket()` + `onmessage` 逻辑。

5. **Workflow 通过 `this.runWorkflow()` 启动** — Workflow 里可以 `this.agent.xxx()` RPC 回调 Agent，`this.reportProgress()` 推进度，`this.broadcastToClients()` 直接推 WebSocket。

6. **认证用 `onBeforeConnect` hook** — `routeAgentRequest(request, env, { onBeforeConnect })` 在 WebSocket 建立前校验 token。

7. **自定义路由兼容** — 我们现有的 `/api/login`、`/api/tasks`、`/api/r2/*` 等路由可以保留在 Worker fetch 里，只有 Agent 相关的走 `routeAgentRequest`。

8. **`@callable()` 装饰器** — 标记的方法可以从前端通过 `agent.stub.methodName()` 直接调用，替代 WebSocket 消息解析。

9. **`connection.state`** — 每个连接可以存用户信息（userId, username, role），替代我们现在从 URL params 解析 token 的方式。

10. **Workflow 不能开 WebSocket** — 必须通过 `this.broadcastToClients()` 或 `this.reportProgress()` 间接推送给前端。

## 架构变化

```
Before:
  index.ts (Worker): 手写路由 + auth + WebSocket upgrade + D1 CRUD + R2 proxy
  agent-session.ts (DO extends DurableObject): 手写 WS + ReAct 循环 + KV storage

After:
  index.ts (Worker): routeAgentRequest() + 保留 /api/login, /api/tasks, /api/r2/*
  agent-session.ts (Agent extends Agent): onConnect/onMessage + @callable + setState + runWorkflow
  agent-workflow.ts (AgentWorkflow): ReAct 循环 + step.do + reportProgress + waitForApproval
  前端: useAgent hook 替代手写 WebSocket
```

## Step 1: 安装依赖 + 配置

1.1 安装 agents SDK
```bash
cd worker && npm install agents
```

1.2 更新 wrangler.toml
```toml
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "AgentSession", class_name = "AgentSession" }
]

[[workflows]]
name = "agent-task-workflow"
binding = "AGENT_TASK_WORKFLOW"
class_name = "AgentTaskWorkflow"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["AgentSession"]
```

1.3 注意: migration 从 `new_classes` 改为 `new_sqlite_classes`，tag 改为 v2。已有 DO 数据（KV storage）会丢失，这是预期的（demo 环境）。

## Step 2: 改造 index.ts (Worker 入口)

保留:
- `POST /api/login` — D1 用户认证
- `GET /api/tasks` — D1 任务列表
- `GET /api/r2/*` — R2 图片代理

改造:
- 删除手写的 WebSocket upgrade 逻辑（`/ws` 路由）
- 删除手写的 DO stub.fetch 转发
- 加入 `routeAgentRequest(request, env, { cors: true, onBeforeConnect })` 处理 Agent 路由
- `onBeforeConnect`: 从 URL params 解析 token，验证 base64 → userId:username:role，无效则 401

路由优先级:
```
/api/login     → D1 认证（保留原逻辑）
/api/tasks     → D1 CRUD（保留原逻辑）
/api/r2/*      → R2 代理（保留原逻辑）
/agents/*      → routeAgentRequest() 自动处理
```

前端连接方式变化:
```
Before: wss://api.agents.cloudc.top/ws?token=xxx&task=yyy&title=zzz
After:  useAgent({ agent: "AgentSession", name: taskId, query: { token } })
        → wss://api.agents.cloudc.top/agents/agent-session/{taskId}?token=xxx
```

## Step 3: 改造 agent-session.ts (Agent)

```typescript
import { Agent, callable } from "agents";

export class AgentSession extends Agent<Env, AgentState> {
  // 状态自动持久化 + 广播
  initialState: AgentState = { status: "idle", logs: [], plan: null };

  // WebSocket 连接时校验 + 存用户信息
  onConnect(connection, ctx) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");
    // 解析 token → userId, username, role
    connection.setState({ userId, username, role });
  }

  // 收到消息 → 启动 Workflow
  onMessage(connection, message) {
    const data = JSON.parse(message);
    if (data.type === "start_task") {
      this.startTask(data.taskId, data.message, connection.state);
    }
    if (data.type === "approve") {
      this.approveWorkflow(data.workflowId);
    }
    if (data.type === "reject") {
      this.rejectWorkflow(data.workflowId, { reason: data.reason });
    }
  }

  // 启动 Workflow
  async startTask(taskId, userMessage, user) {
    const instanceId = await this.runWorkflow("AGENT_TASK_WORKFLOW", {
      taskId, userMessage, userId: user.userId, username: user.username
    });
    this.setState({ ...this.state, status: "running", currentWorkflow: instanceId });
  }

  // Workflow 进度回调 → 广播给前端
  onWorkflowProgress(name, id, progress) {
    this.broadcast(JSON.stringify(progress));
  }

  // Workflow 完成回调
  onWorkflowComplete(name, id, result) {
    this.setState({ ...this.state, status: "completed" });
    this.broadcast(JSON.stringify({ type: "completed", data: result }));
  }

  // Workflow 错误回调
  onWorkflowError(name, id, error) {
    this.setState({ ...this.state, status: "failed" });
    this.broadcast(JSON.stringify({ type: "error", data: error }));
  }

  // HTTP GET 查询任务状态（保留）
  onRequest(request) {
    // 返回 this.state（包含 logs, plan, status）
  }
}
```

关键: TOOLS 数组、SYSTEM_PROMPT、PLANNING_PROMPT 保持不变，搬到 agent-workflow.ts 里。

## Step 4: 新建 agent-workflow.ts (Workflow)

```typescript
import { AgentWorkflow } from "agents/workflows";

export class AgentTaskWorkflow extends AgentWorkflow<AgentSession, TaskParams> {
  async run(event, step) {
    const { taskId, userMessage, userId, username } = event.payload;
    const env = this.env;

    // Step 1: Plan
    const plan = await step.do("plan", { retries: { limit: 2, delay: "3 seconds" } }, async () => {
      // 调 LLM 生成计划（复用现有 planPhase 逻辑）
      return await callLLM(env, planMessages);
    });
    this.reportProgress({ type: "plan", data: plan });

    // Step 2-N: ReAct 循环
    let messages = [...]; // 初始化 messages
    for (let i = 0; i < MAX_STEPS; i++) {
      // LLM 决策
      const llmResult = await step.do(`llm-${i}`, {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }
      }, async () => {
        return await callLLM(env, messages);
      });

      if (llmResult.type === "answer") {
        this.reportProgress({ type: "answer", data: llmResult.content });
        await step.reportComplete(llmResult.content);
        return;
      }

      // exec 工具需要审批
      if (llmResult.toolName === "exec") {
        this.reportProgress({ type: "approval_required", workflowId: this.instanceId,
          message: `即将执行: ${llmResult.toolArgs.command}` });
        await this.waitForApproval(step, { timeout: "5 minutes" });
      }

      // 工具执行
      const toolResult = await step.do(`tool-${i}`, {
        retries: { limit: 2, delay: "3 seconds" }
      }, async () => {
        return await callSandbox(env, llmResult.toolName, llmResult.toolArgs);
      });

      this.reportProgress({ type: "step", data: { tool: llmResult.toolName, result: toolResult } });
      messages.push(/* tool result */);
    }
  }
}
```

## Step 5: 前端改造

5.1 安装 agents client SDK
```bash
cd agents-website/app && npm install agents
```

5.2 Dashboard.tsx 核心改造:
- 删除手写 `new WebSocket()` 逻辑
- 用 `useAgent` hook 连接:
```tsx
const agent = useAgent({
  agent: "AgentSession",
  name: taskId,
  host: "api.agents.cloudc.top",
  query: async () => ({ token: getToken() }),
  onStateUpdate: (state) => { /* 更新 UI */ },
  onMessage: (msg) => {
    // 处理 progress 事件: log, step, plan, approval_required, answer
  }
});
```
- 审批 UI: 收到 `approval_required` 时显示确认按钮
  - 继续: `agent.send(JSON.stringify({ type: "approve", workflowId }))`
  - 取消: `agent.send(JSON.stringify({ type: "reject", workflowId }))`

5.3 保留:
- 截图渲染逻辑
- Lightbox
- 任务列表（仍从 /api/tasks GET）
- 登录（仍 POST /api/login）

## Step 6: 部署 + 验证

6.1 部署 Worker + Agent + Workflow
6.2 部署前端
6.3 测试: 普通搜索任务（无审批）
6.4 测试: exec 任务（有审批）
6.5 测试: 断点恢复（kill sandbox → Workflow 自动重试）
6.6 测试: 历史任务加载（Agent state 持久化）

## 风险点

1. **Migration v1→v2** — `new_classes` → `new_sqlite_classes` 会导致已有 DO 数据丢失。Demo 环境可接受。
2. **Agent SDK 的 WebSocket 协议** — SDK 会自动发 identity/state 消息给客户端。前端如果用 `onMessage` 处理原始消息，需要过滤掉 SDK 内部协议消息。
3. **Workflow 里的 env 访问** — 需确认 `this.env.SANDBOX_URL` 等 vars 在 Workflow context 可用。
4. **前端 agents/react 依赖** — 需要确认跟我们的 Vite + React 构建兼容。
5. **`@callable()` 装饰器** — 需要 tsconfig `"target": "ES2021"`，不能开 `experimentalDecorators`。

## 回退计划

```bash
git checkout v1.0
cd worker && CLOUDFLARE_API_TOKEN=xxx npx wrangler deploy
cd ../agents-website/app && npm run build && CLOUDFLARE_API_TOKEN=xxx npx wrangler pages deploy --branch=production
```
