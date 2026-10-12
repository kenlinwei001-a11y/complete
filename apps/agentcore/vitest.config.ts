import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // WO-AGENTCORE-DIST-PREFLIGHT：dist 没构建时先说话（「先 pnpm --filter agentcore build」），
    // 而不是甩出一片像产品坏了的红。前置齐全时静默通过、测试面逐字节不变。见该文件头注。
    globalSetup: ["./test/dist-preflight.ts"],
  },
});
