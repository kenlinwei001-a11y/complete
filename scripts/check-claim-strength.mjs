#!/usr/bin/env node
/**
 * 门 `claim-strength:check` · **屏上的强承诺词必须有东西撑着**（WO-OPTIMAL-WORDING ④）
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * 仓主裁决（改名 WO-IA-E2E5E6 的判词）：**「最优」不是审美问题，是诚实问题——
 * 屏上写「最优」，用户读成「保证这是最好的方案」。除非求解器真给最优性保证，否则不许写。**
 *
 * 本仓求解器的真实现状（WO-OPTIMAL-WORDING ① 取证，详见交单报告）：
 *   · docker 态：portfolio / cross_object_occupancy / OPT_FAMILIES 五模型走
 *     `services/optimizer`（CP-SAT），`optimal:true ⟺ cp_model.OPTIMAL`（未设挂钟时限，
 *     server.py `_new_solver`）——**可证最优**，说「最优」有撑。
 *   · 内存态（本机部署默认，无 OPTIMIZER_BASE_URL）：`InProcOptimizerClient` 只对
 *     portfolio / cross_object_occupancy 做**确定性贪心兜底**，恒返 `FEASIBLE / optimal:false`
 *     （inproc-optimizer.ts「诚实红线」）——**启发式，无最优性保证**，说「最优」即谎话。
 *  ⇒ 同一个屏，两种部署，承诺强度不同 ⇒ **静态大字一律不许写死强承诺词**；
 *    允许的只有两类：① 跟着求解器自述字段（`optimal`）走的动态标注；
 *    ② 在本门登记册里**显式登记依据**的字面量（`scripts/claim-strength-registry.json`）。
 *
 * ══ 判据 ═══════════════════════════════════════════════════════════════════════
 * 扫描面内每个**会渲染出去的字面量**（与 `check-dev-jargon-onscreen.mjs` 同一套
 * JSX 位置判据：JSX 文本节点 / 文案型属性 / JSX 表达式容器里的字面量与模板片段；
 * 外加两份「词表型 .ts」——`sandboxModes.ts` 与 `locales/zh.ts`——的全部字符串字面量），
 * 命中强承诺词（最优 / 最划算 / 最佳 / 最好的 / 保证）时，**必须在登记册里找到同文件、
 * 同片段的登记**，且登记必须带：
 *   · `backedBy`：撑着它的东西（人话，≥20 字——「有 CP-SAT 撑着」不算，怎么撑的才算）；
 *   · `solverField`（可选）：若声明依据是求解器侧字段（如 `optimal`），本门**机械验证**
 *     该字段真实存在于 `apps/datacore/src/solvers/optimizer-client.ts` —— 凭空写个字段名骗不过去。
 * 反向也咬：登记了而屏上已没有该串（漂移死账）⇒ 红。登记册不是免检白名单，是**对账表**。
 *
 * ══ ⚠ 本门最容易做成废物的地方（与 dev-jargon 门同源）═══════════════════════════
 * ① **把注释也数进去** —— 源码注释里「最优」遍地都是（求解器语义讨论本来就该写），
 *    全算进去噪声必淹掉真违规，门当天被关。故只取 JSX 渲染位 + 词表文件字面量。
 * ② **大字承诺 + 小字免责** —— WO 明令禁止（「把承诺留在大字上、把撤回藏在小字里，
 *    比直接说错更坏」）。故豁免**不看**同串里有没有免责声明，只看登记依据是否成立。
 * ③ **否定句与释义句**（「不是引擎保证」「『可证最优』= 已从数学上证明…」）也会被词表咬到
 *    —— 它们不是承诺，但**照样要登记**（verdict 标 not-a-claim / negation / glossary），
 *    让「为什么这句可以留」留在机器可查的地方，而不是下个 dev 再猜一次。
 *
 * ══ 诚实边界（做不到什么，报「0 违规」时必须连同一起报）════════════════════════
 *  · **经变量间接上屏的看不见**：`const s = "全局最优"; <div>{s}</div>` —— 字面量不在
 *    JSX 渲染位，本门不咬（与 dev-jargon 门同一盲区，金丝雀「必不咬-3」钉死此边界）。
 *  · **mock 数值口径不查**（WO 边界）：mock 返 `optimal:true` 时屏上「可证最优」照常显示，
 *    那是 mock 的口径问题，不是本门的扫描对象。
 *  · 扫描面只覆盖推演相关页面（views/sim/** + OptimizeWhatifView + DecisionPlayPanel +
 *    sandboxModes.ts + locales/zh.ts）——别的页面写「最优」本门看不见。
 *
 * ══ 金丝雀 + 变异反证 ═══════════════════════════════════════════════════════════
 * 金丝雀与主逻辑**共用同一份 analyze()/judge()**（抄一份 = 装饰品，本仓 2026-08-08 实测）。
 * 变异反证（M1–M5）直接喂 judge() 合成的命中/登记，证明三条红路径（未登记命中 /
 * 登记无依据 / solverField 不存在 / 死账）与绿路径都真存在 —— 门不是永远绿的摆设。
 * 任一金丝雀/变异不中 ⇒ RC=2「工具坏了」，**不许**报「屏上干净」。
 *
 * ══ 退出码 ════════════════════════════════════════════════════════════════════
 *   0 = 干净（屏上强承诺词全部有登记且依据成立）
 *   1 = 真违规（未登记命中 / 登记无依据 / solverField 不存在 / 死账漂移）
 *   2 = **工具自己坏了**（缺依赖 / 扫描面塌了 / 金丝雀不中 / 登记册读不出）
 *
 * 用法：
 *   node scripts/check-claim-strength.mjs            # 门
 *   node scripts/check-claim-strength.mjs --selftest # 只跑金丝雀 + 变异反证
 *   node scripts/check-claim-strength.mjs --list     # 逐条列出屏上命中与登记匹配情况
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const REGISTRY = join(ROOT, "scripts/claim-strength-registry.json");
const SOLVER_CLIENT = join(ROOT, "apps/datacore/src/solvers/optimizer-client.ts");

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「屏上没有强承诺词 / 承诺都有撑」——");
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

/** 强承诺词表 —— 逐条对 WO 原文：「最优 / 最划算 / 最好 / 保证」这类强承诺词。 */
const CLAIM_WORDS = ["最优", "最划算", "最佳", "最好的", "最好方案", "保证"];

