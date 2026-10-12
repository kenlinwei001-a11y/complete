// 「连真后端」验收专用 vitest 配置（**跑完即删，不进仓**）：
//  · VITE_MOCK=0 + VITE_DATACORE_URL 指向真 datacore（SEED_DEMO=1，端口 4801）
//  · setup 不装 MSW ⇒ 请求真的出网到本机后端；`mockDecisionPlay()` 一次都不会被调到
//  · include 只收 *.live.tsx（默认 include 只认 *.test.* / *.spec.*，故它不会混进 `pnpm test`）
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["live-acceptance/*.live.tsx"],
    setupFiles: ["./live-acceptance/live-setup.ts"],
    css: false,
    testTimeout: 180000,
    hookTimeout: 180000,
    env: {
      VITE_DATACORE_URL: "http://127.0.0.1:4801",
      VITE_AGENTCORE_URL: "http://127.0.0.1:4802",
      VITE_MOCK: "0",
    },
  },
});
