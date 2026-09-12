#!/usr/bin/env node
/**
 * 门 `opt-determinism:check`（轨B 优化求解器融合 · R6 确定性地板 + FUS2）：
 * 守 CP-SAT「seed + 单线程 + 稳定输入序 → 字节一致」+「embedding advisory 不入确定性求解路径」。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §7（门）/§8（G-12）。新门，本地跑通后交主线并入 `pnpm gates`。
 *
 * 静态断言（保守哨兵）：
 *  1) sidecar 确定性：services/optimizer/server.py 每个 CpSolver() 块须同时设
 *     `num_search_workers = 1` 与 `random_seed`（单线程 + 固定 seed → R6）。
 *  2) 无非确定来源：5 核心 solve_* 函数体内不得出现 Math.random / random.random / time.time / datetime.now。
 *  3) 稳定输入序：绑定层 opt-binding.ts 组请求时对对象数组 .sort(（确定性排序，消多解/顺序抖动）。
 *  4) FUS2 embedding 不入求解路径：5 核心求解方法（service.ts 的 facilityLocation/minCostFlow/setCover/
 *     independentSet/combinatorialAuction 与 opt-binding.ts）不得 import/引用 embedding 检索层
 *     （opt-embedding / nearestTemplates / OptEmbeddingIndex）——embedding 只在 advisory 检索端点用。
 *
 * 用法：node scripts/check-opt-determinism.mjs
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
  console.error(`⛔ check-opt-determinism.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const fail = [];

// ── 1) + 2) sidecar 确定性 ───────────────────────────────────────────────────
const py = read("services/optimizer/server.py");
if (py == null) fail.push("缺 services/optimizer/server.py");
else {
  // 每个 CpSolver() 之后的参数块须含 num_search_workers=1 + random_seed。
  const solverBlocks = py.split("cp_model.CpSolver()").slice(1);
  let idx = 0;
  for (const block of solverBlocks) {
    idx++;
    const head = block.slice(0, 400); // 紧随 CpSolver() 的参数设置区
    if (!/num_search_workers\s*=\s*1/.test(head)) fail.push(`server.py 第 ${idx} 个 CpSolver 缺 num_search_workers=1（单线程 R6）`);
    if (!/random_seed\s*=/.test(head)) fail.push(`server.py 第 ${idx} 个 CpSolver 缺 random_seed（固定 seed R6）`);
  }
  const code = py.replace(/#.*$/gm, "").replace(/"""[\s\S]*?"""/g, "");
  if (/\brandom\.random\(|\btime\.time\(|datetime\.now\(/.test(code)) fail.push("server.py 出现非确定来源（random/time/datetime）—— 破坏 R6");
}

// ── 3) 绑定层稳定输入序 ──────────────────────────────────────────────────────
const binding = read("apps/datacore/src/solvers/opt-binding.ts");
if (binding == null) fail.push("缺 apps/datacore/src/solvers/opt-binding.ts");
else if (!/\.sort\(/.test(binding)) fail.push("opt-binding.ts 未见 .sort( —— 输入序非稳定，威胁 R6");

// ── 4) FUS2 embedding 不入确定性求解路径 ─────────────────────────────────────
const EMB = /(opt-embedding|nearestTemplates|OptEmbeddingIndex|coverageGap)/;
const PATH_FILES = ["apps/datacore/src/solvers/opt-binding.ts"];
const service = read("apps/datacore/src/solvers/service.ts");
if (service) {
  // 截出 5 核心求解方法 + solveWithBinding 段（粗粒度：从 solveWithBinding 到 getParams 之间）。
  const start = service.indexOf("solveWithBinding");
  const end = service.indexOf("async getParams");
  const seg = start >= 0 && end > start ? service.slice(start, end) : "";
  if (EMB.test(seg)) fail.push("service.ts 优化求解段引用了 embedding 检索层（FUS2：embedding advisory 不入确定性求解路径）");
}
for (const rel of PATH_FILES) {
  const src = read(rel);
  if (src && EMB.test(src)) fail.push(`${rel} 引用 embedding 检索层（FUS2 不入求解路径）`);
}

console.log(`· opt-determinism：sidecar seed/单线程 · 绑定层稳定序 · FUS2 embedding 隔离 · 违规 ${fail.length}`);
if (fail.length) {
  console.error("\n✗ opt-determinism:check 未过（R6 确定性 / FUS2 embedding 隔离）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("✓ opt-determinism:check 通过（CP-SAT seed+单线程 · 稳定输入序 · embedding advisory 不入求解路径 FUS2）。");
