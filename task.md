# CF-Agent: Multi-Tenant Web Research Agent Demo

## 项目目标

基于存算分离架构的多租户 Web Research Agent 演示系统，展示 Cloudflare 产品矩阵（R2 / DO / WfP / AI Gateway / Pages）在 AI Agent SaaS 场景下的商业价值。

---

## Phase 1：无状态执行层（EC2 + R2）

**目标：** 一个纯粹的远程浏览器 API 服务，无状态，可随时销毁重建。

- [ ] 1.1 Cloudflare R2 Bucket 配置（CORS、API Token）
- [ ] 1.2 EC2 上部署 HTTP 服务（FastAPI 或 Express）
- [ ] 1.3 集成 Playwright，实现 `POST /execute` 接口
  - 接收 URL + task_id
  - 打开页面 → 提取文本 + Accessibility Tree → 截图
  - 截图上传 R2 → 返回 { text, screenshot_url, metadata }
- [ ] 1.4 错误处理：超时、页面加载失败、上传失败
- [ ] 1.5 验证：Postman 调通，R2 中可见截图

---

## Phase 2：核心状态机与 LLM 调度（DO + AI Gateway）

**目标：** Agent 的中枢大脑，ReAct 循环 + 状态持久化 + 断点续跑。

- [ ] 2.1 配置 AI Gateway（绑定 LLM 后端，开启 Logging / Caching / Rate Limiting）
- [ ] 2.2 创建 Worker + Durable Object 类
- [ ] 2.3 DO 内实现 WebSocket 长连接（与前端通信）
- [ ] 2.4 DO 内实现 ReAct 循环
  - 接收用户指令 → 组装 Prompt → 调 AI Gateway → 解析意图
  - 调用 Phase 1 沙盒执行 → 获取结果
  - 结果喂回 LLM → 决定下一步或输出最终总结
- [ ] 2.5 上下文管理（分层存储）
  - DO Storage 存完整记录（manifest：每步输入/输出/R2路径）
  - 发给 LLM 的上下文做压缩（滑动窗口 + 摘要）
- [ ] 2.6 断点续跑：沙盒崩溃后从 manifest 最后成功步骤恢复
- [ ] 2.7 验证：终端 WebSocket 客户端跑通完整 Research 任务；kill EC2 后任务自动恢复

---

## Phase 3：多租户路由层（WfP）

**目标：** 租户级代码隔离，不同租户可运行不同版本的 Agent 逻辑。

- [ ] 3.1 创建 Dispatch Worker 环境
- [ ] 3.2 路由逻辑：解析租户标识（URL 路径 / Header）→ 鉴权 → 限流
- [ ] 3.3 `env.dispatcher.get()` 动态转发到对应 User Worker
- [ ] 3.4 至少两个租户模板：Basic（单步执行）/ Pro（多步 ReAct + 自定义 Prompt）
- [ ] 3.5 验证：不同租户路径请求，验证隔离性和能力差异

---

## Phase 4：前端交互层（Pages）

**目标：** 可视化 Demo 界面 + 成本对比展示。

- [ ] 4.1 React 聊天界面（WebSocket 连接 WfP 网关）
- [ ] 4.2 消息流渲染（打字机效果 + Agent 思考过程展示）
- [ ] 4.3 R2 截图内联展示（`<img>` 直接加载 R2 URL）
- [ ] 4.4 成本对比面板（本次任务：纯 AWS 方案 vs 存算分离方案的预估费用）
- [ ] 4.5 部署到 Cloudflare Pages
- [ ] 4.6 验证：端到端测试，UI 输入 → 图文总结全流程

---

## 关键设计决策

| 决策点 | 方案 |
|--------|------|
| 沙盒语言 | 待定（Python FastAPI / Node Express） |
| LLM 后端 | 待定（Workers AI / OpenAI / Claude） |
| 文本提取策略 | 混合：默认文本/A11y Tree，fallback 截图给多模态 LLM |
| 上下文压缩 | 分层存储 + 滑动窗口 + 定期摘要 |
| 租户隔离 | WfP User Worker 级别隔离 |
| 截图用途 | 主要服务前端展示和审计日志，LLM 仅在需要视觉理解时使用 |