/** 文案型属性（与 dev-jargon 门同一张表）。 */
const TEXT_ATTR = /^(label|title|heading|caption|placeholder|text|desc|description|hint|summary|subtitle|tip|topic|aria-label)$/;

/**
 * **主判据本体① · analyze** —— 门 / --list / 金丝雀三者共用这一份。
 * @returns {{text:string,word:string,line:number}[]} 屏上命中（file 由调用方补）
 */
export function analyze(src, fileName = "x.tsx") {
  const isTsx = fileName.endsWith(".tsx");
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const check = (raw, line) => {
    const s = String(raw).replace(/\s+/g, " ").trim();
    if (!s) return;
    for (const w of CLAIM_WORDS) {
      if (s.includes(w)) {
        hits.push({ text: s, word: w, line }); // 全文进判据（登记匹配用）；截断只在打印时做
        break;
      }
    }
  };

  const visit = (node) => {
    if (isTsx) {
      // ① JSX 文本节点 —— 真正印在屏上的字
      if (ts.isJsxText(node)) check(node.text, lineOf(node));
      // ② 文案型属性上的字面量 / 模板片段
      if (ts.isJsxAttribute(node) && node.name && node.initializer) {
        if (TEXT_ATTR.test(node.name.getText())) {
          if (ts.isStringLiteral(node.initializer)) check(node.initializer.text, lineOf(node));
          else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
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
      // ③ JSX 表达式容器里的字面量：`<div>{"文字"}</div>` / `{cond ? "甲" : "乙"}` / 模板
      //    （属性 initializer 已由 ② 走过，跳过避免双计）
      if (ts.isJsxExpression(node) && node.expression && !(node.parent && ts.isJsxAttribute(node.parent))) {
        const walk = (n) => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) check(n.text, lineOf(node));
          else if (ts.isTemplateExpression(n)) {
            check(n.head.text, lineOf(node));
            n.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(node)));
          }
          ts.forEachChild(n, walk);
        };
        walk(node.expression);
      }
    } else {
      // 词表型 .ts（sandboxModes.ts / locales/zh.ts）：全部字符串字面量都是候选屏上文案。
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node.text, lineOf(node));
      else if (ts.isTemplateExpression(node)) {
        check(node.head.text, lineOf(node));
        node.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(node)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * **主判据本体② · judge** —— 命中 × 登记册对账。纯函数，变异反证直接喂它合成输入。
 * @param hits   analyze() 的命中（已补 file）
 * @param entries 登记册条数组
 * @param solverSrc optimizer-client.ts 源码（solverField 机械验证用）
 * @returns {{violations:string[], matched:Map}}
 */
export function judge(hits, entries, solverSrc) {
  const violations = [];
  const matched = new Map(); // entry index -> 命中数
  const usedEntries = new Set();

  const entryInvalid = (e, idx) => {
    if (!e || typeof e !== "object") return `登记册第 ${idx + 1} 条不是对象`;
    if (!e.file || !e.textIncludes) return `登记册第 ${idx + 1} 条缺 file/textIncludes`;
    if (!e.backedBy || String(e.backedBy).trim().length < 20)
      return `登记「${e.file} :: ${e.textIncludes}」无依据（backedBy 不足 20 字）——「有撑」不算依据，怎么撑的才算`;
    if (e.solverField && !solverSrc.includes(e.solverField))
      return `登记「${e.file} :: ${e.textIncludes}」声称依据求解器字段 \`${e.solverField}\`，但 optimizer-client.ts 里**不存在**这个字段——凭空写个字段名骗不过去`;
    return null;
  };

  entries.forEach((e, idx) => {
    const bad = entryInvalid(e, idx);
    if (bad) violations.push(bad);
  });

  for (const h of hits) {
    const shown = h.text.length > 120 ? `${h.text.slice(0, 120)}…` : h.text;
    const idx = entries.findIndex(
      (e, i) => !entryInvalid(e, i) && e.file === h.file && h.text.includes(e.textIncludes),
    );
    if (idx === -1) {
      violations.push(
        `屏上强承诺词无登记：${h.file}:${h.line} 「${shown}」（命中词「${h.word}」）——` +
          `要么改成「优选」系说法，要么在 scripts/claim-strength-registry.json 登记它**被什么撑着**`,
      );
    } else {
      matched.set(idx, (matched.get(idx) ?? 0) + 1);
      usedEntries.add(idx);
    }
  }

  entries.forEach((e, idx) => {
    if (entryInvalid(e, idx)) return;
    if (!usedEntries.has(idx))
      violations.push(
        `登记册死账：「${e.file} :: ${e.textIncludes}」屏上已无此串——删掉这条登记（登记册是对账表，不是免检白名单）`,
      );
  });

  return { violations, matched };
}

/* ── 金丝雀 + 变异反证：与主逻辑共用同一份 analyze()/judge() ────────────────── */
const SELFTESTS = [
  // ── 金丝雀·必咬（analyze 的牙）──
  {
    name: "必咬-1 JSX 文本里的「全局最优」（本单修的 h2 原文形态）",
    kind: "analyze",
    src: `export const V = () => <h2>接单组合优选 · 决策驾驶舱（全局最优在先）</h2>;`,
    file: "x.tsx",
    expect: (h) => h.some((x) => x.word === "最优"),
  },
  {
    name: "必咬-2 title 属性里的「最划算」",
    kind: "analyze",
    src: `export const V = () => <span title="一次算出全局最划算的方案">配置</span>;`,
    file: "x.tsx",
    expect: (h) => h.some((x) => x.word === "最划算"),
  },
  {
    name: "必咬-3 JSX 表达式三元里的字面量（动态标注也照咬，靠登记豁免）",
    kind: "analyze",
    src: `export const V = ({ d }) => <span>{d.optimal ? "✓ 可证最优" : "可行"}</span>;`,
    file: "x.tsx",
    expect: (h) => h.some((x) => x.word === "最优"),
  },
  {
    name: "必咬-4 词表型 .ts（zh.ts 形态）里的「保证」",
    kind: "analyze",
    src: `export const zh = { sim: { note: "引擎保证同输入同输出" } };`,
    file: "zh.ts",
    expect: (h) => h.some((x) => x.word === "保证"),
  },
  // ── 金丝雀·必不咬（本门的活路 + 声明过的盲区）──
  {
    name: "必不咬-1 注释 / 变量名 / testid 里的强承诺词不算违规（注释是写给开发的）",
    kind: "analyze",
    src: `/** 全局最优组合推演 */
      const OPTIMAL_LABEL = "x"; // 求最优
      export const V = () => <div data-testid="全局最优" className="最优">正常文案</div>;`,
    file: "x.tsx",
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-2 「优选 / 更划算 / 逐层锁定」不咬（仓主钦定的替代说法）",
    kind: "analyze",
    src: `export const V = () => <div title="按所选目标比较出更划算的组合">接单组合优选 · 全局优选在先</div>;`,
    file: "x.tsx",
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-3 经变量间接上屏的字面量本门看不见（**声明过的盲区**，不是疏漏）",
    kind: "analyze",
    src: `const s = "全局最优"; export const V = () => <div>{s}</div>;`,
    file: "x.tsx",
    expect: (h) => h.length === 0,
  },
  // ── 变异反证（judge 的红路径与绿路径都真存在）──
  {
    name: "变异-M1 真违规：命中无登记 ⇒ judge 必须报违规（证明门不是永远绿）",
    kind: "judge",
    hits: [{ file: "a.tsx", text: "一次算出全局最优", word: "最优", line: 1 }],
    entries: [],
    solverSrc: "optimal",
    expectViolations: (v) => v.some((s) => s.includes("无登记")),
  },
  {
    name: "变异-M2 登记无依据（backedBy 只有四个字「有撑」）⇒ 必须报违规",
    kind: "judge",
    hits: [{ file: "a.tsx", text: "一次算出全局最优", word: "最优", line: 1 }],
    entries: [{ file: "a.tsx", textIncludes: "全局最优", backedBy: "有撑" }],
    solverSrc: "optimal",
    expectViolations: (v) => v.some((s) => s.includes("无依据")),
  },
  {
    name: "变异-M3 登记声称的 solverField 在 optimizer-client.ts 不存在 ⇒ 必须报违规",
    kind: "judge",
    hits: [{ file: "a.tsx", text: "✓ 可证最优", word: "最优", line: 1 }],
    entries: [{ file: "a.tsx", textIncludes: "可证最优", backedBy: "跟着求解器自述字段走：字段必须真实存在于 optimizer-client.ts", solverField: "nonexistent_field_xyz" }],
    solverSrc: "export interface R { optimal: boolean }",
    expectViolations: (v) => v.some((s) => s.includes("nonexistent_field_xyz")),
  },
  {
    name: "变异-M4 死账：登记了屏上没有的串 ⇒ 必须报违规（登记册不是免检白名单）",
    kind: "judge",
    hits: [],
    entries: [{ file: "a.tsx", textIncludes: "全局最优", backedBy: "这条登记对应的串已被改掉了，理应变红——死账不许留" }],
    solverSrc: "",
    expectViolations: (v) => v.some((s) => s.includes("死账")),
  },
  {
    name: "变异-M5 全对：命中 + 合法登记（solverField 真存在）⇒ 零违规（绿路径真存在）",
    kind: "judge",
    hits: [{ file: "a.tsx", text: "✓ 可证最优", word: "最优", line: 1 }],
    entries: [{ file: "a.tsx", textIncludes: "可证最优", backedBy: "跟着求解器自述字段 optimal 走，仅证到 OPTIMAL 时显示", solverField: "optimal" }],
    solverSrc: "export interface R { optimal: boolean }",
    expectViolations: (v) => v.length === 0,
  },
];

function runSelftests() {
  const fails = [];
  for (const c of SELFTESTS) {
    try {
      if (c.kind === "analyze") {
        const h = analyze(c.src, c.file);
        if (!c.expect(h)) fails.push(`${c.name} —— 实测命中 ${h.length} 条：${h.map((x) => `${x.word}@${x.line}`).join(" / ") || "（无）"}`);
      } else {
        const { violations } = judge(c.hits, c.entries, c.solverSrc);
        if (!c.expectViolations(violations)) fails.push(`${c.name} —— 实测违规 ${violations.length} 条：${violations.join(" | ") || "（无）"}`);
      }
    } catch (e) {
      fails.push(`${c.name} —— 抛异常：${e.message}`);
    }
  }
  return fails;
}

/* ── 扫描面（推演相关页面 · 逐层枚举不用 pathspec 通配）────────────────────── */
const SCAN_TSX_DIRS = ["apps/frontend-shell/src/views/sim"];
const SCAN_TSX_FILES = [
  "apps/frontend-shell/src/views/OptimizeWhatifView.tsx",
  "apps/frontend-shell/src/views/DecisionPlayPanel.tsx",
];
const SCAN_TS_COPY = [
  "apps/frontend-shell/src/views/sim/sandboxModes.ts", // 沙盘五模式名（屏上 tab）
  "apps/frontend-shell/src/locales/zh.ts", // i18n 词表——屏上的串可能经它间接下发（WO ③ 点名）
];
const MIN_FILES = 25; // 扫描面塌了（<此数）= 工具坏了，不许报「干净」

function listScanFiles() {
  const out = [...SCAN_TSX_FILES, ...SCAN_TS_COPY];
  for (const d of SCAN_TSX_DIRS) {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) toolBroken(`扫描面目录不存在：${d}`);
    for (const e of readdirSync(abs)) {
      if (e.endsWith(".tsx") && statSync(join(abs, e)).isFile()) out.push(`${d}/${e}`);
    }
  }
  return out.sort();
}

