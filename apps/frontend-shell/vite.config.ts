import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // 显式放行整个 monorepo 工作区根：@platform/contracts 在 apps/frontend-shell 之外，
  // dev server fs allow-list 必须含工作区根，否则解析被拦（v0.6 复制目录后崩 useContext 的成因之一）。
  // dev proxy 目标可经 env 覆盖（默认标准端口 DataCore 4001 / AgentCore 4002·与 compose/DEPLOY.md 一致）。
  //
  // ⚠️ **端口挪窝时要设的是 `VITE_*CORE_URL`，不是这里的 `VITE_DEV_*CORE`**（2026-08-10 实测订正）。
  // 本注释原先写着「改跑别的端口时设 VITE_DEV_AGENTCORE=http://127.0.0.1:4005 即可」——
  // **那句话是错的，照做不生效**，而它恰好写在最容易被信的地方（就在 proxy 配置旁边）。
  //
  // 真实链路：`src/env.ts:13` 在 hostname 命中 localhost/127.0.0.1/[::1] 时
  // 返回**绝对** URL `http://127.0.0.1:4002`，`src/api/apiClient.ts:35` 拿它当 base 拼绝对地址 ⇒
  // 浏览器**直接打 4002**，下面这三条 proxy 规则**一条都不会被触发**。
  // 所以只设 VITE_DEV_AGENTCORE 时，浏览器照旧连 4002 → Failed-to-fetch 一模一样地复现。
  //
  // 两个变量各管一段，名字像但作用不同，别混：
  //   · VITE_AGENTCORE_URL  → **浏览器**去连谁（走 env.ts，绕过 proxy）。**改端口要设的是它。**
  //   · VITE_DEV_AGENTCORE  → **这台 dev server** 代理转发给谁（仅当请求是相对路径时才起作用；
  //                            当前 localhost 默认分支下不会发生）。
  // 非 localhost 域名访问时 env.ts 才回落到相对路径，那时下面的 proxy 才真正接管。
  //
  // 例：AgentCore 用 LaunchAgent 跑在 4005 ⇒ `VITE_AGENTCORE_URL=http://127.0.0.1:4005 pnpm dev`
  //     （AgentCore 需允许 http://127.0.0.1:5173 跨源；DataCore 侧已实测放行同款 Origin）。
  server: {
    port: 5173,
    // 远程开发（Codespaces / devcontainer / gitpod）转发出来的域名要显式放行，
    // 否则 vite ≥5.4.12 的 Host 校验会把整个页面挡成
    // `Blocked request. This host ("xxx-5173.app.github.dev") is not allowed.`
    //
    // ⚠️ 三条实测订正（2026-09-11 亲手跑的，都与「网上通用做法」相反）：
    //   ① `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.app.github.dev` **不生效**（仍被拦）；
    //   ② `vite --allowedHosts` **这个 CLI 选项不存在** —— v5.4.21 直接 `CACError: Unknown option`；
    //   ③ `pnpm --filter <pkg> dev -- --host` 会**把参数吞掉**（日志仍打
    //      「Network: use --host to expose」）⇒ 想传 flag 得进包目录跑 `npx vite --host ...`。
    //      ⚠ 这一条最阴：它让前两条的测试**看起来**都是「被拦」，而其实那两次 vite 压根没收到参数。
    //
    // ⛔ 不写 `allowedHosts: true` —— 那是把这道 Host 校验整个关掉（它挡的是 DNS rebinding）。
    //    这里只放行远程开发平台的域名后缀；别的域名照旧拦（有金丝雀守着：evil.example.com 必须仍被拦）。
    allowedHosts: [".app.github.dev", ".githubpreview.dev", ".gitpod.io", ".github.dev"],
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    proxy: {
      "/a/v1": { target: process.env.VITE_DEV_DATACORE ?? "http://127.0.0.1:4001", changeOrigin: true },
      "/b/v1": { target: process.env.VITE_DEV_AGENTCORE ?? "http://127.0.0.1:4002", changeOrigin: true },
      "/api/v1": { target: process.env.VITE_DEV_AGENTCORE ?? "http://127.0.0.1:4002", changeOrigin: true },
    },
  },
  // @platform/contracts 是工作区 TS 源包，排除预打包 —— 从根上消除 .vite 缓存里
  // 存绝对路径、目录复制/迁移后陈旧导致加载失败的整类故障。
  optimizeDeps: {
    exclude: ["@platform/contracts"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
  },
});

