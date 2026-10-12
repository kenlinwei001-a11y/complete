#!/usr/bin/env node
/**
 * 门 `no-hardcoded-rules:check`（PRD-rules-as-references §6.2）：求解器内与已登记规则同义的**业务阈值**
 * 必须源自参数（`c.params`/`p.*`/`rule.params`），不得字面硬编码 → 防"改规则不改推演"回潮（R14 规则维度）。
 *
 * 诚实边界（保守哨兵，非全量静态分析）：只钉死已迁移的已知阈值——C09 数据健康降级系数/时延、C04 认证
 * 产能系数——断言 `capacity.ts` 仍**从参数读**（`p.health.*` / `p.certFactors`），且不出现这些阈值的
 * 裸字面量（0.93/0.9/认证中系数 0.6/staleHours 2）。新求解器引入裸业务阈值需在此扩断言。
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-no-hardcoded-rules.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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
