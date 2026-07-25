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
  // dev proxy 目标可经 env 覆盖（默认标准端口 DataCore 4001 / AgentCore 4002·与 compose/DEPLOY.md 一致）——
  // 防"本地把 AgentCore 挪到非标准端口(如 4005 的 LaunchAgent workaround)→ 前端仍连 4002 → Failed-to-fetch"
  // 这类端口错配的整类故障：改跑别的端口时设 VITE_DEV_AGENTCORE=http://127.0.0.1:4005 即可，无需改码/打本地补丁。
  server: {
    port: 5173,
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

