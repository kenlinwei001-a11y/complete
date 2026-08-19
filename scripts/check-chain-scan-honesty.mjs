#!/usr/bin/env node
/**
 * 门 `chain-scan-honesty:check` · 全链扫描「零写死」门（WO-SANDBOX-A2）
 *
 * 制度出处：`docs/PRD-sandbox-redesign.md` §9 验收 **A2** 与 §10.1 点亮判据 A2 白纸黑字点名本门
 *   > **零写死**：`chain-scan-honesty:check` 绿；随机抽 5 个数字，逐个溯源到求解器输出
 * ——而在本单之前**这道门根本不存在**（`scripts/` 下无此文件）。制度点名、实际不存在的门是本仓已坐实的
 * 病（`boundary-singlesource` 曾红着且零接线 24 个 commit，欠账 #76；假绿第 5 形态 G-DEAD-GATE-BY-POLICY）：
 * **验收判据点名的门不存在 ⇒ 那条验收今天无法机械核**，只能靠人说"我看过了"。
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **屏上/回包里的每个数字，都来自求解器输出或对象库，不是源码里的字面量。**
 * 具体到全链扫描：`chain-impediment.ts` 的文件头自称"本引擎里没有任何业务阈值，一个数字都没有"，
 * 本门把这句**自称**变成**机械可证伪的断言** —— 自称是保质期最短的东西（同族见 `stale-claims:check`）。
 *
 * ══ 五条判据（各抓一种错法，混为一谈会漏）═════════════════════════════════════
 *  ① H1 判据表零数值   `IMPEDIMENT_RULE_BINDINGS` / `UNBOUND_IMPEDIMENT_JUDGEMENTS` 两张声明表内
 *                      **剥注释 + 剥字符串**后不得出现任何数字。阈值/系数/红线只许登记「哪条规则的哪个字段」，
 *                      数值本体必须由 `readRuleThreshold` 从规则读回。表里一旦能存数，
 *                      "引擎没有第二个地方可以存阈值"这条结构性保证当场失效。
 *  ② H2 输出构造位无裸字面量
 *                      两层：**区域层**——`ChainImpedimentSchema.parse({…})` / `thresholdRow = {…}` /
 *                      `caveat ??= {…}` / `unresolved()` 这几个**回包构造区**内不得有 `key: <数字>`
 *                      与含中文的裸字符串；**文件层**——`severity|metricValue|threshold` 三个数值键
 *                      无论在哪被赋数字字面量都红（防有人绕开构造区先算好再塞进去）。
 *  ③ H3 无兜底默认阈值 全扫描面禁止 `?? <数字>` / `|| <数字>`。这是"读不回来就给个看着合理的默认值"
 *                      那条路的入口 —— 判定器一旦有默认阈值，就能在规则缺失时**判出一堆像模像样的阻滞点**，
 *                      而界面完全看不出来（静默错答比跑不通更糟，本仓刚坐实过一次）。
 *  ④ H4 溯源可机械核   回包构造区必须写 `solverKey: CHAIN_IMPEDIMENT_SOLVER_KEY`（**符号引用**，不是内联串）
 *                      且必须同时带 `ruleKey` / `metricValue` / `threshold` / `unit`；再把
 *                      `CHAIN_IMPEDIMENT_SOLVER_KEY` 的字面值**当场读回**去核 `SOLVER_KEYS` 是否真在册
 *                      （事实层，不靠人记性 —— 同 `stale-claims` 的 STALE-3/4 那一层）。
 *                      这条对应 A2 的"逐个溯源到求解器输出"：溯源链的每一环都得在源码里可指认。
 *  ⑤ H5 业务名棘轮     扫描面内出现**行业业务名**（基地名/工序名/产品名）即计一条，棘轮只降不升。
 *                      判据源**自 `BASE_REGISTRY` 机械派生**（改册自动跟随），门自己不写行业词表 ——
 *                      门里写死一张中文词表，本身就是本门要治的病。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════
 * 本门开扫之前先拿**内嵌样例**过一遍检测器（N 条必咬 + M 条必不咬）+ **规则抽取器金丝雀 R1–R7**
 * + 规模下界自证。任一不成立 ⇒ 打印「⛔ 门自己瞎了」并 **RC=2**（不是 1 —— 见下"三分退出码"），
 * **而不是安静报「代码干净」**。理由是本会话实测过的四个陷阱
 * （见 `docs/VERIFY-batch-2026-08-08.md`）：`git grep -- "apps/<星>/src"` 恒 0 命中
 * （⚠️ 病因**不是**「pathspec 通配符不跨 `/`」——那是 2026-08-11 已被实测推翻的错病因，
 *  `*` 确实跨 `/`；真因是**含通配的 pathspec 不当目录前缀用**，须补一段成 `apps/<星>/src/<星>`。
 *  详见 CLAUDE.md 铁律 0.5 判据 #5 的订正段）、
 * import 图解析器不认 ESM `./x.js`、正则窗口截断符号名 —— 三者都会让扫描器
 * **报 0 命中**，而 0 命中在门里恰好长得跟"代码干净"一模一样。失败方向不安全的门必须自证工具是对的。
 *
 * ══ 规则库抽取器（H6/H7/H8 的 oracle · WO-R9-SCAN-EXTRACTOR 重写）══════════════
 * **本门 2026-08-13 之前的抽取器是坏的，而且是"静默给错答"那种坏法。** 原实现一条正则：
 *
 *     /\bkey:\s*"([A-Z]\d+)"[\s\S]{0,400}?\bexpression:\s*(["'`])([\s\S]*?)\2/g
 *
 * 它**只认字符串字面量形态的 expression**，且**不校验 key 与 expression 属于同一个对象字面量** ——
 * 只是"从 key 往后 400 字内找第一个字面量 expression"。`battery.ts` 把阈值收进单一来源
 * （`expression: parityRuleExpression("C05")`）之后，这个正则跟不过那一跳，于是懒量词
 * **跨过对象边界**去咬下一条规则的原文。**一个根因，两种表现，必须一起修**：
 *
 *  ① **错位（静默错答 · 比红更坏）**：`key` 绑到**别人的** expression 上。实测（29 条规则）：
 *       C13 → 绑到 C18 的原文（匹配跨度 452 字，吞掉 C13/C05/C12/C18 四个 key）
 *       C01 → 绑到 C04 的原文（跨度 330 字，吞掉 C01/C02/C04）
 *       C09 → 绑到 C10 的原文 `Action.approver == NULL OR Action.audited == FALSE`（跨度 241 字）
 *     —— 报错里那句"规则原文"印的就是**另一条规则**的原文，读的人会去改一条根本不相干的规则。
 *  ② **吞噬（假的"不在册"）**：`matchAll` **非重叠**，被①跨过去的 key 落在上一次匹配的跨度**内部**
 *     ⇒ 再也不会被匹一次 ⇒ 从 map 里彻底消失。实测 29 条只抽出 21 条，丢了
 *     C03/C08/C05/C12/C18/C02/C04/C10 —— 于是 H6 报"BATTERY_RULES 里没有这条规则"，
 *     而 `grep -oE '"C[0-9]{2}"' battery.ts` 现算它们**全都在**。**真单一来源改良反被门打红。**
 *
 * 现实现两步，把①②在**结构上**变成不可能：
 *  · **按对象边界切分**（`topLevelObjects` + `topLevelProps`）：先把 `BATTERY_RULES = [ … ]` 用
 *    括号配对切成顶层对象，再取该对象**顶层**的 `key` / `expression` / `params`。key 与 expression
 *    从此天然同属一个对象，"跨对象错配"不再有发生的地方（不是"正则写严一点"，是把可能性拿掉）。
 *  · **跟过那一跳**（`makeEvaluator`）：属性的**原始值源码**放进一个以**已 build 的
 *    `@platform/contracts` 导出**为作用域的求值器里求值。于是 `parityRuleExpression("C05")` /
 *    `parityRuleParams("C09")` / `outsourceRedlineViolationExpr(…)` / 模板串 `${ruleParamRef("x")}`
 *    **全部由真值源自己算出真值**。⛔ 门里**一条规则内容都不抄**（抄了就是第二个真值源，
 *    改一处漏一处 —— 那正是本门要治的病）；新加一个 contracts 导出的派生函数，本门自动跟得上。
 *  · 求值不出来的**不许**当"不在册"：那是**工具看不懂**（RC=2），与"规则不存在"（RC=1）处置相反。
 *
 * ══ 诚实边界（本门做不到什么）════════════════════════════════════════════════
 *  · 只做**静态**扫描：它证明"源码里没有写死的数"，**不证明**"跑出来的数是对的"。
 *    A2 后半句"随机抽 5 个数字逐个溯源"的**运行态**那一半由 `apps/datacore/test/chain-scan-honesty.test.ts`
 *    咬（真跑 `detectChainImpediments` 逐字段查 provenance），A5「亲手真跑」仍必须人做。
 *  · 只认字面量形态的写死。`const T = Number("95")` / 从 JSON 读一个写死文件 / 经算术拼出来的常数
 *    一律看不见 —— 门能证伪"有裸字面量"，不能证实"没有写死"。
 *  · H2 区域层靠**锚点**定位构造区（`ChainImpedimentSchema.parse(` 等）。构造方式若被重构成
 *    别的写法，区域数会掉 → 金丝雀下界当场红（这正是下界存在的理由），但不会静默放行。
 *  · H5 只咬 `BASE_REGISTRY` 派生得出的词；册外的行业名（新工序名等）看不见。
 *
 * ══ 三分退出码（WO-R9-SCAN-EXTRACTOR 落地）═══════════════════════════════════
 *   **0** 干净 · **1** 真违规（先修被扫代码）· **2** **门自己坏了 / 环境没就绪**（结论作废）。
 *   归 2 的三类：金丝雀不中（含规则抽取器 R1–R7）· `@platform/contracts` 的 dist 未构建或过期 ·
 *   规则表达式求值不出来（工具看不懂）。**RC=2 时不许打印「不得并线」** —— 本门这次什么都没证明。
 *   变异反证开关：`CHAIN_SCAN_HONESTY_BREAK_CANARY=legacy-regex` 把抽取器换回上面那条坏正则，
 *   金丝雀必须当场报 R1/R5/R7 不中并 **RC=2**（若它反而报 RC=1，说明金丝雀是装饰品）。
 *
 * 本体登记：`docs/SYSTEM-ONTOLOGY.md` §7（门）· §8 `G-GATE-EXTRACTOR-CROSS-OBJECT-MISBIND`。
 * 门账：`scripts/gate-ledger.json`（binding=GATE_SH）。
 * 用法：node scripts/check-chain-scan-honesty.mjs [--selftest | --update | --list]
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
  console.error(`⛔ check-chain-scan-honesty.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
import { contentKey, reconcileContents, buildContentsSegment, conservationCanary } from "./lib/ratchet-conservation.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertDistFresh } from "./dist-freshness.mjs";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/chain-scan-honesty-baseline.json");
/** 规则真值源的**派生函数**所在包（`parityRuleExpression` 等），本门经 dist 调用它们求真值。 */
const CONTRACTS_DIST = "packages/contracts/dist/index.js";

