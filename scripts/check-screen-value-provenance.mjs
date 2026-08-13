#!/usr/bin/env node
/**
 * 门 `screen-value-provenance:check` · **屏上数值的来源记号门**（WO-GATE4 ④）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 前端第一层展示的数值，要么可溯源到求解器输出/对象属性，要么**必须带来源记号**。
 * 一个由结构哈希凭空派生出来的读数，长得和真值一模一样 —— 它有单位、有小数位、会随
 * 对象变化，**唯独不是任何真实世界的量**。用户没有任何办法分辨。
 *
 * **实测存量（2026-08-13 本门首次运行现算）**：`apps/frontend-shell/src/views/sim/SandboxView.tsx:123`
 *   `for (const v of vars) row[v] = Math.round(hash01(`${oid}|${v}`) * 100);`
 * 顶栏 16 个读数由此派生。因为 `hash01` 在 [0,1) 上近似均匀，**全对象均值必然收敛到 50**——
 * 实测这 16 个数全落在 49.5–50.4 之间（`SandboxView.tsx` 自己的注释就写着这个实测区间）。
 * 而同屏的阻滞点行**有**「合成数据」徽标，**顶栏一个都没有**。
 *
 * 对照组同样是实测出来的（本门不是只会咬一个文件）：
 *   · `views/sim/physicalTopology.ts` —— 同族 `hash01`/`spread` 占位值，但有
 *     `PROVENANCE_LABEL`/`PROVENANCE_BADGE`（"占位·未接真值"/"占位"/"EMPTY·无数据源"）逐格显示 ⇒ **判过**
 *   · `views/sim/inspectorModel.ts` —— 同族 `hash32`/`jitter` 占位值，带 `emptyReason`/"占位·未接真值" ⇒ **判过**
 * 三个文件同族做法、只有一个没记号 —— 这正是本门要区分的那件事。
 *
 * ══ 判据 ═══════════════════════════════════════════════════════════════════════
 *   D1（硬·棘轮）  凡含「**合成数值来源点**」的生产前端文件，必须至少有一条**来源记号**。
 *   D2（棘轮反向）  基线条目一旦不再违规必须删除（只降不升）。
 *
 *   **合成数值来源点**（AST 判定，非行式正则）：调用了
 *     ① `Math.random()`，或 ② 本文件内定义的哈希函数（体内含 `Math.imul`/`Math.random`），
 *        或 ③ 传递地调用了上述函数的本地函数（不动点，最多 4 轮）
 *     且该调用结果**进入数值上下文**（`Math.round/floor/ceil/abs/min/max` · `.toFixed` · `* / + -` 算术）。
 *     **排除** `.toString(...)`（id 生成，不是读数）与几何/样式落点（`dx/dy/x/y/width/opacity/...`，
 *     那是布局抖动不是屏上读数）。
 *
 *   **来源记号**（AST 判定）：`占位|合成|未实测|非实测|示意|estimated|placeholder|provenance|dataMode|EMPTY`
 *     出现在**字符串/模板/JSX 文本字面量**里。**标识符名不算** —— 这条是实测逼出来的：
 *     `SandboxView.tsx` 里有 `EMPTY_SANDBOX_SCOPE` 这个常量名，把标识符算进来它就"有记号"了，
 *     而那玩意儿跟数值来源毫无关系。**「名字里带 EMPTY」不是「屏上说了这是占位」。**
 *
 * ══ ⚠ 射程边界（本门做不到什么 · 不许把它的绿读成「屏上数字都可溯源」）════════════
 * 这道门**做不到全自动溯源**，它是 WO 明确允许的「白名单 + 棘轮」形态。具体：
 *  1. **只到文件级**：证「同一文件里有来源记号」，**不证「记号就贴在那个数旁边」**。
 *     `SandboxView.tsx` 恰恰是反例的极端形态 —— 同屏阻滞点行有「合成数据」徽标、顶栏一个都没有；
 *     **这种「同文件不同区域」的缺席本门看不见**（它只在文件层判定）。修好第 123 行那条之后，
 *     若有人只在页脚加一句"合成"就想变绿，本门确实拦不住 —— 那要靠 UI 走查。
 *  2. **不做数据流**：追不到「这个哈希值最终有没有真的渲染成一个读数」，也追不到**跨文件**传播
 *     （A 文件产哈希、export 出去、B 文件渲染 —— 本门只在 A 判定，B 完全看不见）。
 *  3. **只认三类污染源**：`Math.imul` 型哈希 / `Math.random` / 调用它们的本地函数。
 *     写死常数、mock fixture、后端下发的假值，一律看不见。
 *  4. **记号判定偏假绿**：一句只出现在 `console.log` 里的"占位"也会被算作记号。
 *     反方向（把标识符名当记号）已经堵住，这一侧今天还没堵。
 * ⇒ **本门的绿 = 「没有一个含合成数值来源点的文件是彻底不吭声的」，不是「屏上数字都可溯源」。**
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）。
 * 用法：node scripts/check-screen-value-provenance.mjs   ·   pnpm screen-value-provenance:check
 *      node scripts/check-screen-value-provenance.mjs --list     # 逐文件判定表
 *      node scripts/check-screen-value-provenance.mjs --update   # 棘轮基线只许收缩式回写
 */
