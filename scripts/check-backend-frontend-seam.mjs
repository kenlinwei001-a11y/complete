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
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/backend-frontend-seam-baseline.json");
const FE_SRC = join(ROOT, "apps/frontend-shell/src");
const AGENTCORE_SRC = join(ROOT, "apps/agentcore/src");
const DATACORE_SRC = join(ROOT, "apps/datacore/src");
const AGENTCORE_SERVER = join(ROOT, "apps/agentcore/src/server.ts");

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
    const p = raw.trim();
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
    out += c;
    i++;
  }
  return out;
}

export function extractFrontendPaths(src) {
  const { strings } = lex(src);
  const found = new Set();
  for (const s of strings) {
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
 * 「前端生产代码提到这个名字了吗」——搜代码与字符串，**排除注释**
 * （注释里写一句「供前端分栏」不是消费；`roleLabel` 那条正是死在这上面）。
 * 返回命中的文件相对路径数组（空数组 = 零消费方）。
 */
export function mentionsInProd(name, prodTexts) {
  const re = new RegExp(String.raw`(?<![\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\w$])`, "g");
  const hits = [];
  for (const { rel, src, mask } of prodTexts) {
    for (const m of src.matchAll(re)) {
      if (mask[m.index] === M_COMMENT) continue;
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
  { re: /^\/[ab]\/v1\/(healthz|readyz|metrics)$/, why: "网关前缀下的探活别名·同上" },
  { re: /\/internal\//, why: "服务间内部钩子（B←A 事件失效等）·SERVICE_TOKEN 凭证，前端一律 403" },
  { re: /^\/\.well-known\//, why: "认证基础设施（JWKS 等）·由 AgentCore 验签侧消费，不经前端" },
  { re: /\/jwks/, why: "JWKS 公钥集·服务间验签用" },
  { re: /^\/a\/v1\/references\/report$/, why: "服务间引用上报·SERVICE_TOKEN 专用（见 CLAUDE.md 服务间凭证一节）" },
  { re: /\/credential$/, why: "凭据读取·SERVICE_TOKEN 专用，no-secrets-echo 纪律禁止前端触达" },
  { re: /^\/openapi/, why: "API 自描述文档端点" },
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
    const fake = [{ rel: "fake.ts", ...(() => { const src = "// 结构化字段 roleLabel 供前端分栏\nconst a = 1;"; return { src, mask: lex(src).mask }; })() }];
    const hits = mentionsInProd("roleLabel", fake);
    return { ok: hits.length === 0, got: hits, want: [] };
  });

  // C12 前端面剔除 mocks/测试（只有 mock 引用 = 已排练，不是已实现）
  add("consume/前端面剔 mocks 与测试", "把 MSW mock 当消费方 ⇒ 后端字段「前端有了」是假的", () => {
    const bad = ctx.prodFiles.filter((p) => p.includes("/mocks/") || /\.(test|spec)\.tsx?$/.test(p));
    return { ok: bad.length === 0 && ctx.prodFiles.length > 50, got: `生产文件 ${ctx.prodFiles.length} · 混入 mocks/测试 ${bad.length}`, want: ">50 且 0" };
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
const prodTexts = prodFiles.map((p) => {
  const src = readFileSync(p, "utf8");
  return { rel: relative(ROOT, p), src, mask: lex(src).mask };
});
const fePaths = new Set();
for (const t of prodTexts) for (const p of extractFrontendPaths(t.src)) fePaths.add(p);

// ── 金丝雀先行 ──
const ctx = { emitFields, backendRoutes, fePaths, prodTexts, prodFiles: prodFiles.map((p) => relative(ROOT, p)), rewritePrefixes };
const canaryResults = canaries(ctx).map((c) => ({ ...c, ...c.fn() }));
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
console.log(`· 金丝雀 ${canaryResults.length}/${canaryResults.length} 全中（词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3）——抽取器在真源码上有效，下面的否定结论才有资格被相信。`);

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

const BASELINE_NOTE =
  "后端↔前端接缝缺口棘轮基线（WO-GATE-BEFE-SEAM · 闭本体 §8 G-BE-FE-SEAM-DEAD）。" +
  "sseFields = 后端 emit 了、前端生产代码零提及的字段名；endpoints = 后端注册了、前端零调用的路由。" +
  "**只减不增**：--update 只摘掉已修复项，绝不收编新增缺口（否则棘轮秒变橡皮图章）；" +
  "要把一条新缺口记进存量，必须人手编辑本文件——那是一个可评审的显式动作，不是脚本的副作用。" +
  "首次建账（本文件不存在时）用 --seed。";

function writeBaseline(sse, ep, how) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      { version: 1, note: BASELINE_NOTE, generatedBy: `node scripts/check-backend-frontend-seam.mjs ${how}`, sseFields: [...sse].sort(), endpoints: [...ep].sort() },
      null,
      2,
    ) + "\n",
  );
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
