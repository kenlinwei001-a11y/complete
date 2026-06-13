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
  server: {
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
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