/* ── dist 新鲜度守卫（退 **2**：环境问题，不是被扫代码的问题）────────────────────
 * ⚠️ 2026-08-13 · WO-R9-DISTFRESH-RC2：这里原先挂着一个**作用域内的退出码翻译器**
 * （`process.once("exit", …)` 把守卫的 1 改写成 2，调用返回后立刻 `off`）。**已删。**
 * 原因：那个修法只让**这一道门**说对了话，另外 19 道读 dist 的门照旧吐 1；
 * 而 1 在本仓三分约定里 = 「被扫代码有问题」，于是「没 build」被 22 道门齐声报成「代码违规」。
 * 现在退 2 由**共享实现**负责（`assertDistFresh` → `exitToolNotReady`，见 dist-freshness.mjs），
 * 一次改完、处处生效；本门这里只留一行普通调用，**不许**再叠第二层翻译
 * （两层翻译叠加行为无法推理，且长期存活的 exit 钩子有吞掉主判据 exit(1) 的风险）。 */
assertDistFresh([CONTRACTS_DIST], { gate: "chain-scan-honesty:check" });

/** 规则真值源模块（**唯一**的规则内容出处；本门不抄任何一条规则）。 */
const CONTRACTS = await import(pathToFileURL(join(ROOT, CONTRACTS_DIST)).href);

/** 扫描面 = 全链扫描输出的产出链：判定器本体 + 喂它 metricValue 的读回层 + IO 聚合半。
 * ⚠ 本名册被「名单 vs 现算」一致性断言机器锁死（判据 H9 · WO-GATE-ROSTER-SWEEP-3）：
 *    凡**现算**出的产数处（构造/直出 ChainImpediment 回包的文件）都必须已在册，
 *    漏登记当场 RC=1 点名 file:line —— 名册不再能悄悄落后于现实。 */
const SCAN_TARGETS = [
  { file: "apps/datacore/src/solvers/chain-impediment.ts", role: "判定器本体（回包每个数字的产地）" },
  { file: "packages/contracts/src/process-capacity.ts", role: "硬容量读回层（喂 parallelThroughput）" },
  // 聚合/IO 半：只取 `chainImpediments` 方法体（service.ts 有 4000+ 行，整文件扫会淹没在无关代码里）
  { file: "apps/datacore/src/solvers/service.ts", role: "IO 聚合半", method: "chainImpediments" },
];
/**
 * 「产链路数字的地方」的**现算判据**（H9 用）：源码（剥注释）里真构造/直出 ChainImpediment 回包
 * —— 含 `ChainImpedimentSchema.parse(` 或调用 `detectChainImpediments(`。
 * 实测 2026-08-19 全仓命中恰 2 文件（chain-impediment.ts · service.ts），均在 SCAN_TARGETS。
 * ⚠ 诚实边界：这条判据认的是「构造点」两种写法；换个写法产数（如手拼对象字面量再 as ChainImpediment）
 *    仍可能漏 —— 那需要按赋值目标类型解析，属中等工作量判据设计，登记在案不是已守住。
 */
const PRODUCER_TOKENS = ["ChainImpedimentSchema.parse(", "detectChainImpediments("];
/** H9 现算的扫描根（生产+mock 源码面；mocks/ 目录除外 —— 那是合成 fixture，判据本体性质，不是产数处）。 */
const PRODUCER_SCAN_ROOTS = [
  "apps/datacore/src",
  "apps/agentcore/src",
  "packages/contracts/src",
  "packages/llm-adapters/src",
  "apps/frontend-shell/src",
];
/** 回包构造区锚点（H2 区域层 / H4）。少于 `MIN_REGIONS` 个 ⇒ 门自己瞎了。 */
const REGION_ANCHORS = ["ChainImpedimentSchema.parse(", "thresholdRow = {", "caveat ??= {", "unresolved = (reason: string) => ({"];
const MIN_REGIONS = 3;
/** 声明表锚点（H1）。 */
const DECL_TABLES = ["IMPEDIMENT_RULE_BINDINGS", "UNBOUND_IMPEDIMENT_JUDGEMENTS"];
/** 事实源（H4/H6/H7/H8 当场读回）。 */
const SOLVER_REGISTRY_FILE = "apps/datacore/src/solvers/service.ts";
const VOCAB_REGISTRY_FILE = "packages/contracts/src/base-registry.ts";
const RULE_REGISTRY_FILE = "apps/datacore/src/synthetic/battery.ts";
const RULE_REGISTRY_SYMBOL = "BATTERY_RULES";
/** 数值输出键（H2 文件层）。 */
const NUMERIC_OUTPUT_KEYS = ["severity", "metricValue", "threshold"];

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/* ══════════════════════════ 词法工具（剥注释/剥字符串，保行号）══════════════════════════ */

/**
 * 剥掉行注释与块注释，**保留换行**（行号不偏移，报错仍能给准 file:line）。
 * 逐字符跟踪字符串/模板字面量状态，避免把 "http://…" 里的斜杠误当注释起点。
 * （照抄 `check-boundary-singlesource.mjs` 已验证过的写法，不另发明。）
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 把字符串/模板字面量的**内容**挖空（保留定界符与换行），供「表里不许有数字」这类判据用。 */
function stripStringBodies(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { out += (src[i + 1] === "\n" ? "\n" : ""); i += 2; continue; }
      if (c === quote) { quote = null; out += c; i++; continue; }
      out += c === "\n" ? "\n" : "";
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/** 从 `from` 起做括号配对，返回 [起, 止]（含）。找不到闭合返回 null。 */
function matchBlock(code, from, open, close) {
  let i = code.indexOf(open, from);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  let quote = null;
  for (; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return [start, i]; }
  }
  return null;
}

const lineOf = (code, idx) => code.slice(0, idx).split("\n").length;

/**
 * 定位 `const <name>…= [ … ]` 的**初始化数组**。
 *
 * ⚠ 不能直接 `matchBlock(code, indexOf(name), "[", "]")`：类型标注里的 `ImpedimentRuleBinding[]`
 * 是一对**空**方括号，会先被匹上 ⇒ 解析出 0 条 binding。这正是本门金丝雀第一次跑就抓到的自伤
 * （报「⛔ 门自己瞎了：0 条 binding」而不是「代码干净」——失败方向安全的证据）。
 * 故先跳过类型标注（可跨行、含 `{}` `[]` `()`），找到**顶层 `=`**，再从那里配对。
 */
function declInitBlock(code, name) {
  const at = code.indexOf(name);
  if (at < 0) return null;
  let i = at + name.length;
  let depth = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth <= 0) return null;
    else if (c === "=" && depth <= 0 && code[i + 1] !== "=" && code[i + 1] !== ">" && !"=!<>".includes(code[i - 1])) break;
  }
  if (i >= code.length) return null;
  const span = matchBlock(code, i, "[", "]");
  if (!span) return null;
  return { start: span[0], code: code.slice(span[0], span[1] + 1), line: lineOf(code, span[0]) };
}

/* ══════════════════════════ 检测器（金丝雀喂的就是这几个函数）══════════════════════════ */

/** H1：一段声明表代码里是否残留数字（调用方须先剥注释 + 剥字符串体）。 */
export function detectTableDigits(tableCode) {
  const hits = [];
  tableCode.split("\n").forEach((line, i) => {
    const m = /-?\d+(\.\d+)?/.exec(line);
    if (m) hits.push({ line: i + 1, text: line.trim().slice(0, 100), token: m[0] });
  });
  return hits;
}

/** H2 区域层：构造区里的 `key: <数字>` 与含中文的裸字符串。 */
export function detectRegionLiterals(regionCode) {
  const hits = [];
  regionCode.split("\n").forEach((line, i) => {
    const num = /\b([A-Za-z_$][\w$]*)\s*:\s*-?\d+(\.\d+)?\s*(,|$|\})/.exec(line);
    if (num) hits.push({ line: i + 1, kind: "裸数字", text: line.trim().slice(0, 100), token: num[0].trim() });
    const cn = /\b([A-Za-z_$][\w$]*)\s*:\s*(["'])([^"'\n]*[一-鿿][^"'\n]*)\2/.exec(line);
    if (cn) hits.push({ line: i + 1, kind: "裸中文业务名", text: line.trim().slice(0, 100), token: `${cn[1]}: "${cn[3]}"` });
  });
  return hits;
}

