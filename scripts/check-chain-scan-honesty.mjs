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
 * 本门开扫之前先拿**内嵌样例**过一遍检测器（N 条必咬 + M 条必不咬）+ 规模下界自证。任一不成立
 * ⇒ 打印「⛔ 门自己瞎了」并 RC=1，**而不是安静报「代码干净」**。理由是本会话实测过的四个陷阱
 * （见 `docs/VERIFY-batch-2026-08-08.md`）：`git grep -- "apps/<星>/src"` 的 pathspec 通配符不跨 `/`
 * 恒 0 命中、import 图解析器不认 ESM `./x.js`、正则窗口截断符号名 —— 三者都会让扫描器
 * **报 0 命中**，而 0 命中在门里恰好长得跟"代码干净"一模一样。失败方向不安全的门必须自证工具是对的。
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
 * 本体登记：`docs/SYSTEM-ONTOLOGY.md` §7。门账：`scripts/gate-ledger.json`（binding=GATE_SH）。
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


import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/chain-scan-honesty-baseline.json");

/** 扫描面 = 全链扫描输出的产出链：判定器本体 + 喂它 metricValue 的读回层 + IO 聚合半。 */
const SCAN_TARGETS = [
  { file: "apps/datacore/src/solvers/chain-impediment.ts", role: "判定器本体（回包每个数字的产地）" },
  { file: "packages/contracts/src/process-capacity.ts", role: "硬容量读回层（喂 parallelThroughput）" },
  // 聚合/IO 半：只取 `chainImpediments` 方法体（service.ts 有 4000+ 行，整文件扫会淹没在无关代码里）
  { file: "apps/datacore/src/solvers/service.ts", role: "IO 聚合半", method: "chainImpediments" },
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

/**
 * 规则库全集（事实层 · H6/H7/H8 的 oracle）：`{ key -> expression }`。
 * 门不抄一份规则清单 —— 抄一份就是本门要治的病（"改规则不改推演"的诱饵）。
 */
function ruleRegistry() {
  const code = stripComments(read(RULE_REGISTRY_FILE));
  const blk = declInitBlock(code, RULE_REGISTRY_SYMBOL);
  const out = new Map();
  if (!blk) return out;
  // expression 既可能是 "…" 也可能是模板串 `…${ruleParamRef("staleHours")}…`，两种都收。
  for (const m of blk.code.matchAll(/\bkey:\s*"([A-Z]\d+)"[\s\S]{0,400}?\bexpression:\s*(["'`])([\s\S]*?)\2/g)) {
    if (!out.has(m[1])) out.set(m[1], m[3]);
  }
  return out;
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
  const cmp = new RegExp(
    // ⚠ 右侧终止符必须含 `,`：`SUSTAIN(Line.utilization > 95, 3)` 里不排除逗号会读成 "95," ⇒
    //   归类失败 → 该判据被误报成 ABSENT。金丝雀「必不咬样例被误咬」当场抓到了这个（本门第二次自伤）。
    String.raw`(?:[\w.]*\b)?${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*(<=|>=|==|!=|<|>)\s*([^\s),]+)`,
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

const rules = ruleRegistry();
const bindings = tables.flatMap((t) => (t.name === DECL_TABLES[0] ? parseBindings(t.code) : []));

const ctx = { targets, regions, tables, bindingCount, solverKeys, vocab, rules, bindings };

/* ---------- 金丝雀先跑：门瞎了与代码脏了必须分开报（修法完全不同） ---------- */
const blind = selftest(ctx);
if (blind.length > 0) {
  console.error("⛔ 门自己瞎了（不是「代码干净」）—— chain-scan-honesty:check 无法给出有效结论：");
  for (const b of blind) console.error(`  - ${b}`);
  console.error("\n  修法：修门（锚点/正则/事实源解析），不是修被扫代码。0 命中在本门里长得跟通过一模一样，故必须先自证工具是对的。");
  process.exit(1);
}
console.log(
  `· 金丝雀通过：必咬 ${MUST_BITE.length}/${MUST_BITE.length} · 必不咬 ${MUST_NOT_BITE.length}/${MUST_NOT_BITE.length} · ` +
    `扫描面 ${targets.length} · 构造区 ${regions.length} · 声明表 ${tables.length}（${bindingCount} 条 binding）· ` +
    `SOLVER_KEYS ${solverKeys.size} · 业务词表 ${vocab.size}`,
);
if (isSelftestOnly) process.exit(0);

/* ---------- 判据逐条跑 ---------- */
const fail = [];
const hits = []; // H5 棘轮候选

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
for (const b of bindings) {
  // H6 ruleKey 当场读回：判据声称"阈值出自 C22"，那 C22 得真在规则库里。
  if (!b.ruleKey || !rules.has(b.ruleKey)) {
    fail.push(
      `H6 规则在册（事实层）：判据 ${b.bindingId} 声称阈值出自规则 ${b.ruleKey ?? "（未声明）"}，` +
        `但 ${RULE_REGISTRY_FILE} 的 ${RULE_REGISTRY_SYMBOL} 里没有这条规则\n` +
        `        —— 虚构一个规则码会让它看着像官方阈值，实际全仓无定义：溯源链第一环就断了。`,
    );
    sourceTally.ABSENT++;
    continue;
  }
  // H7 声称的来源真存在：规则表达式必须真以该 metricPath 为比较操作数，否则判据与规则口径不符。
  const cls = classifyThresholdSource(rules.get(b.ruleKey), b.metricPath);
  sourceTally[cls.source]++;
  if (cls.source === "ABSENT") {
    fail.push(
      `H7 溯源可达：判据 ${b.bindingId} 声称读 ${b.ruleKey} 的 ${b.metricPath} 阈值，但${cls.reason}\n` +
        `        规则原文：${rules.get(b.ruleKey)}\n` +
        `        —— 判据与规则口径不符 ⇒ 运行期只会恒 UNKNOWN 或读回一个不相干的数（后者是静默错答）。`,
    );
  } else if (cls.source === "literal") {
    literalRows.push({ bindingId: b.bindingId, ruleKey: b.ruleKey, metricPath: b.metricPath, value: cls.value });
  }
}

/* ---------- H5 棘轮（存量豁免只降不升，每条理由 ≥10 字）---------- */
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const keyOf = (h) => `${h.file}#${sha(h.text)}`;
const MIN_REASON = 10;

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { maxExemptions: 0, exemptions: {} };
if (isUpdate) {
  const exemptions = {};
  for (const h of hits) {
    const k = keyOf(h);
    exemptions[k] = baseline.exemptions?.[k] ?? { file: h.file, token: h.token, reason: "" };
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          "chain-scan-honesty:check 的 H5 业务名棘轮。key = 文件 + 声明原文 sha256 前 16 位（不是行号——行号会漂）；" +
          "文案一改哈希即变 ⇒ 豁免当场失效、门重新红。maxExemptions 必须恒等于条数（加一条 = 一处显眼 diff）；只降不升。",
        // ⚠ 计的是**命中条数**不是 key 数：同一行出现两个业务名（`化成柜位/老化库位`）时
        //   两条命中共用一个 key（key = 原文哈希），若按 key 数记基线，复跑时 4 > 3 会假红。
        maxExemptions: hits.length,
        exemptions,
        noteLiteral:
          "H8 字面量阈值棘轮：阈值源 source==='literal' 的判据条数，只降不升。literal 不是罪 —— 它在规则表达式里、" +
          "可审计、改规则即改判定；但它比 param 僵（要改表达式而非旋钮），故存量记账、新增被挡。迁往 params 即可收窄。",
        maxLiteralThresholds: literalRows.length,
        literalThresholds: literalRows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ 棘轮基线已写：${Object.keys(exemptions).length} 条豁免（每条须补 ≥${MIN_REASON} 字理由，否则门红）。`);
  process.exit(0);
}

const exempted = [];
const newHits = [];
for (const h of hits) {
  const e = baseline.exemptions?.[keyOf(h)];
  if (e) exempted.push({ h, e });
  else newHits.push(h);
}
for (const h of newHits) {
  fail.push(
    `H5 业务名棘轮：${h.file}:${h.line} 新增内联行业业务名 \`${h.token}\`（词表自 BASE_REGISTRY 派生）\n` +
      `        ${h.text}\n` +
      `        —— 业务名必须来自对象库/册；确有必要保留请 \`node scripts/check-chain-scan-honesty.mjs --update\` 登账并写 ≥${MIN_REASON} 字理由。`,
  );
}
for (const { h, e } of exempted) {
  if (typeof e.reason !== "string" || e.reason.trim().length < MIN_REASON) {
    fail.push(
      `H5 豁免无理由：${h.file}:${h.line} \`${h.token}\` 的豁免理由不足 ${MIN_REASON} 字（当前 "${e.reason ?? ""}"）\n` +
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
  `· H6 规则在册 ${bindings.length - sourceTally.ABSENT}/${bindings.length} · H7 溯源可达（ABSENT ${sourceTally.ABSENT}）· ` +
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
