#!/usr/bin/env node
/**
 * 门 `ontology-anchors:check`（治理 · 欠账 #80「假绿第六形态：锚点漂了但门是绿的」）。
 *
 * 病灶：本体开篇自述「锚点为 `file:line`（随代码演进需校准）」，但**"需校准"从来没有任何机制去执行**。
 * `ontology:check` 只验**文件存在**、不验行号——于是代码一演进，读本体的人（和 Agent）按锚点跳过去
 * 看到的是**不相干的代码**，而门一直绿着。首次量化：54 个 `file:line` 锚点里只有 4 个真指向它声称的东西。
 *
 * ─── 门的形态（为什么它不会退化成橡皮图章）────────────────────────────────────
 * 锚点必然随代码漂，所以门**不要求行号永远精确**（那会天天红 → 几次之后没人再分辨该不该变，
 * 正是本仓 `ruleSetVersion` 金值的老路）。本门守的是「**锚点还指着它声称的那个东西**」：
 *
 *   锚点写成  `apps/agentcore/src/agent/loop.ts:452 (degrade)`   ← 显式声明它指向哪个 symbol
 *   门断言    ① 文件存在且路径唯一  ② symbol 真在该文件里  ③ |实际行号 − 声明行号| ≤ TOL（默认 40）
 *   红的时候  打印**实际行号**，并可 `--update` 一键回写 markdown（棘轮式，同 debattery/ontology-descriptions）
 *
 * 三条反橡皮图章设计：
 *   (a) **只在真断了时才红**：TOL 吸收日常编辑（同文件上方增删 <40 行不动它）；漂出一屏 = 跳过去真看不到 →
 *       该红。噪声红被容差挡掉，红一次就意味着一次真实漂移。
 *   (b) **机械类失败的修复是一条命令、diff 是一个数字**（`:584` → `:735`）——人一眼判得出对错。
 *       对比 `ruleSetVersion` 金值：diff 是个不透明哈希，人**无法**分辨"该变"和"回归"，只剩"接受" → 橡皮图章。
 *   (c) **语义类失败 `--update` 拒绝自动修**：symbol 在文件里彻底找不到（被改名/删除）→ 门保持红，
 *       必须人来决定新锚点指哪。**唯一需要判断力的场景，恰恰是唯一不能自动过的场景。**
 *
 * ─── 棘轮基线（存量债可见、只降不升）──────────────────────────────────────────
 * `scripts/ontology-anchor-baseline.json`：
 *   `verified`  已带 (symbol) 的锚点键 `path::symbol` —— **基线里的键不许消失**（堵"为变绿删锚点"：
 *               锚点是本体可用性的索引，删了等于把大脑的索引撕掉）。新增带 symbol 的锚点无需改基线（鼓励补）。
 *   `unverified` 未带 (symbol) 的锚点**按文件计数** —— 数量只许降不许升（新锚点必须带 symbol）；
 *               同时对它们仍做**零噪声**的客观校验：文件可解析 + 行号不越界。
 *
 * 用法：node scripts/check-ontology-anchors.mjs [--update] [--report]
 *       ONTOLOGY_ANCHOR_TOLERANCE=<n> 覆盖容差（默认 40 行 ≈ 一屏）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ONTO_REL = "docs/SYSTEM-ONTOLOGY.md";
const ONTO = join(ROOT, ONTO_REL);
const BASELINE = join(ROOT, "scripts/ontology-anchor-baseline.json");
const TOL = Number(process.env.ONTOLOGY_ANCHOR_TOLERANCE ?? 40);

const update = process.argv.includes("--update");
const report = process.argv.includes("--report");
const canaryOnly = process.argv.includes("--canary");

// --- 源文件索引（用于把简写锚点 `loop.ts:452` 解析到真实路径 / 判歧义）--------------
const SRC_ROOTS = ["apps", "packages", "scripts", "deploy", "services", "db-seed", ".claude"];
const byBase = new Map();
function walk(dir) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    // `worktrees`：`.claude/worktrees/agent-*/` 是**整个仓库的副本**（派 dev 用的隔离工作区）。
    // 不排除的话，有 N 个在跑的 dev，每个源文件就在索引里出现 N+1 次 → 裸文件名锚点
    // （如 `l2-decompose.ts:102`）全部判 PATH_AMBIGUOUS，门红在一个纯属自造的歧义上。
    // 2026-08-06 实测：23 个 worktree 一次性把锚点门打红。**worktree 里的路径就是同一个文件**，
    // 把它算成"另一个候选"本身就是错的 —— 这是门的缺陷，不是本体漂移。
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git" || e.name === "coverage" || e.name === "worktrees") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const rel = relative(ROOT, p);
      const arr = byBase.get(e.name) ?? [];
      arr.push(rel);
      byBase.set(e.name, arr);
    }
  }
}
for (const r of SRC_ROOTS) walk(join(ROOT, r));

/** 路径解析：优先按仓根相对路径；否则按 basename 唯一后缀匹配。返回 {rel} | {ambiguous:[]} | null */
function resolvePath(p) {
  if (existsSync(join(ROOT, p))) return { rel: p };
  const base = p.split("/").pop();
  const pool = byBase.get(base) ?? [];
  const suffixHits = pool.filter((c) => c === p || c.endsWith("/" + p));
  const cands = suffixHits.length ? suffixHits : pool;
  if (cands.length === 1) return { rel: cands[0] };
  if (cands.length > 1) return { ambiguous: cands.slice(0, 8) };
  return null;
}

// --- 锚点抽取 -----------------------------------------------------------------
// 形态：反引号代码段内的 <path>.<ext>:<line>[-<end>] ，可选紧跟 (symbol) / （symbol）声明它指向什么。
const EXT = "ts|tsx|mjs|cjs|js|jsx|py|sql|sh|json|md|conf|yml|yaml";
const ANCHOR_RE = new RegExp(
  String.raw`([A-Za-z0-9_./-]+\.(?:${EXT})):(\d+)(?:-(\d+))?(?:\s*[(（]\s*([A-Za-z0-9_$.\[\]]+)\s*[)）])?`,
  "g",
);

const src = readFileSync(ONTO, "utf8");
const docLines = src.split("\n");

function sectionOf(idx) {
  for (let i = idx; i >= 0; i--) if (/^#{2,4}\s/.test(docLines[i])) return docLines[i].trim().slice(0, 40);
  return "(前言)";
}

const anchors = [];
for (let i = 0; i < docLines.length; i++) {
  const line = docLines[i];
  // 只认反引号代码段里的锚点（散文里提到的 "xx.ts:12" 不算锚点）
  const spanRe = /`[^`]*`/g;
  let span;
  while ((span = spanRe.exec(line))) {
    ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = ANCHOR_RE.exec(span[0]))) {
      anchors.push({
        docLine: i + 1,
        section: sectionOf(i),
        raw: m[0],
        path: m[1],
        line: Number(m[2]),
        endLine: m[3] ? Number(m[3]) : null,
        symbol: m[4] ?? null,
        absStart: span.index + m.index, // 行内偏移，供 --update 精确回写
      });
    }
  }
}

