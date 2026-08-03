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
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git" || e.name === "coverage") continue;
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
    } else unverified.push(a);
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
  const nearest = occ.reduce((best, n) => (Math.abs(n - a.line) < Math.abs(best - a.line) ? n : best), occ[0]);
  a.actual = nearest;
  a.delta = Math.abs(nearest - a.line);
  if (a.delta > TOL) {
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
  const drifted = problems.filter((p) => p.kind === "LINE_DRIFT");
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
  if (autoFixable) console.error(`    · ${autoFixable} 条为**行号漂移**（机械） → \`node scripts/check-ontology-anchors.mjs --update\` 一键校准，diff 只有行号`);
  console.error("    · SYMBOL_GONE / FILE_MISSING / PATH_AMBIGUOUS 为**语义漂移** → 人工改锚点指向新位置（--update 刻意不代劳）");
  console.error("    · 新写锚点请带 symbol：`apps/agentcore/src/agent/loop.ts:452 (degrade)`");
  process.exit(1);
}
console.log("\n✓ 本体锚点校准门通过（已校准锚点均指向其声称的 symbol；未校准存量未回潮）。");
