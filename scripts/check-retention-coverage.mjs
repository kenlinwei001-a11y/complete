#!/usr/bin/env node
/**
 * 门 `retention-coverage:check`（WO-RETENTION ⑤·数据留存/TTL·守 R-RETENTION 不变量不回潮）。
 *
 * 守"每个无界增长表都在留存策略注册表里有项 + 由 RETENTION_SWEEP 真清理"——否则长跑爆库 / 漏配某表
 * 永久增长（正是 outbox_events/ts_points/scheduler_runs 此前无上限的根因）。
 *
 * 纯静态：① 契约 RETENTION_DEFAULTS / RETENTION_TABLES 单一来源覆盖所有受治理增长表；
 *         ② 已知无界增长表清单（GROWTH_TABLES）⊆ 注册表（新增增长表漏登即红）；
 *         ③ retention.ts sweepTable 对每张注册表都有删除分支（注册了却不清理 = 假覆盖）；
 *         ④ app.ts 已 `.on("RETENTION_SWEEP", …)` 接线 + boot 注册每日 cron（调度真跑）。
 * 依赖 datacore 已构建（gates 链 `pnpm -r build` 在前）。
 */
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

let red = false;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  red = true;
};

// 0) 已知无界增长表清单（DataCore 侧·按时间无限追加写入·须有留存上限）。
//    新增此类表 → 必须同时登记进 RETENTION_DEFAULTS + sweepTable 分支，否则本门红。
const GROWTH_TABLES = ["outbox_events", "ts_points", "scheduler_runs"];

// 1) 契约单一来源：RETENTION_DEFAULTS / RETENTION_TABLES。
const contracts = await import("../packages/contracts/dist/index.js").catch((e) => {
  console.error(`✗ retention-coverage:check 导入 contracts dist 失败（先 pnpm --filter @platform/contracts build）：${e.message}`);
  process.exit(1);
});
const defaults = contracts.RETENTION_DEFAULTS;
if (!defaults || typeof defaults !== "object") {
  fail("contracts 未导出 RETENTION_DEFAULTS（留存默认上限注册表缺失）");
}

// 2) retention.ts 模块：RETENTION_TABLES + sweepTable 分支覆盖。
const retention = await import("../apps/datacore/dist/retention.js").catch((e) => {
  console.error(`✗ retention-coverage:check 导入 datacore dist 失败（先 pnpm --filter datacore build）：${e.message}`);
  process.exit(1);
});
const tables = retention.RETENTION_TABLES;
if (!Array.isArray(tables)) fail("retention.ts 未导出 RETENTION_TABLES（受治理表注册表缺失）");

// 3) 每张已知增长表 ∈ 注册表 + 有默认 keepDays。
for (const t of GROWTH_TABLES) {
  if (Array.isArray(tables) && !tables.includes(t)) {
    fail(`无界增长表 ${t} 未登记进 RETENTION_TABLES（漏配 → 永久增长爆库）`);
  }
  if (defaults && typeof defaults[t] !== "number") {
    fail(`无界增长表 ${t} 在 RETENTION_DEFAULTS 无默认 keepDays（须有平台默认上限）`);
  }
}

// 4) sweepTable 对每张注册表都有删除分支（注册了却无清理逻辑 = 假覆盖）。
const retSrc = read("apps/datacore/src/retention.ts");
for (const t of Array.isArray(tables) ? tables : []) {
  if (!new RegExp(`case\\s+"${t}"`).test(retSrc)) {
    fail(`retention.ts sweepTable 缺 case "${t}" 删除分支（注册表有项但不清理 → 假覆盖）`);
  }
}

// 5) app.ts 调度接线：handler + boot cron。
const appSrc = read("apps/datacore/src/app.ts");
if (!/\.on\(\s*"RETENTION_SWEEP"/.test(appSrc)) {
  fail("app.ts 未注册 .on(\"RETENTION_SWEEP\", …) handler（清理作业无处理器）");
}
const seedSrc = read("apps/datacore/src/synthetic/service.ts");
if (!/register\([^)]*"RETENTION_SWEEP"/.test(seedSrc)) {
  fail("boot 未注册 RETENTION_SWEEP 每日 cron（scheduler.register …）→ 定时清理不会自动跑");
}

if (red) {
  console.error("\nretention-coverage:check 红 —— 见上。根因解：每张无界增长表都须在留存注册表有项 + sweepTable 有清理分支 + RETENTION_SWEEP 调度接线。");
  process.exit(1);
}
console.log(
  `✓ retention-coverage:check 通过（${GROWTH_TABLES.length} 张增长表均有留存策略+清理分支·RETENTION_SWEEP 已接线+每日 cron）。`,
);