function scanAll() {
  const files = listScanFiles();
  if (files.length < MIN_FILES)
    toolBroken(`扫描面塌了：只找到 ${files.length} 个文件（阈值 ${MIN_FILES}）`, "检查是否在仓库根目录运行、扫描面配置是否被改坏。");
  const hits = [];
  for (const f of files) {
    let src;
    try {
      src = readFileSync(join(ROOT, f), "utf8");
    } catch {
      toolBroken(`读不到扫描面文件：${f}`);
    }
    for (const h of analyze(src, f)) hits.push({ ...h, file: f });
  }
  return { files, hits };
}

function loadRegistry() {
  if (!existsSync(REGISTRY)) toolBroken("登记册不存在：scripts/claim-strength-registry.json", "新建登记册（可先在交单报告里登记依据）。");
  let doc;
  try {
    doc = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    toolBroken(`登记册不是合法 JSON：${e.message}`);
  }
  if (!doc || !Array.isArray(doc.allowed)) toolBroken("登记册缺 `allowed` 数组字段");
  return doc.allowed;
}

function loadSolverSrc() {
  if (!existsSync(SOLVER_CLIENT)) toolBroken("求解器客户端不存在：apps/datacore/src/solvers/optimizer-client.ts");
  try {
    return readFileSync(SOLVER_CLIENT, "utf8");
  } catch {
    toolBroken("读不到 optimizer-client.ts");
  }
}

