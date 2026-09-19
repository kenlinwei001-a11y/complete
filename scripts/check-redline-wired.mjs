#!/usr/bin/env node
/**
 * 门 `redline-wired:check` · **红线闸必须真的守在生产路径上**（欠账 #134）
 *
 * ⛔ 存在理由 = 一次真实的假绿（不是预防性洁癖）
 * ─────────────────────────────────────────────────────────────────────────────
 * `apps/datacore/src/databuilder/provisional-honesty.ts:12 (checkProvisionalHonesty)`
 * 是 A18 的**诚实红线闸**：守「PROVISIONAL 未审核域绝不谎报」（R13）——
 * ① 整域 `domainTrustLevel=UNVERIFIED` ② 终态恒 `PROVISIONAL_ANSWER`（绝不 VERIFIED/answerable）
 * ③ 闭包缺口全降 ADVISORY、不 blocked。本体 §7 白纸黑字把它登记成一道**门**。
 *
 * 而 2026-08-10 实测：它的调用方集合是 **test 5 处 · 生产 0 处 · 门脚本 0 处**。
 * ⇒ **没有任何生产路径在执行它**，这道「红线闸」当天拦不住任何东西。
 * 测试证明的是「这个函数能识别谎报」，**不是**「系统不会谎报」——
 * 咬的是**函数**，不是**链路**（假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同族）。
 *
 * ── 为什么现存的门一个都抓不到它（这才是**门自己的盲区**）────────────────────
 * `check-gate-ledger.mjs` 与 `check-ontology-writeback.mjs` G3 都从 **`scripts/check-*.mjs`
 * 文件名**这一种形状出发扫 §7（`RE_CHECK = /check-[a-z0-9-]+\.mjs/g`）。
 * 但 §7 登记的「门」实际有**三种**形状：
 *   ① `scripts/check-*.mjs` 脚本门 ← 现存两道门只认这一种
 *   ② `pnpm <alias>` 声称的入口   ← **一条都没被治理过**（实测 42 条声称里 14 条 package.json 根本没有）
 *   ③ test-backed 纯函数闸        ← **一条都没被治理过**（本门治的就是它）
 * ②③ 整整两类逃逸。形态照铁律 0.6 的句式：
 * **「我用『§7 里出现的 check-*.mjs 文件名』当作『§7 登记的门集合』的证据，而前者并不度量后者。」**
 *
 * ── 两条判据 ────────────────────────────────────────────────────────────────
 *   W1 · 红线闸有生产调用方
 *        注册表**从本体 §7 现解**（门自己不手抄一份符号清单）：§7 里自述 `test-backed` 的条目中
 *        被反引号点名、且在 `apps|packages` 的 `src` 下**真是导出符号**的 camelCase 名。
 *        断言：每个这样的符号在**生产面**至少有 1 处引用（排除其定义文件、排除 `test/`）。
 *   W2 · §7 声称的 `pnpm` 入口属实
 *        §7 里以 `` `pnpm X` `` 给出的执行入口，`package.json` 的 `scripts` 必须真有键 `X`。
 *        存量记**棘轮基线**（只降不升）——今天 14 条是历史欠账，本门先封死增量。
 *
 * ── 追一层：本门怎么避免把「间接调用」误报成「零调用方」（铁律 0.5）────────────
 * `grep` 一次看不见的五条间接路，本门**逐条覆盖**（金丝雀里有对应样例，见 §3）：
 *   · import 别名   `import { checkX as chk }` → 仍出现标识符 `checkX`
 *   · re-export     `export { checkX } from "./x.js"` → 同上
 *   · 命名空间导入  `import * as H …; H.checkX()` → 属性名标识符就是 `checkX`
 *   · 值传递 / DI   `deps.guard = checkX` → 同上
 *   · 门脚本动态 import **dist 产物**  `(await import(".../dist/x.js")).checkX` → 同上
 *     （这条是本仓真实存在的第三条消费路，`mcp/mock.ts` 就是靠它活着的）
 * 判据刻意**偏向不红**（fail-open）：只有「整个生产面一处都不出现」才报。
 * 一道红线门误报的代价，比漏报一次更贵——误报会逼出豁免名单，豁免名单一开口就把门蛀空。
 *
 * ── 门自己不许瞎（`G-GATE-PARSER-TRUNCATED-VIEW` 同族）─────────────────────────
 *  ① 扫描面下限：`src` 语料文件数 ≥ MIN_SRC_FILES，§7 正文非空 —— 扫空即红，不许在空视野里报「干净」。
 *  ② **引用提取走 TypeScript 官方 AST**（标识符 + 字符串字面量），不是裸文本匹配 ——
 *     否则注释里提一嘴那个符号名就被算作「已接线」，门当场变成橡皮图章。
 *  ③ **金丝雀每次运行都跑，且与主逻辑共用同一份 `countProductionRefs`**（不许各抄一份正则：
 *     抄了就是装饰品，改主逻辑时金丝雀拿旧的去测、照样绿）。
 *     6 段必须**数得出**（直调/别名/re-export/命名空间/值传递/dist 动态 import）、
 *     3 段必须**数不出**（只在定义文件里 / 只在 test 里 / 只在注释里）。
 *     任一条对不上 ⇒ 判「**门自己瞎了**」并红，而不是报「代码干净」。
 *  ④ W2 的金丝雀取 `package.json` **现有的第一个键**（不手抄一个键名）+ 一个保证不存在的键，正反对拍。
 *
 * ── 诚实边界（本门抓不到什么，照实写，免得门名再一次承诺过头）──────────────────
 *  ① **注册表只覆盖「§7 自述 test-backed 且点名了符号」的条目**。一道红线闸若既不在 §7 登记、
 *     又不点名符号，本门看不见它。治法是纪律（新建红线闸必须登 §7 并点名），不是再加正则。
 *  ② **只判「有没有生产引用」，不判「引用在不在正确的位置」**。把 `checkX` 写在一个永不执行的
 *     分支里，本门照样绿。那属「接了线接错地方」，需要接缝测试而非静态门（CLAUDE.md 三形态第 3 种）。
 *  ③ **W2 只查键存在，不查键指向的脚本真能跑**。脚本存在性由 `gate-ledger:check` ② 覆盖。
 *  ④ 提取器只认 `export function|const|class <name>` 形状的定义。`export default` / 解构导出
 *     形状的符号解析不到定义 ⇒ 被当作「散文」跳过（fail-open，不是漏判：跳过 = 不进注册表）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-GATE-ENTRYPOINT-PHANTOM`（本门所闭断点）。
 * 用法：node scripts/check-redline-wired.mjs   ·   pnpm redline-wired:check
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
  console.error(`⛔ check-redline-wired.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONTO_REL = "docs/SYSTEM-ONTOLOGY.md";
const BASELINE_REL = "scripts/redline-wired-baseline.json";

/** `src` 语料文件数下限：walker 断了会掉到 0，那时门会「在空视野里报一致」。 */
const MIN_SRC_FILES = 300;

