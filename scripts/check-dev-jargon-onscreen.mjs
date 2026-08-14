#!/usr/bin/env node
/**
 * 门 `dev-jargon:check` · **开发的话不许上屏**（WO-UI-LAYERING-BURNDOWN §3.3）
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **给开发看的话，不许出现在用户的屏幕上。**
 * 判据一句话（派单原文）：**「这句话用户读了能做什么决定？」答不出 ⇒ 它不该在屏上。**
 *
 * 现场（本单实测，仓主截图那页）：`DecisionPlayView` 的入口横幅上印着
 *   「contracts **ChainImpedimentSchema** 是 **strictObject**，逐键核过，无 factorId / factorRef」
 * ——**契约类型名上了屏**。决策者不需要知道契约是不是 strictObject；
 * 这与 `DataBuilderPage` 的「三页归一（自成长收编）」「厂商中立施工」是同一个病。
 *
 * ══ ⚠ 这道门最容易做成废物的地方：把注释也数进去 ═════════════════════════════
 * 全仓 `grep -rEo "WO-[A-Z0-9-]+" views/ pages/admin/` 命中 **数百条**，
 * 但**绝大多数在注释里** —— 注释是写给开发看的，本来就该写这些，一个字都不算违规。
 * 拿 grep 的原始命中数当判据，会得出「全仓到处是违规」这个**恰好相反**的结论，
 * 然后这道门因为噪声太大被永久关掉。这正是本仓铁律 0.6 点名的形态：
 *   **「我用『源码里出现了这个词』当作『用户看得见这个词』的证据，而前者并不度量后者。」**
 *
 * ⇒ 故本门**不 grep 源码文本**，而是用 TypeScript 解析 JSX，只取**真正会渲染出去的字**：
 *    ① JSX 文本节点（`<div>这里</div>`）
 *    ② 文案型属性上的字符串字面量（`label=` / `title=` / `placeholder=` …）
 *    ③ 上述位置里的模板字符串字面量片段
 *    注释 / 变量名 / import / data-testid / className **一律不看**。
 *
 * ══ 诚实边界（本门做不到什么，不许当成"屏上已干净"）════════════════════════════
 *  · **经变量间接上屏的看不见**：`<div>{zh.foo.bar}</div>` 里 `zh.foo.bar` 的正文在
 *    `locales/zh.ts`，本门不跨文件解析 ⇒ 藏在 locale 里的开发话**测不出来**。
 *    （这与 `check-ui-first-layer.mjs` 的 `formula` 判据是同一个盲区，那边也只扫字面量。）
 *  · **词表是有限的**：只咬列举的那几类形态，不是"所有开发术语"。
 *    新的黑话形态要手工补进 `JARGON`，不会自己冒出来。
 *  报「0 命中」时必须连同这两条一起报 —— 「我没找到」和「它不存在」是两个命题。
 *
 * ══ 金丝雀 ════════════════════════════════════════════════════════════════════
 * 与主逻辑**共用同一份 `analyze()`**，不另抄正则（抄一份 = 装饰品：改主正则时
 * 金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。含「必咬」与「必不咬」两侧，
 * 必不咬那侧专门钉死「注释里的 WO 编号不算违规」这条 —— 它是本门唯一的活路。
 *
 * ══ 退出码 ════════════════════════════════════════════════════════════════════
 *   0 = 未超基线 · 1 = 真超标（新增开发话上屏）· 2 = **工具自己坏了**
 * 与 `check-ui-first-layer.mjs` 同约定：任何"我没能扫描"一律 RC=2，
 * 默认失败方向必须是「我没查出来」，不是「你的页面干净」。
 *
 * 用法：
 *   node scripts/check-dev-jargon-onscreen.mjs            # 门（棘轮）
 *   node scripts/check-dev-jargon-onscreen.mjs --selftest # 只跑金丝雀
 *   node scripts/check-dev-jargon-onscreen.mjs --list     # 逐条列出屏上命中
 *   node scripts/check-dev-jargon-onscreen.mjs --update   # 重写基线（需人工核）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/dev-jargon-baseline.json");
const SPEC = "docs/CONVENTION-ui-information-layering.md";

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「屏上没有开发话 / 页面干净」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

let ts;
try {
  ts = require("typescript");
} catch {
  toolBroken("缺 typescript（本门的 JSX 解析器）", "先跑 `pnpm install --prefer-offline` 再重跑。");
}

/**
 * 黑话词表 —— 逐条对着派单 §3.3 原文抄的，不是自拟：
 *   > 契约类型名（`XxxSchema`）· `strictObject` · WO 编号 · PRD 区号（`区2`/`区4`…）·
 *   > 内部机制名（「三页归一」「自成长收编」「厂商中立施工」）
 */