// --- 逐条判定 -----------------------------------------------------------------
const fileCache = new Map();
function linesOf(rel) {
  if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(join(ROOT, rel), "utf8").split("\n"));
  return fileCache.get(rel);
}

/**
 * 取一行的**代码部分**（剥掉注释）。锚点必须指向代码，不能指向"谈论这段代码的注释"——
 * 否则一个到处被注释提及的常用名（如 `degrade` 在 loop.ts 里出现 31 次、半数在注释）会让门形同虚设：
 * 行号随便写都能在一屏内蹭到一句注释 → 又一次假绿。（本门自身第一版就栽在这，变异反证当场抓出。）
 */
function codeOf(line) {
  const t = line.trimStart();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
  const m = line.match(/(^|[^:])\/\//); // 行尾 // 注释（避开 URL 的 "://"）
  return m ? line.slice(0, m.index + m[1].length) : line;
}

// ─── 行分类：import/export-from · 定义处 · 普通引用（欠账 #166）──────────────────
// 病灶：`--update` 原来「在所有代码出现里取离声称行最近的一个」回写。TypeScript 文件里一个符号
// **第一次出现往往是 `import { X } from "..."`**，于是代码一漂，`--update` 就把锚点写到一句 import 上：
// 门当场变绿（机械正确），但本体的 file:line 从「读这里能看懂接线」退化成「读这里只看到一句 import」，
// 而本体是系统接线的单一来源 —— 烂掉了没人会立刻发现。这是**门自己把自己修绿**的假绿形态。
//
// ⚠️ **单一实现**：下面两个纯函数被**三处**共用 —— ① `--update` 的回写候选筛选、
// ② 校验路径的 `IMPORT_LINE_ANCHOR` 护栏、③ 自证工具用的金丝雀 `runCanary()`。
// **不许各抄一份正则**：抄了护栏就是装饰品，改主逻辑时金丝雀拿旧的去测、照样绿（CLAUDE.md 铁律 0.6 明令）。
const JS_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
const PY_EXT = new Set(["py"]);
function extOf(rel) {
  return (rel.split(".").pop() ?? "").toLowerCase();
}

/** import/export-from 语句是否已闭合（用于把多行 import 收成一条语句）。 */
function stmtClosed(buf) {
  return /(^|[\s}])from\s*["'][^"']*["']/.test(buf) || /^import\s*["'][^"']*["']/.test(buf) || /;\s*$/.test(buf);
}