const errs = [];
const blind = []; // 「门自己瞎了」类，与业务违规分开报——修法完全不同

/* ═══════════════ 0 · 取 TS AST（fail-closed，不静默降级成裸文本匹配） ═══════════════ */
let ts;
try {
  ts = (await import("typescript")).default;
} catch (e) {
  console.error(
    "❌ redline-wired: 载入 typescript 失败 —— 本门用官方 AST 取标识符（否则注释里提一嘴符号名" +
      "就被算作「已接线」，门当场变橡皮图章）。装不上就红，不静默降级。\n  " +
      String(e && e.message ? e.message : e),
  );
  process.exit(1);
}

/* ═══════════════ 1 · 语料 ═══════════════ */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage", "__snapshots__", "worktrees"]);
function walk(dir, acc) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mts|cts|mjs|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 生产面 = 两个 app/包的 `src` + 门脚本目录（门脚本经 `dist/` 动态 import 消费源码，见文件头）。 */
const PROD_ROOTS = [
  "apps/datacore/src",
  "apps/agentcore/src",
  "apps/frontend-shell/src",
  "packages/contracts/src",
  "packages/llm-adapters/src",
  "scripts",
];
const corpus = new Map(); // relPath -> code
for (const r of PROD_ROOTS) {
  const abs = join(ROOT, r);
  if (!existsSync(abs)) continue;
  for (const f of walk(abs, [])) {
    corpus.set(relative(ROOT, f).split("\\").join("/"), readFileSync(f, "utf8"));
  }
}
// `package.json` 也算生产面（`node dist/xxx-cli.js` 这条消费路只在这里出现）。
corpus.set("package.json", readFileSync(join(ROOT, "package.json"), "utf8"));

if (corpus.size < MIN_SRC_FILES) {
  blind.push(`生产面只扫到 ${corpus.size} 个文件（下限 ${MIN_SRC_FILES}）—— walker 断了，不是「仓库真的这么小」`);
}

