#!/usr/bin/env node
/**
 * 门 `no-silent-mock:check`（WO-DM keystone·hollow-data 地基防复发）。
 *
 * 根除「求解器静默返回哈希/魔数、UI 无从区分真假」整类：**每个 SOLVER_KEY 的输出形状必须含 `dataMode`
 * 诚实位**（LIVE/MOCK/PARTIAL）。配套运行期 invoke wrapper 保证每次输出真带 dataMode（hollow 自置
 * MOCK/PARTIAL·其余默认 LIVE），前端 DataModeBadge 据此标。
 *
 * 依赖 datacore 已构建（gates 链 `pnpm -r build` 在前）。导入编译产物的 SOLVER_KEYS + SOLVER_OUTPUT_SHAPES
 * 静态校验：每 key 有形状 + 形状含 dataMode。
 */
const mod = await import("../apps/datacore/dist/solvers/service.js").catch((e) => {
  console.error(`✗ no-silent-mock:check 导入 datacore dist 失败（先 pnpm --filter datacore build）：${e.message}`);
  process.exit(1);
});

const keys = mod.SOLVER_KEYS;
const shapes = mod.SOLVER_OUTPUT_SHAPES;
if (!Array.isArray(keys) || !shapes) {
  console.error("✗ no-silent-mock:check：SOLVER_KEYS / SOLVER_OUTPUT_SHAPES 未从 service.js 导出");
  process.exit(1);
}

let red = false;
for (const k of keys) {
  const shape = shapes[k];
  if (!shape) {
    console.error(`✗ ${k}：无 SOLVER_OUTPUT_SHAPES 形状声明（每 SOLVER_KEY 须声明输出形状）`);
    red = true;
    continue;
  }
  if (!shape.includes("dataMode")) {
    console.error(`✗ ${k}：输出形状缺 dataMode 诚实位 → 可静默哈希/魔数冒充真算（hollow-data 回潮）`);
    red = true;
  }
}

if (red) {
  console.error("\n✗ no-silent-mock:check 未过：上述求解器输出无 dataMode 诚实位。修法：SOLVER_OUTPUT_SHAPES 该项加 dataMode（或经 contracts schema 含 dataMode），求解器据数据来源置 LIVE/MOCK/PARTIAL。");
  process.exit(1);
}
console.log(`✓ no-silent-mock:check 通过（${keys.length} 个求解器输出形状均带 dataMode 诚实位）。`);