/**
 * 一份源文件里**属于 import / export-from 语句**的全部行号（1-based；多行 import 的每一行都算）。
 * 纯函数（吃 lines + ext），故金丝雀可以直接投喂合成样例，与主逻辑跑的是同一份实现。
 * 只认**静态** import 与 `export ... from`：`export const/function/class/type X`、
 * 不带 from 的本地 `export { X }`、动态 `await import("./x")` **都不算**（它们是真代码位置）。
 */
function importStatementLines(lines, ext) {
  const set = new Set();
  if (PY_EXT.has(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const t = codeOf(lines[i]).trim();
      if (/^import\s+\S/.test(t) || /^from\s+\S+\s+import\b/.test(t)) set.add(i + 1);
    }
    return set;
  }
  if (!JS_EXT.has(ext)) return set;
  for (let i = 0; i < lines.length; i++) {
    const head = codeOf(lines[i]).trim();
    // 廉价剪枝：只有这几种起手式**可能**是 import/export-from。`export const|function|class|interface|type X`
    // 一律不进（它们正是我们要保住的"定义处"）。
    const isImp = /^import\b/.test(head);
    const isExpFrom = /^export\s+type\s*\{/.test(head) || /^export\s*\{/.test(head) || /^export\s*\*/.test(head);
    if (!isImp && !isExpFrom) continue;
    const span = [i];
    let buf = head;
    let k = i;
    while (!stmtClosed(buf) && k + 1 < lines.length && span.length < 200) {
      k++;
      buf += " " + codeOf(lines[k]).trim();
      span.push(k);
    }
    const sideEffect = /^import\s*["'][^"']*["']/.test(buf); // import "./x.js"（纯副作用导入）
    const fromClause = /(^|[\s}])from\s*["'][^"']*["']/.test(buf);
    if ((isImp && (fromClause || sideEffect)) || (isExpFrom && fromClause)) {
      for (const n of span) set.add(n + 1);
      i = k; // 整条语句已消费
    }
  }
  return set;
}

/**
 * 该行是不是 `symbol` 的**定义处**（而非调用/引用）。纯函数，金丝雀直接投喂。
 * 覆盖 `export function X` / `class X` / `interface X` / `type X =` / `enum X` /
 * `const|let|var X`（含解构） / 类成员与对象字面量键 `X:` / 方法简写 `X(...) {`。
 */
function isDefinitionLine(line, symbol) {
  const code = codeOf(line ?? "");
  if (!code) return false;
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pats = [
    String.raw`\b(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?function\s*\*?\s*${s}\b`,
    String.raw`\b(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+${s}\b`,
    String.raw`\b(?:export\s+)?(?:declare\s+)?interface\s+${s}\b`,
    String.raw`\b(?:export\s+)?(?:declare\s+)?type\s+${s}\s*[=<]`,
    String.raw`\b(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+${s}\b`,
    String.raw`\b(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+(?:\{[^}]*\b${s}\b[^}]*\}|\[[^\]]*\b${s}\b[^\]]*\]|${s}\b)`,
    String.raw`^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|abstract\s+|async\s+)*${s}\s*[:(=]`,
  ];
  return pats.some((p) => new RegExp(p).test(code));
}

const importLineCache = new Map();
/** 缓存版：某文件的 import 行号集合。 */
function importLinesOf(rel) {
  if (!importLineCache.has(rel)) importLineCache.set(rel, importStatementLines(linesOf(rel), extOf(rel)));
  return importLineCache.get(rel);
}

/** 把 symbol 的出现按「import 行 / 定义处 / 普通引用」三分。回写候选**永不含 import 行**。 */
function classifyOccurrences(rel, symbol) {
  const lines = linesOf(rel);
  const imports = importLinesOf(rel);
  const out = { imp: [], def: [], code: [] };
  for (const n of occurrences(rel, symbol)) {
    if (imports.has(n)) out.imp.push(n);
    else if (isDefinitionLine(lines[n - 1], symbol)) out.def.push(n);
    else out.code.push(n);
  }
  return out;
}

// ─── 金丝雀（CLAUDE.md 铁律 0.6 · 强制）────────────────────────────────────────
// 本门要报的是「0 个锚点指向 import 行」这种**否定结论**。而「我没找到」和「它不存在」是两个命题：
// 若 `importStatementLines` 哪天被改坏（少认一种 import 形态 / 正则写歪），它会安静地返回空集，
// 门照样打印「✓ 通过」。所以在下任何否定结论之前，先拿一份**已知必中**的合成样例证明检测逻辑是活的。
// ⚠️ 金丝雀调用的就是主逻辑那两个函数本身（`importStatementLines` / `isDefinitionLine`），
// **没有另抄一份正则** —— 抄了它就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
const CANARY_LINES = [
  /* 1 */ `import { seedDemoEntitlements, DEMO_TENANT } from "./seed.js";`,
  /* 2 */ `import type { Foo } from "./foo.js";`,
  /* 3 */ `import "./side-effect.js";`,
  /* 4 */ `import {`,
  /* 5 */ `  multiLineSymbol,`,
  /* 6 */ `  other,`,
  /* 7 */ `} from "./multi.js";`,
  /* 8 */ `export { reExported } from "./re.js";`,
  /* 9 */ `export * from "./star.js";`,
  /* 10 */ `export const SEED_PACKAGE_ID = "pkg_battery_manufacturing";`,
  /* 11 */ `export function seedDemoEntitlements(repos) {`,
  /* 12 */ `  const m = await import("./dynamic.js");`,
  /* 13 */ `  return multiLineSymbol(repos);`,
  /* 14 */ `}`,
  /* 15 */ `export interface Foo { bar: string }`,
  /* 16 */ `export type Baz = { qux: number };`,
  /* 17 */ `export class Widget {}`,
  /* 18 */ `const localOnly = 1;`,
  /* 19 */ `export { localOnly };`,
];
// (行号, 期望是不是 import 行) —— 覆盖单行/类型/副作用/多行/re-export/星号导出，以及一组**必须不中**的负例。
const CANARY_IMPORT_EXPECT = [
  [1, true], [2, true], [3, true],
  [4, true], [5, true], [6, true], [7, true], // 多行 import 的每一行都要算
  [8, true], [9, true],
  [10, false], [11, false], [12, false], // `export const` / `export function` / 动态 import 都是真代码位置
  [13, false], [15, false], [16, false], [17, false], [18, false],
  [19, false], // 不带 from 的本地 `export { X }` 不算 import
];
const CANARY_DEF_EXPECT = [
  [10, "SEED_PACKAGE_ID", true],
  [11, "seedDemoEntitlements", true],
  [15, "Foo", true],
  [16, "Baz", true],
  [17, "Widget", true],
  [18, "localOnly", true],
  [13, "multiLineSymbol", false], // 调用处不是定义处
  [1, "seedDemoEntitlements", false], // import 行不是定义处
];

/** 跑金丝雀。返回 {ok, hits, misses[]}。不中 ⇒ 调用方必须报「工具坏了」，不许报「锚点都干净」。 */
function runCanary() {
  const misses = [];
  let hits = 0;
  const got = importStatementLines(CANARY_LINES, "ts");
  for (const [ln, want] of CANARY_IMPORT_EXPECT) {
    const have = got.has(ln);
    if (have === want) hits++;
    else misses.push(`importStatementLines 第 ${ln} 行（\`${CANARY_LINES[ln - 1].trim()}\`）期望 ${want ? "是" : "不是"} import 行，实得 ${have}`);
  }
  for (const [ln, sym, want] of CANARY_DEF_EXPECT) {
    const have = isDefinitionLine(CANARY_LINES[ln - 1], sym);
    if (have === want) hits++;
    else misses.push(`isDefinitionLine 第 ${ln} 行 × \`${sym}\` 期望 ${want ? "是" : "不是"} 定义处，实得 ${have}`);
  }
  return { ok: misses.length === 0, hits, total: CANARY_IMPORT_EXPECT.length + CANARY_DEF_EXPECT.length, misses };
}

const canary = runCanary();
if (!canary.ok) {
  console.error("\n✗ **工具坏了**（不是「锚点都干净」）：import/定义行判定的金丝雀未全中，本门这一轮的结论一律不可信。");
  for (const m of canary.misses) console.error(`  - ${m}`);
  console.error(`  金丝雀 ${canary.hits}/${canary.total} 命中 —— 修好 importStatementLines / isDefinitionLine 再跑。`);
  process.exit(2);
}
if (canaryOnly) {
  console.log(`✓ 金丝雀全中：${canary.hits}/${canary.total}（import 行判定 ${CANARY_IMPORT_EXPECT.length} 例 + 定义处判定 ${CANARY_DEF_EXPECT.length} 例）`);
  console.log(`  命中样例：合成样例第 1/4/5/6/7/8/9 行判为 import 行；第 10/11/12/19 行判为非 import（含动态 import 与本地 export{}）。`);
  process.exit(0);
}

const nearestTo = (arr, line) =>
  arr.length ? arr.reduce((best, n) => (Math.abs(n - line) < Math.abs(best - line) ? n : best), arr[0]) : null;

/**
 * 选回写目标：**import 行一律不进候选**（硬规则）；定义处优先（软规则）——
 * 最近的定义若落在容差内，说明锚点本意就是指定义 ⇒ snap 到定义；
 * 否则保留最近的**非 import** 出现（锚点可能有意指"接线点/调用处"而非定义处，不该被硬拽走）。
 * 这条软规则刻意不会把任何原本绿的锚点判红：snap 只发生在 delta ≤ TOL 的情形。
 */
function pickAnchorTarget(cls, declared) {
  const nearestDef = nearestTo(cls.def, declared);
  if (nearestDef !== null && Math.abs(nearestDef - declared) <= TOL) return nearestDef;
  return nearestTo(cls.def.concat(cls.code), declared);
}

/** symbol 在文件中的出现行号（标识符走词边界，含点/括号的按字面子串）。scope: "code" | "comment" */
function occurrences(rel, symbol, scope = "code") {
  const lines = linesOf(rel);
  const isIdent = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol);
  const re = isIdent ? new RegExp(String.raw`\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`) : null;
  const hit = (s) => (re ? re.test(s) : s.includes(symbol));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const code = codeOf(lines[i]);
    const target = scope === "code" ? code : lines[i].slice(code.length);
    if (target && hit(target)) out.push(i + 1);
  }
  return out;
}