const JARGON = [
  { re: /\b[A-Z][A-Za-z0-9]*Schema\b/, why: "契约类型名（用户不需要知道契约长什么样）" },
  { re: /\bstrictObject\b/, why: "zod 术语" },
  { re: /\bWO-[A-Z0-9][A-Z0-9-]*/, why: "工单编号（内部排期，不是用户的事）" },
  { re: /区\s?[0-9①-⑳]/, why: "PRD 区号（内部章节编号）" },
  { re: /(三页归一|自成长收编|厂商中立施工)/, why: "内部机制名（开发内部叫法）" },
  { re: /\b(zod|tsx?|useQuery|useState|repo\.|msw)\b/, why: "实现细节标识符" },
];

/** 文案型属性 —— 这些属性上的字符串会渲染给用户看。 */
const TEXT_ATTR = /^(label|title|heading|caption|placeholder|text|desc|description|hint|summary|subtitle|tip|topic|aria-label)$/;

/**
 * **主判据本体** —— 门 / `--list` / 金丝雀**三者共用这一份**。
 * @returns {{text:string,why:string,line:number}[]} 屏上命中
 */
export function analyze(src, fileName = "x.tsx") {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const check = (raw, line) => {
    const s = String(raw).replace(/\s+/g, " ").trim();
    if (!s) return;
    for (const j of JARGON) {
      const m = j.re.exec(s);
      if (m) {
        hits.push({ text: s.slice(0, 80), match: m[0], why: j.why, line });
        break;
      }
    }
  };

  const visit = (node) => {
    // ① JSX 文本节点 —— 真正印在屏上的字
    if (ts.isJsxText(node)) check(node.text, lineOf(node));

    // ② 文案型属性上的字面量
    if (ts.isJsxAttribute(node) && node.name && node.initializer) {
      const an = node.name.getText();
      if (TEXT_ATTR.test(an)) {
        if (ts.isStringLiteral(node.initializer)) check(node.initializer.text, lineOf(node));
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          // 只取字面量片段；变量引用跨文件，本门不跟（见"诚实边界"）
          const walk = (n) => {
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) check(n.text, lineOf(node));
            else if (ts.isTemplateExpression(n)) {
              check(n.head.text, lineOf(node));
              n.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(node)));
            }
            ts.forEachChild(n, walk);
          };
          walk(node.initializer.expression);
        }
      }
    }

    // ③ JSX 表达式容器里的字面量：`<div>{"文字"}</div>` / `<div>{`模板`}</div>`
    if (ts.isJsxExpression(node) && node.expression) {
      const ex = node.expression;
      if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) check(ex.text, lineOf(node));
      else if (ts.isTemplateExpression(ex)) {
        check(ex.head.text, lineOf(node));
        ex.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(node)));
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/* ── 金丝雀：与主逻辑共用同一份 analyze() ────────────────────────────────────── */
const CANARIES = [
  {
    name: "必咬-1 契约类型名 + zod 术语上屏（仓主截图那页的原文）",
    src: `export const V = () => <div>（contracts <span>ChainImpedimentSchema</span> 是 strictObject，逐键核过）</div>;`,
    expect: (h) => h.some((x) => /Schema/.test(x.match)) && h.some((x) => x.match === "strictObject"),
  },
  {
    name: "必咬-2 PRD 区号上屏",
    src: `export const V = () => <div>下面 区4 显示的是默认根因</div>;`,
    expect: (h) => h.some((x) => /区\s?4/.test(x.match)),
  },
  {
    name: "必咬-3 内部机制名上屏",
    src: `export const V = () => <div>三页归一（自成长收编）</div>;`,
    expect: (h) => h.length >= 1,
  },
  {
    name: "必咬-4 文案型属性上的 WO 编号",
    src: `export const V = () => <button title="WO-FOO-BAR 入口">去</button>;`,
    expect: (h) => h.some((x) => /^WO-/.test(x.match)),
  },
  {
    /**
     * ⚠ **本门唯一的活路，也是最容易做错的一条。**
     * 注释里的 WO 编号 / 契约名是**写给开发看的，本来就该写**。
     * 全仓注释里有数百条 —— 若本门把它们算进去，噪声会淹掉真违规，门必被关掉。
     * 形态（铁律 0.6）：「我用『源码里出现了这个词』当作『用户看得见这个词』的证据。」
     */
    name: "必不咬-1 注释 / 变量名 / testid 里的黑话不算违规（本门的活路）",
    src: `/** WO-FOO-BAR · 见 ChainImpedimentSchema（strictObject） */
      import { ChainImpedimentSchema } from "@platform/contracts";
      const wo = "WO-FOO-BAR"; // 区4
      export const V = () => <div data-testid="wo-区4" className="strictObject">正常文案</div>;`,
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-2 普通中文文案不误伤",
    src: `export const V = () => <div>缩短备份供应商认证周期 · 本季 · 规则未到线</div>;`,
    expect: (h) => h.length === 0,
  },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let h;
    try {
      h = analyze(c.src, "canary.tsx");
    } catch (e) {
      fails.push(`${c.name} —— analyze() 抛异常：${e.message}`);
      continue;
    }
    if (!c.expect(h)) fails.push(`${c.name} —— 实测命中 ${h.length} 条：${h.map((x) => x.match).join(" / ") || "（无）"}`);
  }
  return fails;
}

