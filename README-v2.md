# CF-Agent: Multi-Tenant Web Research Agent on Cloudflare

基于 Cloudflare Sandbox SDK 的 Web Research Agent 演示系统。用户输入自然语言任务，Agent 自主规划、搜索网页、提取信息、截图，最终返回结构化研究报告。

**线上地址**：https://agents.cloudc.top  
**API 地址**：https://api.agents.cloudc.top

---

## 架构

```
┌──────────────┐   WebSocket    ┌─────────────────────────────────────────┐
│  Pages 前端   │ ◄────────────► │  Worker (index.ts)                      │
│  React+GSAP  │                │  ├─ REST API (login/tasks/admin/r2)     │
└──────────────┘                │  ├─ WebSocket → AgentSession DO         │
                                │  └─ Sandbox debug endpoint              │
                                └──────┬──────────┬───────────────────────┘
                                       │          │
                                       ▼          ▼
                              ┌──────────┐  ┌──────────────────┐
                              │ AgentTask │  │ AgentSession DO  │
                              │ Workflow  │  │ (状态 + WS广播)   │
                              └────┬─────┘  └──────────────────┘
                                   │
                          ┌────────┼────────┐
                          ▼        ▼        ▼
                    ┌──────────┐ ┌────┐ ┌──────┐
                    │ Sandbox  │ │ AI │ │  D1  │
                    │ Container│ │Gate│ │      │
                    │ (Python  │ │way │ │(用户) │
                    │ Playwright│ │    │ │      │
                    │ httpx)   │ │    │ │      │
                    └────┬─────┘ └────┘ └──────┘
                         │
                         ▼
                    ┌──────────┐
                    │    R2    │
                    │ (截图存储)│
                    └──────────┘
```

### 核心设计理念

**存算分离** — 计算（浏览器沙盒）运行在 Cloudflare Container 内，状态（Agent 上下文、任务进度）持久化在 Durable Objects，存储（截图）放在 R2。三者解耦，各自独立扩缩。

**Workflow 驱动** — Agent 的 ReAct 循环运行在 Cloudflare Workflow 中，天然具备持久化、重试、断点续跑能力。沙盒崩溃不影响 Agent 状态。

**Human-in-the-Loop** — `exec` 工具（任意 shell 命令）需要用户在前端点击"批准"才会执行，通过 Workflow 的 `waitForApproval` 实现。

---

## 技术栈

| 组件 | 技术 | 作用 |
|------|------|------|
| 前端 | React + Tailwind + GSAP + shadcn/ui | 落地页、登录、任务中心 |
| Worker | Cloudflare Workers (TypeScript) | HTTP API + WebSocket 路由 |
| 状态机 | Durable Objects (`AgentSession`) | WebSocket 广播、任务状态、日志持久化 |
| 执行引擎 | Workflows (`AgentTaskWorkflow`) | ReAct 循环、LLM 调用、工具调度 |
| 浏览器沙盒 | Cloudflare Sandbox SDK + Container | Python + Playwright + Chromium |
| LLM | AI Gateway → Workers AI (GLM-4.7-flash) | 规划 + 推理 |
| 用户数据 | D1 (SQLite) | 用户认证、任务列表 |
| 截图存储 | R2 | 零 Egress 费用的截图读写 |

---

## 项目结构

```
cf-agent/
├── README-v2.md                    # 本文件
├── worker/                         # Worker + Sandbox
│   ├── wrangler.toml               # Bindings: DO, Workflow, D1, R2, Container
│   ├── package.json                # agents, @cloudflare/sandbox
│   ├── Dockerfile                  # Sandbox 容器镜像
│   ├── scripts/                    # 容器内 Python 脚本
│   │   ├── search.py               # Bing 搜索 (httpx + regex 解析)
│   │   ├── browse.py               # Playwright 页面导航 + 截图
│   │   ├── extract.py              # Playwright CSS 选择器提取
│   │   └── debug_search.py         # 调试: 查看搜索引擎返回的原始 HTML
│   └── src/
│       ├── index.ts                # Worker 入口: REST API + WS 路由
│       ├── agent-session.ts        # AgentSession DO: 状态 + WS 广播
│       └── agent-workflow.ts       # AgentTaskWorkflow: ReAct 循环
│
├── agents-website/                 # 前端
│   └── app/
│       ├── wrangler.toml           # Pages 配置
│       └── src/
│           ├── App.tsx             # 路由: / → Home, /login, /dashboard
│           ├── lib/api.ts          # API_BASE, WS_BASE 常量
│           └── pages/
│               ├── Home.tsx        # 落地页 (粒子背景 + 架构展示)
│               ├── Login.tsx       # 登录页
│               └── Dashboard.tsx   # 任务中心 (创建/查看/实时日志/截图)
│
├── sandbox/                        # (旧) EC2 沙盒, 已被 Cloudflare Container 替代
└── dispatch/                       # (暂缓) WfP 多租户路由
```

---

## Agent 工作流程