/* ═══════════════ 2 · 引用计数（主逻辑与金丝雀共用这一份） ═══════════════ */
/**
 * 取一份源码里所有**标识符**与**字符串字面量**的文本（不含注释 —— AST 里根本没有注释节点）。
 * 字符串字面量也收，是为了覆盖 `mod["checkX"]` 与 `await import(".../provisional-honesty.js")` 这类
 * 「名字藏在字符串里」的间接消费路（本仓真实存在，见文件头「追一层」）。
 */
function tokensOf(code, hint) {
  if (/\.(mjs|js|cjs)$/.test(hint) || hint === "package.json") {
    // 门脚本/清单里名字常出现在字符串与路径里；用 JS 方言解析，同样走 AST 不走裸文本。
    if (hint === "package.json") {
      // JSON：把值当字符串收（`node scripts/x.mjs` / `dist/x.js` 都在值里）
      const out = new Set();
      for (const m of code.matchAll(/"([^"]*)"/g)) {
        for (const w of m[1].split(/[^A-Za-z0-9_]+/)) if (w) out.add(w);
      }
      return out;
    }
  }
  const sf = ts.createSourceFile(hint, code, ts.ScriptTarget.Latest, false, hint.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) out.add(n.text);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      // 字符串里可能是路径（`../src/databuilder/provisional-honesty.js`）——按非标识符字符切词
      for (const w of n.text.split(/[^A-Za-z0-9_]+/)) if (w) out.add(w);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

const tokenCache = new Map();
function tokensCached(path, code) {
  let t = tokenCache.get(path);
  if (t === undefined) {
    t = tokensOf(code, path);
    tokenCache.set(path, t);
  }
  return t;
}

/** 该路径算不算「生产面」（排除 test / 排除本门自身与其基线）。 */
const isTestPath = (p) => /(^|\/)(test|tests|__tests__)\//.test(p) || /\.(test|spec)\.[tj]sx?$/.test(p);
const isSelf = (p) => p === "scripts/check-redline-wired.mjs" || p === BASELINE_REL;

/**
 * 数一个符号在生产面的引用处（排除定义文件自身、排除 test、排除本门自身）。
 * **主逻辑与金丝雀共用这一份实现**（铁律 0.6：金丝雀不许各抄一份）。
 * @returns {string[]} 命中的文件相对路径
 */
function countProductionRefs(symbol, corpusMap, defFiles) {
  const hits = [];
  for (const [p, code] of corpusMap) {
    if (defFiles.includes(p) || isTestPath(p) || isSelf(p)) continue;
    if (!code.includes(symbol)) continue; // 先粗筛（纯性能，AST 才是判据）
    if (tokensCached(p, code).has(symbol)) hits.push(p);
  }
  return hits;
}

/** 找一个符号的**定义文件**（只认 `export function|const|class <name>` 形状，见诚实边界 ④）。 */
function findDefFiles(symbol, corpusMap) {
  const re = new RegExp(String.raw`export\s+(?:async\s+)?(?:function|const|class)\s+${symbol}\b`);
  return [...corpusMap.entries()].filter(([, c]) => re.test(c)).map(([p]) => p);
}

/* ═══════════════ 3 · 金丝雀：证明引用计数器不是哑的（每次运行都跑） ═══════════════
 *
 * 「零调用方」是**否定结论**——铁律 0.6 明令：报否定结论必须同时给出金丝雀的命中证据。
 * 六条间接路正样例 + 三条必须数不出的负样例，全部喂给**主逻辑那个** `countProductionRefs`。
 */