/* ── 扫描面（与 check-ui-first-layer 同一片，逐层枚举不用 pathspec 通配）────── */
const SCAN = ["apps/frontend-shell/src/views", "apps/frontend-shell/src/pages/admin"];
const MIN_FILES = 80;

function listFiles() {
  const out = [];
  const walk = (abs, rel, depth) => {
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs)) {
      const p = join(abs, e);
      const r = `${rel}/${e}`;
      if (statSync(p).isDirectory()) {
        if (depth < 2) walk(p, r, depth + 1);
      } else if (e.endsWith(".tsx")) out.push(r);
    }
  };
  for (const d of SCAN) walk(join(ROOT, d), d, 1);
  return out.sort();
}

function scanAll() {
  const rows = [];
  for (const f of listFiles()) {
    let src;
    try {
      src = readFileSync(join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    const hits = analyze(src, f);
    if (hits.length) rows.push({ file: f, hits });
  }
  return rows;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return null;
  try {
    const j = JSON.parse(readFileSync(BASELINE, "utf8"));
    if (!j || typeof j.files !== "object") toolBroken("基线结构不对（缺 files）");
    return j;
  } catch (e) {
    toolBroken(`基线读不出 / 不是合法 JSON（${e.message}）`, "合并冲突残留？重跑 --update 或从 canonical 取回。");
  }
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);

  // 金丝雀先跑，任何模式都跑
  const cf = runCanaries();
  if (cf.length) {
    console.error("⛔ 门自己瞎了 —— 金丝雀不中，**不许**据此报「屏上没有开发话」：");
    cf.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }

  const files = listFiles();
  if (files.length < MIN_FILES) {
    console.error(`⛔ 门自己瞎了：扫描面只枚举到 ${files.length} 个文件（下界 ${MIN_FILES}）——枚举器坏了，不是文件没了。`);
    process.exit(2);
  }

  if (has("--selftest")) {
    const bite = CANARIES.filter((c) => /必咬/.test(c.name)).length;
    console.log(`✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必咬 ${bite} + 必不咬 ${CANARIES.length - bite}）`);
    console.log(`✅ 扫描面 ${files.length} 个文件（下界 ${MIN_FILES}）`);
    console.log("   金丝雀命中证据（报否定结论时必须一同给出）：");
    analyze(CANARIES[0].src, "c.tsx").forEach((h) => console.log(`     · "${h.match}" ← ${h.why}`));
    process.exit(0);
  }

  const rows = scanAll();
  const total = rows.reduce((a, r) => a + r.hits.length, 0);

  if (has("--list")) {
    for (const r of rows) {
      console.log(`\n# ${r.file}（${r.hits.length}）`);
      r.hits.forEach((h) => console.log(`  L${h.line}\t${h.match}\t← ${h.why}\n     "${h.text}"`));
    }
    console.log(`\n合计 ${total} 条 / ${rows.length} 个文件`);
    process.exit(0);
  }

  if (has("--update")) {
    const out = { note: `${SPEC} §3.3「开发的话不许上屏」棘轮。只数**会渲染出去的字**（JSX 文本 + 文案型属性字面量），注释/变量名/testid 不算。`, spec: SPEC, gate: "scripts/check-dev-jargon-onscreen.mjs", total, files: Object.fromEntries(rows.map((r) => [r.file, r.hits.length])) };
    writeFileSync(BASELINE, JSON.stringify(out, null, 1) + "\n");
    console.log(`✅ 基线已写：${rows.length} 个文件 / ${total} 条 → ${relative(ROOT, BASELINE)}`);
    process.exit(0);
  }

  const base = loadBaseline();
  if (!base) {
    console.error(`⛔ 基线缺失 ${relative(ROOT, BASELINE)} —— 先跑 --update`);
    process.exit(2);
  }

  const fails = [];
  for (const r of rows) {
    const b = base.files[r.file] ?? 0;
    if (r.hits.length > b) {
      fails.push(
        `${r.file} 屏上开发话 ${b} → ${r.hits.length}：` +
          r.hits.slice(0, 3).map((h) => `L${h.line} "${h.match}"（${h.why}）`).join(" · ")
      );
    }
  }

  if (fails.length) {
    console.error(`❌ dev-jargon:check 未通过（${fails.length} 条）\n`);
    fails.forEach((f) => console.error("  · " + f));
    console.error(`\n判据（${SPEC} §3.3）：**这句话用户读了能做什么决定？** 答不出 ⇒ 它不该在屏上（移进代码注释）。`);
    process.exit(1);
  }

  console.log(`✅ dev-jargon:check 通过 —— ${files.length} 个页面文件，屏上开发话未新增`);
  console.log(`   存量 ${total} 条 / ${rows.length} 个文件（棘轮基线 ${base.total}）`);
  console.log("   ⚠ 诚实边界（不许读成「屏上已干净」）：① 经 `locales/` 等变量**间接**上屏的测不出来（本门不跨文件解析）；");
  console.log("     ② 词表有限，只咬已列举的几类形态。金丝雀 6/6 全中 ⇒ 检测逻辑活着。");
  process.exit(0);
}

try {
  main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 3).join("\n   "));
}
