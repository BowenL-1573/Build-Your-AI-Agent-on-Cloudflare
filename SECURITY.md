# CF-Agent 安全配置指南

## ⚠️ 部署前必读

本项目的 `wrangler.toml` 已移除所有敏感信息。在部署前，你需要：

## 1. 配置 wrangler.toml

编辑 `worker/wrangler.toml`，替换以下占位符：

```toml
# AI Gateway URL
AI_GATEWAY_BASE = "https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_NAME>/compat"

# D1 Database ID
database_id = "<YOUR_D1_DATABASE_ID>"

# R2 Bucket Name
bucket_name = "<YOUR_R2_BUCKET_NAME>"
```

### 获取这些值：

**Account ID**：
- 登录 Cloudflare Dashboard
- 右侧边栏可以看到 Account ID

**AI Gateway**：
```bash
# 创建 AI Gateway
npx wrangler ai-gateway create cf-agent-gateway
```

**D1 Database**：
```bash
# 创建数据库
npx wrangler d1 create agent-user-db
# 复制返回的 database_id
```

**R2 Bucket**：
```bash
# 创建 bucket
npx wrangler r2 bucket create cf-agent-screenshots
```

## 2. 设置 Secrets

通过命令行设置敏感信息（不要写在文件里）：

```bash
cd worker

# AI Gateway Token（从 Dashboard 获取）
npx wrangler secret put CF_AIG_TOKEN

# Serper API Key（搜索功能，https://serper.dev）
npx wrangler secret put SERPER_API_KEY

# Jina API Key（可选，网页抓取，https://jina.ai）
npx wrangler secret put JINA_API_KEY
```

## 3. 初始化数据库

```bash
cd worker

# 创建用户表
npx wrangler d1 execute agent-user-db --remote --command "
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)"

# 创建测试用户（密码：demo123）
npx wrangler d1 execute agent-user-db --remote --command "
INSERT INTO users (username, password, role) VALUES 
('demo', 'demo123', 'user'),
('admin', 'admin123', 'admin')
"
```

## 4. 部署

```bash
# 部署 Worker
cd worker
npx wrangler deploy

# 部署前端
cd ../agents-website/app
npm run build
npx wrangler pages deploy dist --project-name cf-agent-web
```

## 安全最佳实践

### ✅ 已实现
- Secrets 通过 `wrangler secret` 管理
- 敏感文件已加入 `.gitignore`
- 环境变量通过 `exec()` 的 `env` 参数传递

### ⚠️ 生产环境建议
- 密码使用 bcrypt hash 存储（当前是明文）
- 实现 JWT Token 过期机制
- 添加 Rate Limiting（防止滥用）
- 启用 Workers Logs（审计日志）

## 常见问题

**Q: 为什么 wrangler.toml 里有 Account ID？**
A: AI Gateway URL 必须包含 Account ID，但这不是敏感信息（公开也无法操作你的账户）。真正敏感的是 `CF_AIG_TOKEN`，已通过 secret 管理。

**Q: D1 Database ID 需要保密吗？**
A: 建议保密。虽然没有 API Token 无法操作，但暴露 ID 增加攻击面。

**Q: 如何轮换 Secrets？**
A: 重新运行 `npx wrangler secret put <KEY_NAME>` 即可覆盖。
