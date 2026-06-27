#!/usr/bin/env node
/**
 * 门 `traceability:check`（轨N 增量3 · 守 R13 结论可溯源在交互层不回潮）：
 * 保守静态哨兵——扫前端 `*.tsx`，禁止"规则号裸渲染成 JSX 文本子节点"（未包 <RuleRef>）。
 *
 * 来由：轨N 增量0 实拍铁证 `OrderChainView.tsx:464-466` 把规则渲染成 `{...ruleRefs.join("/")}` 裸文本
 * （C02 悬浮无信息）。增量1 已全部换 <RuleRef>。本门防"再有人写裸规则号渲染"回潮。
 *
 * 判据（低误报）：匹配「JSX 子节点位置直接渲染含 ruleRef(s) 的表达式」——
 *   `>{ ...ruleRef... }<`（开始标签 `>` 与结束 `<` 之间的纯表达式子节点，且表达式含 ruleRef/ruleRefs）。
 * **不**误报正确写法：`<RuleRef code={x.ruleRefs.join("/")} />`（join 在 code= 属性内，非 `>{...}<` 子节点）、
 * `rule={def.provenance.ruleRefs}`（属性值）、`ruleRefs` 出现在注释/testid/普通逻辑。
 *
 * 与 genuine-sim:check 同范式（保守哨兵 + 防回潮）；扫不出即绿（增量1 后基线 0）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";

const ROOT = new URL("../apps/frontend-shell/src/", import.meta.url);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const u = new URL(name + (name.endsWith("/") ? "" : ""), dir);
    const full = new URL(name, dir);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(new URL(name + "/", dir)));
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// JSX 子节点位置渲染含 ruleRef 的表达式：`>{ ...ruleRef... }<`（容忍前后空白；表达式内无嵌套大括号）。
const BARE_RULE_CHILD = />\s*\{[^{}]*\bruleRefs?\b[^{}]*\}\s*</g;

const files = walk(ROOT);
const violations = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = f.pathname.split("/frontend-shell/")[1] ?? f.pathname;
  let m;
  while ((m = BARE_RULE_CHILD.exec(src)) !== null) {
    // 行号
    const line = src.slice(0, m.index).split("\n").length;
    violations.push(`${rel}:${line}  ${m[0].replace(/\s+/g, " ").trim()}`);
  }
}

console.log(`· traceability：扫描 ${files.length} 个 tsx · 裸规则号渲染 ${violations.length}`);
if (violations.length > 0) {
  console.error("✗ traceability:check：发现规则号裸渲染（未包 <RuleRef>，悬浮无溯源信息 · 违 R13）：");
  for (const v of violations) console.error("  " + v);
  console.error("  → 换成 <RuleRef code={...} />（组件现成，splits on /、,空格），就地悬浮出 定义/阈值/作用域/版本/谁定/有效边界。");
  process.exit(1);
}

// ── KPI 维（轨N 跟进2）：财务/规划决策视图必须具备 Provenance 溯源能力（import 在位）。
// 诚实边界：逐数字穷尽 wrap 不可静态可靠检测（任意数字非皆 KPI），故此处为「决策视图 Provenance 能力 presence」
// 哨兵——确保每个含财务/规划 KPI 的决策视图都接入 Provenance（高价值 KPI 已逐视图 wrap），防"新决策视图裸渲染 KPI"回潮。
// RiskBoardView 的风险峰值经 RiskPopover 悬浮 + bottleneck 详情溯源（另一机制），不在此列。
const KPI_DECISION_VIEWS = [
  "src/views/DashboardView.tsx",
  "src/views/LedgerView.tsx",
  "src/views/plan/OrderChainView.tsx",
  "src/views/plan/AnnualScenarioView.tsx",
  "src/views/plan/QuarterlyRollingView.tsx",
  "src/views/sim/PlanAuditView.tsx",
  "src/views/sim/PlanGenerateView.tsx",
  "src/views/sim/SopBalanceView.tsx",
  "src/views/sim/ProjectSimView.tsx",
];
const missingProv = [];
for (const rel of KPI_DECISION_VIEWS) {
  let src;
  try {
    src = readFileSync(new URL("../apps/frontend-shell/" + rel, import.meta.url), "utf8");
  } catch {
    missingProv.push(`${rel}（文件不存在）`);
    continue;
  }
  if (!/from\s+"@\/components\/Provenance"/.test(src)) missingProv.push(rel);
}
console.log(`· traceability(KPI)：${KPI_DECISION_VIEWS.length} 个财务/规划决策视图 · 缺 Provenance 能力 ${missingProv.length}`);
if (missingProv.length > 0) {
  console.error("✗ traceability:check：以下决策视图渲染 KPI 但未接入 Provenance 溯源能力（违 R13）：");
  for (const v of missingProv) console.error("  " + v);
  console.error("  → import { Provenance } 并把关键 KPI 数字包 <Provenance src/formula/inputs/rule>…</Provenance>。");
  process.exit(1);
}
console.log("✓ traceability:check：无规则号裸渲染（R13）+ 财务/规划决策视图均接入 Provenance 溯源能力。");
