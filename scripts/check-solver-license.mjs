#!/usr/bin/env node
/**
 * 门 `solver-license:check`（优化求解器融合 · 许可证合规 + 不训练红线）：
 * 守 THIRD-PARTY-NOTICES.md §2 的四条红线（LIC1 不训练 / LIC2 Gurobi 不碰 / LIC3 MIT 署名 / LIC4 CDLA 取派生）。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §7（门）/§8（G-12）。
 *
 * 静态断言：
 *   1) THIRD-PARTY-NOTICES.md 存在且含四红线（LIC1–LIC4）+ MIT 版权声明段。
 *   2) Gurobi 指纹：代码库（apps/packages/services/scripts）不得出现 `gurobipy`/`GRB.`/`grb.Model`/`import gurobi`。
 *   3) 不训练：优化作用域文件不得出现把上游数据导入训练/微调管线的调用
 *      （`import torch`/`tensorflow`/`from sklearn`/`.fit(`/`fine_tune`/`finetune(`）。
 *   4) 派生留痕：代码里的 OptModelTemplate 字面量（含 `family:`+`objectiveSense:`）必须带 `provenance` 且含 `license`。
 *
 * 诚实边界：保守哨兵（指纹 + 作用域扫描），非全量许可证审计；新增上游借鉴需同步扩 NOTICES + 本门断言。
 * 用法：node scripts/check-solver-license.mjs   （package.json: "solver-license:check"）
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
  console.error(`⛔ check-solver-license.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);

const fail = [];

// ── 1) THIRD-PARTY-NOTICES.md 存在 + 四红线 + MIT 声明 ────────────────────────
const NOTICES = "THIRD-PARTY-NOTICES.md";
const notices = read(NOTICES);
if (!notices) {
  fail.push(`缺少 ${NOTICES}（许可证合规单一来源）`);
} else {
  for (const lic of ["LIC1", "LIC2", "LIC3", "LIC4"]) {
    if (!notices.includes(lic)) fail.push(`${NOTICES} 缺红线条目 ${lic}`);
  }
  if (!/MIT License/i.test(notices)) fail.push(`${NOTICES} 缺 MIT 版权声明段（LIC3 署名）`);
}

// ── 代码文件遍历（跳过 node_modules/dist/.git/coverage） ──────────────────────
const CODE_DIRS = ["apps", "packages", "services", "scripts"];
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", ".turbo", "build"]);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const codeFiles = [];
const walk = (relDir) => {
  let entries;
  try { entries = readdirSync(abs(relDir), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (CODE_EXT.test(e.name)) codeFiles.push(rel);
  }
};
for (const d of CODE_DIRS) if (existsSync(abs(d))) walk(d);

const SELF = "scripts/check-solver-license.mjs"; // 本门自身含指纹字符串，排除

// ── 2) Gurobi 指纹（LIC2） ───────────────────────────────────────────────────
const GUROBI = /\b(gurobipy|GRB\.[A-Z]|grb\.Model|import\s+gurobi|from\s+gurobi)\b/;
// ── 3) 不训练（LIC1）：优化作用域 = 路径含 opt/optimizer/solver ─────────────────
const OPT_SCOPE = /(^|\/)(opt|optimizer|solvers?)[-_/]/i;
const TRAIN = /\b(import\s+torch|tensorflow|from\s+sklearn|\.fit\(|fine_tune\b|finetune\()/;
// ── 4) OptModelTemplate 字面量派生留痕 ───────────────────────────────────────
const TEMPLATE_LIT = /family\s*:/;

for (const rel of codeFiles) {
  if (rel === SELF) continue;
  const src = read(rel);
  if (src == null) continue;
  // 去行/块注释，避免散文误命中
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  if (GUROBI.test(code)) fail.push(`Gurobi 指纹出现于 ${rel}（LIC2 不碰）`);

  if (OPT_SCOPE.test(rel) && TRAIN.test(code)) {
    fail.push(`优化作用域文件 ${rel} 出现训练/微调管线调用（LIC1 不训练）`);
  }

  // OptModelTemplate 对象字面量：有 family: 且 objectiveSense: 的块须带 provenance.license
  if (TEMPLATE_LIT.test(code) && /objectiveSense\s*:/.test(code)) {
    // 仅校验"实例字面量"（非 schema 定义本身：schema 文件用 z.object/z.enum 声明）
    const isSchemaDef = /z\.(object|enum)\s*\(/.test(code) && /OptModelTemplateSchema/.test(code);
    if (!isSchemaDef) {
      if (!/provenance\s*:/.test(code) || !/license\s*:/.test(code)) {
        fail.push(`${rel} 含 OptModelTemplate 字面量但缺 provenance.license（LIC4 派生留痕）`);
      }
    }
  }
}

console.log(`· solver-license：扫描 ${codeFiles.length} 代码文件 · NOTICES ${notices ? "在" : "缺"} · 违规 ${fail.length}`);

if (fail.length) {
  console.error("\n✗ solver-license:check 未过（许可证合规 / 不训练红线）：");
  for (const f of fail) console.error(`  - ${f}`);
  console.error("  → 见 THIRD-PARTY-NOTICES.md §2（LIC1–LIC4）与 docs/SYSTEM-ONTOLOGY.md §8（G-12）。");
  process.exit(1);
}
console.log("✓ solver-license:check 通过（NOTICES 四红线在 · 无 Gurobi 指纹 · 优化作用域无训练管线 · 模板派生留痕）。");