### 1. 任务创建

```
用户 → WebSocket → AgentSession DO → runWorkflow("AGENT_TASK_WORKFLOW", params)
```

前端通过 WebSocket 连接到 `AgentSession` DO，发送 `{ type: "task", content: "..." }`。DO 启动 Workflow 实例。

### 2. 规划阶段 (Plan)

Workflow 第一步调用 LLM（不传 tools），要求输出 JSON 格式的执行计划：

```json
{"steps": [
  {"id": 1, "description": "搜索最新新闻"},
  {"id": 2, "description": "打开搜索结果中的文章"},
  {"id": 3, "description": "提取关键信息并总结"}
]}
```

同时 fire-and-forget 调用 `getSandbox()` 预热容器，减少后续工具调用的冷启动。

### 3. ReAct 循环 (最多 20 步)

每一步：

```
LLM 推理 → 选择工具 + 参数 → callSandbox() 执行 → 结果压缩 → 反馈给 LLM
```

- LLM 可以选择 5 个工具之一，或直接输出最终答案
- 工具结果超过 2000 字符会被截断（search/extract 除外）
- 连续 3 次工具失败自动终止
- 上下文超过 32K 字符时，旧的 tool 消息会被压缩

### 4. 工具执行

所有工具通过 `sandbox.exec()` 在 Cloudflare Container 中执行：

| 工具 | 实现 | 说明 |
|------|------|------|
| `search` | `python3 /workspace/search.py <query>` | httpx 请求 Bing，regex 解析 `<li class="b_algo">` |
| `navigate` | `python3 /workspace/browse.py <url> <screenshot_path>` | Playwright 打开页面，提取 body 文本，截图 |
| `extract` | `python3 /workspace/extract.py <url> <selector>` | Playwright 打开页面，CSS 选择器提取 |
| `fetch` | 内联 `python3 -c "import httpx; ..."` | 纯 HTTP GET，不启动浏览器 |
| `exec` | 直接 `sandbox.exec(command)` | 任意 shell 命令，需用户批准 |

### 5. 截图流水线

```
browse.py 截图 → sandbox.readFile(base64) → atob → Uint8Array → R2.put()
                                                                    ↓
前端 ← WebSocket ← screenshot_url: https://api.agents.cloudc.top/api/r2/screenshots/...
```

### 6. 实时推送

Workflow 通过 `this.reportProgress()` 向 AgentSession DO 推送事件，DO 通过 `this.broadcast()` 转发给所有 WebSocket 连接：

| 事件类型 | 说明 |
|----------|------|
| `plan` | 执行计划 |
| `step_start` / `step_done` | 计划步骤状态变更 |
| `reasoning` | LLM 推理过程 |
| `action` | 工具调用（工具名 + 参数） |
| `observation` | 工具执行结果摘要 |
| `screenshot` | 截图 URL |
| `approval_required` | exec 命令等待用户批准 |
| `answer` | 最终答案 |
| `error` | 错误信息 |

---

## System Prompt 设计

```
You are a Web Research Agent. You help users research topics on the web.

**Today's date: {动态生成}**
```

关键设计原则：

1. **客观描述工具** — 只说每个工具做什么，不说"推荐用哪个"、不标注速度快慢。让 LLM 自己根据场景选择。
2. **动态日期** — `getSystemPrompt()` 函数每次调用时生成当天日期，避免 LLM 搜索过时关键词。
3. **防止死循环** — "Do NOT repeat the same failing approach more than twice"。
4. **强制完整回答** — "NEVER stop with a plan for next steps — that is NOT a final answer"。
5. **语言跟随** — "ALWAYS respond in the same language as the user's input"。

---

## API 接口

### 认证

Token 格式：`base64(userId:username:role)`，通过 URL 参数 `?token=` 或 `Authorization: Bearer` 传递。

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 登录，返回 token |
| GET | `/api/tasks?token=` | 获取当前用户任务列表 |
| GET | `/api/tasks/:id?token=` | 获取任务详情（日志、步骤、计划） |
| DELETE | `/api/tasks/:id?token=` | 删除任务 |
| GET | `/api/r2/:key?token=` | 读取 R2 截图 |
| GET | `/api/admin/overview?token=` | 管理员：所有用户和任务 |
| GET | `/api/admin/task/:userId/:taskId?token=` | 管理员：查看任意任务 |
| POST | `/api/sandbox-exec` | 管理员：在容器中执行命令（调试用） |

### WebSocket

```
wss://api.agents.cloudc.top/ws?token=xxx&task=taskId&title=任务名
```

客户端消息：
```json
{"type": "task", "content": "研究任务描述", "task_id": "uuid"}
{"type": "approve"}
{"type": "reject", "reason": "原因"}
```

服务端推送：见上方"实时推送"表格。

---

## Sandbox Container

### Dockerfile

```dockerfile
FROM docker.io/cloudflare/sandbox:0.7.0-python
RUN pip3 install --no-cache-dir playwright httpx
RUN python3 -m playwright install --with-deps chromium
COPY scripts/ /workspace/
```

