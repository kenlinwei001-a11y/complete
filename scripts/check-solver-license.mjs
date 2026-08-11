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
