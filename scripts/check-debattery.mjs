#!/usr/bin/env node
/**
 * 去电池锁死门禁（PRD-de-battery-multitenant-config §3.6 / 不变量 R14「应用层无业务常数」）。
 *
 * 静态扫描前端视图/页里**内联的业务常数**（基地名/型号/工序/产品段等电池/制造专属串），
 * 这些本应来自 ViewConfig.layout / WorkspaceConfig / 对象库 / i18n，写死即撑不起其他租户/行业。
 *
 * 机制：棘轮（ratchet）——以 `scripts/debattery-baseline.json` 记录"当前已知存量"，
 *   - 某文件命中数 > 基线 → 红（新写死/回潮，CI 失败）；
 *   - 某文件命中数 < 基线 → 绿，并提示可 `--update` 收紧基线（迁移成果落账）。
 * 这样既能**自动盘出剩余写死项**（报告），又能**防回潮**（门禁），不必一次清零。
 *
 * 豁免：行内带 `// debattery-allow` 注释的行不计（用于确有必要的兜底常量）。
 * 用法：node scripts/check-debattery.mjs [--update]   （package.json: "debattery:check"）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/frontend-shell/src/views", "apps/frontend-shell/src/pages/admin"];
const BASELINE = "scripts/debattery-baseline.json";

// 电池/制造行业专属业务常数（出现在视图代码的字符串里即视为写死）。i18n(zh.ts) 与注释不在扫描面。
const TOKENS = [
  // 基地名
  "常州", "合肥", "西安", "宜宾", "溧阳", "青海", "青岛", "南京", "成都", "福州", "长沙", "惠州", "盐城", "枣庄", "江门", "眉山",
  // 工序
  "化成", "涂布", "卷绕", "分切", "老化", "注液", "搅拌", "辊压", "分容",
  // 型号/产品
  "4680", "刀片", "VDA-NCM", "L300", "L148", "P28-NCM", "S192", "M3P",
  // 产品段
  "乘用车", "商用车",
];
const TOKEN_RE = new RegExp(TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const isComment = (line) => {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("*/");
};

/** 命中数 = 含业务 token 的非注释、非 debattery-allow 行数。 */
function scan(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (isComment(line) || line.includes("debattery-allow")) return;
    if (TOKEN_RE.test(line)) hits.push({ n: i + 1, text: line.trim().slice(0, 90) });
  });
  return hits;
}

const files = ROOTS.flatMap(walk).sort();
const counts = {};
const detail = {};
for (const f of files) {
  const hits = scan(f);
  if (hits.length > 0) {
    counts[f] = hits.length;
    detail[f] = hits;
  }
}

const update = process.argv.includes("--update");
if (update) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`✓ debattery 基线已更新：${Object.keys(counts).length} 文件 / ${Object.values(counts).reduce((a, b) => a + b, 0)} 命中。`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const regressions = [];
for (const [f, c] of Object.entries(counts)) {
  const base = baseline[f] ?? 0;
  if (c > base) regressions.push({ f, c, base });
}
// 已清零但基线仍记的（迁移成果，提示收紧）
const shrunk = Object.entries(baseline).filter(([f, b]) => (counts[f] ?? 0) < b);

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`· 扫描 ${files.length} 文件（${ROOTS.join(" + ")}）`);
console.log(`· 内联业务常数命中：${total}（${Object.keys(counts).length} 文件）；基线 ${Object.values(baseline).reduce((a, b) => a + b, 0)}`);
if (shrunk.length) console.log(`· 已收窄 ${shrunk.length} 文件（迁移成果，可 \`pnpm debattery:check --update\` 收紧基线）`);

if (regressions.length) {
  console.error("\n✗ 去电池锁死门禁未通过（视图/页内联了新的业务常数 → 违反 R14）：");
  for (const r of regressions) {
    console.error(`  - ${r.f}：${r.c} 命中（基线 ${r.base}）`);
    for (const h of detail[r.f].slice(0, 4)) console.error(`      L${h.n}: ${h.text}`);
  }
  console.error("\n  修法：把业务常数移到 ViewConfig.layout / WorkspaceConfig / 对象库 / i18n；必须保留的兜底加 // debattery-allow。");
  process.exit(1);
}
console.log("\n✓ 去电池锁死门禁通过（无新增内联业务常数；存量见基线，随迁移收窄）。");