/* ── 退出码纪律 · 顶层兜底 ───────────────────────────────────────────────────── */
process.on("uncaughtException", (e) => gateToolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
process.on("unhandledRejection", (e) => gateToolBroken(`未预期 rejection（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
function gateToolBroken(what, hint) {
  console.error(`⛔ check-screen-value-provenance.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「屏上数值都有来源记号 / 代码干净 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2);
}

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/screen-value-provenance-baseline.json");
/** 生产 UI 层。`lib/` 刻意不扫：`lib/uuid.ts` 那类是 id 生成，不是屏上读数。 */
const SCAN_DIRS = ["apps/frontend-shell/src/views", "apps/frontend-shell/src/pages", "apps/frontend-shell/src/components"];
const SKIP = /(^|\/)(__tests__|__mocks__|mocks|fixtures)(\/|$)|\.(test|spec)\.[tj]sx?$/;
const MIN_FILES = 100; // 实测 174；低于此下界多半是 cwd 不对或目录读错

/** typescript 是本门的解析器；缺了它不是「屏上数值都有记号」，是「没得扫」。 */
let ts;
try { ts = require("typescript"); }
catch { gateToolBroken("缺 typescript（本门的解析器）", "多半是这个 worktree 没装依赖：先跑 `pnpm install --prefer-offline` 再重跑本门。"); }

/* ═══════════════════════════════════════════════════════════════════════════
 * 判据本体 —— 金丝雀与主扫描**共用 analyzeSource 这一个函数**，不许各抄一份
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 几何/样式落点：布局抖动不是屏上读数。 */
const GEOMETRY_TARGETS = new Set([
  "dx", "dy", "x", "y", "cx", "cy", "x1", "y1", "x2", "y2", "left", "top", "right", "bottom",
  "width", "height", "opacity", "angle", "offset", "rotate", "scale", "translateX", "translateY",
  "jitterX", "jitterY", "px", "py",
]);
/** 来源记号词表（只在字符串/JSX 文本字面量里认，标识符名不算）。 */
const MARKER_RE = /占位|合成|未实测|非实测|示意|estimated|placeholder|provenance|Provenance|PROVENANCE|dataMode|DataMode|EMPTY/;

function walkAst(n, fn) { fn(n); n.forEachChild((c) => walkAst(c, fn)); }

/**
 * 分析一份源码。**门与金丝雀共用这一个实现。**
 * @returns {{taintFns:string[], hits:{line:number,text:string,target:string|null}[],
 *            markers:{line:number,text:string}[]}}
 */
export function analyzeSource(src, fileName = "x.tsx") {
  const sf = ts.createSourceFile(
    fileName, src, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // ① 本文件内的「伪随机/哈希」函数
  const bodies = new Map();
  walkAst(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) bodies.set(n.name.text, n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      bodies.set(n.name.text, n.initializer.body);
    }
  });
  const taintFns = new Set();
  for (const [name, body] of bodies) {
    let seed = false;
    walkAst(body, (n) => {
      if (!ts.isCallExpression(n)) return;
      const t = n.expression.getText(sf);
      if (t === "Math.imul" || t === "Math.random") seed = true;
    });
    if (seed) taintFns.add(name);
  }
  // 传递闭包（不动点，最多 4 轮）：调用了污染函数的函数，其输出同样是哈希派生
  for (let i = 0; i < 4; i++) {
    let grew = false;
    for (const [name, body] of bodies) {
      if (taintFns.has(name)) continue;
      let hit = false;
      walkAst(body, (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && taintFns.has(n.expression.text)) hit = true; });
      if (hit) { taintFns.add(name); grew = true; }
    }
    if (!grew) break;
  }

  // ② 合成数值来源点：污染调用 ∧ 数值上下文 ∧ ¬toString ∧ ¬几何落点
  const hits = [];
  walkAst(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const callee = n.expression.getText(sf);
    const tainted = callee === "Math.random" || (ts.isIdentifier(n.expression) && taintFns.has(n.expression.text));
    if (!tainted) return;
    let numeric = false, viaToString = false, geometry = false, target = null;
    for (let p = n.parent, d = 0; p && d < 8; p = p.parent, d++) {
      if (ts.isBinaryExpression(p)) {
        const op = p.operatorToken.getText(sf);
        if (op === "*" || op === "/" || op === "+" || op === "-") numeric = true;
        if (p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const lhs = p.left.getText(sf);
          target ??= lhs;
          if (GEOMETRY_TARGETS.has(lhs)) geometry = true;
        }
      }
      if (ts.isCallExpression(p)) {
        const t = p.expression.getText(sf);
        if (/^Math\.(round|floor|ceil|abs|min|max)$/.test(t)) numeric = true;
        if (/\.toFixed$/.test(t)) numeric = true;
        if (/\.toString$/.test(t)) viaToString = true;
      }
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
        target ??= p.name.text;
        if (GEOMETRY_TARGETS.has(p.name.text)) geometry = true;
      }
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
        target ??= p.name.text;
        if (GEOMETRY_TARGETS.has(p.name.text)) geometry = true;
      }
    }
    if (!numeric || viaToString || geometry) return;
    hits.push({ line: lineOf(n), text: n.getText(sf).replace(/\s+/g, " ").slice(0, 80), target });
  });

  // ③ 来源记号：**只认字符串/模板/JSX 文本字面量**（标识符名不算——见文件头 EMPTY_SANDBOX_SCOPE 那条）
  const markers = [];
  walkAst(sf, (n) => {
    if (ts.isStringLiteralLike(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (MARKER_RE.test(n.text)) markers.push({ line: lineOf(n), text: n.text.trim().replace(/\s+/g, " ").slice(0, 48) });
    }
  });

  return { taintFns: [...taintFns], hits, markers };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 · **双向**，全部是合成样例 + 规模下界
 *
 * ⚠ 刻意**不拿存量缺陷当必中金丝雀**：那样一来「缺陷被修好」会让门报「工具坏了」，
 *   正好把本门要咬的场景吞掉（同批 carrier 门的 M5 变异当场演示过这个陷阱）。
 *   合成样例的性质由构造保证，永远不会因生产代码变化而失效。
 * ═══════════════════════════════════════════════════════════════════════════ */
const CANARIES = [
  {
    name: "必中·哈希派生 + Math.round 进数值上下文 ⇒ 算来源点",
    src: "function h(s: string): number { let x = 2166136261; x = Math.imul(x, 16777619); return (x >>> 0) % 1000 / 1000; }\nexport function f(o: string) { const row: Record<string, number> = {}; row['v'] = Math.round(h(o) * 100); return row; }\n",
    ok: (r) => r.hits.length === 1 && r.markers.length === 0,
  },
  {
    name: "必中·Math.random() 直接进算术 ⇒ 算来源点",
    src: "export const v = Math.round(Math.random() * 100);\n",
    ok: (r) => r.hits.length === 1,
  },
  {
    name: "必中·记号在 JSX 文本里 ⇒ 认得出",
    src: "export const C = () => <span>占位·未接真值</span>;\n",
    file: "c.tsx",
    ok: (r) => r.markers.length === 1,
  },
  {
    name: "必中·记号在字符串常量里 ⇒ 认得出",
    src: 'export const LABEL = { placeholder: "占位·未接真值" };\n',
    ok: (r) => r.markers.length >= 1,
  },
  {
    name: "必不中·`Math.random().toString(36)` 生成 id ⇒ 不算屏上读数",
    src: "export const id = `s_${Math.random().toString(36).slice(2, 8)}`;\n",
    ok: (r) => r.hits.length === 0,
  },
  {
    name: "必不中·随机只用于布局抖动（dx/dy）⇒ 不算屏上读数",
    src: "export function jitter() { let dx = 0; dx = (Math.random() - 0.5) * 2; return dx; }\n",
    ok: (r) => r.hits.length === 0,
  },
  {
    name: "必不中·**标识符名**里带 EMPTY 不算来源记号（EMPTY_SANDBOX_SCOPE 那条实测坑）",
    src: "const EMPTY_SANDBOX_SCOPE = { baseIds: [] };\nexport const s = EMPTY_SANDBOX_SCOPE;\n",
    ok: (r) => r.markers.length === 0,
  },
  {
    name: "必不中·**注释**里写「占位」不算来源记号（AST 不收注释）",
    src: "// 这里是占位值，不是实测\nexport const v = 1;\n",
    ok: (r) => r.markers.length === 0,
  },
  {
    name: "必不中·完全干净的组件 ⇒ 零来源点零记号",
    src: "export const C = ({ n }: { n: number }) => <b>{n.toFixed(1)}</b>;\n",
    file: "c.tsx",
    ok: (r) => r.hits.length === 0 && r.markers.length === 0,
  },
  {
    name: "必中·传递调用（本地函数调哈希函数）也算污染（不动点那一层）",
    src: "function h(s: string): number { let x = 1; x = Math.imul(x, 16777619); return x % 100; }\nconst spread = (k: string) => h(k) * 2;\nexport const util = Math.round(spread('a'));\n",
    ok: (r) => r.hits.length >= 1 && r.taintFns.includes("spread"),
  },
];
{
  const bad = [];
  for (const c of CANARIES) {
    let r;
    try { r = analyzeSource(c.src, c.file ?? "canary.ts"); }
    catch (e) { bad.push(`${c.name} —— 解析器抛异常：${e?.message || e}`); continue; }
    if (!c.ok(r)) bad.push(`${c.name} —— 实得 hits=${r.hits.length} markers=${r.markers.length} taintFns=[${r.taintFns.join(",")}]`);
  }
  if (bad.length) gateToolBroken("金丝雀不中 ⇒ **门自己瞎了**：\n   · " + bad.join("\n   · "));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 扫描面
 * ═══════════════════════════════════════════════════════════════════════════ */
function listFiles(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.test(p)) listFiles(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    if (SKIP.test(p)) continue;
    out.push(p);
  }
  return out;
}
let files = [];
for (const d of SCAN_DIRS) files = listFiles(join(ROOT, d), files);
if (files.length < MIN_FILES) {
  gateToolBroken(`只枚举到 ${files.length} 个前端源文件（下界 ${MIN_FILES}）`, "多半是 cwd 不在仓根：本门必须在仓根跑。");
}

const rows = [];
for (const abs of files.sort()) {
  const rel = abs.slice(ROOT.length + 1);
  let r;
  try { r = analyzeSource(readFileSync(abs, "utf8"), rel); }
  catch (e) { gateToolBroken(`解析 ${rel} 失败（${e?.message || e}）`); }
  if (r.hits.length === 0) continue;
  rows.push({ file: rel, ...r });
}
const violations = rows.filter((r) => r.markers.length === 0);

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  console.log(`扫描 ${files.length} 个生产前端源文件 · 含合成数值来源点的 ${rows.length} 个`);
  for (const r of rows) {
    console.log(`  ${r.markers.length ? "✓" : "✗"} ${r.file}  来源点 ${r.hits.length} · 记号 ${r.markers.length}`);
    for (const h of r.hits) console.log(`        L${h.line} → ${h.target ?? "?"} :: ${h.text}`);
    for (const m of r.markers.slice(0, 3)) console.log(`        记号 L${m.line}: ${m.text}`);
  }
  process.exit(0);
}
if (argv.includes("--update")) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { exempt: {} };
  const exempt = {};
  for (const v of violations) exempt[v.file] = prev.exempt?.[v.file] || { why: "TODO：写清楚为什么这个文件的合成数值今天可以不带来源记号（空 why 会被门判红）" };
  writeFileSync(BASELINE, JSON.stringify({
    note: "screen-value-provenance 棘轮基线：存量「含合成数值来源点却零来源记号」的具名豁免，只许降不许升。每条必须写 why。键 = 仓库相对文件路径。",
    generatedBy: "node scripts/check-screen-value-provenance.mjs --update",
    exempt,
  }, null, 2) + "\n");
  console.log(`已写基线：豁免 ${Object.keys(exempt).length} 条（${BASELINE}）`);
  process.exit(0);
}

