# Cloudflare Sandbox SDK
## 边缘计算上的安全代码执行

---

## 什么是 Sandbox SDK？

**在隔离环境中安全运行不受信任的代码**

- 基于 Cloudflare Containers（VM 级别隔离）
- 完整 Linux 环境（Ubuntu + Python + Node.js + Git）
- 简洁的 TypeScript API（从 Workers 调用）
- 零基础设施管理

**状态**：Beta（需要 Workers Paid 计划）

**文档**：https://developers.cloudflare.com/sandbox/

---

## 架构：三层设计

```
┌─────────────────────────────────────────┐
│  第 1 层：你的 Worker                    │
│  ─────────────────────────────────────  │
│  使用 Sandbox SDK 的应用代码             │
└──────────────┬──────────────────────────┘
               │ 通过 Durable Object stub 的 RPC 调用
               ▼
┌─────────────────────────────────────────┐
│  第 2 层：Durable Object                │
│  ─────────────────────────────────────  │
│  • 路由请求并维护状态                    │
│  • 管理容器生命周期                      │
│  • 地理分布式部署                        │
└──────────────┬──────────────────────────┘
               │ HTTP/WebSocket API
               ▼
┌─────────────────────────────────────────┐
│  第 3 层：Container 运行时               │
│  ─────────────────────────────────────  │
│  • VM 级别隔离（安全）                   │
│  • 完整 Ubuntu Linux 环境                │
│  • 安全执行不受信任的代码                │
└─────────────────────────────────────────┘
```