/** H2 文件层：数值输出键无论在哪被赋数字字面量。 */
export function detectNumericKeyLiterals(code, keys = NUMERIC_OUTPUT_KEYS) {
  const re = new RegExp(String.raw`\b(${keys.join("|")})\s*(:|=)\s*-?\d+(\.\d+)?`, "g");
  const hits = [];
  code.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(re)) hits.push({ line: i + 1, text: line.trim().slice(0, 100), token: m[0] });
  });
  return hits;
}

/** H3：`?? <数字>` / `|| <数字>` 兜底默认值。 */
export function detectFallbackDefaults(code) {
  const hits = [];
  code.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/(\?\?|\|\|)\s*(-?\d+(\.\d+)?)\b/g)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 100), token: m[0].trim() });
    }
  });
  return hits;
}

/** H5：行业业务名（词表自 BASE_REGISTRY 派生，门里不写死）。 */
export function detectBusinessVocab(code, vocab) {
  if (vocab.size === 0) return [];
  const re = new RegExp([...vocab].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const hits = [];
  code.split("\n").forEach((line, i) => {
    const seen = new Set();
    for (const m of line.matchAll(re)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      hits.push({ line: i + 1, token: m[0], text: line.trim().slice(0, 100) });
    }
  });
  return hits;
}

/* ══════════════════════════ 事实源解析（H4/H5 的 oracle）══════════════════════════ */

/** `SOLVER_KEYS` 全集（事实层：门不记求解器名单，当场从注册处读回）。 */
function solverKeyRegistry() {
  const code = stripComments(read(SOLVER_REGISTRY_FILE));
  const at = code.indexOf("SOLVER_KEYS = [");
  if (at < 0) return new Set();
  const span = matchBlock(code, at, "[", "]");
  if (!span) return new Set();
  return new Set([...code.slice(span[0], span[1] + 1).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));
}

/* ══════════════ 规则库抽取器（事实层 · H6/H7/H8 的 oracle）══════════════════════
 * 设计说明见文件头「规则库抽取器」一节。三个不变式：
 *   ⅰ key 与 expression **必须来自同一个对象字面量**（结构上排除错位）
 *   ⅱ 属性的值一律**求值**，不做形态假设（跟得过 `parityRuleExpression("Cxx")` 这一跳）
 *   ⅲ 求值失败 = **工具看不懂**（RC=2），**不是**"规则不在册"（RC=1）
 */

/** 把 `[ {…}, {…} ]` 切成**顶层**对象字面量（括号配对，非正则 —— 正则做不到"同一个对象"）。 */
export function topLevelObjects(arrayCode) {
  const objs = [];
  let i = 0;
  for (;;) {
    const at = arrayCode.indexOf("{", i);
    if (at < 0) break;
    const span = matchBlock(arrayCode, at, "{", "}");
    if (!span) break;
    objs.push({ start: span[0], code: arrayCode.slice(span[0], span[1] + 1) });
    i = span[1] + 1;
  }
  return objs;
}

/** 从 `i` 起扫到**本层**的 `,` 或收尾（跳过嵌套括号与各类引号），返回该下标。 */
function skipToTopLevelComma(code, i, end) {
  let depth = 0;
  let quote = null;
  for (; i < end; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") { if (depth === 0) return i; depth--; }
    else if (c === "," && depth === 0) return i;
  }
  return i;
}

/**
 * 一个对象字面量的**顶层**属性 → **值的原始源码**。
 * 只收顶层：`params: { staleHours: 2 }` 里面的 `staleHours` 不会被当成规则属性，
 * 反过来 `params` 里出现 `key:` / `expression:` 也污染不到外层（旧正则栽的就是这一类越界）。
 */
export function topLevelProps(objCode) {
  const out = new Map();
  const end = objCode.length - 1; // 末位是配对的 `}`
  let i = 1;
  while (i < end) {
    while (i < end && /[\s,;]/.test(objCode[i])) i++;
    if (i >= end) break;
    let name = null;
    if (/[A-Za-z_$]/.test(objCode[i])) {
      let j = i;
      while (j < end && /[\w$]/.test(objCode[j])) j++;
      name = objCode.slice(i, j);
      i = j;
    } else if (objCode[i] === '"' || objCode[i] === "'") {
      const q = objCode[i];
      let j = i + 1;
      while (j < end && objCode[j] !== q) { if (objCode[j] === "\\") j++; j++; }
      name = objCode.slice(i + 1, j);
      i = j + 1;
    } else if (objCode[i] === "[") {
      const span = matchBlock(objCode, i, "[", "]");
      if (!span) break;
      name = objCode.slice(span[0], span[1] + 1); // 计算键（如 `[OUTSOURCE_REDLINE.paramKey]`）原样留着
      i = span[1] + 1;
    }
    while (i < end && /\s/.test(objCode[i])) i++;
    if (name === null || objCode[i] !== ":") {
      // 简写属性 / `...spread` / 认不出的形态：整体跳过，不猜
      i = skipToTopLevelComma(objCode, i, end) + 1;
      continue;
    }
    i++;
    while (i < end && /\s/.test(objCode[i])) i++;
    const vStart = i;
    i = skipToTopLevelComma(objCode, i, end);
    if (!out.has(name)) out.set(name, objCode.slice(vStart, i).trim());
    i++;
  }
  return out;
}

/** JS 关键字不能当函数形参名，从作用域符号里剔掉（`default` 是 ESM 命名空间必带的那个）。 */
const JS_RESERVED = new Set([
  "default", "class", "function", "const", "let", "var", "return", "new", "delete", "in", "of", "if", "else",
  "do", "while", "for", "switch", "case", "break", "continue", "this", "null", "true", "false", "typeof",
  "void", "with", "import", "export", "await", "yield", "enum", "super", "throw", "try", "catch", "finally",
  "instanceof", "extends", "arguments", "eval", "implements", "interface", "package", "private", "protected", "public", "static",
]);

/**
 * 造一个以 `@platform/contracts` 的**全部导出**为作用域的求值器。
 * ⛔ 这是本门"不抄第二份真值"的落地方式：规则内容一律由**契约包自己**算出来，
 *    门只负责把源码里那段值表达式原样交给它。新增一个派生函数，本门自动跟得上。
 */
export function makeEvaluator(mod) {
  const names = Object.keys(mod).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !JS_RESERVED.has(n));
  const values = names.map((n) => mod[n]);
  return (raw) => new Function(...names, `"use strict"; return (${raw});`)(...values);
}

/**
 * ⚠ **反面实现 · 只作金丝雀样例与变异开关用，主路径永不调用**。
 * 这就是 2026-08-13 之前的抽取器原样。留着它不是怀旧：金丝雀 R5 拿**同一段样例**同时喂
 * 新旧两版，把"旧版必错、新版必对"钉成机器可判的断言 —— 否则"我修好了"只是一句自称。
 */
