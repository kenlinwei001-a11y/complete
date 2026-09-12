/**
 * 门脚本共用的 TS/JS 源码词法与路由原语 —— **单一实现，不许各抄一份**。
 *
 * ── 为什么单独成包 ────────────────────────────────────────────────────────────
 * 这批函数最早长在 `check-backend-frontend-seam.mjs` 里。后来
 * `check-mock-fidelity.mjs` 也要「按代码/注释/字符串分辨源码」「切对象字面量」「归一路由」，
 * 照 CLAUDE.md 铁律 0.6 那条机制 —— **门脚本里的金丝雀必须与主逻辑共用同一份实现，
 * 不许各抄一份正则；抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿** ——
 * 复制一份到新门里等于当场违纪。故抽到这里，两道门 `import` 同一份。
 *
 * 抽包时**一行逻辑都没改**（纯搬运）：`check-backend-frontend-seam.mjs` 抽包前后
 * 输出逐字节一致，可用 `node scripts/check-backend-frontend-seam.mjs` 复验。
 *
 * ── 为什么不用裸正则 ──────────────────────────────────────────────────────────
 * 本仓源码里真有 `replace(/\/$/, "")` 这种**正则字面量内含 `//`** 的写法
 * （`apps/agentcore/src/agent/production-cognition.ts:52` 等 5 个文件）。裸正则把那两个斜杠
 * 读成行注释起点 ⇒ 该行剩下的代码整段被当注释吞掉 ⇒ 抽取器悄悄少数据、报出的是"干净"。
 * 这正是铁律 0.6 那五连犯的形态（拿一个看起来相关的数字当判据）。故必须做**正则字面量感知**的扫描。
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

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
export function skipBracedExpr(src, j) {
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
 * ⚠️ 为什么有这个函数：`befe-seam` 门第一次做变异反证时，给后端 emit payload 加了一个字段，
 * 并在它上一行写了行注释（本仓真实写法，payload 里注释满地都是）。**门没红。**
 * 病因：`splitTopLevel` 按顶层逗号切出来的那一段长这样——
 *     `\n  // 结构化字段，供前端分栏\n  escalationRationaleLabel: "x"`
 * `trim()` 之后首字符是 `/`，`^ident\s*:` 一条都匹配不上 ⇒ **有注释的字段一律读作不存在**。
 * 13 条金丝雀全中、门照样绿——因为没有一条金丝雀喂过"带注释的 payload"。
 * 这正是变异反证存在的理由：**金丝雀证明工具在我想到的输入上没坏，变异反证才检验它在我没想到的输入上坏没坏。**
 */
export function stripComments(text) {
  const { mask } = lex(text);
  let out = "";
  for (let i = 0; i < text.length; i++) out += mask[i] === M_COMMENT ? (text[i] === "\n" ? "\n" : " ") : text[i];
  return out;
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

export const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

/* ── 路由归一 ──────────────────────────────────────────────────────────────── */

export const METHODS = "get|post|put|patch|delete|head|options";

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

/* ── 文件遍历 ──────────────────────────────────────────────────────────────── */

/** 递归收集 .ts/.tsx（跳过 node_modules 与 dist）。 */
export function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === "dist") continue; walk(p, acc); }
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