const verified = [];
const unverified = [];
const importScanned = []; // 真正过了 IMPORT_LINE_ANCHOR 护栏的锚点（路径可解析 + 行号在范围内）
const problems = []; // {kind, anchor, msg, fix?}

for (const a of anchors) {
  const res = resolvePath(a.path);
  if (res === null) {
    problems.push({ kind: "FILE_MISSING", a, msg: `文件不存在：${a.path}`, auto: false });
    (a.symbol ? verified : unverified).push(a);
    continue;
  }
  if (res.ambiguous) {
    // 带 symbol 的锚点必须路径唯一（歧义 = 跳过去可能落在另一个文件）；不带 symbol 的记入存量债。
    a.ambiguous = res.ambiguous;
    if (a.symbol) {
      problems.push({
        kind: "PATH_AMBIGUOUS",
        a,
        msg: `路径不唯一（写全仓根相对路径）：${a.path} → ${res.ambiguous.join(" | ")}`,
        auto: false,
      });
      verified.push(a);
    } else {
      // 路径不唯一 ⇒ 无法确知锚点指的是哪个文件。但若**每个候选**的那一行都是 import/export-from，
      // 则"指着一句 import"这个结论与选哪个候选无关 —— 仍可确定性判红（保守推广，不制造噪声红）。
      const inRange = a.ambiguous.filter((c) => a.line >= 1 && a.line <= linesOf(c).length);
      if (inRange.length && inRange.length === a.ambiguous.length && inRange.every((c) => importLinesOf(c).has(a.line))) {
        importScanned.push(a);
        problems.push({
          kind: "IMPORT_LINE_ANCHOR",
          a,
          msg: `锚点指向 import/export-from 语句（${a.ambiguous.length} 个候选**全部**如此，故与选哪个无关）：${a.path}:${a.line} → \`${(linesOf(inRange[0])[a.line - 1] ?? "").trim().slice(0, 90)}\``,
          auto: false,
        });
      }
      unverified.push(a);
    }
    continue;
  }
  a.resolved = res.rel;
  const total = linesOf(res.rel).length;
  a.fileLines = total;
  if (a.line < 1 || a.line > total) {
    problems.push({ kind: "LINE_OUT_OF_RANGE", a, msg: `行号越界：${a.path}:${a.line}（文件仅 ${total} 行）`, auto: false });
    (a.symbol ? verified : unverified).push(a);
    continue;
  }
  // 护栏（欠账 #166）：**任何**锚点——带不带 symbol 都算——若指着一句 import/export-from，
  // 就是"读过去只能看到一句 import"的坏锚点，直接红。与 `--update` 的回写候选筛选**共用
  // `importLinesOf` 这一个实现**，不是另抄的正则。
  importScanned.push(a);
  if (importLinesOf(res.rel).has(a.line)) {
    a.onImportLine = true;
    problems.push({
      kind: "IMPORT_LINE_ANCHOR",
      a,
      msg: `锚点指向 import/export-from 语句：${res.rel}:${a.line} → \`${(linesOf(res.rel)[a.line - 1] ?? "").trim().slice(0, 90)}\`—— 跳过去只看得到一句 import，看不到接线`,
      auto: false, // 先占位；下面若能算出真实代码位置，会改成可自动修
    });
  }
  if (!a.symbol) {
    unverified.push(a);
    continue;
  }
  verified.push(a);
  const occ = occurrences(res.rel, a.symbol);
  if (occ.length === 0) {
    const inComment = occurrences(res.rel, a.symbol, "comment");
    problems.push({
      kind: inComment.length ? "SYMBOL_ONLY_IN_COMMENT" : "SYMBOL_GONE",
      a,
      msg: inComment.length
        ? `symbol \`${a.symbol}\` 在 ${res.rel} 里只出现在注释（行 ${inComment.slice(0, 5).join("/")}）—— 锚点须指向代码，不是指向谈论它的注释`
        : `symbol \`${a.symbol}\` 在 ${res.rel} 中已不存在（被改名/删除）—— 语义漂移，--update 不代劳，须人判新锚点`,
      auto: false,
    });
    continue;
  }
  // 三分：import 行 / 定义处 / 普通引用。**import 行永不作为回写目标**（欠账 #166 的核心修法）。
  const cls = classifyOccurrences(res.rel, a.symbol);
  const nearest = pickAnchorTarget(cls, a.line);
  if (nearest === null) {
    // fail-closed：符号在该文件里**只**出现在 import 行（本地无定义、无调用）——
    // 静默把锚点写到那句 import 上正是本缺陷，所以这里报错退出、交给人判锚点该指哪个文件。
    problems.push({
      kind: "SYMBOL_ONLY_IN_IMPORT",
      a,
      msg: `symbol \`${a.symbol}\` 在 ${res.rel} 里**只**出现在 import/export-from 语句（行 ${cls.imp.join("/")}）—— 该文件只是转口，锚点须改指真正定义/使用它的文件（--update 刻意不代劳）`,
      auto: false,
    });
    continue;
  }
  a.actual = nearest;
  a.delta = Math.abs(nearest - a.line);
  const badLine = problems.find((p) => p.kind === "IMPORT_LINE_ANCHOR" && p.a === a);
  if (badLine) {
    // 锚点当前压在 import 行上，但该 symbol 在本文件有真实代码位置 ⇒ 机械可修，交给 `--update`。
    badLine.auto = true;
    badLine.fix = nearest;
    badLine.msg += `；真实代码位置 ${res.rel}:${nearest}`;
  } else if (a.delta > TOL) {
    problems.push({
      kind: "LINE_DRIFT",
      a,
      msg: `锚点漂了 ${a.delta} 行：\`${a.raw}\` 声称 :${a.line}，\`${a.symbol}\` 实际在 ${res.rel}:${nearest}`,
      fix: nearest,
      auto: true,
    });
  }
}

