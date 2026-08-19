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
  console.error(`⛔ check-debattery.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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

/**
 * 把注释内容抹成空格（保留换行与列宽，行号不漂）。
 *
 * ⚠ **别退回「按行首字符判断是不是注释」的老写法**（本门 2026-08-13 实测被它咬出假红）。
 * 老写法是 `t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")`，
 * 对**块注释的续行**恒判 false —— JSX 里这样写的注释极常见：
 *
 *     {␣/* 欠账 #178：……
 *        （引擎侧记的病历原话：问「枣庄」拿到 8 张别的基地的卡）。   ← 这行不以注释符开头
 *        …… *␣/}
 *
 * 于是「枣庄」被当成**视图里写死的基地名**报红，而它其实只是一句病历记录。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『这一行以注释符开头』当作『这一行是注释』的证据，而前者并不度量后者。」**
 * 同族前例（同日）：`stale-claims` 事实锁的注释遮蔽 —— 那次也是拿行首形状当注释判据。
 * 按铁律 0.6「同一个错第二次必须当场建机制」，这里改成**带状态的扫描**，并配双向金丝雀。
 *
 * 状态机同时认字符串字面量，否则 `"https://x"` 里的 `//` 会被当成注释起点，
 * 把后面半行真代码一起抹掉 —— 那是**漏报**方向的坏法，比假红更难发现。
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let state = "code"; // code | line | block | s-quote | d-quote | tick
  while (i < src.length) {
    const c = src[i];
    const nx = src[i + 1];
    const keep = (ch) => { out += ch === "\n" ? "\n" : ch; };
    const blank = (ch) => { out += ch === "\n" ? "\n" : " "; };
    if (state === "code") {
      if (c === "/" && nx === "/") { state = "line"; blank(c); blank(nx); i += 2; continue; }
      if (c === "/" && nx === "*") { state = "block"; blank(c); blank(nx); i += 2; continue; }
      if (c === "'") state = "s-quote";
      else if (c === '"') state = "d-quote";
      else if (c === "`") state = "tick";
      keep(c); i++; continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      blank(c); i++; continue;
    }
    if (state === "block") {
      if (c === "*" && nx === "/") { state = "code"; blank(c); blank(nx); i += 2; continue; }
      blank(c); i++; continue;
    }
    // 字符串内：原样保留（业务常数写死在字符串里正是本门要抓的）
    if (c === "\\") { keep(c); if (i + 1 < src.length) keep(src[i + 1]); i += 2; continue; }
    if ((state === "s-quote" && c === "'") || (state === "d-quote" && c === '"') || (state === "tick" && c === "`")) state = "code";
    keep(c); i++; continue;
  }
  return out;
}

/** 命中数 = 含业务 token 的非注释、非 debattery-allow 行数。 */
function scan(file) {
  const raw = readFileSync(file, "utf8");
  const rawLines = raw.split("\n");
  // 注释先抹掉再判 token；`debattery-allow` 标记**本身写在注释里**，故须对原文判。
  const codeLines = stripComments(raw).split("\n");
  const hits = [];
  codeLines.forEach((line, i) => {
    if ((rawLines[i] ?? "").includes("debattery-allow")) return;
    if (TOKEN_RE.test(line)) hits.push({ n: i + 1, text: (rawLines[i] ?? "").trim().slice(0, 90) });
  });
  return hits;
}

/**
 * 双向金丝雀 —— 与主逻辑**共用同一个 `stripComments` / `TOKEN_RE`**，不许各抄一份。
 * 抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿（本仓实测过这个形态）。
 * 缺任一边都会漏掉一半坏法：
 *   ① 必中：token 写在**真代码**里，必须被数到。只有②会让「恒判是注释」的坏法照样通过。
 *   ② 必不中：同一个 token 写在**块注释续行**里，必须数不到。只有①会让本次这个假红复发。
 */
function selfTest() {
  const codeSample = 'const base = "枣庄";\n';
  const commentSample = "{/* 病历：问「枣庄」拿到 8 张别的基地的卡\n   续行也在注释里 4680 */}\n";
  const hit = TOKEN_RE.test(stripComments(codeSample));
  const miss = TOKEN_RE.test(stripComments(commentSample));
  if (!hit || miss) {
    console.error("⛔ 金丝雀不中 ⇒ **本门自己坏了**，本次结论作废（不许读作「无内联业务常数」）：");
    console.error(`   ① 代码里的「枣庄」应被数到：${hit ? "✓" : "✗"}`);
    console.error(`   ② 块注释续行里的「枣庄/4680」应数不到：${miss ? "✗ 仍被数到" : "✓"}`);
    process.exit(2);
  }
  return { hit, miss };
}
selfTest();

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
/* 扫描面自证的独立口径分母（2026-08-19 · WO-GATE-SCAN-SURFACE-CENSUS）：
 * MIN_SCAN_FILES   —— 探测器 A（内联业务常数）面 = ROOTS 两目录递归 .ts/.tsx，当日现算 154，取 ~58%。
 * MIN_DATA_SCAN_FILES —— 探测器 B（写死数据表）面 = DATA_ROOTS 剔 mocks/test，当日现算 241，取 ~60%。
 * 任一面塌到下界以下 ⇒ 枚举器/目录坏了，报「工具坏了」RC=2 —— 不许读作「视图没写死业务常数」。 */
const MIN_SCAN_FILES = 90;
const MIN_DATA_SCAN_FILES = 145;

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
if (files.length < MIN_SCAN_FILES) {
  console.error(`⛔ 门自己瞎了：探测器 A 扫描面只枚举到 ${files.length} 个文件（下界 ${MIN_SCAN_FILES}）——枚举器/目录坏了，不是「视图真的没文件」。`);
  console.error("   本次结论作废：**不许**读作「没有新增内联业务常数」。");
  process.exit(2);
}
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
if (dataFiles.length < MIN_DATA_SCAN_FILES) {
  console.error(`⛔ 门自己瞎了：探测器 B 扫描面只枚举到 ${dataFiles.length} 个文件（下界 ${MIN_DATA_SCAN_FILES}）——枚举器/目录坏了，不是「写死数据表清零了」。`);
  console.error("   本次结论作废：**不许**读作「前端没有写死数据表」。");
  process.exit(2);
}
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
console.log(`· 扫描 ${files.length} 文件（${ROOTS.join(" + ")}）（扫描面下界 ${MIN_SCAN_FILES}，已过 ⇒ 射程没塌）`);
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

console.log(`\n· 前端写死数据表扫描：${dataFiles.length} 文件（${DATA_ROOTS.join(" + ")}，排除 mocks/ 与 test）（扫描面下界 ${MIN_DATA_SCAN_FILES}，已过）`);
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