- 基础镜像：`sandbox:0.7.0-python`（Cloudflare Sandbox SDK 官方 Python 镜像）
- 实例类型：`standard-1`（8GB 磁盘，容纳 3.26GB 镜像）
- 容器内工作目录：`/workspace/`（Python 脚本）
- 临时文件：`/tmp/`（截图等）

### 容器生命周期

- 通过 `getSandbox(env.Sandbox, "shared")` 获取共享实例
- 规划阶段 fire-and-forget 预热，减少首次工具调用延迟
- 容器在版本更新时会被 rollout 重启（`Runtime signalled the container to exit due to a new version rollout`）

---

## Durable Objects

### AgentSession

职责：WebSocket 连接管理、状态广播、日志/步骤持久化。

```typescript
class AgentSession extends Agent<Env, AgentState> {
  // SQLite 表: logs, steps
  // 状态: idle | running | completed | failed | waiting_approval
  // WebSocket: onConnect → 验证 token, onMessage → 启动 Workflow / 批准 / 拒绝
  // Workflow 回调: onWorkflowProgress → broadcast, onWorkflowComplete/Error → 更新状态
}
```

AgentSession 不直接执行 Agent 逻辑，只负责：
1. 接收用户消息，启动 Workflow
2. 接收 Workflow 进度，广播给前端
3. 持久化日志和步骤记录到 SQLite

### Sandbox DO

由 `@cloudflare/sandbox` 自动管理，绑定到 Container。通过 `getSandbox()` 获取实例后调用 `exec()` / `readFile()`。

---

## 前端

### 页面

| 路由 | 组件 | 说明 |
|------|------|------|
| `/` | Home.tsx | 落地页：粒子背景、架构图、工作流程、CTA |
| `/login` | Login.tsx | 用户名密码登录 |
| `/dashboard` | Dashboard.tsx | 任务中心：创建任务、实时日志、截图查看 |

### 任务生命周期（前端视角）

1. 用户点击"新建任务"，输入名称和描述
2. 前端创建 WebSocket 连接，发送 `{ type: "task" }`
3. 实时接收 Workflow 事件，更新日志面板、计划进度条、截图
4. `exec` 命令触发审批弹窗，用户点击"批准"或"拒绝"
5. 收到 `answer` 或 `error` 事件，任务结束

### 截图展示

日志中的 `[screenshot]<url>` 格式会被渲染为可点击缩略图，点击打开全屏 Lightbox。

---

## 部署

### 环境变量 & Secrets

| 变量 | 来源 | 说明 |
|------|------|------|
| `AI_GATEWAY_BASE` | wrangler.toml vars | AI Gateway 端点 |
| `AI_MODEL` | wrangler.toml vars | LLM 模型标识 |
| `CF_AIG_TOKEN` | wrangler secret | AI Gateway 认证 token |

### 部署命令

```bash
# Worker + Container
cd worker && npx wrangler deploy

# 前端
cd agents-website/app && npm run build && npx wrangler pages deploy --branch=production
```

`wrangler deploy` 会自动：
1. 构建 Docker 镜像
2. Push 到 Cloudflare Container Registry
3. 部署 Worker + 更新 Container 配置

### 调试

```bash
# 在容器中执行命令
curl -X POST https://api.agents.cloudc.top/api/sandbox-exec \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"cmd": "python3 /workspace/search.py test"}'

# 查看实时日志
npx wrangler tail cf-agent
```

---

## 已知问题

### 搜索质量

当前使用 Bing 搜索（httpx + regex 解析 HTML）。Cloudflare Container 的出口 IP 被 Google 标记为自动化流量（返回 CAPTCHA），因此无法使用 Google。Bing 对部分查询（尤其是中文）返回的结果相关性较差。

可能的改进方向：
- 接入 Brave Search API 或 SearXNG
- 使用 Bing News API（需要 API key）
- 在搜索脚本中添加 `&freshness=Week` 等时间过滤参数

### 容器 Rollout

每次 `wrangler deploy` 会触发容器重启（`Runtime signalled the container to exit due to a new version rollout`），正在执行的 `sandbox.exec()` 会失败。Workflow 的重试机制可以部分缓解。

---

## Cloudflare 产品价值证明

| 产品 | 证明的价值 |
|------|-----------|
| **Sandbox SDK + Containers** | 安全隔离的代码执行环境，无需自建 EC2 沙盒 |
| **R2** | 零 Egress：截图高频读取（前端展示）不产生出网流量费 |
| **Durable Objects** | 状态持久化 + WebSocket 广播：Agent 上下文不丢失 |
| **Workflows** | 持久化执行：ReAct 循环天然支持重试、断点续跑 |
| **AI Gateway** | LLM 可观测性：Token 追踪、Prompt 缓存、限流 |
| **D1** | 边缘数据库：用户认证就近存储 |
| **Pages** | 边缘前端托管：全球低延迟 |
