// 配置说明：
// 开发环境：使用 wrangler dev 启动的本地地址
// 生产环境：替换为你的 Worker 域名
export const API_BASE = import.meta.env.VITE_API_BASE || "https://your-worker.workers.dev";
export const WS_BASE = import.meta.env.VITE_WS_BASE || "wss://your-worker.workers.dev";
