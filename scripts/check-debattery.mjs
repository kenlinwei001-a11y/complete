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

/* ─────────────────────────────────────────────────────────────────────────────
 * 探测器 B · 前端写死的「业务数据表」（仓主 2026-08-09 裁定二）
 *
 * 原话：「需要补齐数据，而不是 mock 数据，写死在前端的数据都不行」。
 *
 * 探测器 A（上面）只抓**行业专属字符串**（基地名/工序/型号）。它抓不到这种：
 *     const CMP = [["营收","¥12.8B","¥12.5B",-2.3], ["毛利率","9.8%","8.1%",-1.7], ...]
 * —— 数字配通用标签，一个行业 token 都不含，A 全部漏过。审核方自己交付的 HTML 设计稿
 * 就是这个形态，所以这条必须由机器管，不能靠人记（铁律 0.6：下次是机器先说话）。
 *
 * 判据（要的是「数据表」的形状，不是「有数字」）：
 *   顶层元素 ≥ MIN_ROWS 且块内数值字面量 ≥ MIN_NUMS 的 const 字面量。
 *   配色表/断点/枚举多为字符串或扁平短数组，达不到这个形状。
 * 豁免：块首行带 `// hardcoded-data-allow`；`mocks/` 与 `*.test.*` 整体不扫。
 * ────────────────────────────────────────────────────────────────────────── */
const DATA_ROOTS = ["apps/frontend-shell/src"];
const DATA_BASELINE = "scripts/frontend-data-baseline.json";
const DATA_ALLOW = "hardcoded-data-allow";
const MIN_ROWS = 3;
const MIN_NUMS = 6;

/** 从 `= [` / `= {` 处起做括号配平，返回块文本与结束行号（粗略跳过字符串与注释）。 */
function balancedBlock(src, openIdx) {
  const open = src[openIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0, i = openIdx, inStr = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "/" && p === "*") inBlock = false; continue; }
    if (inStr) { if (c === inStr && p !== "\\") inStr = null; continue; }
    if (c === "/" && src[i + 1] === "/") { inLine = true; continue; }
    if (c === "/" && src[i + 1] === "*") { inBlock = true; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  return null;
}

