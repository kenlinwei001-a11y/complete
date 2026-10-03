// WO-MEMORY-VIEW-RESILIENCE §4.6：双 baseURL 解析。
// - 显式配了 VITE_DATACORE_URL / VITE_AGENTCORE_URL → 直接用（部署/联调覆盖）。
// - 未配 + 本机开发（hostname=localhost/127.0.0.1/[::1]，如 Vite dev :5173）→ 默认直连内存模式本地双服务
//   （DataCore 4001 / AgentCore 4002·见 DEPLOY.md「端口」与 CLAUDE.md 内存模式命令），免去每次手设 env 才能连后端。
//   默认地址**跟随页面 hostname**（localhost 访问 → localhost:4001，127.0.0.1 访问 → 127.0.0.1:4001，
//   [::1] 归一到 127.0.0.1 因后端只听 IPv4）：页面与 API 永远同站，refresh cookie（SameSite=Lax）
//   不会被跨站 fetch 丢弃——硬编码 127.0.0.1 时，用 localhost:5173 访问会每 15 分钟
//   （access token 到期）静默刷新 401 → 被 authFailure 钩子踢回 /login。
// - 未配 + 非 localhost（部署态经 nginx 网关同源，/a/v1→datacore、/b|api/v1→agentcore）→ "" 相对路径（网关按前缀转发）。
const rawDatacore = import.meta.env.VITE_DATACORE_URL as string | undefined;
const rawAgentcore = import.meta.env.VITE_AGENTCORE_URL as string | undefined;
const pageHostname = typeof window !== "undefined" ? window.location.hostname : "";
const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(pageHostname);
const localApiHost = pageHostname === "[::1]" ? "127.0.0.1" : pageHostname;

export const env = {
  datacoreUrl: rawDatacore ?? (isLocalhost ? `http://${localApiHost}:4001` : ""),
  agentcoreUrl: rawAgentcore ?? (isLocalhost ? `http://${localApiHost}:4002` : ""),
  mock: import.meta.env.VITE_MOCK === "1",
};