let refCanaryPos = 0;
let refCanaryNeg = 0;
{
  const SYM = "canaryRedlineGuard";
  const DEF = "apps/x/src/def.ts";
  const cases = [
    { name: "直接调用", want: true, path: "apps/x/src/a.ts", code: `import { ${SYM} } from "./def.js";\nexport const r = () => ${SYM}(1);` },
    { name: "**import 别名**（换个名字 grep 一次就看不见）", want: true, path: "apps/x/src/b.ts", code: `import { ${SYM} as chk } from "./def.js";\nexport const r = () => chk(1);` },
    { name: "**re-export**（本文件不调用，只转出去）", want: true, path: "apps/x/src/c.ts", code: `export { ${SYM} } from "./def.js";` },
    { name: "**命名空间导入**（`H.sym()`，属性名才是符号）", want: true, path: "apps/x/src/d.ts", code: `import * as H from "./def.js";\nexport const r = () => H.${SYM}(1);` },
    { name: "**值传递 / 依赖注入**（从不出现调用括号）", want: true, path: "apps/x/src/e.ts", code: `import { ${SYM} } from "./def.js";\nexport const deps = { guard: ${SYM} };` },
    { name: "**门脚本经 dist 动态 import**（名字藏在字符串/属性里）", want: true, path: "scripts/check-canary.mjs", code: `const m = await import("../apps/x/dist/def.js");\nm["${SYM}"]({});` },
    { name: "负样例：只出现在**定义文件**自身", want: false, path: DEF, code: `export function ${SYM}(n: number) { return n; }` },
    { name: "负样例：只出现在 **test**（已排练 ≠ 已实现）", want: false, path: "apps/x/test/z.test.ts", code: `import { ${SYM} } from "../src/def.js";\n${SYM}(1);` },
    { name: "负样例：只出现在**注释**里（证明不是裸文本匹配）", want: false, path: "apps/x/src/f.ts", code: `// TODO: 以后接 ${SYM}\nexport const r = 1;` },
  ];
  for (const c of cases) {
    const mini = new Map([[DEF, `export function ${SYM}(n: number) { return n; }`], [c.path, c.code]]);
    const got = countProductionRefs(SYM, mini, [DEF]).length > 0;
    if (got !== c.want) {
      blind.push(
        `引用计数金丝雀失败：样例「${c.name}」期望 ${c.want ? "数得出" : "数不出"}，实得 ${got ? "数得出" : "数不出"}` +
          (c.want
            ? " —— **计数器瞎了**：这条间接消费路真实存在，漏掉它就会把「接了线」误报成「零调用方」（铁律 0.5 那四次错的形态）"
            : " —— **误报**：把定义/测试/注释算成生产调用方，等于门恒绿，本门就成了装饰品"),
      );
    }
  }
  refCanaryPos = cases.filter((c) => c.want).length;
  refCanaryNeg = cases.length - refCanaryPos;
}

