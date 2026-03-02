# CF-Agent: Web Research Agent on Cloudflare

全栈运行在 Cloudflare 上的 AI Web Research Agent，展示 Cloudflare 产品矩阵在 AI Agent 场景下的能力。

## 架构

```
用户 ──WebSocket──▶ Worker + Durable Object (状态管理)
                         │
                    Workflow (编排层)
                    ┌────┴────┐
              AI Gateway    Container Sandbox
              (LLM 调度)    (工具执行环境)
                  │          ├─ search (Serper)
                  ▼          ├─ fetch (httpx + Jina)
              Workers AI     ├─ navigate (Playwright)
              (GLM-4.7)      ├─ extract (CSS selector)
                             ├─ write_file / read_file
                             ├─ exec / python
                             └─ request_help (human-in-the-loop)
                                    │
                                    ▼
                                    R2 (截图存储)
```

## 技术栈

| 层 | 技术 | Cloudflare 产品 |
|---|---|---|
| 前端 | React + Tailwind + GSAP | Pages |
| API / 状态 | TypeScript Worker + Durable Object | Workers |
| 编排 | Workflow (plan → review → execute) | Workflows |
| 工具沙盒 | Python + Playwright (Docker) | Container |
| LLM | GLM-4.7-flash via AI Gateway | Workers AI + AI Gateway |
| 用户数据 | SQLite | D1 |
| 截图存储 | Object Storage | R2 |

## 项目结构

```
cf-agent/
├── worker/                  # Agent 核心
│   ├── src/
│   │   ├── index.ts         # Worker 入口: 路由 + 认证
│   │   ├── agent-session.ts # DO: WebSocket + 状态管理
│   │   └── agent-workflow.ts # Workflow: 规划 + ReAct 循环
│   ├── scripts/             # Container 内工具脚本
│   │   ├── search.py        # Serper API 搜索
│   │   ├── fetch_url.py     # httpx + Jina Reader 抓取
│   │   ├── browse.py        # Playwright 导航 + 截图
│   │   └── extract.py       # CSS 选择器提取
│   ├── Dockerfile           # Container 镜像
│   └── wrangler.toml
│
└── agents-website/app/      # 前端
    └── src/pages/
        ├── Home.tsx          # 落地页 (架构展示)
        ├── Login.tsx         # 登录
        └── Dashboard.tsx     # 任务中心 (计划审批 + 实时日志)
```

## Agent 工作流

1. **用户输入任务** → WebSocket 发送到 Durable Object
2. **规划阶段** → LLM 生成 5 步计划 (JSON)
3. **计划审批** → 前端展示计划，用户可确认/修改/终止 (30s 自动执行)
4. **执行阶段** → ReAct 循环，最多 30 步
   - 工具并发执行 (最多 5 个/轮)
   - 失败 URL 自动去重
   - 连续失败自动降级
5. **输出报告** → `write_file` 保存 report.md + 摘要返回用户

## 部署

```bash
# Worker
cd worker && npx wrangler deploy

# 前端
cd agents-website/app && npm run build && npx wrangler pages deploy dist --project-name cf-agent-web
```

## 线上地址

| 组件 | 地址 |
|---|---|
| 前端 | https://agents.cloudc.top |
| Worker | https://cf-agent.liubowen1573-846.workers.dev |
