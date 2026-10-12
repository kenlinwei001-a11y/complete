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
  console.error(`⛔ check-prd-coverage.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DOCS = "docs";
/**
 * 测试语料根 —— **现算**，不再手抄。
 *
 * ══ WO-GATE-ROSTER-SWEEP 修（2026-08-16）· 本体 §8 `G-GATE-ROSTER-HANDCOPIED` ══════
 * **病**：原文写死 `["apps/frontend-shell/test", "apps/datacore/test", "apps/agentcore/test"]`。
 * 实测差集 **1**：`packages/contracts/test` 存在且有测试文件，**从未进过 PRD 覆盖语料** ——
 * 于是「只在契约包测过」的验收项被一律判为**未覆盖**（本门的假红方向），
 * 而反过来，将来新建一个工作区包的测试也照样进不来（假绿方向）。
 * **形态**：「我用『那 3 个 test 目录里的语料』当作『全仓测试语料』的证据。」
 *
 * **修法**：从 `apps/*` 与 `packages/*` **枚举**存在的 `test/` 目录 —— 判据是
 * 「工作区成员下有没有 test 目录」，随包结构自动跟随，新增包不必有人想起来改这里。
 */
const TEST_ROOTS = ["apps", "packages"];
function liveTestDirs() {
  const out = [];
  for (const root of TEST_ROOTS) {
    if (!existsSync(root)) continue;
    for (const pkg of readdirSync(root)) {
      const d = join(root, pkg, "test");
      if (existsSync(d)) out.push(d);
    }
  }
  return out.sort();
}
const TEST_DIRS = liveTestDirs();
/** 语料根下界（金丝雀）：枚举器一坏集合就空 ⇒ 所有验收项报「未覆盖」，是**假红**的危险方向。 */
if (TEST_DIRS.length < 3) {
  console.error(`⛔ prd-coverage:check **工具坏了**：只枚举到 ${TEST_DIRS.length} 个 test 目录（下界 3）—— 枚举器坏了，不是测试没了。`);
  console.error("   本次结论作废：**不许**读作「验收项覆盖率低 / 有未覆盖项」——集合塌陷时每一项都会报未覆盖。");
  process.exit(2);
}
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
