#!/usr/bin/env node
/**
 * 门 `befe-seam:check` · 后端↔前端接缝门（WO-GATE-BEFE-SEAM · 闭本体 §8 `G-BE-FE-SEAM-DEAD`）
 *
 * ── 治什么 ────────────────────────────────────────────────────────────────────
 * 本仓已有 SEAM-GATE 纪律，但它只覆盖「数据+引擎两半」与「A+B 两系统」，
 * **从没把「后端+前端两半」列进去** ⇒ 这一类缺口一路裸奔：后端改造全落地、前端消费方是 0。
 *
 * 实测最刺眼的一例（2026-08-09）：
 *   `apps/agentcore/src/router/orchestrator.ts` 的 Coordinator 旁白 emit 里发 `roleLabel`，
 *   紧邻的注释白纸黑字写着「结构化字段（role/roleLabel）供前端分栏」，
 *   而 `apps/frontend-shell/src/sse/taskStreamReducer.ts` 的 `selectStepRows` 解构
 *   `{ stepId, type, outcome, durationMs, text }` —— **根本不读这两个字段**。
 *   后端写了、注释承诺了、测试全绿，前端一个字都没接。
 *
 * ── 判据（两类载体，各自棘轮） ────────────────────────────────────────────────
 *   载体① SSE 事件字段：agentcore `src/` 里 `emit(...)` 的 payload 对象字面量顶层字段名
 *          → 前端**生产代码**（`apps/frontend-shell/src/**`，剔除 `mocks/` 与测试）必须提到该字段名。
 *   载体② HTTP 端点：datacore/agentcore `src/` 注册的 `/a/v1` `/b/v1` `/api/v1` 路由
 *          → 前端生产代码必须有对应 URL 字面量（`/b/v1` 别名重写表从 `server.ts` 单源抽取）。
 *
 * **棘轮门，不是全量门**：今天的存量缺口太大，要求全绿会当场卡死所有人。
 * 缺口清单记进 `scripts/backend-frontend-seam-baseline.json`；门只断言「不许比基线更差」。
 * `--update` **只删不加**（修好的从基线里摘掉，新缺口不许自动招安）——基线只减不增。
 *
 * ── 诚实边界（必须先读，免得把这道门当成它不是的东西） ──────────────────────
 *  · 载体① 的消费判据是「字段名在前端生产代码里出现过」。这是**必要条件不是充分条件**：
 *    名字撞车会漏报（`role`/`type` 这类通名在前端本就到处是，本门抓不到它们的缺口）；
 *    泛化消费（整包 `JSON.stringify(data)`）会误报（本仓当前无此写法，实测过）。
 *    它抓得住的是 `roleLabel` `promptVersion` `contextSnapshot` 这类**专名零消费**——
 *    也正是本仓今天真实的那一片缺口。
 *  · 载体① 只解析**对象字面量**。`emit(taskId, "answer.final", answer)` 这种变量 payload
 *    的字段来自 `@platform/contracts` 的类型，由 contracts-only-shared 纪律另管，本门不猜（计数如实报）。
 *  · 载体② 的豁免表按**结构性理由**分类（探活/服务间/认证基础设施），每条带理由，不许无理由豁免。
 *
 * ── 金丝雀（本门的核心，比断言本身更重要） ──────────────────────────────────
 * 铁律 0.6：任何扫描/解析/计数在报出结论前，必须先跑一个「已知必中」样例。
 * 本门的金丝雀 **与主逻辑共用同一批导出函数**（`lex` / `extractEmitFields` / `extractBackendRoutes` /
 * `extractFrontendPaths` / `mentionsInProd`），不另抄一份正则——抄了就是装饰品：
 * 改主正则时金丝雀拿旧的去测、照样绿（本仓 2026-08-08 实测踩过）。
 * 金丝雀不中 ⇒ 打印「⛔ 门自己坏了」并 `exit 2`，**绝不允许**报「代码干净 / 零缺口」。
 * 消费判据的金丝雀是**双向**的：既验「已知存在的名字必须命中」，也验「已知不存在的名字必须不中」——
 * 一个恒真的匹配器会把所有缺口藏起来、一个恒假的会把全仓报成缺口，单向金丝雀两者都测不出来。
 *
 * 用法：node scripts/check-backend-frontend-seam.mjs [--update] [--seed] [--verbose]
 *   （无参 = 判定；--seed = 首次建账，基线已存在则拒绝；--update = 收紧基线，只减不增；--verbose = 列缺口明细）
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门 `befe-seam:check`）· §8（断点 `G-BE-FE-SEAM-DEAD`）。
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
  console.error(`⛔ check-backend-frontend-seam.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/backend-frontend-seam-baseline.json");

// ⚠ 位置是刻意的：本常量原先声明在文件尾部（`writeBaseline` 旁），而金丝雀区在它**之前**运行
//   ⇒ 金丝雀里一碰它就是 TDZ 报错。而金丝雀里抛异常被映射成 RC=2「门自己坏了」，
//   于是「给基线写入加一条金丝雀」这个动作本身会把整道门变成恒 RC=2。故提到顶部。
//   （只搬声明，正文一字未改。）
const BASELINE_NOTE =
  "后端↔前端接缝缺口棘轮基线（WO-GATE-BEFE-SEAM · 闭本体 §8 G-BE-FE-SEAM-DEAD）。" +
  "sseFields = 后端 emit 了、前端生产代码零提及的字段名；endpoints = 后端注册了、前端零调用的路由。" +
  "**只减不增**：--update 只摘掉已修复项，绝不收编新增缺口（否则棘轮秒变橡皮图章）；" +
  "要把一条新缺口记进存量，必须人手编辑本文件——那是一个可评审的显式动作，不是脚本的副作用。" +
  "首次建账（本文件不存在时）用 --seed。";
const FE_SRC = join(ROOT, "apps/frontend-shell/src");
const AGENTCORE_SRC = join(ROOT, "apps/agentcore/src");
const DATACORE_SRC = join(ROOT, "apps/datacore/src");
const AGENTCORE_SERVER = join(ROOT, "apps/agentcore/src/server.ts");

/**
 * 退出码三分（本仓统一约定）：`0` 干净 / `1` 真有问题 / `2` **工具自己坏了**。
 * 没有这道兜底，门内部任何一次抛异常都会以 **RC=1** 收场 —— 而 RC=1 的语义是
 * 「你的代码有接缝缺口」。**「门崩了」被读成「代码有问题」是误报，方向正好相反**。
 * （实测：变异 E 绕开 `scanText()` 手搓扫描面记录 → 崩在诚实位累加处 → RC=1，
 *   金丝雀根本没轮上跑。这条 handler 把它扳回 RC=2「我没查出来」。）
 */
const dieAsToolBroken = (e) => {
  console.error("⛔ 门自己坏了 —— befe-seam:check 内部抛异常，本次**不产出任何结论**。");
  console.error("   （铁律 0.6：只许报「我没查出来」，绝不许报「代码干净 / 零缺口」。）\n");
  console.error(e?.stack ?? String(e));
  process.exit(2);
};
process.on("uncaughtException", dieAsToolBroken);
process.on("unhandledRejection", dieAsToolBroken);

const argv = new Set(process.argv.slice(2));
const UPDATE = argv.has("--update");
const SEED = argv.has("--seed");
const VERBOSE = argv.has("--verbose");

/* ════════════════════════════════════════════════════════════════════════════
 * 1 · 词法扫描原语
 *
 * 为什么要自己写而不是裸正则：本仓源码里真有 `replace(/\/$/, "")` 这种**正则字面量内含 `//`**
 * 的写法（`apps/agentcore/src/agent/production-cognition.ts:52` 等 5 个文件）。裸正则把那两个斜杠
 * 读成行注释起点 ⇒ 该行剩下的代码整段被当注释吞掉 ⇒ 抽取器悄悄少数据、报出的是"干净"。
 * 这正是铁律 0.6 那五连犯的形态（拿一个看起来相关的数字当判据）。故必须做**正则字面量感知**的扫描。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** mask 取值：0=代码 · 1=注释 · 2=字符串/模板 · 3=正则字面量 */
export const M_CODE = 0, M_COMMENT = 1, M_STRING = 2, M_REGEX = 3;

const REGEX_PREV_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do",
  "else", "case", "yield", "await", "throw",
]);
/** `/` 是正则起点还是除号：看前一个有效码点（标准启发式）。 */
function regexAllowed(prevChar, prevWord) {
  if (prevWord) return REGEX_PREV_KEYWORDS.has(prevWord);
  if (prevChar === "") return true;
  return "([{;,:=!&|?+-*%~^<>".includes(prevChar);
}