export function legacyRuleRegistryRegex(blockCode) {
  const out = new Map();
  for (const m of blockCode.matchAll(/\bkey:\s*"([A-Z]\d+)"[\s\S]{0,400}?\bexpression:\s*(["'`])([\s\S]*?)\2/g)) {
    if (!out.has(m[1])) out.set(m[1], m[3]);
  }
  return out;
}

/** 变异反证开关：`legacy-regex` ⇒ 主路径换回坏抽取器，金丝雀必须当场报不中并 RC=2。 */
const CANARY_BREAK = process.env.CHAIN_SCAN_HONESTY_BREAK_CANARY || "";

/**
 * 规则库全集（事实层）：`key -> { expression, params, exprRaw, … }`。
 * 门不抄一份规则清单 —— 抄一份就是本门要治的病（"改规则不改推演"的诱饵）。
 * @returns {{ rules: Map, declaredKeys: string[], unresolved: object[] }}
 */
export function ruleRegistry(evalRaw, { blockCode = null } = {}) {
  let blk = blockCode;
  if (blk === null) {
    const code = stripComments(read(RULE_REGISTRY_FILE));
    const d = declInitBlock(code, RULE_REGISTRY_SYMBOL);
    blk = d ? d.code : null;
  }
  const rules = new Map();
  const unresolved = [];
  if (blk === null) return { rules, declaredKeys: [], unresolved };

  // 真值侧的"应有多少条"：直接数声明里的 key（与解析结果比对 ⇒ 防"吞噬"，见金丝雀 R7）
  const declaredKeys = [...blk.matchAll(/\bkey:\s*"([A-Z]\d+)"/g)].map((m) => m[1]);

  if (CANARY_BREAK === "legacy-regex" || CANARY_BREAK === "1") {
    for (const [k, expr] of legacyRuleRegistryRegex(blk)) {
      rules.set(k, { key: k, expression: expr, exprRaw: JSON.stringify(expr), params: null, paramsRaw: null });
    }
    return { rules, declaredKeys, unresolved };
  }

  for (const obj of topLevelObjects(blk)) {
    const props = topLevelProps(obj.code);
    const keyRaw = props.get("key");
    if (keyRaw === undefined) continue; // 不是规则对象
    let key;
    try { key = evalRaw(keyRaw); } catch { continue; }
    if (typeof key !== "string" || !/^[A-Z]\d+$/.test(key)) continue;

    const rec = { key, exprRaw: props.get("expression") ?? null, paramsRaw: props.get("params") ?? null, expression: null, params: null };
    if (rec.exprRaw === null) {
      unresolved.push({ key, what: "expression", why: "该规则对象里没有顶层 expression 属性" });
    } else {
      try {
        const v = evalRaw(rec.exprRaw);
        if (typeof v !== "string") unresolved.push({ key, what: "expression", why: `求值结果不是字符串（${typeof v}）`, raw: rec.exprRaw });
        else rec.expression = v;
      } catch (e) {
        unresolved.push({ key, what: "expression", why: e.message, raw: rec.exprRaw });
      }
    }
    if (rec.paramsRaw !== null) {
      try {
        const v = evalRaw(rec.paramsRaw);
        if (v && typeof v === "object") rec.params = v;
        else unresolved.push({ key, what: "params", why: `求值结果不是对象（${typeof v}）`, raw: rec.paramsRaw });
      } catch (e) {
        unresolved.push({ key, what: "params", why: e.message, raw: rec.paramsRaw });
      }
    }
    if (!rules.has(key)) rules.set(key, rec);
  }
  return { rules, declaredKeys, unresolved };
}

/**
 * 判据声明表逐条解析（bindingId / ruleKey / metricPath），供 H6/H7/H8 拿去和规则库对账。
 * 解析不出来 ⇒ 条数掉到下界之下 ⇒ 金丝雀报「门自己瞎了」，不会静默放行。
 */
function parseBindings(tableCode) {
  const out = [];
  for (const m of tableCode.matchAll(/\{[^{}]*\bbindingId:[\s\S]*?\}/g)) {
    const chunk = m[0];
    const pick = (k) => (new RegExp(String.raw`\b${k}:\s*"([^"]+)"`).exec(chunk) || [])[1];
    const bindingId = pick("bindingId");
    if (!bindingId) continue;
    out.push({ bindingId, ruleKey: pick("ruleKey"), metricPath: pick("metricPath") });
  }
  return out;
}

/**
 * 阈值来源分类（A2-b/A2-c 的机械那一半）：在规则表达式里找 metricPath 那侧的比较，看**另一侧**是什么。
 *  · `params.x` / `${ruleParamRef("x")}` → param   —— 改规则 params 即改判定（最好的形态）
 *  · 另一个字段路径                       → field   —— 改数据即改判定
 *  · 数字                                 → literal —— **改表达式**才改判定；可审计但最僵，故上棘轮
 *  · metricPath 根本不在表达式里          → ABSENT  —— 判据声称的来源不存在（A2-c 咬的就是这个）
 */
export function classifyThresholdSource(expression, metricPath) {
  if (!expression || !metricPath) return { source: "ABSENT", reason: "规则或 metricPath 缺失" };
  const leaf = metricPath.split(".").slice(1).join(".") || metricPath;
  const esc = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cmp = new RegExp(
    // ⚠ 右侧终止符必须含 `,`：`SUSTAIN(Line.utilization > 95, 3)` 里不排除逗号会读成 "95," ⇒
    //   归类失败 → 该判据被误报成 ABSENT。金丝雀「必不咬样例被误咬」当场抓到了这个（本门第二次自伤）。
    //
    // ⚠⚠ 左侧必须是**真的标识符边界**（WO-R9-SCAN-EXTRACTOR 实测第三次自伤）。原写法
    //    `(?:[\w.]*\b)?<leaf>` 里那个前缀组是**可选**的，而 `<leaf>` 自己前面没有任何边界断言 ⇒
    //    `Line.MUTANT_utilization > 95` 里的 `utilization` 会被当成比较操作数**匹上**，归类成 literal 95。
    //    实测：把 `PARITY_RULE_SEEDS` 的 C05 表达式改成 `SUSTAIN(Line.MUTANT_utilization > 95, 3)`，
    //    本门**全绿放行** —— H7 号称"表达式必须真以该 metricPath 为比较操作数"，实际只要求"包含这个子串"。
    //    形态（铁律 0.6 句式）：**「我用『表达式里出现了这个子串』当作『该字段是比较操作数』的证据，
    //    而前者并不度量后者。」** 与本单主病（拿 400 字窗口里的下一个 expression 当同一条规则的）同族。
    //    修法：前缀改成"零个或多个**完整**限定段"，并在整体左侧加 `(?<![\w$.])`、leaf 右侧加 `\b`。
    //    钉死它的是 MUST_BITE 的「H7 子串同名字段不算数」那条（去掉边界断言即当场报门瞎了）。
    String.raw`(?<![\w$.])(?:[A-Za-z_$][\w$]*\.)*${esc}\b\s*(<=|>=|==|!=|<|>)\s*([^\s),]+)`,
  ).exec(expression);
  if (!cmp) {
    return new RegExp(String.raw`\b${leaf}\b`).test(expression)
      ? { source: "ABSENT", reason: `表达式提到 ${leaf} 但未以它为比较操作数` }
      : { source: "ABSENT", reason: `表达式里根本没有 ${leaf}` };
  }
  const rhs = cmp[2];
  if (/^\$\{ruleParamRef\(|^params\./.test(rhs)) return { source: "param", value: rhs };
  if (/^-?\d+(\.\d+)?$/.test(rhs)) return { source: "literal", value: rhs };
  if (/^[A-Za-z_$][\w$]*\.[\w$.]+$/.test(rhs)) return { source: "field", value: rhs };
  return { source: "ABSENT", reason: `阈值操作数 "${rhs}" 无法归类` };
}

/**
 * 行业业务词表（自 `BASE_REGISTRY` 机械派生：基地中文名 / 瓶颈工序 / 主产品）。
 * 刻意**不**收 `kind`/`position` 那两个枚举（动力/储能/混合）—— 它们是业态维度词，
 * 在判定器里出现属正常建模用语，收进来只会逼出一张白名单让门腐坏。
 */
function businessVocab() {
  const code = stripComments(read(VOCAB_REGISTRY_FILE));
  const vocab = new Set();
  for (const key of ["name", "bottleneck", "mainProduct"]) {
    for (const m of code.matchAll(new RegExp(String.raw`\b${key}:\s*"([^"]*[一-鿿][^"]*)"`, "g"))) {
      vocab.add(m[1]);
    }
  }
  return vocab;
}

/* ══════════════════════════ 金丝雀（门自己的自检）══════════════════════════ */

/** 必咬样例：每条都是"确定该被咬"的形态，检测器若不咬 ⇒ 门瞎了。 */
const MUST_BITE = [
  { name: "H1 表里塞红线常数", fn: () => detectTableDigits(`  { bindingId: "X", redline: 95 },`).length > 0 },
  { name: "H2 构造区裸 severity", fn: () => detectRegionLiterals(`      severity: 87,`).length > 0 },
  { name: "H2 构造区裸中文", fn: () => detectRegionLiterals(`      label: "常州化成段",`).length > 0 },
  { name: "H2 文件层 threshold 赋字面量", fn: () => detectNumericKeyLiterals(`const threshold = 95.5;`).length > 0 },
  { name: "H3 ?? 兜底默认阈值", fn: () => detectFallbackDefaults(`const t = readRuleThreshold(r) ?? 95;`).length > 0 },
  { name: "H3 || 兜底默认阈值", fn: () => detectFallbackDefaults(`const t = th.value || 0.85;`).length > 0 },
  { name: "H5 业务名可被咬", fn: (v) => (v.size > 0 ? detectBusinessVocab(`const base = "${[...v][0]}";`, v).length > 0 : false) },
  { name: "H7 声称的来源不存在可被咬", fn: () => classifyThresholdSource("Line.utilization > 95", "Order.changeoverMin").source === "ABSENT" },
  // ⛔ 这条钉死 2026-08-13 实测的第三次自伤：`utilization` 是 `MUTANT_utilization` 的**子串**，
  //    旧正则照样匹上并归类成 literal 95 ⇒ 改坏规则表达式本门全绿放行。去掉边界断言即当场不中。
  {
    name: "H7 子串同名字段不算数（MUTANT_utilization ≠ utilization）",
    fn: () => classifyThresholdSource("SUSTAIN(Line.MUTANT_utilization > 95, 3)", "Line.utilization").source === "ABSENT",
  },
  // 同族反向：限定段必须**完整**，`OtherLine.utilization` 属于另一个对象，但 leaf 相同 ⇒ 仍算命中
  // （H7 只认字段名不认对象名，这是**已知的诚实边界**，写成金丝雀以免被后人当 bug 悄悄改掉）。
];
/** 必不咬样例：正常写法若被咬 ⇒ 门会把好代码报红，同样是门坏了。 */
const MUST_NOT_BITE = [
  { name: "severity 由超阈幅度算出", fn: () => detectRegionLiterals(`      severity: Math.max(0, Math.min(100, Math.round((breach / denom) * 100))),`).length === 0 },
  { name: "threshold 从规则读回", fn: () => detectRegionLiterals(`        threshold: round(th.value, 6),`).length === 0 },
  { name: "metricValue 取自对象", fn: () => detectRegionLiterals(`        metricValue: round(metric, 6),`).length === 0 },
  { name: "unit 由 binding 声明", fn: () => detectRegionLiterals(`        unit: b.unit,`).length === 0 },
  { name: "剥注释后示例数字不算", fn: () => detectNumericKeyLiterals(stripComments(`// severity: 87 —— 注释里的示例`)).length === 0 },
  { name: "剥字符串后规则码不算数字", fn: () => detectTableDigits(stripStringBodies(`  ruleKey: "C02",`)).length === 0 },
  { name: "H8 param 阈值判为 param", fn: () => classifyThresholdSource('DataSourceHealth.lagHours > ${ruleParamRef("staleHours")}', "DataSourceHealth.lagHours").source === "param" },
  { name: "H8 字面量阈值判为 literal", fn: () => classifyThresholdSource("SUSTAIN(Line.utilization > 95, 3)", "Line.utilization").source === "literal" },
  { name: "H8 字段阈值判为 field", fn: () => classifyThresholdSource("Process.parallelThroughput < Process.requiredThroughput", "Process.parallelThroughput").source === "field" },
];

/* ── 规则抽取器金丝雀 R1–R7 ────────────────────────────────────────────────────
 * ⛔ 铁律 0.6 已落地的机制：金丝雀**必须与主判据共用同一份实现**，不许另抄一份正则。
 *    故下面每一条都走**上面那个** `ruleRegistry()` / `topLevelObjects` / `topLevelProps`，
 *    一行解析逻辑都不重复；R5 额外把**同一段样例**再喂一遍反面实现
 *    `legacyRuleRegistryRegex`，让"旧版必错、新版必对"成为机器可判的断言。
 *
 * 样例的选取是**按形态机械挑**、不写死规则码：写死 C05 会在 battery.ts 改写法时
 * 变成"样例过期却照样绿"的装饰品。挑不到某形态 ⇒ 报「样例不存在，金丝雀过期」= 工具坏了。
 */
const MISBIND_SAMPLE = `[
  { key: "C01", name: "甲", expression: parityRuleExpression("C01"), severity: "BLOCK", params: {} },
  { key: "C10", name: "乙", expression: "Action.approver == NULL OR Action.audited == FALSE", severity: "BLOCK", params: {} },
]`;
/** 负金丝雀用的**保证不存在**的规则码（在册即说明样例过期，报工具坏了而不是放行）。 */
const ABSENT_PROBE_KEY = "C99";

export function ruleExtractorCanaries(reg, evalRaw) {
  const rows = [];
  const add = (id, name, pass, evidence) => rows.push({ id, name, pass, evidence });
  const all = [...reg.rules.values()];
  const pick = (pred, prefer) => all.find((r) => r.key === prefer && pred(r)) ?? all.find(pred);

  /* R1 正·派生式：`expression: parityRuleExpression("Cxx")` 必须解析回**真值源里那条**表达式。
   *    钉死"跟得过这一跳"。判据取自 `PARITY_RULE_SEEDS`（数据），解析走 `parityRuleExpression`（函数）——
   *    同一个单一来源的两个出口，错位/吞噬时必然对不上。 */
  const derived = pick((r) => /^parityRuleExpression\s*\(\s*"[A-Z]\d+"\s*\)$/.test(r.exprRaw ?? ""), "C05");
  if (!derived) {
    add("R1", "派生式样例存在", false, `battery.ts 里已无 \`expression: parityRuleExpression("Cxx")\` 形态 ⇒ 金丝雀过期`);
  } else {
    const seed = (CONTRACTS.PARITY_RULE_SEEDS ?? []).find((s) => s.key === derived.key);
    const ok = !!seed && derived.expression === seed.expression && derived.expression !== derived.exprRaw;
    add("R1", `派生式跟得过这一跳（${derived.key}）`, ok,
      `${derived.exprRaw} → ${JSON.stringify(derived.expression)}${seed ? "（= PARITY_RULE_SEEDS 同条）" : "（PARITY_RULE_SEEDS 无此条）"}`);
  }

  /* R2 正·内联函数派生式（C08 刻意保留 `outsourceRedlineViolationExpr(…)`，不进 PARITY_RULE_SEEDS）。
   *    它证明本门跟的不是"parityRuleExpression 这一个函数"，而是**任意 contracts 派生函数**。 */
  const inlineCall = pick(
    (r) => /^[A-Za-z_$][\w$]*\s*\(/.test(r.exprRaw ?? "") && !/^parityRuleExpression\s*\(/.test(r.exprRaw ?? ""),
    CONTRACTS.OUTSOURCE_REDLINE?.ruleKey,
  );
  if (!inlineCall) {
    add("R2", "内联函数派生式样例存在", false, "battery.ts 里已无内联派生函数形态的 expression ⇒ 金丝雀过期");
  } else {
    let ok = typeof inlineCall.expression === "string" && inlineCall.expression.length > 0
      && inlineCall.expression !== inlineCall.exprRaw
      && /[\w.]+\s*(<=|>=|==|!=|<|>)\s*\S/.test(inlineCall.expression);
    let note = "";
    // 若挑中的正是 C08，再拿契约自己的**发布态出口**对一次（真值源，不是抄的副本）
    if (inlineCall.key === CONTRACTS.OUTSOURCE_REDLINE?.ruleKey && typeof CONTRACTS.outsourceRedlineViolationExprPublished === "function") {
      const published = CONTRACTS.outsourceRedlineViolationExprPublished();
      ok = ok && inlineCall.expression === published;
      note = ` · 与 outsourceRedlineViolationExprPublished() ${inlineCall.expression === published ? "一致" : "不一致（应为 " + published + "）"}`;
    }
    add("R2", `内联函数派生式被求值（${inlineCall.key}）`, ok, `${(inlineCall.exprRaw ?? "").slice(0, 60)} → ${JSON.stringify(inlineCall.expression)}${note}`);
  }

  /* R3 正·字面量式：`expression: "…"` 必须**原样**取回。判据是**字符串切片**（与求值路径互不依赖），
   *    故它能抓到"求值器把好端端的字面量改写了"这个反方向的坏法。 */
  const literal = pick((r) => /^"[^"\\]*"$/.test(r.exprRaw ?? ""), "C22");
  if (!literal) {
    add("R3", "字面量式样例存在", false, "battery.ts 里已无纯双引号字面量形态的 expression ⇒ 金丝雀过期");
  } else {
    const sliced = literal.exprRaw.slice(1, -1);
    add("R3", `字面量式原样取回（${literal.key}）`, literal.expression === sliced, `${literal.exprRaw} → ${JSON.stringify(literal.expression)}`);
  }

  /* R4 正·模板串式：`` `… ${ruleParamRef("x")}` `` 必须**真被求值**（结果里不许再有 `${`）。 */
  const tpl = pick((r) => (r.exprRaw ?? "").startsWith("`") && (r.exprRaw ?? "").includes("${"), "C18");
  if (!tpl) {
    add("R4", "模板串式样例存在", false, "battery.ts 里已无带 ${} 的模板串 expression ⇒ 金丝雀过期");
  } else {
    const paramPrefix = typeof CONTRACTS.ruleParamRef === "function" ? CONTRACTS.ruleParamRef("") : "params.";
    const ok = typeof tpl.expression === "string" && !tpl.expression.includes("${") && tpl.expression.includes(paramPrefix);
    add("R4", `模板串真被求值（${tpl.key}）`, ok, `${tpl.exprRaw.slice(0, 60)} → ${JSON.stringify(tpl.expression)}`);
  }

  /* R5 负·**错位必须被咬**（钉死 2026-08-13 那个病）：同一段内嵌样例喂新旧两版抽取器 ——
   *    新版必须把 C01 解析成 C01 自己的表达式；旧正则必然把 C01 绑到 C10 的原文上且吞掉 C10。
   *    这一条是本门"我修好了"的**唯一机器证据**。 */
  {
    let ok = false;
    let evidence = "";
    try {
      const fresh = ruleRegistry(evalRaw, { blockCode: MISBIND_SAMPLE });
      const legacy = legacyRuleRegistryRegex(MISBIND_SAMPLE);
      const want = typeof CONTRACTS.parityRuleExpression === "function" ? CONTRACTS.parityRuleExpression("C01") : null;
      const gotNew = fresh.rules.get("C01")?.expression ?? null;
      const gotOld = legacy.get("C01") ?? null;
      ok = want !== null && gotNew === want && fresh.rules.has("C10") && gotOld !== want;
      evidence = `新版 C01→${JSON.stringify(gotNew)}（解析 ${fresh.rules.size}/2 条）· 旧正则 C01→${JSON.stringify(gotOld)}（解析 ${legacy.size}/2 条 · 这就是那个病）`;
    } catch (e) {
      evidence = `样例解析抛异常：${e.message}`;
    }
    add("R5", "跨对象错位可被咬（新对旧错）", ok, evidence);
  }

  /* R6 负·**不在册判据不许恒真**：一个保证不存在的规则码必须被判为不在册。
   *    没有它，H6 那句"BATTERY_RULES 里没有这条规则"就无法证伪。 */
  {
    const declared = reg.declaredKeys.includes(ABSENT_PROBE_KEY);
    add("R6", `不在册可被判出（${ABSENT_PROBE_KEY}）`, !declared && !reg.rules.has(ABSENT_PROBE_KEY),
      declared ? `${ABSENT_PROBE_KEY} 竟已在 BATTERY_RULES 里 ⇒ 负样例过期，请换一个不存在的码` : `${ABSENT_PROBE_KEY} 正确判为不在册（在册 ${reg.rules.size} 条里无它）`);
  }

  /* R7 规模等式·**防吞噬**：声明了几条就必须解析出几条。旧正则在真库上是 21/29 —— 少的那 8 条
   *    会被 H6 报成"规则不存在"，而它们**全都在**。"数量对得上"是这个病最直接的判据。 */
  {
    const declared = [...new Set(reg.declaredKeys)];
    const missing = declared.filter((k) => !reg.rules.has(k));
    add("R7", "声明条数 == 解析条数（防吞噬）", missing.length === 0 && reg.rules.size === declared.length,
      `声明 ${declared.length} 条 · 解析 ${reg.rules.size} 条${missing.length ? ` · 丢失 ${missing.join(",")}` : " · 无丢失"}`);
  }

  return rows;
}

/** 表达式里 `params.x` / `${ruleParamRef("x")}` 两种写法都取出那个 **param 名**。 */
export function paramNameOf(operand) {
  const m = /^\$\{\s*ruleParamRef\(\s*["'`]([\w$]+)["'`]\s*\)\s*\}$/.exec(operand) || /^params\.([\w$]+)$/.exec(operand);
  return m ? m[1] : null;
}

function selftest(ctx) {
  const bad = [];
  for (const s of MUST_BITE) {
    let ok = false;
    try { ok = s.fn(ctx.vocab) === true; } catch (e) { ok = false; }
    if (!ok) bad.push(`必咬样例没咬住：${s.name} —— 检测器失灵，0 命中会被读成「代码干净」`);
  }
  for (const s of MUST_NOT_BITE) {
    let ok = false;
    try { ok = s.fn(ctx.vocab) === true; } catch (e) { ok = false; }
    if (!ok) bad.push(`必不咬样例被误咬：${s.name} —— 门会把好代码报红`);
  }
  // 规模下界：扫描面/构造区/事实源任一读不出来，都会让本门恒绿（失败方向不安全）。
  if (ctx.targets.length !== SCAN_TARGETS.length) {
    bad.push(`扫描面只解析出 ${ctx.targets.length}/${SCAN_TARGETS.length} 个 —— 这不是「代码干净」，是文件读不到/方法体切不出来`);
  }
  if (ctx.regions.length < MIN_REGIONS) {
    bad.push(`回包构造区只定位到 ${ctx.regions.length} 个（下界 ${MIN_REGIONS}）—— 锚点失配，H2/H4 等于没开`);
  }
  if (ctx.tables.length !== DECL_TABLES.length) {
    bad.push(`声明表只解析出 ${ctx.tables.length}/${DECL_TABLES.length} 张 —— H1 等于没开`);
  }
  if (ctx.bindingCount < 6) {
    bad.push(`判据声明表只解析出 ${ctx.bindingCount} 条 binding（下界 6）—— 表解析坏了`);
  }
  if (ctx.solverKeys.size < 20) {
    bad.push(`SOLVER_KEYS 事实源只读出 ${ctx.solverKeys.size} 个 key（下界 20）—— H4 的事实层等于没开`);
  }
  if (ctx.rules.size < 20) {
    bad.push(`规则库事实源（${RULE_REGISTRY_FILE} ${RULE_REGISTRY_SYMBOL}）只读出 ${ctx.rules.size} 条规则（下界 20）—— H6/H7/H8 全等于没开`);
  }
  // 规则抽取器金丝雀 R1–R7（与主判据共用 ruleRegistry / topLevelObjects / topLevelProps）
  for (const r of ctx.ruleCanaries) {
    if (!r.pass) bad.push(`规则抽取器金丝雀 ${r.id} 不中：${r.name} —— ${r.evidence}`);
  }
  // 求值不出来的表达式：**工具看不懂**，不许被 H6 读成「规则不在册」（两者处置相反）
  for (const u of ctx.ruleUnresolved) {
    bad.push(
      `规则 ${u.key} 的 ${u.what} 求值不出来：${u.why}${u.raw ? `\n      原文：${u.raw.slice(0, 120)}` : ""}\n` +
        `      —— 这是**门看不懂**，不是「规则不存在」。修法：把该派生函数从 @platform/contracts 导出（本门自动跟得上），` +
        `或改回可求值的形态；**不许**把它读成 H6 的「不在册」。`,
    );
  }
  if (ctx.bindings.length !== ctx.bindingCount) {
    bad.push(`判据逐条解析出 ${ctx.bindings.length} 条，但表里有 ${ctx.bindingCount} 个 bindingId —— 解析漏条，H6/H7/H8 覆盖不全`);
  }
  if (ctx.vocab.size < 5) {
    bad.push(`BASE_REGISTRY 业务词表只派生出 ${ctx.vocab.size} 个词（下界 5）—— H5 等于没开`);
  }
  return bad;
}

/* ══════════════════════════ 主流程 ══════════════════════════ */

const argv = process.argv.slice(2);
const isUpdate = argv.includes("--update");
const isSelftestOnly = argv.includes("--selftest");
const isList = argv.includes("--list");

/** 取一个扫描目标的**代码**（剥注释；method 目标只取该方法体），带原文件行号偏移。 */
function loadTarget(t) {
  let src;
  try { src = read(t.file); } catch { return null; }
  const code = stripComments(src);
  if (!t.method) return { ...t, code, lineOffset: 0 };
  const at = code.indexOf(`${t.method}(`);
  if (at < 0) return null;
  const span = matchBlock(code, at, "{", "}");
  if (!span) return null;
  return { ...t, code: code.slice(span[0], span[1] + 1), lineOffset: lineOf(code, span[0]) - 1 };
}

const targets = SCAN_TARGETS.map(loadTarget).filter(Boolean);
const solverKeys = solverKeyRegistry();
const vocab = businessVocab();

// 判定器本体（H1/H2 区域层/H4 都挂在它上面）
const core = targets.find((t) => t.file.endsWith("chain-impediment.ts"));
const coreCode = core?.code ?? "";

// —— 声明表（H1）
const tables = [];
for (const name of DECL_TABLES) {
  const blk = declInitBlock(coreCode, name);
  if (blk) tables.push({ name, ...blk });
}
const bindingCount = (tables.find((t) => t.name === DECL_TABLES[0])?.code.match(/bindingId:/g) || []).length;

// —— 回包构造区（H2 区域层 / H4）
const regions = [];
for (const anchor of REGION_ANCHORS) {
  let from = 0;
  for (;;) {
    const at = coreCode.indexOf(anchor, from);
    if (at < 0) break;
    const span = matchBlock(coreCode, at, "{", "}");
    if (span) regions.push({ anchor, code: coreCode.slice(span[0], span[1] + 1), line: lineOf(coreCode, span[0]) });
    from = at + anchor.length;
  }
}

const evalRaw = makeEvaluator(CONTRACTS);
const reg = ruleRegistry(evalRaw);
const rules = reg.rules;
const ruleCanaries = ruleExtractorCanaries(reg, evalRaw);
const bindings = tables.flatMap((t) => (t.name === DECL_TABLES[0] ? parseBindings(t.code) : []));

const ctx = {
  targets, regions, tables, bindingCount, solverKeys, vocab, rules, bindings,
  ruleCanaries, ruleUnresolved: reg.unresolved,
};

/* ---------- 金丝雀先跑：门瞎了与代码脏了必须分开报（修法完全不同） ---------- */
const blind = selftest(ctx);
// D5/D6 内容对账金丝雀（共享实现 scripts/lib/ratchet-conservation.mjs 本体，不另抄）
const consCanary = conservationCanary();
if (consCanary.ok === false) blind.push(`D5/D6 内容对账金丝雀不过：${consCanary.got}（期望：${consCanary.want}）`);
if (blind.length > 0) {
  console.error("⛔ 门自己瞎了（不是「代码干净」）—— chain-scan-honesty:check 无法给出有效结论：");
  for (const b of blind) console.error(`  - ${b}`);
  for (const r of ruleCanaries) console.error(`      ${r.pass ? "✓" : "✗"} ${r.id} ${r.name}：${r.evidence}`);
  console.error(
    "\n  修法：修门（锚点/正则/事实源解析/求值器），不是修被扫代码。0 命中在本门里长得跟通过一模一样，故必须先自证工具是对的。" +
      "\n  **本次结论作废（RC=2）**：不许读作「代码干净 / 无违规 / 通过」，也不许读作「不得并线」—— 本门这次什么都没证明。",
  );
  process.exit(2); // 2 = 工具自己坏了；1 只留给主判据明确判负那条路径，两者处置相反
}
console.log(
  `· 金丝雀通过：必咬 ${MUST_BITE.length}/${MUST_BITE.length} · 必不咬 ${MUST_NOT_BITE.length}/${MUST_NOT_BITE.length} · ` +
    `规则抽取器 R1–R7 ${ruleCanaries.filter((r) => r.pass).length}/${ruleCanaries.length} · ` +
    `扫描面 ${targets.length} · 构造区 ${regions.length} · 声明表 ${tables.length}（${bindingCount} 条 binding）· ` +
    `SOLVER_KEYS ${solverKeys.size} · 规则库 ${rules.size} 条 · 业务词表 ${vocab.size}`,
);
// 否定结论（H6「不在册」）的命中证据：铁律 0.6 要求报「它不存在」时同时给出金丝雀证据
for (const r of ruleCanaries) console.log(`    ${r.pass ? "✓" : "✗"} ${r.id} ${r.name}：${r.evidence}`);
if (isSelftestOnly) process.exit(0);

/* ---------- 判据逐条跑 ---------- */
const fail = [];
const hits = []; // H5 棘轮候选

/* ---------- H9 名单 vs 现算：产数处必须都在扫描面名册里（WO-GATE-ROSTER-SWEEP-3）----------
 * SCAN_TARGETS 只钉「册内文件被扫」钉不住「新产数处没登记」—— 后者正是 roster 门守的病
 * （不在名单里的对象永远绿）。现算：PRODUCER_SCAN_ROOTS 全遍历，剥注释后含 PRODUCER_TOKENS
 * 任一即计为产数处（mocks 除外：合成 fixture 不是产数处）。漏登记 ⇒ RC=1 点名 file:line。 */
{
  const targetFiles = new Set(SCAN_TARGETS.map((t) => t.file));
  const producers = [];
  const walk = (abs, rel) => {
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "build" || e.name === "mocks") continue;
      const p = join(abs, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, r);
      else if (/\.(ts|tsx)$/.test(e.name)) producers.push(r);
    }
  };
  for (const root0 of PRODUCER_SCAN_ROOTS) walk(join(ROOT, root0), root0);
  for (const f of producers.sort()) {
    if (targetFiles.has(f)) continue;
    const code = stripComments(read(f));
    for (const tok of PRODUCER_TOKENS) {
      const at = code.indexOf(tok);
      if (at < 0) continue;
      fail.push(
        `H9 产数处未登记：${f}:${lineOf(code, at)} 含 \`${tok}\`（构造/直出 ChainImpediment 回包）但不在 SCAN_TARGETS 名册里\n` +
          `        —— 名单 vs 现算双向锁：新产数处须同批登记进 SCAN_TARGETS，否则它的裸字面量零看护（名册落后于现实 = 这门只在守昨天）。`,
      );
      break;
    }
  }
}

// H1 判据表零数值
for (const t of tables) {
  const stripped = stripStringBodies(t.code);
  for (const h of detectTableDigits(stripped)) {
    fail.push(
      `H1 判据表零数值：${core.file}:${t.line + h.line - 1} 声明表 ${t.name} 内出现数值字面量 \`${h.token}\`\n` +
        `        ${h.text}\n` +
        `        —— 阈值/系数/红线只许登记「哪条规则的哪个字段」，数值本体必须由 readRuleThreshold 从规则读回。`,
    );
  }
}

// H2 区域层
for (const r of regions) {
  for (const h of detectRegionLiterals(r.code)) {
    fail.push(
      `H2 输出构造位（区域层）：${core.file}:${r.line + h.line - 1} 构造区 \`${r.anchor}\` 内出现${h.kind} \`${h.token}\`\n` +
        `        ${h.text}\n` +
        `        —— 回包里的每个数字/名字都必须来自求解器输出或对象库，不许在构造位内联。`,
    );
  }
}

// H2 文件层 + H3 + H5：全扫描面
for (const t of targets) {
  const loc = (n) => `${t.file}:${t.lineOffset + n}`;
  for (const h of detectNumericKeyLiterals(t.code)) {
    fail.push(
      `H2 输出构造位（文件层）：${loc(h.line)} 数值输出键被赋字面量 \`${h.token}\`\n        ${h.text}`,
    );
  }
  for (const h of detectFallbackDefaults(t.code)) {
    fail.push(
      `H3 兜底默认阈值：${loc(h.line)} 出现 \`${h.token}\`\n        ${h.text}\n` +
        `        —— 读不回来必须诚实 UNKNOWN；给默认值会让规则缺失时判出一堆看着合理的假阻滞点。`,
    );
  }
  for (const h of detectBusinessVocab(t.code, vocab)) {
    hits.push({ file: t.file, line: t.lineOffset + h.line, token: h.token, text: h.text });
  }
}

// H4 溯源可机械核
const REQUIRED_EVIDENCE = ["ruleKey", "metricValue", "threshold", "unit"];
const parseRegion = regions.find((r) => r.anchor === "ChainImpedimentSchema.parse(");
if (!parseRegion) {
  fail.push("H4 溯源：找不到 `ChainImpedimentSchema.parse(` 构造区 —— 无法核对 evidence 是否齐备");
} else {
  if (!/solverKey:\s*CHAIN_IMPEDIMENT_SOLVER_KEY\b/.test(parseRegion.code)) {
    fail.push(
      `H4 溯源：${core.file}:${parseRegion.line} 构造区未以**符号** \`solverKey: CHAIN_IMPEDIMENT_SOLVER_KEY\` 写 solverKey\n` +
        `        —— 内联字符串会让 key 与求解器注册表悄悄漂移（改一处不改另一处，屏上仍显示得很专业）。`,
    );
  }
  for (const k of REQUIRED_EVIDENCE) {
    if (!new RegExp(String.raw`\b${k}:`).test(parseRegion.code)) {
      fail.push(`H4 溯源：构造区缺 \`${k}\` —— A2「逐个溯源到求解器输出」的链条断在这里（少一环就没法机械核）`);
    }
  }
}
const keyDecl = /CHAIN_IMPEDIMENT_SOLVER_KEY\s*=\s*"([a-z0-9_]+)"/.exec(coreCode);
if (!keyDecl) {
  fail.push("H4 溯源：读不到 `CHAIN_IMPEDIMENT_SOLVER_KEY` 的字面值 —— 无法与 SOLVER_KEYS 对账");
} else if (!solverKeys.has(keyDecl[1])) {
  fail.push(
    `H4 溯源（事实层）：evidence.solverKey = "${keyDecl[1]}" **不在** ${SOLVER_REGISTRY_FILE} 的 SOLVER_KEYS 册上\n` +
      `        —— 回包声称"这个数来自某求解器"，而那个求解器全仓没注册：溯源指向空气。`,
  );
}

/* ---------- H6/H7/H8 阈值溯源（A2-b/A2-c：声称的来源到底存不存在）---------- */
const sourceTally = { param: 0, field: 0, literal: 0, ABSENT: 0 };
const literalRows = [];
let notInRegistry = 0;
/** 报「不在册」这类**否定结论**时必须随附的金丝雀证据（铁律 0.6）。 */
const CANARY_PROOF =
  `本次抽取器金丝雀 ${ruleCanaries.filter((r) => r.pass).length}/${ruleCanaries.length} 全中` +
  `（已解析 ${rules.size}/${new Set(reg.declaredKeys).size} 条规则 · ` +
  `${ruleCanaries.find((r) => r.id === "R1")?.evidence ?? ""} · ${ruleCanaries.find((r) => r.id === "R6")?.evidence ?? ""}）`;
for (const b of bindings) {
  // H6 ruleKey 当场读回：判据声称"阈值出自 C22"，那 C22 得真在规则库里。
  if (!b.ruleKey || !rules.has(b.ruleKey)) {
    fail.push(
      `H6 规则在册（事实层）：判据 ${b.bindingId} 声称阈值出自规则 ${b.ruleKey ?? "（未声明）"}，` +
        `但 ${RULE_REGISTRY_FILE} 的 ${RULE_REGISTRY_SYMBOL} 里没有这条规则\n` +
        `        金丝雀证据（否定结论必附）：${CANARY_PROOF}\n` +
        `        —— 虚构一个规则码会让它看着像官方阈值，实际全仓无定义：溯源链第一环就断了。`,
    );
    sourceTally.ABSENT++;
    notInRegistry++;
    continue;
  }
  const rule = rules.get(b.ruleKey);
  // H7 声称的来源真存在：规则表达式必须真以该 metricPath 为比较操作数，否则判据与规则口径不符。
  const cls = classifyThresholdSource(rule.expression, b.metricPath);
  sourceTally[cls.source]++;
  if (cls.source === "ABSENT") {
    fail.push(
      `H7 溯源可达：判据 ${b.bindingId} 声称读 ${b.ruleKey} 的 ${b.metricPath} 阈值，但${cls.reason}\n` +
        `        规则原文：${rule.expression}\n` +
        `        （源码形态：${(rule.exprRaw ?? "?").slice(0, 80)}）\n` +
        `        —— 判据与规则口径不符 ⇒ 运行期只会恒 UNKNOWN 或读回一个不相干的数（后者是静默错答）。`,
    );
  } else if (cls.source === "literal") {
    literalRows.push({ bindingId: b.bindingId, ruleKey: b.ruleKey, metricPath: b.metricPath, value: cls.value });
  } else if (cls.source === "param") {
    /* H7b **旋钮真存在**（`parityRuleParams("Cxx")` 的消费方 —— 解析回来却没人核 = 假绿第 9 形态）。
     * expression 引用 `params.x`，而 `rule.params` 里没有 x ⇒ 运行期解析不出阈值、恒 UNKNOWN；
     * 屏上那条判据从此永远不触发，而**没有任何东西会变红**。这正是"接了线没数据"那一族。 */
    const pname = paramNameOf(cls.value);
    if (pname === null) {
      fail.push(
        `H7b 旋钮可解析：判据 ${b.bindingId} 的规则 ${b.ruleKey} 阈值操作数 \`${cls.value}\` 看着像 param 引用却取不出名字\n` +
          `        规则原文：${rule.expression}`,
      );
    } else if (!rule.params || !Object.prototype.hasOwnProperty.call(rule.params, pname)) {
      fail.push(
        `H7b 旋钮在册：判据 ${b.bindingId} 的规则 ${b.ruleKey} 表达式引用 \`${cls.value}\`，` +
          `但该规则的 params 里没有 \`${pname}\`（现有：${rule.params ? Object.keys(rule.params).join("/") || "（空）" : "（无 params 属性）"}）\n` +
          `        规则原文：${rule.expression}\n` +
          `        （params 源码形态：${(rule.paramsRaw ?? "（无）").slice(0, 80)}）\n` +
          `        —— 阈值引用了一个不存在的旋钮 ⇒ 运行期解析不出数、判据恒 UNKNOWN，而屏上看不出来。`,
      );
    }
  }
}

/* ---------- H5 棘轮（存量豁免只降不升，每条理由 ≥10 字）---------- */
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const keyOf = (h) => `${h.file}#${sha(h.text)}`;
const MIN_REASON = 10;

/* ── D5/D6 内容键（共享实现 scripts/lib/ratchet-conservation.mjs）──────────────────
 * H5 旧键 = 文件+原文哈希 ⇒ 业务名从文件 A 搬到文件 B 会被当成「新增」假红（内容没变，
 * 总量没变）。内容键剔掉文件：搬家 ⇒ 跨文件认领 ⇒ 守恒不红；换新词/改文案 ⇒ 键变 ⇒ D6 红。
 * H8 旧判据只有条数棘轮 ⇒ 同数调包（95 改成 96，条数不变）恒绿。内容键 =
 * bindingId+ruleKey+metricPath+value：集合对账，调包当场点名。 */
const h5entries = hits.map((h) => ({
  key: contentKey("H5", h.token, h.text),
  file: h.file,
  label: `${h.token} @ L${h.line}: ${h.text}`,
  h,
}));
const h8entries = literalRows.map((r) => ({
  key: contentKey("H8", r.bindingId, r.ruleKey, r.metricPath, r.value),
  file: RULE_REGISTRY_FILE, // 阈值字面量的产地在规则库（battery.ts），不是判据声明表
  label: `${r.bindingId}(${r.ruleKey}=${r.value})`,
  r,
}));

if (argv.includes("--entries-json")) {
  // 诊断/迁移用：dump 内容键条目后退出（不进比对、不写任何文件）
  process.stdout.write(
    JSON.stringify(
      {
        h5: h5entries.map((en) => ({ key: en.key, file: en.file, label: en.label, legacyKey: keyOf(en.h) })),
        h8: h8entries.map((en) => ({ key: en.key, file: en.file, label: en.label })),
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

const baselineExists = existsSync(BASELINE);
const baseline = baselineExists ? JSON.parse(readFileSync(BASELINE, "utf8")) : { maxExemptions: 0, exemptions: {} };
if (isUpdate) {
  // 基线写入器四向金丝雀（与 buildBaselineDoc 共用同一份实现，不另抄）——
  // 本基线有 **两个**归人手的散文键（note / noteLiteral），原实现两个都无条件落常量。
  const bc = baselineDocCanary();
  if (!bc.ok) gateToolBroken(`基线写入器金丝雀不过（${bc.got}）；期望：${bc.want}`);
  // D5/D6 落账段：人手 why 逐字节沿用（buildContentsSegment 保证）；H5 **新落账**的键
  // why 置空 ⇒ 门红「豁免无理由」直到人手补 ≥10 字理由 —— 与旧实现 reason:"" 同级纪律，
  // 不许让 --update 变成「不问理由直接洗绿」的按钮。
  const seg5 = buildContentsSegment(h5entries, baseline.contentsH5 ?? null, "chain-scan-honesty:check/H5");
  for (const k of Object.keys(seg5)) if (!baseline.contentsH5?.[k]) seg5[k].why = "";
  const seg8 = buildContentsSegment(h8entries, baseline.contentsH8 ?? null, "chain-scan-honesty:check/H8");
  // exemptions 旧账簿已被 contentsH5 取代 —— 单一账簿，双写必漂（人手理由今后只写在 contentsH5.why）。
  // 在 **prev 侧**摘除（buildBaselineDoc 会 `...prev` 全摊开，产出 doc 上再 delete 已晚）；
  // ⚠ buildBaselineDoc 必须**内联在 writeFileSync 实参里** —— 抽成 `const doc = …` 再写，
  //   baseline-writer-honesty:check 判 HAND_ROLLED（该门头注自己点名了这种形态；本处实测踩过）。
  const prevSansExemptions = (() => {
    if (!baselineExists) return null;
    const { exemptions: _droppedLegacyLedger, ...rest } = baseline;
    return rest;
  })();
  writeFileSync(
    BASELINE,
    JSON.stringify(
      buildBaselineDoc({
        prev: prevSansExemptions,
        prose: {
          note:
            "chain-scan-honesty:check 的 H5 业务名棘轮。key = 文件 + 声明原文 sha256 前 16 位（不是行号——行号会漂）；" +
            "文案一改哈希即变 ⇒ 豁免当场失效、门重新红。maxExemptions 必须恒等于条数（加一条 = 一处显眼 diff）；只降不升。",
          noteLiteral:
            "H8 字面量阈值棘轮：阈值源 source==='literal' 的判据条数，只降不升。literal 不是罪 —— 它在规则表达式里、" +
            "可审计、改规则即改判定；但它比 param 僵（要改表达式而非旋钮），故存量记账、新增被挡。迁往 params 即可收窄。",
        },
        computed: {
          // ⚠ 计的是**命中条数**不是 key 数：同一行出现两个业务名（`化成柜位/老化库位`）时
          //   两条命中共用一个 key（key = 原文哈希），若按 key 数记基线，复跑时 4 > 3 会假红。
          maxExemptions: hits.length,
          maxLiteralThresholds: literalRows.length,
          literalThresholds: literalRows,
          contentsH5: seg5,
          contentsH8: seg8,
        },
      }),
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ 棘轮基线已写：H5 ${h5entries.length} 条 · H8 ${h8entries.length} 条（H5 每条须补 ≥${MIN_REASON} 字理由（contentsH5.why），否则门红）。`);
  process.exit(0);
}

/* ── D5 全局守恒 + D6 unlisted 落账（共享实现 scripts/lib/ratchet-conservation.mjs）────
 * contentsH5/contentsH8 段存在 ⇒ 内容对账：搬家（同键换文件）守恒不红；新内容/同数调包 ⇒ 红且点名。
 * 段缺失（老基线）⇒ notEstablished，走旧逻辑逐字节原样（不在红绿路径上静默补账）。 */
const recon5 = reconcileContents({
  gate: "chain-scan-honesty:check/H5",
  contents: baseline.contentsH5,
  current: h5entries,
  tightenCmd: "node scripts/check-chain-scan-honesty.mjs --update",
});
const recon8 = reconcileContents({
  gate: "chain-scan-honesty:check/H8",
  contents: baseline.contentsH8,
  current: h8entries,
  tightenCmd: "node scripts/check-chain-scan-honesty.mjs --update",
});

const exempted = [];
const newHits = [];
if (recon5.notEstablished) {
  // 老基线（无 contentsH5 段）：旧逻辑原样
  for (const h of hits) {
    const e = baseline.exemptions?.[keyOf(h)];
    if (e) exempted.push({ h, reason: e.reason });
    else newHits.push(h);
  }
  for (const h of newHits) {
    fail.push(
      `H5 业务名棘轮：${h.file}:${h.line} 新增内联行业业务名 \`${h.token}\`（词表自 BASE_REGISTRY 派生）\n` +
        `        ${h.text}\n` +
        `        —— 业务名必须来自对象库/册；确有必要保留请 \`node scripts/check-chain-scan-honesty.mjs --update\` 登账并写 ≥${MIN_REASON} 字理由。`,
    );
  }
} else {
  // 内容对账：matched（含跨文件搬家认领）= 守恒不红；unmatched = 新内容/调包 ⇒ D6 红且点名
  const un = new Set(recon5.unmatched.map((u) => u.h));
  for (const en of h5entries) {
    if (un.has(en.h)) newHits.push(en.h);
    else exempted.push({ h: en.h, reason: baseline.contentsH5?.[en.key]?.why ?? "" });
  }
  for (const f of recon5.fails) fail.push("[H5] " + f);
}
for (const { h, reason } of exempted) {
  if (typeof reason !== "string" || reason.trim().length < MIN_REASON) {
    fail.push(
      `H5 豁免无理由：${h.file}:${h.line} \`${h.token}\` 的豁免理由不足 ${MIN_REASON} 字（当前 "${reason ?? ""}"）\n` +
        `        —— 无理由白名单等于把门关掉，本门只接受**写清楚为什么**的棘轮。`,
    );
  }
}
if (typeof baseline.maxExemptions === "number" && exempted.length > baseline.maxExemptions) {
  fail.push(`H5 棘轮：豁免 ${exempted.length} 条 > 基线 ${baseline.maxExemptions} 条 —— 只降不升`);
}
if (typeof baseline.maxLiteralThresholds === "number" && literalRows.length > baseline.maxLiteralThresholds) {
  fail.push(
    `H8 字面量阈值棘轮：source="literal" 的判据 ${literalRows.length} 条 > 基线 ${baseline.maxLiteralThresholds} 条 —— 只降不升\n` +
      `        新增：${literalRows.map((r) => `${r.bindingId}(${r.ruleKey}=${r.value})`).join(" · ")}\n` +
      `        —— 新判据的阈值请用 \`params.<名>\`（改旋钮即改判定），而不是写进表达式字面量。`,
  );
}
// H8 同数调包：条数没涨（上面的计数棘轮不红）但内容键对不上基线 ⇒ D6 红且点名
if (!recon8.notEstablished) for (const f of recon8.fails) fail.push("[H8] " + f);

/* ---------- 报告 ---------- */
console.log(
  `· 扫描面 ${targets.length} 处：` + targets.map((t) => `${t.file.split("/").pop()}${t.method ? `#${t.method}` : ""}`).join(" · "),
);
console.log(
  `· H1 声明表 ${tables.length} 张零数值 · H2 构造区 ${regions.length} 个 · H3 兜底默认 0 · ` +
    `H4 solverKey="${keyDecl ? keyDecl[1] : "?"}" ${keyDecl && solverKeys.has(keyDecl[1]) ? "在册" : "不在册"} · ` +
    `H5 业务名命中 ${hits.length}（豁免 ${exempted.length}/${baseline.maxExemptions ?? 0}，新增 ${newHits.length}）`,
);
console.log(
  `· H6 规则在册 ${bindings.length - notInRegistry}/${bindings.length}（规则库解析 ${rules.size}/${new Set(reg.declaredKeys).size} 条）· ` +
    `H7 溯源可达（ABSENT ${sourceTally.ABSENT - notInRegistry}）· ` +
    `H8 阈值源 param ${sourceTally.param} / field ${sourceTally.field} / literal ${sourceTally.literal}` +
    `（literal 棘轮基线 ${baseline.maxLiteralThresholds ?? "未设"}）`,
);
if (isList) for (const r of literalRows) console.log(`    [H8·literal] ${r.bindingId} ${r.ruleKey} ${r.metricPath} = ${r.value}`);
if (isList) for (const h of hits) console.log(`    [H5] ${h.file}:${h.line} ${h.token} | ${h.text}`);

if (fail.length > 0) {
  console.error(`\n✗ chain-scan-honesty:check 未通过（${fail.length} 条 · PRD-sandbox-redesign §9 验收 A2「零写死」）：`);
  for (const m of fail) console.error(`  - ${m}`);
  console.error(
    "\n  命题：屏上/回包里的每个数字都来自求解器输出或对象库，不是源码里的字面量。" +
      "\n  写死数字的看板比空白更危险 —— 它看着专业，但那个数不会因为现实变化而变。",
  );
  process.exit(1);
}
console.log("\n✓ chain-scan-honesty:check 通过（全链扫描输出零写死：阈值全从规则读回 · 构造位无裸字面量 · 无兜底默认 · solverKey 在册）。");
