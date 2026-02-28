# Agent 设计改进方案

> 基于 Manus AI Agent 架构逆向分析及其首席科学家 Pete 在 LangChain Webinar 上的分享

## 调研来源

- [Manus 架构深度分析](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f) — 逆向工程 Manus 的系统 Prompt、工具编排和自主执行能力
- [Manus: Context Engineering for Production AI Agents at Scale](https://www.zenml.io/llmops-database/context-engineering-for-production-ai-agents-at-scale) — Manus 团队在生产环境中的上下文工程实践
- [CodeAct (ICML 2024)](https://openreview.net/forum?id=jJ9BoXAfFa) — 用可执行代码作为 Agent 动作格式的研究

---

## 当前设计的问题

| 问题 | 现状 | 影响 |
|------|------|------|
| 无强制规划 | Prompt 里写了"先 Plan"，但 LLM 可能忽略直接调工具 | Agent 行为不可预测，复杂任务容易跑偏 |
| 工具粒度太粗 | 只有 `navigate` 一个工具 | LLM 想"只提取标题"或"搜索关键词"时无法精确表达意图 |
| 上下文无压缩 | 全量历史堆在 messages 里 | Token 消耗线性增长，多步任务后性能退化 |
| 日志无结构 | 推送给前端的只有 `status`/`action`/`answer` | 用户看不到 Agent 的思考过程和当前阶段 |
| 无错误恢复 | 沙盒报错直接返回错误文本 | 一个页面 403 就可能导致整个任务失败 |

---

## 改进方案

### 改进 1：强制规划阶段（Forced Planning Phase）

**依据：** Manus 有独立的 Planner 模块，在执行前生成结构化步骤列表存为 `todo.md`，Agent 每完成一步就更新状态。

**实现：**
- 第一轮 LLM 调用**不传 tools 参数**，强制只输出计划
- 要求 LLM 以 JSON 格式返回计划：`{ steps: [{ id, description, status }] }`
- 计划存入 DO Storage（`task:{id}:plan`）
- 后续每步执行完更新对应 step 的 status
- 推送给前端：`{ type: "plan", steps: [...] }` 和 `{ type: "step_update", step_id, status }`

**Agent 循环变为：**
```
用户指令 → [PLAN] LLM 生成计划（无工具）
         → [EXECUTE] 按计划逐步执行：
            每步: REASON → ACT → OBSERVE → 更新计划
         → [ANSWER] 所有步骤完成，输出最终总结
```

### 改进 2：扩展工具集（Layered Action Space）

**依据：** Manus 使用三层工具架构。Level 1 是原子函数（10-20 个），保持 function calling 接口精简以最大化 KV cache 命中率。

**新增工具：**

| 工具 | 参数 | 说明 |
|------|------|------|
| `navigate` | `url` | 打开页面，返回全文本 + 截图（已有） |
| `extract` | `url`, `selector` | 打开页面，只提取指定 CSS 选择器的内容 |
| `search` | `query` | 用搜索引擎搜索，返回结果列表（标题+URL+摘要） |
| `read_result` | `step_index` | 从 DO Storage 读取之前某步的完整结果 |

**沙盒新增接口：**
```
POST /extract   { url, selector }  → { text, screenshot_url, metadata }
POST /search    { query }          → { results: [{ title, url, snippet }] }
```

### 改进 3：上下文压缩（Context Compaction）

**依据：** Manus 区分 Compaction（可逆压缩）和 Summarization（不可逆压缩）。每个工具调用有 full 和 compact 两种格式。执行完后压缩成只保留引用，需要时再读文件。

**实现：**
- 工具结果存入 DO Storage 时保留完整版本
- 喂回 LLM 时使用 compact 版本：
  - `navigate` 结果：只保留前 2000 字符 + `[truncated, use read_result(N) for full content]`
  - `search` 结果：只保留前 10 条的标题和 URL
  - `extract` 结果：完整返回（因为已经是精确提取）
- 阈值管理：
  - messages 总 token 估算 > 8000 时，对最早 50% 的工具结果做 compaction
  - 保留最近 3 步的完整结果（作为 few-shot 示例）

### 改进 4：结构化日志推送（Structured Event Stream）

**依据：** Manus 使用类型化的事件流（Event Stream），每个事件有明确类型，帮助模型和用户区分不同信息。

**推送消息类型：**

| type | 说明 | 前端渲染 |
|------|------|---------|
| `plan` | Agent 的执行计划 | 📋 步骤列表，带状态标记 |
| `step_start` | 开始执行某步 | 高亮当前步骤 |
| `reasoning` | LLM 的推理过程 | 🧠 灰色斜体 |
| `action` | 工具调用 | 🔧 代码块样式 |
| `observation` | 工具返回结果摘要 | 📄 折叠面板 |
| `step_done` | 某步完成 | ✅ 更新步骤状态 |
| `screenshot` | 截图 URL | 🖼️ 内联图片 |
| `answer` | 最终答案 | ✅ 高亮卡片 |
| `error` | 错误信息 | ❌ 红色提示 |

### 改进 5：错误处理与重试（Error Recovery）

**依据：** Manus 的 Prompt 明确要求：失败后诊断错误、重试、换策略，3 次失败后才上报用户。

**实现：**
- 沙盒返回 4xx/5xx 时，自动重试 1 次（间隔 2 秒）
- 重试仍失败时，把错误信息作为 tool result 喂给 LLM：
  ```
  "Tool navigate failed: HTTP 403 Forbidden for https://...
   Please try an alternative approach or skip this step."
  ```
- LLM 可以选择：换 URL、换工具（用 search 代替直接 navigate）、或跳过该步
- 连续 3 步失败时，推送 `error` 给前端并终止

---

## 实施优先级

| 优先级 | 改进 | 工作量 | 影响 |
|--------|------|--------|------|
| P0 | 强制规划阶段 | DO 改动 ~30 行 | 根本性改善 Agent 行为可预测性 |
| P0 | 结构化日志推送 | DO + 前端各 ~20 行 | Debug 和 Demo 展示必需 |
| P1 | 扩展工具集 | 沙盒 + DO 各 ~50 行 | 提升任务完成质量 |
| P1 | 错误处理与重试 | DO ~30 行 | 提升鲁棒性 |
| P2 | 上下文压缩 | DO ~40 行 | 多步任务性能优化 |

---

## 改进后的架构流程

```
用户: "总结 HN 首页的 AI 新闻"
  │
  ▼
[PLAN] DO → AI Gateway (无 tools)
  │    LLM 返回: { steps: [
  │      { id: 1, desc: "访问 HN 首页获取文章列表" },
  │      { id: 2, desc: "筛选 AI 相关文章" },
  │      { id: 3, desc: "打开 top 3 文章获取详情" },
  │      { id: 4, desc: "汇总生成最终报告" }
  │    ]}
  │    → 推送 { type: "plan", steps: [...] }
  │    → 存入 DO Storage
  │
  ▼
[STEP 1] DO → AI Gateway (带 tools)
  │    → 推送 { type: "step_start", step_id: 1 }
  │    LLM: tool_call navigate("https://news.ycombinator.com")
  │    → 推送 { type: "action", tool: "navigate", args: {...} }
  │    DO → 沙盒 POST /execute
  │    ← { text: "...", screenshot_url: "r2://...", metadata: {...} }
  │    → 推送 { type: "observation", summary: "获取到 30 条文章" }
  │    → 推送 { type: "screenshot", url: "r2://..." }
  │    → 存完整结果到 DO Storage, compact 版本喂回 LLM
  │    → 推送 { type: "step_done", step_id: 1 }
  │
  ▼
[STEP 2-4] ... 循环 ...
  │
  ▼
[ANSWER] LLM 无 tool_call，返回最终总结
  │    → 推送 { type: "answer", content: "..." }
  │    → 更新所有步骤状态为 completed
```