function scanQuoted(src, i, q) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") { j += 2; continue; }
    if (src[j] === q) return j + 1;
    if (src[j] === "\n") return j; // 未闭合（不该出现）——就地止损，别把整个文件吞掉
    j++;
  }
  return j;
}

function scanTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return j + 1;
    if (c === "$" && src[j + 1] === "{") { j = skipBracedExpr(src, j + 2); continue; }
    j++;
  }
  return j;
}

/** 从 `${` 之后扫到配平的 `}`（内部可再嵌套字符串/模板/注释）。 */
function skipBracedExpr(src, j) {
  let depth = 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "{") { depth++; j++; continue; }
    if (c === "}") { depth--; j++; if (depth === 0) return j; continue; }
    if (c === '"' || c === "'") { j = scanQuoted(src, j, c); continue; }
    if (c === "`") { j = scanTemplate(src, j); continue; }
    if (c === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; continue; }
    if (c === "/" && src[j + 1] === "*") { j += 2; while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++; j += 2; continue; }
    j++;
  }
  return j;
}

function scanRegexLiteral(src, i) {
  let j = i + 1, inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "\n") return -1;            // 正则不跨行 ⇒ 这个 `/` 其实是除号
    if (c === "[") { inClass = true; j++; continue; }
    if (c === "]") { inClass = false; j++; continue; }
    if (c === "/" && !inClass) { j++; while (j < src.length && /[a-z]/.test(src[j])) j++; return j; }
    j++;
  }
  return -1;
}

/**
 * 一遍扫描出 mask（每个字符是代码/注释/字符串/正则）与全部字符串字面量 span。
 * 主逻辑与金丝雀共用此函数——所有"某处是不是真代码"的判断都只有这一个出处。
 */
export function lex(src) {
  const n = src.length;
  const mask = new Uint8Array(n);
  const strings = [];
  let i = 0, prevChar = "", prevWord = "";
  const fill = (s, e, v) => { for (let k = s; k < e && k < n; k++) mask[k] = v; };

  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const s = i; while (i < n && src[i] !== "\n") i++; fill(s, i, M_COMMENT); prevChar = ""; prevWord = ""; continue; }
    if (c === "/" && src[i + 1] === "*") { const s = i; i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i = Math.min(n, i + 2); fill(s, i, M_COMMENT); prevChar = ""; prevWord = ""; continue; }
    if (c === "/" && regexAllowed(prevChar, prevWord)) {
      const e = scanRegexLiteral(src, i);
      if (e > 0) { fill(i, e, M_REGEX); i = e; prevChar = "/"; prevWord = ""; continue; }
    }
    if (c === '"' || c === "'") { const e = scanQuoted(src, i, c); strings.push({ start: i, end: e, kind: "str", value: src.slice(i + 1, e - 1) }); fill(i, e, M_STRING); i = e; prevChar = c; prevWord = ""; continue; }
    if (c === "`") { const e = scanTemplate(src, i); strings.push({ start: i, end: e, kind: "tmpl", value: src.slice(i + 1, Math.max(i + 1, e - 1)) }); fill(i, e, M_STRING); i = e; prevChar = "`"; prevWord = ""; continue; }
    if (!/\s/.test(c)) {
      if (/[A-Za-z0-9_$]/.test(c)) { prevWord += c; } else { prevWord = ""; }
      prevChar = c;
    }
    i++;
  }
  return { mask, strings };
}

/** 从 `(`（或 `{`）位置起，按顶层逗号切实参/属性，跳过字符串/模板/注释/嵌套括号。 */
export function splitTopLevel(src, openIdx) {
  const open = src[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  const parts = [];
  let depth = 0, j = openIdx, partStart = openIdx + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") { j = scanQuoted(src, j, c); continue; }
    if (c === "`") { j = scanTemplate(src, j); continue; }
    if (c === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; continue; }
    if (c === "/" && src[j + 1] === "*") { j += 2; while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++; j += 2; continue; }
    if (c === "(" || c === "{" || c === "[") { depth++; j++; continue; }
    if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0 && c === close) { parts.push(src.slice(partStart, j)); return { parts, end: j + 1 }; }
      j++; continue;
    }
    if (c === "," && depth === 1) { parts.push(src.slice(partStart, j)); partStart = j + 1; j++; continue; }
    j++;
  }
  return { parts, end: src.length };
}

/**
 * 抹掉注释（保留原长度，用空格填充），供"键名识别"这类**必须只看代码**的场合用。
 *
 * ⚠️ 为什么有这个函数：本门第一次做变异反证时，我给后端 emit payload 加了一个字段，
 * 并在它上一行写了行注释（本仓真实写法，payload 里注释满地都是）。**门没红。**
 * 病因：`splitTopLevel` 按顶层逗号切出来的那一段长这样——
 *     `\n  // 结构化字段，供前端分栏\n  escalationRationaleLabel: "x"`
 * `trim()` 之后首字符是 `/`，`^ident\s*:` 一条都匹配不上 ⇒ **有注释的字段一律读作不存在**。
 * 13 条金丝雀全中、门照样绿——因为没有一条金丝雀喂过"带注释的 payload"。
 * 这正是变异反证存在的理由：**金丝雀证明工具在我想到的输入上没坏，变异反证才检验它在我没想到的输入上坏没坏。**
 * 现补金丝雀 C3b 钉死此形态。
 */
export function stripComments(text) {
  const { mask } = lex(text);
  let out = "";
  for (let i = 0; i < text.length; i++) out += mask[i] === M_COMMENT ? (text[i] === "\n" ? "\n" : " ") : text[i];
  return out;
}

/** 把模板串里的 `${…}` 插值整段挖掉，只留**字面**文本（插值是代码，不是散文）。 */
export function stripInterpolations(value) {
  let out = "", i = 0;
  while (i < value.length) {
    if (value[i] === "$" && value[i + 1] === "{") { i = skipBracedExpr(value, i + 2); continue; }
    out += value[i]; i++;
  }
  return out;
}

/**
 * 「这段字符串字面量是**散文**，不是机器令牌」——本门两类载体的**唯一**散文判据。
 *
 * ⚠️ 为什么必须有它（欠账 #174 · 实测于 2026-08-11）：
 * `mentionsInProd` 早就剔了**注释**（金丝雀 C11 守着），但两类载体都没剔**字符串字面量**。
 * 于是本仓真实存在这一手——`apps/frontend-shell/src/store/eventInvalidation.ts:85` 的
 * `SIM_EVENT_GAPS` 是一本**用字符串记的缺口台账**，值就是一段中文说明，原文写着
 *   「缺的是后端读端不是前端订阅…datacore 只有 POST /a/v1/sim/sessions/:id/checkpoint」
 *   「解法…：开 GET /a/v1/sim/sessions/:id/checkpoints → 前端加 checkpoints useQuery」
 * 这两句**是在描述缺口**，而 `extractFrontendPaths` 把它们读成「前端在调这两条路由」。
 * **描述缺口的那段话，反而把缺口盖住了。**
 *
 * 实测今日遮蔽半径 = 0 条（`:id/checkpoint` 前端确有真调用 `api/endpoints.ts:596`；
 * `:id/checkpoints` 后端还没开），所以这是**一把上了膛没击发的枪**，不是已发生的事故。
 * 但第二句尤其毒：它描述的是一条**将来才会开**的路由，谁哪天真开了
 * `GET /a/v1/sim/sessions/:id/checkpoints`，那条缺口**出生即被豁免**——
 * 门第一天就认为前端已经在调它了，而前端一行都没写。
 *
 * 判据：剥掉 `${…}` 后的字面文本里，**出现非 ASCII 可打印字符**（中文/全角标点/emoji）
 * 或**含内部空白** ⇒ 散文。一条真 URL 串按构造不含空格、也不含中文。
 * 反向风险（过度剥离 ⇒ 把真调用误报成缺口）由金丝雀 `consume/机器令牌串仍算消费`
 * 与 `route/真 URL 模板仍算调用` 双向钉死。
 */
const NON_ASCII_RE = /[^\x20-\x7e]/;
export function isProseString(value) {
  const lit = stripInterpolations(value).trim();
  return NON_ASCII_RE.test(lit) || /\s/.test(lit);
}

