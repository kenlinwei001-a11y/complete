#!/usr/bin/env node
/**
 * 门 `opt-template:check`（轨B 优化求解器融合 · 增量1/2）：
 * 守抽象优化模板池的 **R14 零业务常数 + requiredRoles + 派生留痕（FUS4/FUS3 配套）**。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §7（门）/§8（G-12）。新门，本脚本本地跑通后交主线并入 `pnpm gates`。
 *
 * 静态断言（保守哨兵，非全量审计）：
 *  1) 零业务常数（R14）：优化引擎/绑定层作用域文件（services/optimizer/server.py 的 5 核心 model +
 *     apps/datacore/src/solvers/opt-binding.ts + optimizer-client.ts 的 5 核心接口）不得出现**行业实体名**
 *     （电池/基地/产线/工厂/诊所/社区/仓库/门店…）的硬编码字符串字面量——行业是 OntologyBinding 绑进来的内容。
 *  2) requiredRoles 齐备：契约 opt-template.ts 的 family 枚举里，增量1 落地的 5 核心
 *     （facility_location/min_cost_flow/set_cover/independent_set/combinatorial_auction）必须在
 *     opt-binding.ts 的 bindToSolverArgs 里有对应 case（= 每族要求的 role 映射存在）。
 *  3) 派生留痕：THIRD-PARTY-NOTICES.md 含 LIC4（CDLA 取派生 Results）。
 *
 * 用法：node scripts/check-opt-template.mjs
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
  console.error(`⛔ check-opt-template.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const fail = [];

// ── 1) 零业务常数（R14）：优化作用域文件无行业实体名字面量 ──────────────────────
// 行业实体名（中文后缀/词）——绝不应硬编码进抽象引擎/绑定层（应由本体绑定进来）。
const INDUSTRY_ENTITY = /["'`][^"'`]*?(电池|基地|产线|工厂|诊所|社区|仓库|门店|疫苗|冷链|充电站|油田|矿山)[^"'`]*?["'`]/;
const SCOPE_FILES = [
  "apps/datacore/src/solvers/opt-binding.ts",
  "apps/datacore/src/solvers/optimizer-client.ts",
];
for (const rel of SCOPE_FILES) {
  const src = read(rel);
  if (src == null) { fail.push(`缺优化作用域文件 ${rel}`); continue; }
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // 去注释（散文/示例不算）
  const m = code.match(INDUSTRY_ENTITY);
  if (m) fail.push(`${rel} 出现行业实体名字面量 ${m[0]}（R14 零业务常数：行业靠 OntologyBinding 绑进来，不进引擎/绑定层代码）`);
}
// sidecar server.py 的 5 核心 model 同样零业务常数（只扫新增 5 核心 model 段，避免误伤既有注释）。
{
  const py = read("services/optimizer/server.py");
  if (py == null) fail.push("缺 services/optimizer/server.py");
  else {
    const code = py.replace(/#.*$/gm, "").replace(/"""[\s\S]*?"""/g, ""); // 去 # 注释与 docstring
    const m = code.match(INDUSTRY_ENTITY);
    if (m) fail.push(`services/optimizer/server.py 出现行业实体名字面量 ${m[0]}（R14）`);
  }
}

// ── 2) requiredRoles 齐备：5 核心在契约枚举 + 绑定层均落地 ─────────────────────
const CORES = ["facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction"];
const contract = read("packages/contracts/src/opt-template.ts");
const binding = read("apps/datacore/src/solvers/opt-binding.ts");
for (const fam of CORES) {
  if (contract && !contract.includes(`"${fam}"`)) fail.push(`契约 opt-template.ts family 枚举缺 ${fam}`);
  if (binding && !new RegExp(`case\\s+"${fam}"`).test(binding)) fail.push(`opt-binding.ts bindToSolverArgs 缺 case "${fam}"（requiredRoles 映射）`);
}

// ── 3) 派生留痕（LIC4） ──────────────────────────────────────────────────────
const notices = read("THIRD-PARTY-NOTICES.md");
if (!notices) fail.push("缺 THIRD-PARTY-NOTICES.md");
else if (!notices.includes("LIC4")) fail.push("THIRD-PARTY-NOTICES.md 缺 LIC4（CDLA 取派生 Results）");

console.log(`· opt-template：5 核心 ${CORES.length} · 作用域文件 ${SCOPE_FILES.length}+sidecar · 违规 ${fail.length}`);
if (fail.length) {
  console.error("\n✗ opt-template:check 未过（R14 零业务常数 / requiredRoles / 派生留痕）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ opt-template:check 通过（抽象引擎/绑定层零行业实体名 · 5 核心 requiredRoles 齐 · LIC4 派生留痕在）。");