/* ═══════════════ 4 · 取本体 §7 正文 ═══════════════ */
const ontoFull = readFileSync(join(ROOT, ONTO_REL), "utf8");
const s7m = ontoFull.match(/\n## 7\.[^\n]*\n([\s\S]*?)\n## 8\./);
if (!s7m) {
  console.error(`❌ redline-wired: 定位不到本体 §7 检测/门禁章节（${ONTO_REL} 结构变了？门先红，不静默放过）`);
  process.exit(1);
}
const s7Body = s7m[1];
const s7StartLine = ontoFull.slice(0, ontoFull.indexOf(s7Body)).split("\n").length;
const s7Lines = s7Body.split("\n");
if (s7Body.trim().length === 0) blind.push("本体 §7 正文为空 —— 注册表来源塌了，门会在空视野里报「干净」");

/* ═══════════════ 5 · 判据 W1 · 红线闸必须有生产调用方 ═══════════════ */
const registry = new Map(); // symbol -> 本体行号
s7Lines.forEach((line, i) => {
  if (!/test-backed/.test(line)) return;
  for (const m of line.matchAll(/`([A-Za-z_][A-Za-z0-9_]{4,})`/g)) {
    const sym = m[1];
    if (!/^[a-z]/.test(sym)) continue; // 只认 camelCase 函数名（`ClosureReport` 这类类型名不是闸）
    if (!registry.has(sym)) registry.set(sym, s7StartLine + i);
  }
});

let w1Checked = 0;
const w1Wired = [];
for (const [sym, ontoLine] of registry) {
  const defs = findDefFiles(sym, corpus);
  if (defs.length === 0) continue; // 不是 src 里的导出符号 ⇒ 散文，跳过（诚实边界 ④）
  w1Checked += 1;
  const refs = countProductionRefs(sym, corpus, defs);
  if (refs.length === 0) {
    errs.push(
      `${ONTO_REL}:${ontoLine} [W1·红线闸零生产调用方] 本体 §7 把 \`${sym}\` 登记成一道门（test-backed），` +
        `而它在整个生产面**一处引用都没有**（定义在 ${defs.join(", ")}）。` +
        `\n      ⚠ 这不是「测试不够」——测试再多也只咬**函数**，咬不到**链路**：` +
        `今天没有任何生产路径会执行它 ⇒ 这道闸拦不住任何东西（假绿第 9 形态 G-SKILL-REFGRAPH-DEAD-EXTRACTOR 同族）。` +
        `\n      修法二选一，**不许两头都不做**：` +
        `① 真接线 —— 在它该守的那条生产路径上调用它（红线闸应 fail-closed：违规即拒绝落库/发布）；` +
        `② 若它其实不该是门 —— 改 §7 那句成真话（别留一句「已建」让下一个人误以为守住了）。` +
        `\n      金丝雀证据：本次同一计数器在 ${refCanaryPos} 条间接消费路样例上全部数得出（含 import 别名 / re-export / ` +
        `命名空间 / 值传递 / dist 动态 import）⇒ 报「零」的是代码，不是工具。`,
    );
  } else {
    w1Wired.push(`${sym}→${refs.length}处`);
  }
}
if (registry.size > 0 && w1Checked === 0) {
  blind.push(
    `W1 注册表解析出 ${registry.size} 个候选符号，但**一个都解析不到定义** —— ` +
      `极可能是 \`findDefFiles\` 的形状正则或语料塌了（那时门会「无门可查所以全绿」）`,
  );
}

/* ═══════════════ 6 · 判据 W2 · §7 声称的 `pnpm` 入口属实（棘轮） ═══════════════ */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const pkgScripts = pkg.scripts ?? {};
const hasScript = (alias) => Object.prototype.hasOwnProperty.call(pkgScripts, alias);

// W2 金丝雀：现取一个真键 + 一个保证不存在的键，正反对拍（不手抄键名）。
{
  const realKey = Object.keys(pkgScripts)[0];
  if (realKey === undefined) blind.push("package.json 没有任何 scripts —— W2 的判据来源塌了");
  else {
    if (!hasScript(realKey)) blind.push(`W2 金丝雀失败：package.json 现有的键 "${realKey}" 被判成「不存在」—— 查表实现瞎了`);
    if (hasScript("__redline_wired_canary_absent__")) blind.push("W2 金丝雀失败：一个保证不存在的键被判成「存在」—— 查表实现恒真");
  }
}

const phantom = [];
const claimed = new Map(); // alias -> 首次出现的本体行号
s7Lines.forEach((line, i) => {
  for (const m of line.matchAll(/`pnpm ([a-z0-9:_-]+)`/g)) {
    if (!claimed.has(m[1])) claimed.set(m[1], s7StartLine + i);
  }
});
for (const [alias, ontoLine] of claimed) {
  if (!hasScript(alias)) phantom.push({ alias, ontoLine });
}

let baselineCount = null;
const baselineAbs = join(ROOT, BASELINE_REL);
if (existsSync(baselineAbs)) {
  baselineCount = JSON.parse(readFileSync(baselineAbs, "utf8")).phantomEntrypointCount ?? null;
}
if (baselineCount === null) {
  blind.push(`缺 ${BASELINE_REL} 的 phantomEntrypointCount —— W2 是棘轮判据，没有基线就退化成「怎么都算过」`);
} else if (phantom.length > baselineCount) {
  errs.push(
    `[W2·入口属实·棘轮] 本体 §7 里 \`pnpm X\` 形式的执行入口，package.json 查无此键的有 ${phantom.length} 条 > 基线 ${baselineCount} 条。` +
      `\n      新增的是：${phantom.map((p) => `${p.alias}(§7:${p.ontoLine})`).join(" · ")}` +
      `\n      ⚠ 一条查无此键的 \`pnpm X\` = 「制度上宣称存在、实际不可执行」（G-DEAD-GATE-BY-POLICY 的近亲，` +
      `且比它更隐蔽：那类至少还有脚本文件，这类连文件都没有）。` +
      `\n      修法：要么在 package.json 补上该键（脚本已存在时就是一行别名），要么把 §7 那句改成真话。`,
  );
} else if (phantom.length < baselineCount) {
  console.log(`· 棘轮下降：幽灵入口 ${baselineCount} → ${phantom.length}，请同步把 ${BASELINE_REL} 的 phantomEntrypointCount 改成 ${phantom.length}（只降不升）`);
}

/* ═══════════════ 7 · 报告 ═══════════════ */
if (blind.length > 0) {
  console.error("❌ redline-wired:check 失败 —— **门自己瞎了**（不是「被扫代码有问题」，修法完全不同）：");
  for (const e of blind) console.error("  · " + e);
}
if (errs.length > 0) {
  console.error("❌ redline-wired:check 失败：");
  for (const e of errs) console.error("  · " + e);
}
if (blind.length > 0 || errs.length > 0) process.exit(1);

console.log(
  `✅ redline-wired:check 通过（生产面 ${corpus.size} 文件 · ` +
    `W1 红线闸 ${w1Checked}/${registry.size} 个 §7 点名符号解析到定义、全部有生产调用方` +
    (w1Wired.length > 0 ? `：${w1Wired.join(", ")}` : "") +
    ` · W2 §7 声称 ${claimed.size} 个 pnpm 入口 · 幽灵 ${phantom.length}（基线 ${baselineCount}）· ` +
    `引用计数金丝雀 ${refCanaryPos} 正/${refCanaryNeg} 反通过）`,
);