function main() {
  const args = process.argv.slice(2);

  // 金丝雀 + 变异反证：先于一切扫描；不中 ⇒ 工具坏了（RC=2），不许报「干净」。
  const selfFails = runSelftests();
  if (args.includes("--selftest")) {
    if (selfFails.length) {
      console.error(`⛔ 金丝雀/变异反证 ${selfFails.length} 条不中：`);
      selfFails.forEach((f) => console.error(`   · ${f}`));
      process.exit(2);
    }
    console.log(`✅ 金丝雀 + 变异反证全中（${SELFTESTS.length} 条：analyze 必咬 4 · 必不咬 3 · judge 变异 5）`);
    process.exit(0);
  }
  if (selfFails.length)
    toolBroken(`金丝雀/变异反证 ${selfFails.length} 条不中（--selftest 可查原文）`, "门自己瞎了 ⇒ 任何「屏上干净」的结论都不许下。");

  const entries = loadRegistry();
  const solverSrc = loadSolverSrc();
  const { files, hits } = scanAll();
  const { violations } = judge(hits, entries, solverSrc);

  if (args.includes("--list")) {
    console.log(`扫描面 ${files.length} 个文件 · 屏上强承诺词命中 ${hits.length} 条：`);
    for (const h of hits) {
      const ok = entries.some((e) => e.file === h.file && h.text.includes(e.textIncludes));
      const shown = h.text.length > 110 ? `${h.text.slice(0, 110)}…` : h.text;
      console.log(`  ${ok ? "✓" : "✗"} ${h.file}:${h.line} [${h.word}] ${shown}`);
    }
  }

  if (violations.length) {
    console.error(`⛔ claim-strength:check 真违规 ${violations.length} 条（扫描面 ${files.length} 文件 · 命中 ${hits.length} 条）：`);
    violations.forEach((v) => console.error(`   · ${v}`));
    console.error("   依据口径：docker 态 CP-SAT 可证最优有撑；内存态 InProc 贪心恒 optimal:false 无撑 ⇒");
    console.error("   静态大字不许写死强承诺词；动态标注跟求解器自述字段（optimal）走；其余一律登记依据。");
    return 1;
  }
  console.log(`✅ claim-strength:check 干净 —— 扫描面 ${files.length} 文件 · 屏上强承诺词 ${hits.length} 条全部有登记且依据成立。`);
  console.log("   诚实边界：经变量间接上屏的字面量本门看不见（金丝雀必不咬-3 钉死）；mock 数值口径不查；扫描面外的页面不查。");
  return 0;
}

/* 退出码纪律（check-gate-exit-discipline.mjs 只认此形态）：顶层 try 是 Program 直接子语句，
 * catch 通向 toolBroken() ⇒ RC=2；RC=1 只由 main() 主判据明确判负产生。 */
let rc;
try {
  rc = main();
} catch (e) {
  toolBroken(`未预期异常：${e?.message ?? e}`);
}
process.exit(rc);
