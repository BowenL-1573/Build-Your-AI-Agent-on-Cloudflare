# CF-Agent 进度 — 2026-03-01 (for 03-02 继续)

## 今日完成

### 1. Serper 搜索引擎集成 ✅
- 替换了失败的 Bing 爬虫，改用 Serper API
- `search.py` 重写，通过 `SERPER_API_KEY` 环境变量调用
- 已设为 wrangler secret 并通过 `sandbox.setEnvVars()` 传入容器

### 2. fetch 工具 HTML → Markdown ✅
- 问题：fetch 返回原始 HTML，LLM 无法理解内容
- 方案：Dockerfile 加 `html2text`，fetch 输出转为 Markdown
- 效果：token 消耗降低，LLM 可直接阅读网页正文

### 3. WebSocket 断连自动重连 ✅
- 问题：容器版本滚动更新导致 `WebSocket not connected` 错误，所有工具调用失败
- 方案：tool execution 捕获 WebSocket 错误 → 重新 `getSandbox()` + `setEnvVars()` + `mkdir taskDir`
- `sandbox` 改为 `let` 以支持重新赋值

### 4. 反幻觉 Prompt 规则 ✅
- 问题：工具全部失败时 LLM 编造数据（虚假日期、虚假新闻内容）
- 方案：system prompt 加规则 "NEVER fabricate data, dates, or facts. If a tool fails, report the failure."

### 5. request_help 人机交互 ✅
- Worker：`request_help` 工具发 `approval_required` 事件（复用前端已有逻辑）
- Worker：`approveWorkflow` 传递 `userInput` 到 metadata
- 前端：approval 弹框新增 textarea 输入框，用户可输入建议文字
- 流程：LLM 卡住 → 调用 request_help → 前端弹框 → 用户输入建议 → 传回 LLM 作为 tool result

## 当前架构（9 工具）

| 工具 | 说明 | 状态 |
|------|------|------|
| search | Serper API 搜索 | ✅ |
| navigate | Playwright 浏览器 + 截图 → R2 | ✅ |
| extract | CSS 选择器提取 | ✅ |
| fetch | HTTP GET → html2text → Markdown | ✅ 改进 |
| read_file | 读取工作区文件 | ✅ |
| write_file | 写入工作区文件 | ✅ |
| python | 执行 Python 脚本 | ✅ |
| exec | Shell 命令（需人工批准） | ✅ |
| request_help | LLM 请求人工协助 | ✅ 新增 |

## 已知问题

1. **容器频繁重启** — `Runtime signalled the container to exit due to a new version rollout`，每次 deploy 都会触发，WebSocket 重连机制已缓解但不根治
2. **新浪等网站反爬** — fetch 拿到的 HTML 可能不含正文（JS 渲染），需要 navigate 工具配合
3. **navigate 偶尔失败** — Playwright 在沙盒中启动不稳定

## 部署信息

- Worker Version: `9232beaf-b48e-4097-a5ea-f5288cba94b4`
- Container Image: `cf-agent-sandbox:8ab9f58e`
- Frontend: `https://agents.cloudc.top`
- Dockerfile: 加了 `html2text`

## 明日计划

1. **端到端测试** — 完整跑一个研究任务，验证 search → fetch(markdown) → write_file → 最终报告
2. **测试 request_help 交互** — 给 LLM 一个会卡住的任务，验证弹框 + 文本输入 + 传回流程
3. **容器稳定性** — 调查 version rollout 频率，考虑是否需要固定版本
4. **考虑 Skill 系统** — 用户提到未来用 skill 替代 tool 的可能性