// --- --update：机械类（LINE_DRIFT）回写 markdown；语义类拒绝代劳 ------------------
if (update) {
  const drifted = problems.filter((p) => p.auto && typeof p.fix === "number");
  // fail-closed 自检（欠账 #166）：**回写目标绝不允许是 import 行**。这里跑的是与
  // `pickAnchorTarget` / `IMPORT_LINE_ANCHOR` 护栏**同一个** `importLinesOf`，不是另抄的正则；
  // 真撞上说明候选筛选被改坏了 —— 宁可整批不写，也不许再把锚点钉到一句 import 上。
  const wouldWriteImport = drifted.filter((p) => p.a.resolved && importLinesOf(p.a.resolved).has(p.fix));
  if (wouldWriteImport.length) {
    console.error(`\n✗ --update 自检失败：${wouldWriteImport.length} 条回写目标落在 import/export-from 语句上（候选筛选被改坏了）——**未写任何文件**：`);
    for (const p of wouldWriteImport) console.error(`  - ${p.a.raw} → ${p.a.resolved}:${p.fix}`);
    process.exit(2);
  }
  if (drifted.length) {
    const byDoc = new Map();
    for (const p of drifted) {
      const arr = byDoc.get(p.a.docLine) ?? [];
      arr.push(p);
      byDoc.set(p.a.docLine, arr);
    }
    for (const [dl, ps] of byDoc) {
      let line = docLines[dl - 1];
      // 从右往左替换，避免偏移错位
      for (const p of ps.sort((x, y) => y.a.absStart - x.a.absStart)) {
        const a = p.a;
        const span = a.endLine ? `${p.fix}-${p.fix + (a.endLine - a.line)}` : `${p.fix}`;
        const next = a.raw.replace(`:${a.line}${a.endLine ? `-${a.endLine}` : ""}`, `:${span}`);
        line = line.slice(0, a.absStart) + next + line.slice(a.absStart + a.raw.length);
      }
      docLines[dl - 1] = line;
    }
    writeFileSync(ONTO, docLines.join("\n"));
    console.log(`✓ 已校准 ${drifted.length} 条漂移锚点行号（markdown 已回写）`);
    for (const p of drifted) console.log(`  · ${p.a.raw} → :${p.fix}`);
  }
  // 语义漂移未清零 → **绝不写基线**。否则 --update 会把 `SYMBOL_GONE` 的坏锚点当成新的"已校准"键
  // 落进基线、同时把原键从基线里抹掉 —— ANCHOR_DELETED 防线被自己的 --update 洗白（本门第一版真栽过）。
  const blocked = problems.filter((p) => !p.auto);
  if (blocked.length) {
    console.error(`\n✗ 仍有 ${blocked.length} 条**语义漂移**，--update 不代劳（须人判）；基线**未**更新（不许顺手洗白）：`);
    for (const p of blocked) console.error(`  - [${p.kind}] 本体 L${p.a.docLine} ${p.msg}`);
    process.exit(1);
  }
  const unverifiedCounts = {};
  for (const a of unverified) unverifiedCounts[a.path] = (unverifiedCounts[a.path] ?? 0) + 1;
  const verifiedKeys = [...new Set(verified.map((a) => `${a.resolved ?? a.path}::${a.symbol}`))].sort();
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { verified: [] };
  const dropped = (prev.verified ?? []).filter((k) => !verifiedKeys.includes(k));
  if (dropped.length) {
    console.error(`\n✗ --update 拒绝：基线里 ${dropped.length} 条已校准锚点在本体中消失了（删锚点 = 撕掉大脑的索引）：`);
    for (const k of dropped) console.error(`  - ${k}`);
    console.error("  → 要真删，请在本体里把锚点改指新位置；确需退役请单独提交并说明理由。");
    process.exit(1);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify({ tolerance: TOL, verified: verifiedKeys, unverified: sortObj(unverifiedCounts) }, null, 2) + "\n",
  );
  console.log(
    `✓ 锚点基线已更新：已校准锚点 ${verifiedKeys.length} 个 · 未校准存量 ${unverified.length} 条（${Object.keys(unverifiedCounts).length} 个文件）`,
  );
  process.exit(0);
}

