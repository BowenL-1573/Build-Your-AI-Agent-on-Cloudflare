# wrangler.toml 配置说明

## 必须配置的值

在部署前，请替换以下占位符：

### 1. AI Gateway
```toml
AI_GATEWAY_BASE = "https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_NAME>/compat"
```
- 替换 `<ACCOUNT_ID>` 为你的 Cloudflare Account ID
- 替换 `<GATEWAY_NAME>` 为你创建的 AI Gateway 名称

### 2. D1 Database
```toml
database_id = "<YOUR_D1_DATABASE_ID>"
```
- 创建 D1 数据库：`npx wrangler d1 create agent-user-db`
- 复制返回的 database_id

### 3. R2 Bucket
```toml
bucket_name = "<YOUR_R2_BUCKET_NAME>"
```
- 创建 R2 bucket：`npx wrangler r2 bucket create <bucket-name>`
- 填入 bucket 名称

### 4. Secrets（通过命令行设置，不要写在文件里）
```bash
npx wrangler secret put CF_AIG_TOKEN        # AI Gateway Token
npx wrangler secret put SERPER_API_KEY      # Serper API Key (搜索)
npx wrangler secret put JINA_API_KEY        # Jina API Key (可选，网页抓取)
```

## 安全提示

- ❌ 不要将 Account ID、Database ID、Bucket Name 提交到公开仓库
- ❌ 不要将 API Token、Secret Key 写在代码里
- ✅ 使用 `wrangler secret` 管理敏感信息
- ✅ 使用环境变量或 `.env` 文件（已在 .gitignore）