if (!existsSync(BASELINE)) gateToolBroken(`基线文件不存在（${BASELINE}）`, "从 canonical 取回，或先跑 `--update` 生成。");
let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch (e) { gateToolBroken(`基线不是合法 JSON（${e?.message || e}）`); }
if (!baseline || typeof baseline.exempt !== "object" || baseline.exempt === null) gateToolBroken("基线结构不对（缺 `exempt` 对象）");
const exempt = baseline.exempt;

const fail = [];
const used = new Set();
for (const v of violations) {
  const e = exempt[v.file];
  if (!e) {
    fail.push(
      `D1 屏上数值无来源记号：${v.file}\n` +
        v.hits.map((h) => `        L${h.line} → ${h.target ?? "?"} :: ${h.text}`).join("\n") + "\n" +
        `      该文件里有 ${v.hits.length} 个合成数值来源点（哈希/伪随机派生并进了数值上下文），\n` +
        `      而**整份文件的字符串/JSX 文本里一个来源记号都没有** —— 屏上那个数看起来就是真值。\n` +
        `      修法二选一：① 把这个数换成真溯源（求解器输出 / 对象属性）；\n` +
        `           ② 保留占位，但在屏上给它一个记号（「占位」「合成数据」「未实测」之类，\n` +
        `              同族做法见 apps/frontend-shell/src/views/sim/physicalTopology.ts 的 PROVENANCE_BADGE）。\n` +
        `      ⚠ **别为了变绿在文件里随手塞一个含"占位"二字的字符串** —— 本门只到文件级，确实拦不住，\n` +
        `           但那样做等于把一个可见的债换成一个看不见的谎。`,
    );
  } else {
    used.add(v.file);
    if (!e.why || !String(e.why).trim() || /^TODO/.test(String(e.why))) {
      fail.push(`豁免无理由：${v.file} 在基线里但没写 why —— 豁免必须说清理由，否则等于永久居留权`);
    }
  }
}
for (const f of Object.keys(exempt)) {
  if (used.has(f)) continue;
  const cur = rows.find((r) => r.file === f);
  const why = !cur
    ? `${f} 已不含任何合成数值来源点（或文件已删/改名）`
    : `${f} 现在有 ${cur.markers.length} 条来源记号，不再是违规`;
  fail.push(`D2 棘轮：${why} —— 豁免已过期，请从 scripts/screen-value-provenance-baseline.json 删掉该条（只降不升）。`);
}