function sortObj(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

// --- 棘轮比对 -------------------------------------------------------------------
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { verified: [], unverified: {} };
const baseVerified = new Set(baseline.verified ?? []);
const baseUnverified = baseline.unverified ?? {};

const curVerifiedKeys = new Set(verified.map((a) => `${a.resolved ?? a.path}::${a.symbol}`));
const curUnverified = {};
for (const a of unverified) curUnverified[a.path] = (curUnverified[a.path] ?? 0) + 1;

// 锚点删除防线：基线里的已校准锚点不许凭空消失（"为了变绿把锚点删掉" = 把大脑的索引撕掉）。
const vanished = [...baseVerified].filter((k) => !curVerifiedKeys.has(k));
// 未校准锚点只许降不许升；新出现的文件锚点必须带 (symbol)。
const grown = Object.entries(curUnverified).filter(([p, n]) => n > (baseUnverified[p] ?? 0));

console.log(`· 本体锚点：共 ${anchors.length} 个 \`file:line\``);
console.log(`· 已校准（带 (symbol) 可机器核）：${curVerifiedKeys.size} 个 · 容差 ±${TOL} 行`);
console.log(`· 未校准存量：${unverified.length} 条 / 基线 ${Object.values(baseUnverified).reduce((a, b) => a + b, 0)} 条`);
const shrunk = Object.entries(baseUnverified).filter(([p, n]) => (curUnverified[p] ?? 0) < n);
if (shrunk.length) console.log(`· 已补 (symbol) ${shrunk.length} 个文件的锚点（可 \`--update\` 收紧基线落账）`);
// 否定结论必须自带**度量范围** + 金丝雀证据（CLAUDE.md 铁律 0.6）：
// 「0 条坏锚点」只在"实查了的那些"里成立。查不到的那批必须点名，不许被一句"都干净"盖住 ——
// 「我没找到」和「它不存在」是两个命题。
const notScanned = anchors.length - importScanned.length;
const scannedSet = new Set(importScanned);
const blindAmbiguous = anchors.filter((a) => a.ambiguous && !a.symbol && !scannedSet.has(a)).length;
console.log(
  `· import 行护栏：实查 ${importScanned.length}/${anchors.length} 条 · 坏锚点 ` +
    `${problems.filter((p) => p.kind === "IMPORT_LINE_ANCHOR").length} 条 · 金丝雀 ${canary.hits}/${canary.total} 全中（检测逻辑活着）`,
);
if (notScanned) {
  console.log(
    `  ⚠️ 另有 ${notScanned} 条**未受本护栏覆盖**（非"已确认干净"）：其中 ${blindAmbiguous} 条是裸文件名锚点路径不唯一` +
      `（无 (symbol)·按既有设计记入未校准存量、不为此报红）；补上 (symbol) 或写全仓根相对路径即可纳入护栏。`,
  );
}

if (report) {
  console.log("\n--- 逐条 ---");
  for (const a of anchors) {
    const tag = a.symbol ? (a.delta === undefined ? "?" : `Δ${a.delta}`) : "未校准";
    console.log(`  ${String(a.docLine).padStart(4)} [${tag}] ${a.raw}${a.resolved ? ` → ${a.resolved}` : ""}`);
  }
}

const fails = [];
for (const p of problems) fails.push(`[${p.kind}] 本体 L${p.a.docLine} §${p.a.section} ${p.msg}`);
for (const k of vanished) fails.push(`[ANCHOR_DELETED] 基线中的已校准锚点消失了：${k} —— 不许为了变绿删锚点（本体锚点是"大脑的索引"）`);
for (const [p, n] of grown)
  fails.push(`[UNVERIFIED_GROWTH] 新增未校准锚点：\`${p}\` 现 ${n} 处 > 基线 ${baseUnverified[p] ?? 0} 处 —— 新锚点必须写成 \`path:line (symbol)\``);

if (fails.length) {
  console.error("\n✗ 本体锚点校准门未通过：");
  for (const f of fails) console.error(`  - ${f}`);
  const autoFixable = problems.filter((p) => p.auto).length;
  console.error("\n  修法：");
  if (autoFixable) console.error(`    · ${autoFixable} 条为**行号漂移 / 锚点压在 import 行**（机械） → \`node scripts/check-ontology-anchors.mjs --update\` 一键校准，diff 只有行号`);
  console.error("    · SYMBOL_GONE / FILE_MISSING / PATH_AMBIGUOUS 为**语义漂移** → 人工改锚点指向新位置（--update 刻意不代劳）");
  console.error("    · IMPORT_LINE_ANCHOR：锚点指着一句 import（跳过去看不到接线）→ 改指该 symbol 的**定义处或接线点**；");
  console.error("      不带 (symbol) 的裸锚点无法自动重算，须人工补 `path:line (symbol)` 后再 `--update`。");
  console.error("    · SYMBOL_ONLY_IN_IMPORT：该文件只是转口（符号只在 import 行出现）→ 锚点须改指真正定义/使用它的文件。");
  console.error("    · 新写锚点请带 symbol：`apps/agentcore/src/agent/loop.ts:452 (degrade)`");
  console.error("    · ⚠️ 在本体正文里**举例**提某个 file:line 时别写进反引号——抽取器不区分「举例」和「锚点」，");
  console.error("      会把它当成真锚点校验（写成「`x.ts` 第 N 行」即可）。");
  process.exit(1);
}
console.log("\n✓ 本体锚点校准门通过（已校准锚点均指向其声称的 symbol；未校准存量未回潮）。");