**参考**：[架构文档](https://developers.cloudflare.com/sandbox/concepts/architecture/)

---

## 核心能力

### 1. 命令执行

**三种执行模式**：

| 方法 | 使用场景 | 行为 |
|------|---------|------|
| `exec()` | 一次性命令、脚本 | 等待完成，返回完整输出 |
| `execStream()` | 实时输出监控 | 返回 SSE 事件流 |
| `startProcess()` | 长期运行的服务（Web 服务器、数据库） | 后台运行，立即返回 |

**示例**：
```typescript
// 一次性执行
const result = await sandbox.exec('python script.py');

// 后台服务
const server = await sandbox.startProcess('python -m http.server 8000');
await server.waitForPort(8000); // 等待服务就绪
```

**参考**：[Commands API](https://developers.cloudflare.com/sandbox/api/commands/)

---

### 2. Code Interpreter（代码解释器）

**执行 Python/JavaScript/TypeScript 并输出富文本结果**

**特性**：
- 持久化执行上下文（变量/导入在多次执行间保留）
- 自动结果捕获（最后一个表达式自动返回）
- 富文本输出格式：图表、表格、图片、LaTeX、Markdown
- 支持 top-level `await`（JavaScript/TypeScript）

**示例**：
```typescript
const ctx = await sandbox.createCodeContext({ language: 'python' });

// 执行 1：导入并定义数据
await sandbox.runCode('import pandas as pd; data = [1,2,3,4,5]', { context: ctx });

// 执行 2：使用之前的上下文
const result = await sandbox.runCode('sum(data)', { context: ctx });
console.log(result.results[0].text); // "15"
```

**支持的库**：pandas、NumPy、matplotlib、scikit-learn

**参考**：[Code Interpreter API](https://developers.cloudflare.com/sandbox/api/interpreter/)

---

### 3. 文件操作

**完整的文件系统访问**：
- `readFile()` / `writeFile()` - 读写文件
- `mkdir()` / `deleteFile()` - 目录操作
- `renameFile()` / `moveFile()` - 文件操作
- `gitCheckout()` - Git 仓库操作

**示例**：
```typescript
await sandbox.mkdir('/workspace/project/src', { recursive: true });
await sandbox.writeFile('/workspace/project/package.json', 
  JSON.stringify({ name: 'my-app', version: '1.0.0' })
);
const content = await sandbox.readFile('/workspace/project/package.json');
```

**参考**：[Files API](https://developers.cloudflare.com/sandbox/api/files/)

---

### 4. 文件监听（实时）

**使用原生 inotify 监控文件系统变化**

**特性**：
- 递归目录监听
- Glob 模式过滤（`*.ts`、`**/*.js`）
- 事件类型：`create`、`modify`、`delete`、`move_from`、`move_to`、`attrib`
- SSE 流实时更新

**使用场景**：
- 热重载开发服务器
- 构建自动化系统
- 配置监控工具

**示例**：
```typescript
const stream = await sandbox.watch('/workspace/src', {
  recursive: true,
  include: ['*.ts', '*.js']
});

for await (const event of parseSSEStream(stream)) {
  if (event.type === 'event' && event.eventType === 'modify') {
    console.log(`文件变化：${event.path}`);
    // 触发重新构建
  }
}
```

**参考**：[File Watching API](https://developers.cloudflare.com/sandbox/api/file-watching/)

---

### 5. Session 管理

**Sandbox 内的隔离执行上下文**

**Session 提供**：
- 独立的 Shell 状态（环境变量、工作目录）
- 不同环境的并行执行
- 跨请求的持久化状态

**示例**：
```typescript
// 生产环境
const prodSession = await sandbox.createSession({
  id: 'prod',
  env: { NODE_ENV: 'production', API_URL: 'https://api.example.com' },
  cwd: '/workspace/prod'
});

// 测试环境
const testSession = await sandbox.createSession({
  id: 'test',
  env: { NODE_ENV: 'test', API_URL: 'http://localhost:3000' },
  cwd: '/workspace/test'
});

// 并行运行
const [prodResult, testResult] = await Promise.all([
  prodSession.exec('npm run build'),
  testSession.exec('npm run build')
]);
```

**参考**：[Sessions API](https://developers.cloudflare.com/sandbox/api/sessions/)

---

### 6. Preview URLs（端口暴露）

**通过公共 URL 暴露 HTTP 服务**

**特性**：
- 自动生成或自定义 token
- 通配符子域名路由：`https://{port}-{sandboxId}-{token}.yourdomain.com`
- 支持 WebSocket（通过 `wsConnect()`）
- Token 验证实现访问控制

**要求**：
- 自定义域名 + 通配符 DNS（仅生产环境）
- 不能使用 `.workers.dev` 域名

**示例**：
```typescript
const server = await sandbox.startProcess('python -m http.server 8000');
await server.waitForPort(8000);

const exposed = await sandbox.exposePort(8000, { 
  hostname: 'example.com',
  token: 'my-service-v1'  // 重启后 URL 保持不变
});

console.log(exposed.url); 
// https://8000-sandbox-id-my-service-v1.example.com
```

**参考**：[Ports API](https://developers.cloudflare.com/sandbox/api/ports/)

---

### 7. 存储与备份

**跨生命周期的持久化数据**

**存储（R2/S3/GCS 挂载）**：
- 将对象存储挂载为本地文件系统
- 标准文件操作（`cp`、`mv`、`cat`）
- 数据在 Sandbox 重启后保留
- 需要生产环境部署

**备份（快照）**：
- 目录的时间点快照
- 写时复制覆盖层（快速恢复）
- 备份存储在 R2
- 可恢复到任意 Sandbox

**示例**：
```typescript
// 创建备份
const backup = await sandbox.createBackup('/workspace/project', {
  r2Bucket: env.BACKUPS,
  key: 'project-backup-2026-03-04.tar.gz'
});

// 恢复到另一个 Sandbox
await sandbox.restoreBackup('/workspace/restored', {
  r2Bucket: env.BACKUPS,
  key: 'project-backup-2026-03-04.tar.gz'
});
```

**参考**：
- [Storage API](https://developers.cloudflare.com/sandbox/api/storage/)
- [Backups API](https://developers.cloudflare.com/sandbox/api/backups/)

---

### 8. 生命周期管理

**控制 Sandbox 生命周期和资源使用**

**关键选项**：
- `sleepAfter`：无活动后自动休眠（默认：`"10m"`）
- `keepAlive`：防止自动休眠（需要手动 `destroy()`）
- `normalizeId`：ID 转小写（兼容 Preview URL）

**示例**：
```typescript
const sandbox = getSandbox(env.Sandbox, 'user-123', {
  keepAlive: true,      // 长任务保持存活
  sleepAfter: '30s'     // 或 30 秒无活动后休眠
});

try {
  await sandbox.startProcess('npm run build');
} finally {
  await sandbox.destroy(); // keepAlive 必须手动销毁
}
```

**参考**：[Lifecycle API](https://developers.cloudflare.com/sandbox/api/lifecycle/)

---

### 9. Terminal 访问

**通过 WebSocket 的浏览器终端**

**特性**：
- 从浏览器直接访问 Shell
- xterm.js 集成（`SandboxAddon`）
- 自动重连和尺寸调整
- 可配置终端尺寸（cols/rows）

**示例**：
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (url.pathname === '/ws/terminal') {
      const sandbox = getSandbox(env.Sandbox, 'user-123');
      return sandbox.terminal(request, { cols: 80, rows: 24 });
    }
  }
};
```

**参考**：[Terminal API](https://developers.cloudflare.com/sandbox/api/terminal/)

---

### 10. WebSocket 连接

**连接到 Sandbox 内的 WebSocket 服务**

**两种模式**：
1. **直接连接**：`wsConnect()` - Worker 连接到 Sandbox 服务
2. **公开暴露**：`exposePort()` + `proxyToSandbox()` - 外部客户端连接

**示例**：
```typescript
// Worker 直接连接
if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
  const sandbox = getSandbox(env.Sandbox, 'user-123');
  return await sandbox.wsConnect(request, 8080);
}
```

**参考**：[WebSocket 连接指南](https://developers.cloudflare.com/sandbox/guides/websocket-connections/)

---

## 平台限制

### Container 资源限制（Workers Paid）

| 资源 | 账户级别限制 |
|------|-------------|
| 总内存 | 6 TiB |
| 总 vCPU | 1,500 |
| 总磁盘 | 30 TB |
| 镜像存储 | 50 GB |

**实例类型**：

| 类型 | vCPU | 内存 | 磁盘 |
|------|------|------|------|
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

**参考**：[Container 限制](https://developers.cloudflare.com/containers/platform-details/limits/)

---

### Workers Subrequest 限制

**HTTP Transport（默认）**：
- 每个 SDK 操作 = 1 个 subrequest
- Workers Free：50 subrequests/请求
- Workers Paid：1,000 subrequests/请求

**WebSocket Transport（高频操作推荐）**：
- WebSocket 升级 = 1 个 subrequest
- 后续所有操作 = 0 subrequest（多路复用）

**启用 WebSocket Transport**：
```toml
[vars]
SANDBOX_TRANSPORT = "websocket"
```

**参考**：[Sandbox 限制](https://developers.cloudflare.com/sandbox/platform/limits/)

---

## 定价模型

### Container 计费（按 10ms 活跃时间）

**Workers Paid 计划（$5/月）包含**：
- 25 GiB-hours 内存
- 375 vCPU-minutes
- 200 GB-hours 磁盘

**超额费率**：
- 内存：$0.0000025 / GiB-秒
- vCPU：$0.000020 / vCPU-秒（仅活跃使用时间）
- 磁盘：$0.00000007 / GB-秒

**网络出口**：
- 北美 & 欧洲：$0.025/GB（包含 1 TB）
- 大洋洲/韩国/台湾：$0.05/GB（包含 500 GB）
- 其他地区：$0.04/GB（包含 500 GB）

**额外成本**：
- Workers 请求费用
- Durable Objects（每个 Sandbox 实例）
- Workers Logs（如果启用）

**参考**：[Container 定价](https://developers.cloudflare.com/containers/pricing/)

---

## 安全模型

### VM 级别隔离

**每个 Sandbox 运行在独立 VM**：
- ✅ 文件系统隔离（无法访问其他 Sandbox）
- ✅ 进程隔离（无法看到其他进程）
- ✅ 网络隔离（独立网络栈）
- ✅ 资源配额（CPU/内存/磁盘强制限制）

### Sandbox 内部

**所有代码共享资源**：
- ❌ 相同文件系统（所有进程看到相同文件）
- ❌ 相同进程列表（所有 Session 看到所有进程）
- ❌ 相同网络（允许 localhost 通信）

**最佳实践**：每个用户一个 Sandbox
```typescript
// ✅ 好 - 每个用户隔离
const sandbox = getSandbox(env.Sandbox, `user-${userId}`);

// ❌ 坏 - 用户可以访问彼此的文件
const shared = getSandbox(env.Sandbox, 'shared');
```

**参考**：[安全模型](https://developers.cloudflare.com/sandbox/concepts/security/)

---

## 使用场景

### 1. AI 代码执行
- 安全执行 LLM 生成的代码
- 原生集成 Workers AI（GPT-OSS）
- 函数调用 + Sandbox 执行
- 适合 AI Agent 和自主系统

### 2. 数据分析 & Notebook
- 交互式数据分析（pandas、NumPy、matplotlib）
- 生成图表、表格、可视化
- 自动富文本输出格式化
- 跨执行的持久化状态

### 3. 交互式开发环境
- 云端 IDE 和代码游乐场
- 协作开发工具
- 完整 Linux 环境 + Preview URL
- 浏览器终端访问

### 4. CI/CD & 构建系统
- 在隔离环境中运行测试和编译
- 并行执行 + 流式日志
- 自动化测试流水线
- 构建产物生成

**参考**：[Sandbox SDK 概览](https://developers.cloudflare.com/sandbox/)

---

## 功能总览

| 功能 | API | 使用场景 |
|------|-----|---------|
| **命令执行** | `exec()`, `execStream()`, `startProcess()` | 运行脚本、构建系统、长期服务 |
| **代码解释器** | `createCodeContext()`, `runCode()` | AI 生成代码、数据分析、Notebook |
| **文件操作** | `readFile()`, `writeFile()`, `mkdir()` | 项目管理、产物存储 |
| **文件监听** | `watch()` | 热重载、构建自动化、配置监控 |
| **Session** | `createSession()`, `getSession()` | 隔离环境、并行工作流 |
| **Preview URLs** | `exposePort()`, `wsConnect()` | Web 服务、API、WebSocket 服务器 |
| **存储** | 挂载 R2/S3/GCS | 重启后的持久化数据 |
| **备份** | `createBackup()`, `restoreBackup()` | 快照、灾难恢复 |
| **Terminal** | `terminal()` | 浏览器 Shell 访问 |
| **生命周期** | `getSandbox()`, `setKeepAlive()`, `destroy()` | 资源管理、成本优化 |

---

## 最佳实践

### 资源管理
- ✅ 完成后调用 `destroy()`（特别是 `keepAlive: true` 时）
- ✅ 使用 `sleepAfter` 自动清理（默认：10 分钟）
- ✅ 根据工作负载选择合适的实例类型
- ✅ 清理未使用的 Session 和 Context

### 性能优化
- ✅ 高频操作启用 WebSocket transport
- ✅ 长期服务使用 `startProcess()`
- ✅ 批量操作减少 subrequest
- ✅ 跨请求复用 Sandbox（相同 ID = 相同实例）

### 安全
- ✅ 每个用户一个 Sandbox 实现隔离
- ✅ 执行前验证所有用户输入
- ✅ 使用环境变量传递密钥（不硬编码）
- ✅ 实现应用层认证

**参考**：[生产部署](https://developers.cloudflare.com/sandbox/guides/production-deployment/)

---

## 对比：Sandbox vs 传统方案

| 维度 | Cloudflare Sandbox | AWS Lambda + Docker | 传统 VM |
|------|-------------------|---------------------|---------|
| **冷启动** | ~2-5 秒 | ~10-30 秒 | 分钟级 |
| **隔离级别** | VM 级别 | 容器级别 | VM 级别 |
| **状态持久化** | Durable Objects | 需要外部数据库 | 内置 |
| **地理分布** | 自动（边缘） | 手动（区域） | 手动 |
| **计费** | 按 10ms 活跃时间 | 按 100ms 调用 | 按小时 |
| **基础设施** | 零管理 | 中等 | 高 |
| **WebSocket 支持** | 原生 | 复杂配置 | 原生 |

---

## 实战案例：CF-Agent

**架构**：
```
用户 → Worker + Durable Object (WebSocket)
         │
    Workflow (编排)
    ┌────┴────┐
AI Gateway    Sandbox (10 实例)
(LLM)         ├─ search.py (Serper API)
              ├─ fetch_url.py (httpx + Jina)
              ├─ browse.py (Playwright + 截图)
              └─ extract.py (CSS 选择器)
                     │
                     ▼
                  R2 (截图存储)
```

**配置**：
```toml
[[containers]]
class_name = "Sandbox"
instance_type = "standard-1"  # 0.5 vCPU, 4 GiB, 8 GB
max_instances = 10
```

**单任务成本（10 分钟）**：~$0.01（Container + Workflow + DO + R2）

**在线演示**：https://agents.cloudc.top

---

## 快速开始

**1. 安装 SDK**：
```bash
npm install @cloudflare/sandbox
```

**2. 配置 wrangler.toml**：
```toml
[[containers]]
class_name = "Sandbox"
instance_type = "standard-1"
max_instances = 10
```

**3. 基础用法**：
```typescript
import { getSandbox } from '@cloudflare/sandbox';
export { Sandbox } from '@cloudflare/sandbox';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, 'user-123');
    const result = await sandbox.exec('python --version');
    return Response.json({ output: result.stdout });
  }
};
```

**参考**：[快速开始](https://developers.cloudflare.com/sandbox/get-started/)

---

## 关键技术亮点

### 1. 懒加载启动
- `getSandbox()` 立即返回（不启动容器）
- 首次操作时才启动容器
- 减少不必要的资源消耗

### 2. 自动心跳机制
- `keepAlive: true` 时每 30 秒自动 ping
- 防止容器被驱逐
- 透明运行，不影响应用代码

### 3. 进程树管理
- `killProcess()` 终止整个进程树
- 防止孤儿进程
- 确保资源完全释放

### 4. 双 Transport 模式
- HTTP：简单可靠（默认）
- WebSocket：高频操作避免 subrequest 限制

---

## 资源链接

### 文档
- **概览**：https://developers.cloudflare.com/sandbox/
- **API 参考**：https://developers.cloudflare.com/sandbox/api/
- **教程**：https://developers.cloudflare.com/sandbox/tutorials/
- **概念**：https://developers.cloudflare.com/sandbox/concepts/

### 平台
- **定价**：https://developers.cloudflare.com/containers/pricing/
- **限制**：https://developers.cloudflare.com/containers/platform-details/limits/
- **Beta 信息**：https://developers.cloudflare.com/sandbox/platform/beta-info/

### 社区
- **GitHub**：https://github.com/cloudflare/sandbox-sdk
- **Discord**：https://discord.cloudflare.com

---

## 总结

**Cloudflare Sandbox SDK 实现**：
- ✅ 边缘计算上的安全代码执行
- ✅ 完整 Linux 环境，零基础设施
- ✅ 丰富的 API（命令、文件、进程、服务）
- ✅ 通过 Durable Objects 实现地理分布
- ✅ 成本优化计费（按 10ms 活跃时间）
- ✅ VM 级别隔离，生产就绪

**适用场景**：AI Agent、代码执行平台、数据分析工具、CI/CD 系统、交互式开发环境

**状态**：开放 Beta（需要 Workers Paid 计划）