/** 顶层元素个数（只数 depth===1 上的分隔逗号 + 1）。 */
function topLevelRows(block) {
  let depth = 0, rows = 0, inStr = null, seen = false;
  for (let i = 0; i < block.length; i++) {
    const c = block[i], p = block[i - 1];
    if (inStr) { if (c === inStr && p !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if ("[{(".includes(c)) { depth++; if (depth > 1) seen = true; continue; }
    if ("]})".includes(c)) { depth--; continue; }
    if (c === "," && depth === 1) rows++;
    else if (depth === 1 && !/\s/.test(c)) seen = true;
  }
  return seen ? rows + 1 : 0;
}

/** 探测器 B 的唯一实现 —— 金丝雀与主扫描共用它，不许各抄一份。 */
function scanDataTables(source) {
  const hits = [];
  const re = /(?:^|\n)[ \t]*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([[{])/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const block = balancedBlock(source, openIdx);
    if (!block) continue;
    const headLine = source.slice(m.index, source.indexOf("\n", openIdx) + 1 || undefined);
    if (headLine.includes(DATA_ALLOW)) continue;
    const rows = topLevelRows(block);
    const nums = (block.match(/(?<![\w$.])-?\d+(?:\.\d+)?/g) ?? []).length;
    if (rows >= MIN_ROWS && nums >= MIN_NUMS) {
      hits.push({ n: source.slice(0, m.index).split("\n").length, name: m[1], rows, nums });
    }
  }
  return hits;
}

// ── 金丝雀：必须与主逻辑共用 scanDataTables，抄一份正则的金丝雀是装饰品 ──
const CANARY_SRC = `const CMP = [
  ["营收", 12.8, 12.5, -2.3],
  ["毛利率", 9.8, 8.1, -1.7],
  ["交付率", 94.2, 82.6, -11.6],
];`;
const canaryHits = scanDataTables(CANARY_SRC);
if (canaryHits.length !== 1 || canaryHits[0].name !== "CMP") {
  console.error("✗ **门自己坏了**：探测器 B 的金丝雀没命中（期望 1 条 CMP，实得 " + JSON.stringify(canaryHits) + "）。");
  console.error("  报「前端没有写死数据」是不成立的 —— 先修探测器，不许把工具坏了当成代码干净。");
  process.exit(2);
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

// 探测器 B 扫描面：整个前端 src，排除 mocks/ 与 test
const dataFiles = DATA_ROOTS.flatMap(walk)
  .filter((f) => !/[\\/]mocks[\\/]/.test(f) && !/\.test\./.test(f) && !/__tests__/.test(f))
  .sort();
const dataCounts = {};
const dataDetail = {};
for (const f of dataFiles) {
  const hits = scanDataTables(readFileSync(f, "utf8"));
  if (hits.length > 0) { dataCounts[f] = hits.length; dataDetail[f] = hits; }
}

const update = process.argv.includes("--update");
if (update) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  writeFileSync(DATA_BASELINE, JSON.stringify(dataCounts, null, 2) + "\n");
  console.log(`✓ debattery 基线已更新：${Object.keys(counts).length} 文件 / ${Object.values(counts).reduce((a, b) => a + b, 0)} 命中。`);
  console.log(`✓ 前端写死数据表基线已更新：${Object.keys(dataCounts).length} 文件 / ${Object.values(dataCounts).reduce((a, b) => a + b, 0)} 命中。`);
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

/* ── 探测器 B 的棘轮与报告 ───────────────────────────────────────────────── */
const dataBaseline = existsSync(DATA_BASELINE) ? JSON.parse(readFileSync(DATA_BASELINE, "utf8")) : {};
const dataReg = [];
for (const [f, c] of Object.entries(dataCounts)) {
  const base = dataBaseline[f] ?? 0;
  if (c > base) dataReg.push({ f, c, base });
}
const dataShrunk = Object.entries(dataBaseline).filter(([f, b]) => (dataCounts[f] ?? 0) < b);
const dataTotal = Object.values(dataCounts).reduce((a, b) => a + b, 0);

console.log(`\n· 前端写死数据表扫描：${dataFiles.length} 文件（${DATA_ROOTS.join(" + ")}，排除 mocks/ 与 test）`);
console.log(`· 金丝雀：命中 ${canaryHits.length} 条（探测器 B 与主扫描共用同一实现，工具已自证）`);
console.log(`· 命中：${dataTotal}（${Object.keys(dataCounts).length} 文件）；基线 ${Object.values(dataBaseline).reduce((a, b) => a + b, 0)}`);
if (dataShrunk.length) console.log(`· 已收窄 ${dataShrunk.length} 文件（可 --update 收紧基线）`);

if (dataReg.length) {
  console.error("\n✗ 前端写死业务数据门禁未通过（仓主 2026-08-09 裁定二：只补真数据，不做 mock）：");
  for (const r of dataReg) {
    console.error(`  - ${r.f}：${r.c} 处（基线 ${r.base}）`);
    for (const h of dataDetail[r.f].slice(0, 4)) {
      console.error(`      L${h.n}: const ${h.name} —— ${h.rows} 行 × ${h.nums} 个数值字面量`);
    }
  }
  console.error("\n  修法：数据必须来自一次真实 API 调用（后端物化进对象库 → listByType 查得到）。");
  console.error("  真没有的数据返回诚实空 + reason，不许兜底编一个。");
  console.error(`  确有必要的非业务字面量（配色/断点/布局），在 const 那一行加 // ${DATA_ALLOW}。`);
  process.exit(1);
}
console.log("✓ 前端写死业务数据门禁通过（无新增写死数据表；存量见基线，随接真收窄）。");
