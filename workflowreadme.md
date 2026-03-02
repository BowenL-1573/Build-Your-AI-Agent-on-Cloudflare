任务：**"查询 Cloudflare Container 有什么功能"**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## 第 0 步：连接建立

用户浏览器 → WebSocket → AgentSession DO
DO.onConnect() 验证 token，记录 userId/username


## 第 1 步：用户发消息

用户发送: { type: "task", content: "查询 Cloudflare Container 有什么功能" }


DO.onMessage() 收到后：
1. 检查 state.status !== "running" ✅
2. 生成 taskId
3. 清空旧 logs/steps
4. setState({ status: "running" })
5. 调用 this.runWorkflow("AGENT_TASK_WORKFLOW", { taskId, userMessage, userId, username })

→ Workflow 启动

## 第 2 步：Workflow 规划阶段

AgentTaskWorkflow.run() 开始执行：

1. step.mergeAgentState({ status: "running" }) → DO 状态更新
2. step.do("plan") → 调 LLM（不带 tools），LLM 返回：
json
{"steps": [
  {"id": 1, "description": "搜索 Cloudflare Container 功能"},
  {"id": 2, "description": "打开官方文档页面获取详细内容"},
  {"id": 3, "description": "总结功能列表"}
]}

3. reportProgress({ type: "plan", steps }) → DO.onWorkflowProgress() → broadcast() → 前端显示计划

## 第 3 步：ReAct 循环 — 第 1 轮（搜索）

Workflow 调 LLM（带 tools），LLM 返回：
json
{
  "content": "先搜索一下 Cloudflare Container 的功能",
  "tool_calls": [{ "function": { "name": "search", "arguments": "{\"query\": \"Cloudflare Containers features\"}" } }]
}


Workflow 执行工具：
typescript
// 以前（EC2）：
await fetch("http://sandbox.agents.cloudc.top:9090/search", { body: { query: "..." } })

// 现在（CF Sandbox）：
const sandbox = await getSandbox(env.Sandbox, "shared")
const result = await sandbox.exec("python3 /workspace/search.py 'Cloudflare Containers features'", { timeout: 30000 })
// result.stdout = JSON 字符串，包含 [{title, url, snippet}, ...]


Container 内部发生的事：
Container 收到 exec 指令
→ 启动 python3 /workspace/search.py
→ Playwright 启动 Chromium
→ 访问 google.com/search?q=Cloudflare+Containers+features
→ 解析 DOM 提取搜索结果
→ JSON 输出到 stdout
→ 返回给 Workflow


Workflow 拿到 stdout，解析出搜索结果：
json
[
  {"title": "Cloudflare Containers docs", "url": "https://developers.cloudflare.com/containers/", "snippet": "Run Docker containers..."},
  {"title": "Cloudflare Containers pricing", "url": "...", "snippet": "..."}
]


reportProgress({ type: "action", tool: "search", args }) → DO → 前端显示 🔧
reportProgress({ type: "observation", summary: "找到8条结果..." }) → DO → 前端显示 📄

把结果作为 tool message 追加到 messages 数组。

## 第 4 步：ReAct 循环 — 第 2 轮（读取页面）

Workflow 再次调 LLM（带 tools + 上一轮结果），LLM 返回：
json
{
  "content": "打开官方文档获取详细功能列表",
  "tool_calls": [{ "function": { "name": "navigate", "arguments": "{\"url\": \"https://developers.cloudflare.com/containers/\"}" } }]
}


Workflow 执行：
typescript
const sandbox = await getSandbox(env.Sandbox, "shared")  // 复用同一个容器
const result = await sandbox.exec(
  "python3 /workspace/browse.py 'https://developers.cloudflare.com/containers/' /tmp/screenshot.png",
  { timeout: 30000 }
)
// result.stdout = { title, url, text: "页面全文...", screenshot: "/tmp/screenshot.png" }

// 读截图文件，上传 R2
const imgData = await sandbox.readFile("/tmp/screenshot.png", { encoding: "bytes" })
await env.R2.put(`screenshots/${taskId}/step-1.png`, imgData)


reportProgress({ type: "screenshot", url: "..." }) → DO → 前端显示截图
reportProgress({ type: "observation", summary: "页面内容: Containers 支持..." }) → DO → 前端

## 第 5 步：ReAct 循环 — 第 3 轮（最终回答）

Workflow 再调 LLM，这次 LLM 认为信息够了，不返回 tool_calls：
json
{
  "content": "Cloudflare Container 的主要功能包括：\n1. 运行 Docker 容器...\n2. 与 Durable Objects 绑定...\n3. ..."
}


Workflow：
typescript
reportProgress({ type: "answer", content: "..." })  // → DO → 前端显示最终答案
// 更新 DB: task status = 'completed'
return { status: "completed", answer: "..." }


DO.onWorkflowComplete() 触发：
typescript
setState({ status: "completed" })
broadcast({ type: "workflow_complete" })  // → 前端显示完成状态


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


整个流程中，每个组件的职责：

| 组件 | 职责 |
|------|------|
| AgentSession DO | 接 WebSocket、转发消息、启动 Workflow、广播进度给前端 |
| AgentTaskWorkflow | ReAct 循环、调 LLM、调 Sandbox、状态持久化（step.do 保证幂等） |
| Container | 无状态执行环境，跑 Python 脚本，stdout 返回结果 |
| LLM | 决策：选哪个工具、传什么参数、什么时候结束 |

