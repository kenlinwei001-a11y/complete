#!/usr/bin/env node
/**
 * 门 `no-hardcoded-rules:check`（PRD-rules-as-references §6.2）：求解器内与已登记规则同义的**业务阈值**
 * 必须源自参数（`c.params`/`p.*`/`rule.params`），不得字面硬编码 → 防"改规则不改推演"回潮（R14 规则维度）。
 *
 * 诚实边界（保守哨兵，非全量静态分析）：只钉死已迁移的已知阈值——C09 数据健康降级系数/时延、C04 认证
 * 产能系数——断言 `capacity.ts` 仍**从参数读**（`p.health.*` / `p.certFactors`），且不出现这些阈值的
 * 裸字面量（0.93/0.9/认证中系数 0.6/staleHours 2）。新求解器引入裸业务阈值需在此扩断言。
 */
import { readFileSync } from "node:fs";

const read = (rel) => {
  try { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"); }
  catch { console.error(`✗ no-hardcoded-rules:check 读不到 ${rel}`); process.exit(1); }
};

let red = false;
const cap = read("apps/datacore/src/solvers/capacity.ts");

// C09：数据健康降级——必须读 p.health.*（staleHours/normal/degraded），不得裸写阈值/系数。
if (!/p\.health\.staleHours/.test(cap) || !/p\.health\.(degraded|normal)/.test(cap)) {
  console.error("✗ capacity.ts 未从 p.health.* 读 C09 数据健康阈值（疑似硬编码回潮）");
  red = true;
}
// C04：认证产能系数——必须读 p.certFactors，不得裸写 认证中:0.6。
if (!/p\.certFactors/.test(cap)) {
  console.error("✗ capacity.ts 未从 p.certFactors 读 C04 认证系数（疑似硬编码回潮）");
  red = true;
}
// 裸字面量哨兵：C09 健康系数 0.93/0.9 不应作为裸数值出现在 capacity 计算里（应只在 battery solverParams 单一来源）。
const bareHealth = /[^.\w](0\.93|0\.90)\b/.test(cap.replace(/\/\/.*$/gm, "")); // 去行注释后扫
if (bareHealth) {
  console.error("✗ capacity.ts 出现 C09 健康系数裸字面量（0.93/0.90）——应只在 solverParams/rule.params 单一来源");
  red = true;
}

if (red) {
  console.error("\n✗ no-hardcoded-rules:check 未过：求解器业务阈值疑似硬编码（改规则不改推演风险）。");
  process.exit(1);
}
console.log("· no-hardcoded-rules：C09 健康阈值/系数 + C04 认证系数均从参数读，无裸字面量回潮。");
console.log("✓ no-hardcoded-rules:check 通过（保守哨兵：钉死已迁移阈值；新阈值引入需扩断言）。");
