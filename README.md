# CF-Agent: Multi-Tenant Web Research Agent Demo

基于存算分离架构的 Web Research Agent 演示系统，展示 Cloudflare 产品矩阵在 AI Agent SaaS 场景下的价值。

## 架构概览

```
┌─────────────┐     WebSocket      ┌──────────────────────┐
│  Pages 前端  │ ◄──────────────── │  Worker + DO         │
│  (React)    │                    │  (Agent 状态机)       │
└─────────────┘                    └──────┬───────┬────────┘
                                          │       │
                                   AI Gateway    HTTP
                                   (LLM 调度)    │
                                          │       ▼
                                          │  ┌──────────┐
                                          │  │ EC2 沙盒  │
                                          │  │ Playwright│
                                          │  └────┬─────┘
                                          │       │
                                          ▼       ▼
                                      Workers AI   R2
                                      (GLM-4.7)  (截图存储)
```

## 技术栈

| 组件 | 技术 | 部署位置 |
|------|------|---------|
| 前端 | React + Tailwind + GSAP | Cloudflare Pages |
| API / 状态机 | Worker + Durable Objects (TypeScript) | Cloudflare Workers |
| LLM 调度 | AI Gateway → Workers AI (glm-4.7-flash) | Cloudflare AI Gateway |
| 用户数据 | D1 (SQLite) | Cloudflare D1 |
| 截图存储 | R2 | Cloudflare R2 |
| 浏览器沙盒 | Python FastAPI + Playwright (Docker) | Amazon EC2 (Seoul) |

## 项目结构

```
cf-agent/
├── README.md              # 本文件
├── design.md              # Agent 设计改进方案（基于 Manus 架构调研）
├── task.md                # 任务拆解与进度追踪
│
├── sandbox/               # Phase 1: 浏览器沙盒 (EC2)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py            # FastAPI: POST /execute
│
├── worker/                # Phase 2: Agent 核心 (Cloudflare)
│   ├── wrangler.toml
│   ├── package.json
│   └── src/
│       ├── index.ts        # Worker 入口: 路由 + 认证 + WebSocket
│       └── agent-session.ts # DO: ReAct 循环 + 状态持久化
│
├── dispatch/              # Phase 3: WfP 多租户 (暂缓)
│   ├── wrangler.toml
│   └── src/index.ts
│
└── agents-website/        # Phase 4: 前端
    └── app/
        ├── wrangler.toml
        └── src/
            ├── App.tsx
            ├── lib/api.ts
            └── pages/
                ├── Home.tsx       # 落地页（架构展示）
                ├── Login.tsx      # 登录
                └── Dashboard.tsx  # 任务中心
```

## 当前进度

### ✅ Phase 1: 无状态执行层 (EC2 + R2)
- Docker 容器运行 Playwright 无头浏览器
- `POST /execute` 接口：接收 URL → 打开页面 → 提取文本 → 截图上传 R2
- 已测试通过（Hacker News、example.com）

### ✅ Phase 2: 核心状态机 (DO + AI Gateway)
- Worker 部署在 `cf-agent.liubowen1573-846.workers.dev`
- Durable Object `AgentSession`：WebSocket 长连接 + ReAct 循环
- AI Gateway `cf-agent-gateway` → Workers AI `glm-4.7-flash`
- 每步执行结果持久化到 DO Storage（manifest）
- Plan → Reason → Act → Observe 工作流（Prompt 级别）
- 已测试通过完整 Agent 任务流程

### ⏸️ Phase 3: 多租户路由 (WfP) — 暂缓
- Dispatch namespace `cf-agent-tenants` 已创建
- 决定先专注 Agent 核心能力，WfP 后续按需添加

### ✅ Phase 4: 前端交互层 (Pages)
- React 聊天界面，WebSocket 连接 Worker
- 用户认证（D1 存储用户名密码）
- 任务创建、实时日志、截图展示
- 已清理无用元素（假 Agent 类型、假评价等）
- 落地页展示真实架构和工作流程

## 部署信息

| 组件 | 地址 |
|------|------|
| Worker API | `https://cf-agent.liubowen1573-846.workers.dev` |
| 前端 Pages | `cf-agent-web.pages.dev`（计划绑定 `agent.cloudc.top`） |
| EC2 沙盒 | `3.39.169.123:9090`（Docker 容器 `cf-sandbox`） |
| R2 Bucket | `sandbox` |
| AI Gateway | `cf-agent-gateway` |
| D1 Database | 用户认证数据 |

## 下一步：Agent 设计改进

详见 [design.md](./design.md)，核心改进：

1. **强制规划阶段** — 第一轮不传 tools，强制 LLM 先输出结构化计划
2. **扩展工具集** — 新增 `extract`（精确提取）和 `search`（搜索引擎）
3. **上下文压缩** — 工具结果分 full/compact 两种格式，控制 Token 消耗
4. **结构化日志** — 每条推送带阶段标签（PLAN/REASON/ACT/OBSERVE）
5. **错误恢复** — 自动重试 + LLM 自主决定换策略

## 本项目要证明的商业价值

| Cloudflare 产品 | 证明的价值 |
|-----------------|-----------|
| R2 | 零 Egress 费用：Agent 截图的高频读取（前端展示 + LLM 分析）不产生出网流量费 |
| Durable Objects | 状态持久化 + 断点续跑：沙盒崩溃后 Agent 上下文不丢失，自动恢复 |
| AI Gateway | LLM 可观测性：Token 消耗追踪、Prompt 缓存、按租户限流 |
| Pages | 边缘前端托管：全球低延迟访问 |
| D1 | 边缘数据库：用户认证数据就近存储 |