/* ── 报告 ── */
console.log(
  `✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中` +
    `（必中 ${CANARIES.filter((c) => c.name.startsWith("必中")).length} · 必不中 ${CANARIES.filter((c) => c.name.startsWith("必不中")).length}；全部为合成样例，与主逻辑共用 analyzeSource）`,
);
console.log(
  `· screen-value-provenance：扫描 ${files.length} 个生产前端源文件（views/pages/components，排除测试与 mock）· ` +
    `含合成数值来源点 ${rows.length} 个文件 / ${rows.reduce((a, r) => a + r.hits.length, 0)} 处 · 无来源记号 ${violations.length} 个（已豁免 ${used.size}）`,
);
for (const r of rows) console.log(`  ${r.markers.length ? "✓" : "✗"} ${r.file}  来源点 ${r.hits.length} · 记号 ${r.markers.length}${!r.markers.length && exempt[r.file] ? "【基线豁免】" : ""}`);
console.log("· ⚠ 射程边界（本门的绿不等于「屏上数字都可溯源」）：只到**文件级**，不证记号贴在那个数旁边（同文件不同区域的缺席看不见）；");
console.log("     不做数据流，追不到跨文件传播；只认哈希/伪随机三类污染源（写死常数、mock fixture、后端下发的假值一律看不见）；");
console.log("     记号判定偏假绿（只出现在 console.log 里的「占位」也算）。");

if (fail.length) {
  console.error(`\n✗ screen-value-provenance:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error("  - " + m);
  process.exit(1);
}
console.log(
  `\n✓ screen-value-provenance:check 通过（无**新增**违规；存量 ${used.size} 条具名挂账在 scripts/screen-value-provenance-baseline.json，逐条带 why；豁免名单无冗余）。`,
);
if (used.size > 0) console.log(`  ⚠ 「通过」= 没有变得更糟，**不等于**干净：上面 ${used.size} 条今天仍然是真的。`);
