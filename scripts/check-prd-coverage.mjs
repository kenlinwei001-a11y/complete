#!/usr/bin/env node
/**
 * prd:coverage — PRD《验收/DoD》↔ 测试覆盖启发式门（治理缺陷止血：补 prd:check 不验"DoD 是否实现"的盲区）。
 *
 * 做什么：解析每篇 PRD「验收/DoD」段里的验收项编号 → 在测试语料（文件名 + 内容）里查引用 →
 *         报"零测试引用"的验收项（= 已文档化但很可能未实现/未测）。写 docs/prd-coverage-index.json。
 *
 * 诚实边界（启发式）：测试引用 ≠ 完整实现（有测试不证明做对/做全）；但"**零测试引用**"是
 *         "已文档化但未测/很可能未实现"的**强信号**——这正是本门要暴露的盲区。保守方向：
 *         宁可漏报（ID 在别处偶现 → 误判为已覆盖）也不误报缺口。WARN-only（exit 0，先不硬挡）。
 *
 * 用法：node scripts/check-prd-coverage.mjs（package.json: "prd:coverage"）。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DOCS = "docs";
const TEST_DIRS = ["apps/frontend-shell/test", "apps/datacore/test", "apps/agentcore/test"];
const OUT = "docs/prd-coverage-index.json";

// 验收项编号族（清晰、低噪）。C 系列排除（与规则码 C01–C33 冲突）。
const ID_RE = /\b(F\d{1,2}|A\d|B\d|D\d|E\d|OC\d{1,2}|TR\d{1,2}|DL\d{1,2}|VL\d{1,2}|OM\d{1,2}|SK\d{1,2}|MC\d{1,2}|SC\d{1,2}|WF\d{1,2}|SY\d{1,2}|CN\d{1,2}b?|RD\d{1,2}|GE-[A-Z0-9-]+)\b/g;

// 1) 测试语料 -----------------------------------------------------------------
const testFiles = [];
for (const d of TEST_DIRS) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    if (/\.test\.(ts|tsx)$/.test(f)) testFiles.push({ name: f, text: readFileSync(join(d, f), "utf8") });
  }
}
const testCorpus = testFiles.map((t) => `${t.name}\n${t.text}`).join("\n");
// 前端 f<n>.* 文件名 → F<n> 视为覆盖（约定：F7↔f7.ontology-graph）
const frontendFNums = new Set();
for (const t of testFiles) {
  const m = t.name.match(/^f(\d+)\./);
  if (m) frontendFNums.add(`F${m[1]}`);
}

function idCovered(id) {
  if (/^F\d+$/.test(id) && frontendFNums.has(id)) return true;
  const re = new RegExp(`\\b${id.replace(/-/g, "\\-")}\\b`, "i"); // f/F 大小写不敏感
  return re.test(testCorpus);
}

// 2) 解析每篇 PRD 的验收段 -----------------------------------------------------
const prdFiles = readdirSync(DOCS).filter((f) => /^PRD-.*\.md$/.test(f)).sort();
const index = {};
let totalIds = 0;
let totalUncovered = 0;
const uncoveredByPrd = {};

for (const file of prdFiles) {
  const lines = readFileSync(join(DOCS, file), "utf8").split("\n");
  let inAcc = false;
  let accLevel = 0;
  const acc = [];
  for (const line of lines) {
    const h = line.match(/^(#+)\s+(.*)/);
    if (h) {
      const level = h[1].length;
      if (/验收|DoD|Acceptance/i.test(h[2])) {
        inAcc = true;
        accLevel = level;
        continue;
      }
      if (inAcc && level <= accLevel) inAcc = false;
    }
    if (inAcc) acc.push(line);
  }
  const ids = [...new Set([...acc.join("\n").matchAll(ID_RE)].map((m) => m[1]))].sort();
  if (ids.length === 0) continue;
  const covered = ids.filter(idCovered);
  const uncovered = ids.filter((id) => !idCovered(id));
  index[file] = { acceptanceIds: ids, covered, uncovered, coverage: Math.round((covered.length / ids.length) * 100) / 100 };
  if (uncovered.length) uncoveredByPrd[file] = uncovered;
  totalIds += ids.length;
  totalUncovered += uncovered.length;
}

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), heuristic: "测试引用≠完整实现；零引用=未测/很可能未实现的强信号", prds: index }, null, 2) + "\n");

// 3) 报告 ---------------------------------------------------------------------
console.log(`· PRD 验收项：${totalIds} 个（${Object.keys(index).length} 篇有验收段，${testFiles.length} 个测试文件）`);
console.log(`· 有测试引用：${totalIds - totalUncovered} · **零测试引用：${totalUncovered}**`);
console.log(`· 覆盖索引已写：${OUT}`);
console.log(`\n⚠ 启发式：测试引用≠完整实现；"零测试引用"是"已文档化但未测/很可能未实现"的强信号（保守：宁漏报不误报）。`);
if (totalUncovered) {
  console.log(`\n零测试引用的验收项（按 PRD —— 优先核实/补测/补建）：`);
  for (const [f, ids] of Object.entries(uncoveredByPrd)) console.log(`  - ${f}: ${ids.join(" · ")}`);
}
process.exit(0); // WARN-only：先暴露不硬挡（积累一轮后再考虑升 gate）
