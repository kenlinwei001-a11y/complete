import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // SA-3 Workshop 层后单次 seedBattery 数据量约 10×（130 产线/650 工序/58500 时序点）。
    // 满载并行时 CPU 争用使重种子用例（SY1/T8/empty-tenant 等）耗时飙升并触发超时；
    // 按 CLAUDE.md「datacore 勿并发多 vitest」纪律，单文件串行 + 放宽超时以吸收负载
    //（确定性逻辑本身在隔离下 ≤30s 通过），非掩盖挂死。
    fileParallelism: false,
    testTimeout: 300000,
    hookTimeout: 300000,
  },
});