/**
 * 扫描面记录的**唯一**构造出口：主逻辑与金丝雀都必须走它。
 * `mentionsInProd` 会硬性要求 `prose` 跨度存在——手搓记录会当场抛异常，
 * 而金丝雀里的异常被映射成 RC=2「门自己坏了」。
 * 这就是「不许各抄一份实现」的机器化：抄的人过不去，不是靠人记得。
 */
export function scanText(rel, src) {
  const { mask, strings } = lex(src);
  const prose = strings.filter((s) => isProseString(s.value)).map((s) => ({ start: s.start, end: s.end }));
  return { rel, src, mask, prose };
}

/**
 * 对象字面量的顶层键名。展开 `...(cond ? { a } : {})` 里嵌套的对象字面量键
 * （这类条件展开在本仓 emit payload 里是常见写法，不展开会把真字段读成不存在）。
 */
export function objectTopLevelKeys(objText) {
  const openIdx = objText.indexOf("{");
  if (openIdx < 0) return { keys: [], spreads: 0, dynamic: 0 };
  const { parts } = splitTopLevel(objText, openIdx);
  const keys = [];
  let spreads = 0, dynamic = 0;
  for (const raw of parts) {
    const p = stripComments(raw).trim();   // 注释不抹掉 ⇒ 带注释的字段全部读作不存在（见 stripComments 顶注）
    if (!p) continue;
    if (p.startsWith("...")) {
      spreads++;
      // 展开里若还嵌着对象字面量（三元的两支），把它们的键也算上
      let k = p.indexOf("{");
      while (k >= 0) {
        const inner = objectTopLevelKeys(p.slice(k));
        keys.push(...inner.keys);
        const { end } = splitTopLevel(p, k);
        k = p.indexOf("{", end);
      }
      continue;
    }
    if (p.startsWith("[")) { dynamic++; continue; }
    let m = /^([A-Za-z_$][\w$]*)\s*:/.exec(p);
    if (m) { keys.push(m[1]); continue; }
    m = /^["']([^"']+)["']\s*:/.exec(p);
    if (m) { keys.push(m[1]); continue; }
    m = /^([A-Za-z_$][\w$]*)\s*$/.exec(p);
    if (m) { keys.push(m[1]); continue; }
  }
  return { keys: [...new Set(keys)], spreads, dynamic };
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

/* ════════════════════════════════════════════════════════════════════════════
 * 2 · 载体① SSE 事件字段抽取
 *
 * 两条规则，缺一不可：
 *  R1 直接字面量：`emit(taskId, "step.completed", { stepId, type, … })`
 *     ⚠️ 事件名可能是**第二个**实参（`outbox.emit(x, "evt.name", p)`），
 *        故不认位置、认"长得像事件名的字符串字面量"（CLAUDE.md 铁律 0.6 第 5 例的教训）。
 *  R2 变量 payload 回溯：`payload = { … }` … `emit(taskId, e, payload)`
 *     —— **`roleLabel` 那条就长这样**（`orchestrator.ts` emitWithRole 包装器）。
 *        只做 R1 会把本门要治的头号实例整个漏掉，门照样绿。
 * ═══════════════════════════════════════════════════════════════════════════ */

const EVENT_NAME_RE = /^["']([a-z_]+(?:\.[a-z_]+)+)["']$/;

export function extractEmitFields(src) {
  const { mask } = lex(src);
  const out = [];              // { event, field, line }
  const payloadVars = new Map(); // varName -> [{event, line}]
  let unresolved = 0;

  for (const m of src.matchAll(/\bemit\s*\(/g)) {
    const at = m.index;
    if (mask[at] !== M_CODE) continue;                       // 注释/字符串里的示例不算
    const openIdx = at + m[0].length - 1;
    const { parts } = splitTopLevel(src, openIdx);
    if (parts.length === 0) continue;
    let event = "<dynamic>";
    let evIdx = -1;
    for (let k = 0; k < parts.length; k++) {
      const em = EVENT_NAME_RE.exec(parts[k].trim());
      if (em) { event = em[1]; evIdx = k; break; }
    }
    const last = parts[parts.length - 1].trim();
    if (evIdx === parts.length - 1) continue;                // 只有事件名、无 payload
    const line = lineOf(src, at);
    if (last.startsWith("{")) {
      const { keys } = objectTopLevelKeys(last);
      for (const f of keys) out.push({ event, field: f, line });
    } else if (/^[A-Za-z_$][\w$]*$/.test(last)) {
      if (!payloadVars.has(last)) payloadVars.set(last, []);
      payloadVars.get(last).push({ event, line });
    } else {
      unresolved++;                                          // `result.error` / `l3.answer` 之类：契约类型管，本门不猜
    }
  }

  // R2：变量 payload 回溯赋值处的对象字面量
  for (const [varName, sites] of payloadVars) {
    const re = new RegExp(String.raw`(?:^|[^\w$.])${varName}\s*=\s*\{`, "g");
    for (const am of src.matchAll(re)) {
      const braceIdx = src.indexOf("{", am.index);
      if (braceIdx < 0 || mask[braceIdx] !== M_CODE) continue;
      const { end } = splitTopLevel(src, braceIdx);
      const { keys } = objectTopLevelKeys(src.slice(braceIdx, end));
      const ev = sites[0]?.event ?? "<dynamic>";
      for (const f of keys) out.push({ event: ev === "<dynamic>" ? `<dynamic:${varName}>` : ev, field: f, line: lineOf(src, braceIdx) });
    }
  }
  return { fields: out, unresolved };
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3 · 载体② 路由抽取与归一
 * ═══════════════════════════════════════════════════════════════════════════ */

const METHODS = "get|post|put|patch|delete|head|options";

export function extractBackendRoutes(src) {
  const { mask } = lex(src);
  const routes = [];
  const re = new RegExp(String.raw`\.(${METHODS})\s*(?:<[^(){}]*>)?\s*\(\s*(["'\`])(\/[^"'\`]*)\2`, "g");
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== M_CODE) continue;
    routes.push({ method: m[1].toUpperCase(), path: m[3], line: lineOf(src, m.index) });
  }
  return routes;
}

/** 模板里的 `${…}` 整段换成 `*`（必须配平大括号，懒惰正则会把后面的路径段一起吃掉）。 */
export function normalizeTemplatePath(s) {
  let out = "", i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") { const end = skipBracedExpr(s, i + 2); out += "*"; i = end; continue; }
    out += s[i]; i++;
  }
  return out;
}

/** 归一：去 query、去尾斜杠、`:param` → `*`。 */
export function normalizePath(p) {
  let s = normalizeTemplatePath(p).split("?")[0].split("#")[0];
  s = s.replace(/\/+$/, "");
  s = s.split("/").map((seg) => (seg.startsWith(":") ? "*" : seg)).join("/");
  return s || "/";
}

const PATH_PREFIX_RE = /\/(?:a|b|api)\/v1\//g;

/**
 * 从字符串字面量里切出一条 URL 路径，**`${…}` 整段原子跳过**。
 *
 * ⚠️ 这一步的第一版是错的，且错得很典型（已亲手实测，留此为戒）：
 * 用字符类 `[^"'`\s)\\,]*` 一路吃到底 —— 它在 `${encodeURIComponent(objectId)}` 的那个 `)` 上停住，
 * 于是 `/a/v1/objects/${encodeURIComponent(objectId)}/neighbors` 被切成 `/a/v1/objects/${encodeURIComponent(objectId`，
 * 归一后成 `/a/v1/objects/*`，段数 4 ≠ 后端的 5 ⇒ **前端明明调了却被报成「零调用」**。
 * 而当时的金丝雀 C8 只单测 `normalizePath`（拿手写的样例串），端到端那一层没测，照样全绿。
 * 教训与 CLAUDE.md 铁律 0.6 完全同形：**测了一个看起来相关的东西，它不度量我要度量的那件事**。
 * 现补 C7b：拿真 `endpoints.ts` 端到端跑，断言归一后必出 `/a/v1/objects/<通配>/neighbors`。
 */
function scanPathFrom(value, start) {
  let i = start, out = "";
  while (i < value.length) {
    if (value[i] === "$" && value[i + 1] === "{") {
      const end = skipBracedExpr(value, i + 2);
      out += value.slice(i, end);
      i = end;
      continue;
    }
    const c = value[i];
    if (/[\s"'`\\]/.test(c) || c === ")" || c === "," || c === ";") break;
    // URL 按构造是 ASCII：碰到中文/全角标点就到头了。
    // （不加这一条，散文里的「…/checkpoint，解法：开 GET …」会被整段吃进来当成一条路径 —— 已实测，
    //   是本门加散文剔除时金丝雀 `route/散文串不算调用` 当场抖出来的。）
    if (NON_ASCII_RE.test(c)) break;
    out += c;
    i++;
  }
  return out;
}

export function extractFrontendPaths(src) {
  const { strings } = lex(src);
  const found = new Set();
  for (const s of strings) {
    // 散文串里**提到**一条路由 ≠ 前端在**调**它（欠账 #174 · 见 isProseString 顶注）。
    // 缺口台账、TODO 说明、报错文案里写着的 URL 一律不算调用方。
    if (isProseString(s.value)) continue;
    for (const m of s.value.matchAll(PATH_PREFIX_RE)) found.add(normalizePath(scanPathFrom(s.value, m.index)));
  }
  return found;
}

/** 同一段源码里**散文串**写着的路由（不计作调用方的那些）——供报告的诚实位与金丝雀用。 */
export function extractProsePaths(src) {
  const { strings } = lex(src);
  const found = new Set();
  for (const s of strings) {
    if (!isProseString(s.value)) continue;
    for (const m of s.value.matchAll(PATH_PREFIX_RE)) found.add(normalizePath(scanPathFrom(s.value, m.index)));
  }
  return found;
}

/** `/api/v1/queries/…` ⇄ `/b/v1/queries/…` 别名（前缀表从 server.ts rewriteUrl 单源抽取，勿硬编码）。 */
export function extractRewritePrefixes(serverSrc) {
  const block = /rewriteUrl\s*\(req\)\s*\{[\s\S]*?\n {2}\}/.exec(serverSrc)?.[0] ?? "";
  return [...new Set([...block.matchAll(/"\/b\/v1\/([a-z-]+)"/g)].map((m) => m[1]))];
}

/** 路径匹配：段数相同，逐段 wildcard 兼容。 */
export function pathMatches(fePath, bePath) {
  const fe = fePath.split("/"), be = bePath.split("/");
  if (fe.length !== be.length) return false;
  for (let i = 0; i < fe.length; i++) {
    if (be[i] === "*" || fe[i] === "*") continue;
    if (fe[i] === be[i]) continue;
    if (fe[i].includes("*")) {
      const re = new RegExp("^" + fe[i].split("*").map((x) => x.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      if (re.test(be[i])) continue;
    }
    return false;
  }
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 4 · 前端生产代码面与"是否被消费"判据
 * ═══════════════════════════════════════════════════════════════════════════ */

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === "dist") continue; walk(p, acc); }
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 前端**生产**代码面：`src/**` 剔除 `src/mocks/**` 与任何测试文件（只有 test 引用 = 已排练，不是已实现）。 */
export function frontendProdFiles() {
  return walk(FE_SRC).filter((p) => {
    const r = relative(ROOT, p);
    if (r.includes("/mocks/")) return false;
    if (/\.(test|spec)\.tsx?$/.test(r)) return false;
    if (r.includes("/__tests__/")) return false;
    return true;
  });
}

/**
 * 「前端生产代码提到这个名字了吗」——搜代码与**机器令牌**字符串，
 * 排除注释（注释里写一句「供前端分栏」不是消费；`roleLabel` 那条正是死在这上面）
 * **与散文串**（缺口台账里写一句「前端还没接 roleLabel」更不是消费——那是病历，不是接线）。
 * 返回命中的文件相对路径数组（空数组 = 零消费方）。
 *
 * 记录必须由 `scanText()` 造：缺 `prose` 跨度直接抛，逼所有调用点走同一份实现。
 */
export function mentionsInProd(name, prodTexts) {
  const re = new RegExp(String.raw`(?<![\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\w$])`, "g");
  const hits = [];
  for (const t of prodTexts) {
    const { rel, src, mask, prose } = t;
    if (!Array.isArray(prose)) throw new Error(`mentionsInProd: 扫描面记录必须由 scanText() 构造（${rel} 缺 prose 跨度）`);
    for (const m of src.matchAll(re)) {
      if (mask[m.index] === M_COMMENT) continue;
      if (prose.some((p) => m.index >= p.start && m.index < p.end)) continue;
      hits.push(rel);
      break;
    }
  }
  return hits;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 5 · 路由豁免表（结构性理由 · 每条带理由 · 不许无理由豁免）
 * ═══════════════════════════════════════════════════════════════════════════ */
const ROUTE_EXEMPTIONS = [
  { re: /^\/(healthz|readyz|metrics)$/, why: "容器探活/指标端点·由 compose 与 nginx 消费，非前端" },
  // ⛔ `metrics` 曾在下面这条里，是**一条假阴性**（WO-BEFE-G 的 dev 取证，审核方逐层复核确认）：
  //    该条 `why` 写着"网关前缀下的探活别名"，但全仓**没有** `/a/v1/metrics` 或 `/b/v1/metrics`
  //    形态的探活路由。它的 `metrics` 分支在全仓唯一命中的是 `GET /a/v1/metrics`
  //    （`apps/datacore/src/app.ts:3303`）—— SPINE 经营目标-指标-责任骨架的**指标库**，
  //    返回 `Metric` 本体对象、走 `ctx(req)` **用户鉴权**的纯业务端点。
  //    旁证（后端自己分得清）：`app.ts:937` `SERVICE_ONLY_PATHS = new Set(["/metrics"])`
  //    —— 只含**裸** `/metrics`，明确不含带前缀的那条。
  //
  //    形态（铁律 0.6 句式）：**「我用『它长得像探活路径』当作『它是探活端点』的证据，
  //    而前者并不度量后者。」** 危害比基线里记一笔更大：**结构性豁免不计入基线数**，
  //    所以这条真缺口是**隐身**的 —— 门每次都报"零调用 186（新增 0）"，而它一直不在那 186 里。
  //    摘掉 `metrics` 后它现身，按基线注的规矩**人手**记进 endpoints（可评审的显式动作）。
  { re: /^\/[ab]\/v1\/(healthz|readyz)$/, why: "网关前缀下的探活别名·同上（刻意不含 metrics：带前缀的 metrics 是业务端点，见上方注释）" },
  { re: /\/internal\//, why: "服务间内部钩子（B←A 事件失效等）·SERVICE_TOKEN 凭证，前端一律 403" },
  // ⚠ 锚点曾写作 `/^\/\.well-known\//`（要求路径**以** `/.well-known/` 开头），而全仓真实注册的是
  //   `/a/v1/.well-known/jwks.json`（`apps/datacore/src/app.ts:1072`）——以 `/a/v1/` 开头 ⇒ 这条恒不命中。
  //   它没造成事故，纯属侥幸：下一条 `/\/jwks/`（不带锚）替它兜住了。
  //   这就是 C15 存在的理由 —— **一条从没命中过的规则，和一条写对了的规则，在汇总数字上一模一样。**
  //   ⛔ 记一笔方法论：C15 报"死条目"时**不许直接删**。本条与 `/^\/openapi/` 同被报死，
  //     追一层后结论**相反**：这条是规则写错（路由在，锚点歪），那条是路由真不存在。
  //     照单删会把一条意图正确的规则连同意图一起删掉。
  { re: /\/\.well-known\//, why: "认证基础设施（JWKS 等）·由 AgentCore 验签侧消费，不经前端" },
  { re: /\/jwks/, why: "JWKS 公钥集·服务间验签用" },
  { re: /^\/a\/v1\/references\/report$/, why: "服务间引用上报·SERVICE_TOKEN 专用（见 CLAUDE.md 服务间凭证一节）" },
  { re: /\/credential$/, why: "凭据读取·SERVICE_TOKEN 专用，no-secrets-echo 纪律禁止前端触达" },
  // ⛔ `{ re: /^\/openapi/, why: "API 自描述文档端点" }` 已删（C15 首跑当场报死）。
  //   追一层复核（不止 grep 一次）：① 全仓无 `"/openapi…"` 形态的路由注册；
  //   ② 三个 package.json 里**没有任何** swagger/openapi/scalar/redoc 类依赖
  //      ⇒ 排除"经插件注册、grep 看不见"这条间接路（金丝雀：同法查 fastify 类依赖命中 4 个，工具是好的）。
  //   ⇒ 定性「真不存在」，不是「有但看不见」。一条豁免没有对应的被豁免物，
  //     不是"少查一条"而是**一个写宽了的陷阱**：将来谁注册 `/openapi-export` 之类会被静默吞掉。
];
const exemptReason = (p) => ROUTE_EXEMPTIONS.find((e) => e.re.test(p))?.why;

/* ════════════════════════════════════════════════════════════════════════════
 * 6 · 金丝雀（与主逻辑共用同一批函数 · 不中即「门自己坏了」exit 2）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 每条金丝雀 = { name, why, run() -> {ok, got, want} }。
 * 合成样例证明**算法**没坏；真文件样例证明它在**真实源码**上没坏（本仓踩过的坑全是后者：
 * 算法在玩具输入上对，一碰真文件就 0 命中，于是报出"代码干净"）。
 */
function canaries(ctx) {
  const list = [];
  const add = (name, why, fn) => list.push({ name, why, fn });

  // C1 词法：正则字面量里的 `//` 不许被读成行注释（本仓 5 个文件真有这种写法）
  add("lex/正则内双斜杠", "读错就整行代码被当注释吞掉 ⇒ 抽取器少数据 ⇒ 报出「干净」", () => {
    const s = `const x = "a".replace(/\\/$/, ""); emit(t, "canary.evt", { alpha: 1 });`;
    const { fields } = extractEmitFields(s);
    const got = fields.map((f) => `${f.event}.${f.field}`);
    return { ok: got.includes("canary.evt.alpha"), got, want: ["canary.evt.alpha"] };
  });

  // C2 词法：注释里的假 emit 不许被当真（否则门会抓一堆幻觉字段）
  add("lex/注释内 emit 不计", "把示例代码当真接线 ⇒ 幻觉缺口", () => {
    const s = `// emit(t, "ghost.evt", { phantom: 1 })\nconst y = 1;`;
    const { fields } = extractEmitFields(s);
    return { ok: fields.length === 0, got: fields, want: [] };
  });

  // C3 抽取 R1：事件名在**第二个**实参（CLAUDE.md 铁律 0.6 第 5 例）
  add("emit/事件名非首参", "认位置就会把 outbox.emit(x,\"evt\",p) 全漏掉 ⇒ 报「一处都没 emit」", () => {
    const s = `await outbox.emit(tx, "sim.tick_advanced", { tick: 1, sessionId: s });`;
    const { fields } = extractEmitFields(s);
    const got = fields.map((f) => `${f.event}.${f.field}`).sort();
    return { ok: got.join(",") === "sim.tick_advanced.sessionId,sim.tick_advanced.tick", got, want: ["sim.tick_advanced.sessionId", "sim.tick_advanced.tick"] };
  });

  // C3b payload 里带注释的字段照样要抽到
  //     —— 这条是**变异反证抓出来的真洞**（第一版门对"加了带注释的新字段"毫无反应，13 条金丝雀全中）。
  //        本仓 emit payload 里注释满地都是，漏掉它等于门对最常见的写法瞎。
  add("emit/payload 内含注释", "注释挡住键名 ⇒ 带注释的新字段一律读作不存在 ⇒ 门对真实新增字段无反应（已实测发生）", () => {
    const s = `emit("x.y", {\n  a: 1,\n  // 结构化字段，供前端分栏\n  bLabel: "z",\n});`;
    const got = extractEmitFields(s).fields.map((f) => f.field).sort();
    return { ok: got.join(",") === "a,bLabel", got, want: ["a", "bLabel"] };
  });

  // C4 抽取 R2 + 真文件：orchestrator 的 roleLabel（本门的头号实例，必须抓得到）
  add("emit/真文件 orchestrator.roleLabel", "抓不到它这道门就没有存在的理由（R2 变量 payload 回溯失效）", () => {
    const got = ctx.emitFields.filter((f) => f.field === "roleLabel").map((f) => `${f.file}:${f.line}`);
    return { ok: got.length > 0, got, want: ["apps/agentcore/src/router/orchestrator.ts:*"] };
  });

  // C5 抽取 R1 + 真文件：step.completed 的 stepId（最普通的一条，抽不到说明整个抽取器瞎了）
  add("emit/真文件 step.completed.stepId", "最常见的一条都抽不到 ⇒ 抽取器在真源码上失效", () => {
    const got = ctx.emitFields.filter((f) => f.event === "step.completed" && f.field === "stepId").length;
    return { ok: got > 0, got, want: ">0" };
  });

  // C6 路由抽取 + 真文件：后端必有 /api/v1/queries
  add("route/真文件 后端 /api/v1/queries", "抽不到说明路由正则在真 server.ts 上失效 ⇒ 端点清单恒空 ⇒ 报「零缺口」", () => {
    const got = ctx.backendRoutes.filter((r) => r.norm === "/api/v1/queries" && r.method === "POST").length;
    return { ok: got > 0, got, want: ">0" };
  });

  // C7 前端路径抽取 + 真文件：前端必调 /a/v1/me/workspace
  add("route/真文件 前端 /a/v1/me/workspace", "抽不到说明前端 URL 抽取失效 ⇒ 全部后端路由被误报成零消费", () => {
    const ok = ctx.fePaths.has("/a/v1/me/workspace");
    return { ok, got: ok ? "命中" : "未命中", want: "命中" };
  });

  // C7b 端到端（真文件）：带 `${encodeURIComponent(x)}` 的路径必须整条切出来
  //     —— 这条金丝雀是本门第一版真实漏洞的补丁：单测 normalizePath 全绿，端到端却切歪，
  //        把前端明明在调的 /a/v1/objects/:id/neighbors 报成「零调用」。
  add("route/真文件 端到端切 ${} 路径", "只单测归一函数测不出切分早停 ⇒ 前端在调的端点被误报成零调用（幻觉缺口）", () => {
    const src = existsSync(join(ROOT, "apps/frontend-shell/src/api/endpoints.ts"))
      ? readFileSync(join(ROOT, "apps/frontend-shell/src/api/endpoints.ts"), "utf8")
      : "";
    const paths = extractFrontendPaths(src);
    // 用**主逻辑同一个** pathMatches 判定，不另立标准：门怎么判「这条端点有没有人调」，金丝雀就怎么判。
    const target = "/a/v1/objects/*/neighbors";
    const ok = [...paths].some((p) => pathMatches(p, target));
    return { ok, got: ok ? "命中" : [...paths].filter((p) => p.startsWith("/a/v1/objects")).slice(0, 8), want: target };
  });

  // C8 模板归一：`${…}` 配平替换（懒惰正则会吃掉后面的路径段）
  add("route/模板归一配平", "懒惰正则把 /objects/${id}/neighbors 归一成 /objects/* ⇒ 段数错 ⇒ 匹配全错", () => {
    const got = normalizePath("/a/v1/objects/${encodeURIComponent(objectId)}/neighbors${qs ? `?${qs}` : \"\"}");
    return { ok: got === "/a/v1/objects/*/neighbors*", got, want: "/a/v1/objects/*/neighbors*" };
  });

  // C9 别名前缀单源：从 server.ts 抽出的 rewrite 前缀必含 queries
  add("route/别名前缀单源", "抽空了 ⇒ /b/v1/queries 与 /api/v1/queries 被当成两条路 ⇒ 幻觉缺口", () => {
    const got = ctx.rewritePrefixes;
    return { ok: got.includes("queries"), got, want: "含 queries" };
  });

  // C10 消费判据**双向**：恒真的匹配器会藏起全部缺口，恒假的会把全仓报成缺口
  add("consume/双向判据", "单向金丝雀测不出恒真/恒假匹配器——两种坏法一个报「零缺口」一个报「全是缺口」", () => {
    const present = mentionsInProd("stepId", ctx.prodTexts);
    const absent = mentionsInProd("__befe_seam_canary_never_exists__", ctx.prodTexts);
    const ok = present.length > 0 && absent.length === 0;
    return { ok, got: `已知存在 stepId 命中 ${present.length} 文件 · 已知不存在命中 ${absent.length} 文件`, want: "前者 >0 且 后者 =0" };
  });

  // C11 消费判据剔注释：注释里提一嘴不算消费（roleLabel 那条正死在这上面）
  add("consume/注释不算消费", "把注释当消费 ⇒ 「后端注释承诺了前端接」自证成功 ⇒ 门永远绿", () => {
    const hits = mentionsInProd("roleLabel", [scanText("fake.ts", "// 结构化字段 roleLabel 供前端分栏\nconst a = 1;")]);
    return { ok: hits.length === 0, got: hits, want: [] };
  });

  // C11b 消费判据剔**散文串**（欠账 #174 的常驻金丝雀）
  //     C11 只咬注释。本仓的缺口台账偏偏是用**字符串**记的（`store/eventInvalidation.ts:85`
  //     `SIM_EVENT_GAPS` 的值就是一段中文说明），描述缺口的那段话会把缺口自己盖住。
  add("consume/散文串不算消费", "缺口台账/TODO 文案里写一句「前端还没接 X」被读成「X 已被消费」⇒ 描述缺口的话把缺口盖住（欠账 #174）", () => {
    const src = 'const GAPS = { "sim.x": "缺的是后端读端不是前端订阅：前端至今没有 roleLabel 的消费方（2026-08-09 复核）" };';
    const hits = mentionsInProd("roleLabel", [scanText("fake-prose.ts", src)]);
    return { ok: hits.length === 0, got: hits, want: [] };
  });

  // C11c **反向**：机器令牌串仍算消费（防过度剥离 ⇒ 把前端真在读的字段误报成缺口）
  add("consume/机器令牌串仍算消费", "散文判据过宽 ⇒ d[\"roleLabel\"] 这类真消费被剔掉 ⇒ 幻觉缺口（与 C11b 是同一判据的两个方向）", () => {
    const hits = mentionsInProd("roleLabel", [scanText("fake-token.ts", 'const v = d["roleLabel"];')]);
    return { ok: hits.length === 1, got: hits, want: ["fake-token.ts"] };
  });

  // C13 载体②：散文串里的路由不算「前端在调」
  //     **非恒真**：本条不复用 extractFrontendPaths 里那一句 `continue`，而是用共用判据
  //     （lex + isProseString + normalizePath + scanPathFrom）**独立重算**一遍散文串里写着的路由，
  //     再断言它们没混进 fePaths。谁把那句过滤删了，这条当场红——不是装饰品。
  add("route/散文串不算调用", "散文里「datacore 只有 POST /a/v1/…」被读成前端在调它 ⇒ 该端点出生即豁免（欠账 #174）", () => {
    const sample =
      "缺的是**后端读端**不是前端订阅（2026-08-09 复核）：datacore 只有 POST /a/v1/sim/sessions/:id/checkpoint" +
      "，解法：开 GET /a/v1/sim/sessions/:id/checkpoints → 前端加 checkpoints useQuery。";
    const src = `const GAPS = ${JSON.stringify(sample)};`;
    const viaGate = extractFrontendPaths(src);          // 门实际用的那条路：必须一条都不收
    const viaProse = extractProsePaths(src);            // 独立重算：必须确实认出这两条（否则样例失效 = 工具坏了）
    const ok = viaGate.size === 0 && viaProse.has("/a/v1/sim/sessions/*/checkpoint") && viaProse.has("/a/v1/sim/sessions/*/checkpoints");
    return { ok, got: `门收到 ${[...viaGate].join("|") || "0 条"} · 散文里实有 ${[...viaProse].join("|") || "0 条"}`, want: "门收 0 条 且 散文里认出 checkpoint/checkpoints 两条" };
  });

  // C13b **反向**：真 URL 模板仍算调用（防过度剥离 ⇒ 前端在调的端点被误报成零调用）
  add("route/真 URL 模板仍算调用", "散文判据过宽 ⇒ 带 ${} 插值的真 URL 被当散文剔掉 ⇒ 全仓端点被误报成零调用", () => {
    const src = 'const u = `/a/v1/sim/sessions/${encodeURIComponent(id)}/certification?scope=${scope}${t ? `&target=${t}` : ""}`;';
    const got = [...extractFrontendPaths(src)];
    return { ok: got.some((p) => pathMatches(p, "/a/v1/sim/sessions/*/certification")), got, want: "/a/v1/sim/sessions/*/certification" };
  });

  // C13c 真文件面：没有任何「只靠散文串才进 fePaths」的路径漏网（活体回归·样例消失时无害地空过）
  add("route/真文件 无散文路径漏网", "线上真出现这一手时要当场说话，而不是等下一次审计", () => {
    const leaked = [];
    for (const t of ctx.prodTexts) for (const p of extractProsePaths(t.src)) if (ctx.fePaths.has(p) && !ctx.cleanPaths.has(p)) leaked.push(`${t.rel} → ${p}`);
    return { ok: leaked.length === 0, got: leaked, want: [] };
  });

  // C12 前端面剔除 mocks/测试（只有 mock 引用 = 已排练，不是已实现）
  add("consume/前端面剔 mocks 与测试", "把 MSW mock 当消费方 ⇒ 后端字段「前端有了」是假的", () => {
    const bad = ctx.prodFiles.filter((p) => p.includes("/mocks/") || /\.(test|spec)\.tsx?$/.test(p));
    return { ok: bad.length === 0 && ctx.prodFiles.length > 50, got: `生产文件 ${ctx.prodFiles.length} · 混入 mocks/测试 ${bad.length}`, want: ">50 且 0" };
  });

  // C14 基线写入不吞人手挂账（四向 · 与 --update/--seed 共用 buildBaselineDoc，不另抄一份）
  //     来历：`--update` 曾无条件写 `note: BASELINE_NOTE`，把 978 字、两笔人手挂账
  //     （WO-R2 +9 条 · WO-R6 metrics-authz 1 条，每笔都写着「为何这条不许走 ROUTE_EXEMPTIONS」）
  //     静默吞掉。**这个字段有两个主人**：常量说它归脚本，正文说它归人手 —— 谁最后写谁赢，
  //     而 --update 永远最后写。四向缺一不可：
  //       ① 吞了人手 note ⇒ 复审只剩一份没有理由的名单；
  //       ② 吞了人手新增的顶层键 ⇒ 同一个病换个字段名再来一次（白名单式保留漏一个就吞一个）；
  //       ③ --seed 反而不落常量 ⇒ 首次建账建出一份没说明的账；
  //       ④ 算出来的三个字段被 prev 的旧值挡住 ⇒ --update 不更新，棘轮从「只减不增」变成「冻结」，
  //          而它照样 RC=0 —— 这是四向里最隐蔽的一向（门还在跑，只是不再度量任何东西）。
  add("baseline/写入不吞人手挂账", "note 有两个主人（常量 vs 人手）⇒ --update 静默吞掉挂账理由；反向若 prev 挡住算出的字段则棘轮冻结", () => {
    const HAND = "【人手挂账】__befe_canary_hand_written__";
    const prev = { version: 1, note: HAND, __handAdded: "keep-me", generatedBy: "旧", sseFields: ["old.a"], endpoints: ["/old"] };
    const upd = buildBaselineDoc(new Set(["new.b"]), new Set(["/new"]), "--update", prev);
    const seed = buildBaselineDoc(new Set(["new.b"]), new Set(["/new"]), "--seed", null);
    const checks = {
      "①人手 note 逐字节留存": upd.note === HAND,
      "②人手新增顶层键留存": upd.__handAdded === "keep-me",
      "③--seed 首次建账落常量": seed.note === BASELINE_NOTE,
      "④算出的字段确实被更新": upd.sseFields.join() === "new.b" && upd.endpoints.join() === "/new" && upd.generatedBy.includes("--update"),
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    return { ok: bad.length === 0, got: bad.length ? `未通过：${bad.join(" · ")}` : "四向全通过", want: "四向全通过" };
  });

  // C15 豁免表不许有死条目（与主逻辑共用 ROUTE_EXEMPTIONS 与 backendRoutes，不另抄一份）
  //     来历：`/^\/[ab]\/v1\/(healthz|readyz|metrics)$/` 的 `metrics` 分支在全仓
  //     **一条探活路由都没命中**，唯一命中的是业务端点 `GET /a/v1/metrics`（SPINE 指标库）。
  //     一条 `why` 与事实不符的豁免，效果不是"少查一条"，是**把一条真缺口变成隐身**
  //     —— 结构性豁免不进基线数，门每次照报「新增 0」。
  //
  //     本条咬的是**死条目**：一条豁免今天一条真实注册路由都不匹配，只有两种可能，
  //     两种都必须当场说话：
  //       · 它**已过期**（当初豁免的路由早删了）⇒ 是装饰品，占着"这里已经想过了"的位置；
  //       · 它是个**陷阱**（写宽了，正等着未来某条真业务路由撞上来被静默吞掉）⇒ 正是上面那次。
  //     判据只能查"命中数是否为 0"这一半（"命中的对不对"要语义判断，机器做不了），
  //     所以另一半靠报告里**逐条打印今天命中了谁** —— 让复审看见，而不是靠人想起来去审。
  add("exempt/豁免表无死条目", "why 与事实不符的豁免不会少查一条，而是把真缺口变成隐身（结构性豁免不进基线数，门照报「新增 0」）", () => {
    const dead = [];
    for (const e of ROUTE_EXEMPTIONS) {
      const hit = ctx.backendRoutes.filter((r) => e.re.test(r.norm)).map((r) => r.norm);
      if (hit.length === 0) dead.push(`${e.re} —— ${e.why}`);
    }
    return { ok: dead.length === 0, got: dead.length ? `死豁免 ${dead.length} 条：${dead.join(" | ")}` : `${ROUTE_EXEMPTIONS.length} 条豁免全部命中真实路由`, want: "0 条死豁免" };
  });

  return list;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 7 · 主逻辑
 * ═══════════════════════════════════════════════════════════════════════════ */

function tsFiles(dir) { return walk(dir); }

// ── 采集 ──
const agentcoreFiles = tsFiles(AGENTCORE_SRC).filter((p) => !/\.(test|spec)\.ts$/.test(p) && !p.includes("/mocks/"));
const datacoreFiles = tsFiles(DATACORE_SRC).filter((p) => !/\.(test|spec)\.ts$/.test(p));

const emitFields = [];
let unresolvedPayloads = 0;
for (const f of agentcoreFiles) {
  const src = readFileSync(f, "utf8");
  if (!src.includes("emit(")) continue;
  const { fields, unresolved } = extractEmitFields(src);
  unresolvedPayloads += unresolved;
  for (const x of fields) emitFields.push({ ...x, file: relative(ROOT, f) });
}

const rewritePrefixes = extractRewritePrefixes(existsSync(AGENTCORE_SERVER) ? readFileSync(AGENTCORE_SERVER, "utf8") : "");
const backendRoutes = [];
for (const f of [...agentcoreFiles, ...datacoreFiles]) {
  const src = readFileSync(f, "utf8");
  if (!/\.(get|post|put|patch|delete)\s*[<(]/.test(src)) continue;
  for (const r of extractBackendRoutes(src)) {
    const norm = normalizePath(r.path);
    if (!/^\/(a|b|api)\/v1\//.test(norm) && !/^\/(healthz|readyz|metrics)$/.test(norm)) continue;
    backendRoutes.push({ ...r, norm, file: relative(ROOT, f) });
  }
}

const prodFiles = frontendProdFiles();
const prodTexts = prodFiles.map((p) => scanText(relative(ROOT, p), readFileSync(p, "utf8")));
const fePaths = new Set();
for (const t of prodTexts) for (const p of extractFrontendPaths(t.src)) fePaths.add(p);
// 散文串里写着、但**不**计作调用方的路由（诚实位现算；`cleanPaths` 与 fePaths 同源，供 C13c 判「漏网」）
const cleanPaths = fePaths;
const prosePaths = new Set();
let proseStrings = 0;
for (const t of prodTexts) {
  proseStrings += t.prose.length;
  for (const p of extractProsePaths(t.src)) prosePaths.add(p);
}
const proseOnlyPaths = [...prosePaths].filter((p) => !cleanPaths.has(p));

// ── 金丝雀先行 ──
const ctx = { emitFields, backendRoutes, fePaths, cleanPaths, prodTexts, prodFiles: prodFiles.map((p) => relative(ROOT, p)), rewritePrefixes };
// 金丝雀里抛异常 = 门自己坏了（RC=2），不是「代码有问题」（RC=1）：
// `mentionsInProd` 对手搓记录会抛，这条 catch 把「有人绕开 scanText 另抄一份」变成机器当场说话。
const canaryResults = canaries(ctx).map((c) => {
  try { return { ...c, ...c.fn() }; }
  catch (e) { return { ...c, ok: false, got: `抛异常：${e.message}`, want: "不抛异常" }; }
});
const brokenCanaries = canaryResults.filter((c) => !c.ok);
if (brokenCanaries.length) {
  console.error("⛔ 门自己坏了 —— befe-seam:check 的金丝雀未命中，本次**不产出任何结论**。");
  console.error("   （铁律 0.6：金丝雀不中只许报「工具坏了」，绝不许报「代码干净 / 零缺口」。）\n");
  for (const c of brokenCanaries) {
    console.error(`  ✗ 金丝雀「${c.name}」未中`);
    console.error(`      为什么它重要：${c.why}`);
    console.error(`      期望：${JSON.stringify(c.want)}`);
    console.error(`      实际：${JSON.stringify(c.got)}`);
  }
  process.exit(2);
}
// 诚实位**现算**，不写死。写死是假绿第 11 形态：加了金丝雀而分组计数不动，屏上照旧「5/5」。
// （原文这里硬编码「词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3」= 13，而总数已经是 14 —— 就是这个病，已实测。）
const GROUP_LABEL = { lex: "词法", emit: "SSE 抽取", route: "路由", consume: "消费判据" };
const byGroup = new Map();
for (const c of canaryResults) {
  const g = c.name.split("/")[0];
  byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
}
const groupBreakdown = [...byGroup].map(([g, n]) => `${GROUP_LABEL[g] ?? g} ${n}`).join(" · ");
console.log(`· 金丝雀 ${canaryResults.filter((c) => c.ok).length}/${canaryResults.length} 全中（${groupBreakdown}）——抽取器在真源码上有效，下面的否定结论才有资格被相信。`);

// ── 载体① 判定 ──
const fieldEvidence = new Map(); // field -> [{event,file,line}]
for (const f of emitFields) {
  if (!fieldEvidence.has(f.field)) fieldEvidence.set(f.field, []);
  fieldEvidence.get(f.field).push(f);
}
const sseGaps = [];
for (const [field, ev] of [...fieldEvidence].sort()) {
  if (mentionsInProd(field, prodTexts).length === 0) sseGaps.push({ field, evidence: ev });
}

// ── 载体② 判定 ──
const beByKey = new Map();
for (const r of backendRoutes) {
  const aliases = [r.norm];
  const m = /^\/api\/v1\/([a-z-]+)(\/.*)?$/.exec(r.norm);
  if (m && rewritePrefixes.includes(m[1])) aliases.push(`/b/v1/${m[1]}${m[2] ?? ""}`);
  const m2 = /^\/b\/v1\/([a-z-]+)(\/.*)?$/.exec(r.norm);
  if (m2 && rewritePrefixes.includes(m2[1])) aliases.push(`/api/v1/${m2[1]}${m2[2] ?? ""}`);
  const key = `${r.method} ${r.norm}`;
  if (!beByKey.has(key)) beByKey.set(key, { ...r, aliases });
}
const routeGaps = [];
let exemptCount = 0;
for (const [key, r] of [...beByKey].sort()) {
  if (exemptReason(r.norm)) { exemptCount++; continue; }
  const consumed = r.aliases.some((a) => [...fePaths].some((fe) => pathMatches(fe, a)));
  if (!consumed) routeGaps.push({ key, file: r.file, line: r.line });
}

// ── 棘轮基线 ──
const emptyBase = { version: 1, note: "", sseFields: [], endpoints: [] };
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : emptyBase;
const baseSse = new Set(base.sseFields ?? []);
const baseEp = new Set(base.endpoints ?? []);

const curSse = sseGaps.map((g) => g.field);
const curEp = routeGaps.map((g) => g.key);
const newSse = curSse.filter((f) => !baseSse.has(f));
const newEp = curEp.filter((k) => !baseEp.has(k));
const fixedSse = [...baseSse].filter((f) => !curSse.includes(f));
const fixedEp = [...baseEp].filter((k) => !curEp.includes(k));

/**
 * 基线文档的**唯一**构造出口（主逻辑与金丝雀 C14 共用此函数，不许各抄一份）。
 *
 * ⛔ 存在理由 = 一处真实的自相矛盾（WO-BEFE-C 的 dev 取证发现，审核方复核确认）：
 *    原实现无条件写 `note: BASELINE_NOTE`，而 `BASELINE_NOTE` 自己的正文写着
 *      「要把一条新缺口记进存量，**必须人手编辑本文件** —— 那是一个可评审的显式动作，
 *        不是脚本的副作用」。
 *    于是这个字段有**两个主人**：常量说它归脚本，正文说它归人手。谁最后写谁赢，
 *    而 `--update` 永远最后写 ⇒ **人手挂账被脚本静默吞掉**。
 *    实测被吞的是 978 字、两笔挂账（WO-R2 收编 +9 条 · WO-R6 metrics-authz 1 条），
 *    每一笔都写着「为什么这条没接线、为什么不许走 ROUTE_EXEMPTIONS」——
 *    正是复审时唯一能区分「真欠账」与「结构性豁免」的依据。吞掉它，
 *    下一个人看到的是一份没有理由的名单，只能靠猜。
 *
 *    形态（铁律 0.6 句式）：**「我用『常量里写了这段话』当作『这段话是当前真相』的证据，
 *    而前者并不度量后者」** —— 人手在文件里补的那部分，常量里根本没有。
 *
 * 修法：`note` 与任何人手新增的顶层键，**只在首次建账（--seed）时由脚本写**；
 *      此后一律**原样保留**文件里的既有值。脚本只拥有它真正在算的三个字段
 *      （`generatedBy` / `sseFields` / `endpoints`）。
 *
 * @param prev 既有基线对象（不存在时传 `null`）——`--seed` 传 null，`--update` 传读回来的那份。
 */
function buildBaselineDoc(sse, ep, how, prev) {
  // 先摊开 prev：人手加的任何顶层键（未来可能有 exempt/burndown 之类）都跟着活下来，
  // 不必等有人想起来在这里补一行 —— 「白名单式保留」漏一个就又吞一个。
  return {
    ...(prev ?? {}),
    version: 1,
    // note 归人手：有既有值就用既有值，只有首次建账才落常量。
    note: prev?.note ?? BASELINE_NOTE,
    generatedBy: `node scripts/check-backend-frontend-seam.mjs ${how}`,
    sseFields: [...sse].sort(),
    endpoints: [...ep].sort(),
  };
}

function writeBaseline(sse, ep, how) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
  writeFileSync(BASELINE, JSON.stringify(buildBaselineDoc(sse, ep, how, prev), null, 2) + "\n");
}

if (SEED) {
  if (existsSync(BASELINE)) {
    console.error("✗ --seed 拒绝执行：基线已存在。首次建账才用 --seed；日常收紧用 --update（只减不增）。");
    process.exit(1);
  }
  writeBaseline(curSse, curEp, "--seed");
  console.log(`· 首次建账：SSE 字段 ${curSse.length} 条 · 端点 ${curEp.length} 条记为今天的存量基线（此后只减不增）。`);
  process.exit(0);
}
if (UPDATE) {
  // 只删不加：修好的摘掉；新缺口**不**自动招安
  const nextSse = [...baseSse].filter((f) => curSse.includes(f));
  const nextEp = [...baseEp].filter((k) => curEp.includes(k));
  writeBaseline(nextSse, nextEp, "--update");
  console.log(`· 基线已收紧：SSE 字段 ${baseSse.size}→${nextSse.length} · 端点 ${baseEp.size}→${nextEp.length}（新增缺口 ${newSse.length + newEp.length} 条**未**收编）`);
}

// ── 报告 ──
console.log(
  `· 载体① SSE 字段：后端 emit 出 ${fieldEvidence.size} 个不同字段（${emitFields.length} 处发点 · 变量 payload 未解析 ${unresolvedPayloads} 处，其字段由契约类型管辖）` +
    ` · 前端零消费 ${sseGaps.length}（基线 ${baseSse.size} · 新增 ${newSse.length} · 已修复 ${fixedSse.length}）`,
);
console.log(
  `· 载体② HTTP 端点：后端注册 ${beByKey.size} 条（结构性豁免 ${exemptCount}）· 前端 URL 字面量 ${fePaths.size} 条` +
    ` · 前端零调用 ${routeGaps.length}（基线 ${baseEp.size} · 新增 ${newEp.length} · 已修复 ${fixedEp.length}）`,
);
console.log(
  `· 散文位剔除（欠账 #174）：前端生产代码里判为散文的字符串 ${proseStrings} 条，其中写着 /a|b|api/v1/ 路由的归一路径 ${prosePaths.size} 条` +
    ` —— 一律**不**计作调用方；其中 ${proseOnlyPaths.length} 条无任何真 URL 串佐证${proseOnlyPaths.length ? `（${proseOnlyPaths.join(" , ")}）` : ""}。`,
);
// ── 结构性豁免逐条点名（不是装饰，是 C15 的另一半） ──
//    C15 只能机器判「命中数是否为 0」；「命中的对不对」要语义判断，机器做不了。
//    那一半只能靠**每次都打印出来**给复审看见 —— 上一条假阴性
//    （`metrics` 豁免唯一命中的是 SPINE 业务端点）之所以活了这么久，
//    正因为豁免结果从不上屏：屏上只有一个汇总数字「结构性豁免 13」，
//    没人能从一个数字里看出它豁免掉的是探活还是业务。**数字不会说谎，但它什么也没说。**
console.log(`· 结构性豁免逐条点名（${ROUTE_EXEMPTIONS.length} 条规则 → ${exemptCount} 条端点）——「豁免≠隐身」，每条今天命中了谁一律上屏：`);
for (const e of ROUTE_EXEMPTIONS) {
  const hit = [...new Set(backendRoutes.filter((r) => e.re.test(r.norm)).map((r) => r.norm))].sort();
  console.log(`    ${String(e.re).padEnd(46)} → ${hit.length ? hit.join(" , ") : "（0 条·C15 会红）"}`);
  console.log(`    ${" ".repeat(46)}   理由：${e.why}`);
}
if (fixedSse.length || fixedEp.length) {
  console.log(`· ✅ 有人把接缝接上了：SSE ${fixedSse.slice(0, 8).join(", ")}${fixedSse.length > 8 ? " …" : ""}` +
    `${fixedEp.length ? ` · 端点 ${fixedEp.slice(0, 5).join(" | ")}${fixedEp.length > 5 ? " …" : ""}` : ""}`);
  console.log("  → 跑 `node scripts/check-backend-frontend-seam.mjs --update` 收紧基线（只减不增，不会招安新缺口）。");
}
if (VERBOSE) {
  console.log("\n— 当前 SSE 零消费字段明细 —");
  for (const g of sseGaps) console.log(`  ${g.field}  ←  ${g.evidence.map((e) => `${e.event}@${e.file}:${e.line}`).slice(0, 3).join(" , ")}`);
  console.log("\n— 当前零调用端点明细 —");
  for (const g of routeGaps) console.log(`  ${g.key}  ←  ${g.file}:${g.line}`);
}

const fails = [];
for (const f of newSse) {
  const ev = fieldEvidence.get(f) ?? [];
  fails.push(
    `载体① 新增「后端发了·前端零消费方」字段 \`${f}\`（${ev.map((e) => `${e.event}@${e.file}:${e.line}`).slice(0, 2).join(" , ")}）` +
      `\n      → 这就是 G-BE-FE-SEAM-DEAD：后端把字段发出去了，前端生产代码一个字都没读（注释里写「供前端…」不算消费）。` +
      `\n        修：在 apps/frontend-shell/src 里真接上（reducer/选择器/组件读它），或者别发这个字段。` +
      `\n        确属暂不接：人手加进 scripts/backend-frontend-seam-baseline.json 的 sseFields 并在 PR 里说明理由。`,
  );
}
for (const k of newEp) {
  const g = routeGaps.find((x) => x.key === k);
  fails.push(
    `载体② 新增「后端注册了·前端零调用」端点 \`${k}\`（${g?.file}:${g?.line}）` +
      `\n      → 后端开了口子没人用。修：前端 apps/frontend-shell/src/api/endpoints.ts 接上；` +
      `\n        或属结构性非前端端点（探活/服务间/认证基础设施）→ 加进本脚本 ROUTE_EXEMPTIONS 并写明理由；` +
      `\n        或确属暂不接 → 人手加进 scripts/backend-frontend-seam-baseline.json 的 endpoints。`,
  );
}

if (fails.length) {
  console.error(`\n✗ befe-seam:check 未通过（${fails.length} 条新增接缝缺口 · 棘轮只许降不许升）：`);
  for (const m of fails) console.error("  - " + m);
  process.exit(1);
}
console.log(
  `\n✓ befe-seam:check 通过：后端↔前端两半无**新增**「后端发了/暴露了、前端零消费方」缺口` +
    `（存量 SSE ${sseGaps.length} · 端点 ${routeGaps.length} 已记基线，只减不增）。`,
);
