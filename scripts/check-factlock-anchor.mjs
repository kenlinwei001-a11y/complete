#!/usr/bin/env node
/**
 * check-factlock-anchor · **事实锁不许锚在位置上**（本体 §8 `G-FACTLOCK-POSITION-ANCHOR`）
 *
 * ── 这一族病是什么（2026-08-11 实测，`e639a6c2` 的病样）─────────────────────────
 * `apps/frontend-shell/test/stale-claims.seam.test.ts` §3 原先这样写：
 *
 *     const app = readRepo("apps/datacore/src/app.ts");
 *     expect(app, "推演 tick 不再 buildCadenceGates").toContain("buildCadenceGates");
 *     expect(app, 'tick 不再 listByType("Cadence")').toContain('listByType(c.tenantId, "Cadence")');
 *
 * 集成分支把这段装配从 `app.ts` 抽到了 `sim/propagation-inputs.ts` —— **能力一行没少，
 * 纯粹搬了个家**。于是同一次重构里，这一条 it 同时产出两个**方向相反**的错误信号：
 *
 *   · `listByType(…, "Cadence")` → **假红**：事实还在，只是锚点搬走了；
 *   · `buildCadenceGates`        → **假绿**：命中的是 `app.ts` 里那句**注释**和 **import 行**，
 *     不是调用点。真调用搬走了，而断言一声不吭。
 *
 * 一个根因、两个方向。照 CLAUDE.md 铁律 0.6 的句式：
 *   **「我用『某串在 app.ts 里』当作『tick 仍在读回 Cadence』的证据，而前者并不度量后者。」**
 *
 * **会因一次无害重构而红的门，只会训练人把门删掉** —— 等真删了那天就没人拦了。
 *
 * ── 本门咬什么 ────────────────────────────────────────────────────────────────
 * **形态**：`expect(<写死的单个源码文件的内容>).toContain(<代码符号/调用片段>)`（**正向**）。
 * 正向断言说的是「这个能力还在」——而能力**与它住在哪个文件无关**，所以判据必须扫「在不在」，
 * 不能扫「在哪个文件里」。修法样板见 `stale-claims.seam.test.ts` §3 现写法：
 * 递归扫整棵源码树 → `stripComments` 剥注释 → 排除声明式（`(?<!function\s)\bfoo\s*\(`）。
 *
 * ── 本门**不**咬什么（别一刀切）──────────────────────────────────────────────
 * **「位置就是事实本身」是合法的**：
 *   · **反向**断言 `not.toContain` —— 「**这个文件**不许引用 X」，事实天生带文件作用域；
 *   · 非源码路径（`.css` / `.sql` / `.sh` / `.json` / `.yml`）—— 「tokens.css 里必须定义 --txt」
 *     「gate.sh 里必须挂着某道门」，那个事实本来就是「在这个文件里」；
 *   · 探针不是代码符号（中文文案 / 散文）—— 「**这一屏**的文案必须写着 X」，同样是文件级事实。
 *
 * ── 退出码三分（不许合并）────────────────────────────────────────────────────
 *   0 = 干净（无新增位置锚）
 *   1 = **真有新增位置锚**
 *   2 = **门自己坏了**（金丝雀不中 / 基线不可解析 / 扫描面低于下界 / 任何未捕获异常）
 *       —— RC=2 时只许说「我没查出来」，**不许**读作「代码干净」。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const BASELINE = join(HERE, "factlock-anchor-baseline.json");

/** 扫描面下界：低于它一律判「工具坏了」，不许读作「全仓干净」。今日实测 606 个测试文件。 */
const MIN_TEST_FILES = 300;

// ═══════════════════════════════════════════════════════════════════════════════
// 1 · 词法：剥注释（保留字符串/模板/正则原文与行号）
//     ⚠ 不许换成朴素的 /\/\/.*$/ —— `"http://x"` 会被拦腰截断，判据当场失真。
// ═══════════════════════════════════════════════════════════════════════════════

/** `/` 前的这些字符意味着**下一个 `/` 开正则**而不是除号。 */
const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">", ""]);

/**
 * 剥掉行注释与块注释，**逐字保留**字符串、模板串、正则字面量，并保持行号不变。
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = "";
  let prev = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      out += " ";
      prev = " ";
      continue;
    }
    if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        const done = src[i] === c;
        i++;
        if (done) break;
      }
      prev = c;
      continue;
    }
    if (c === "`") {
      out += c;
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          depth++;
          out += "${";
          i += 2;
          continue;
        }
        if (depth > 0 && src[i] === "}") {
          depth--;
          out += "}";
          i++;
          continue;
        }
        if (depth === 0 && src[i] === "`") {
          out += "`";
          i++;
          break;
        }
        out += src[i];
        i++;
      }
      prev = "`";
      continue;
    }
    if (c === "/" && REGEX_PREV.has(prev)) {
      // 正则字面量：逐字抄到未转义的收尾 `/` 及其 flags
      out += c;
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) {
          out += "/";
          i++;
          while (i < n && /[a-z]/.test(src[i])) {
            out += src[i];
            i++;
          }
          break;
        } else if (src[i] === "\n") break; // 未闭合 ⇒ 当初判错了，退出别吞行
        out += src[i];
        i++;
      }
      prev = "/";
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/**
 * 把字符串 / 模板 / 正则字面量的**内容**遮成同长的填充字符（分隔符保留），行号与长度都不变。
 * 结构扫描（配对括号、切逗号、找语句尾）一律走遮罩版，取文本再回原文按同一下标切 ——
 * ⚠ 这一步是被金丝雀 C6 逼出来的：`toMatch(/foo\(/)` 里那个**转义的左括号**会把朴素的
 *   括号配对器带沟里，配不上 ⇒ 探针取空 ⇒ 整条正则探针的病样**一条都咬不中**（静默漏报）。
 * @param {string} code 已剥注释
 * @returns {string} 与 code 等长的遮罩串
 */
export function maskLiterals(code) {
  const buf = Array.from(code);
  const FILL = "·";
  let prev = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (code[i] === "\\") {
          buf[i] = FILL;
          if (i + 1 < n) buf[i + 1] = FILL;
          i += 2;
          continue;
        }
        if (code[i] === q) {
          i++;
          break;
        }
        if (code[i] !== "\n") buf[i] = FILL;
        i++;
      }
      prev = q;
      continue;
    }
    if (c === "/" && REGEX_PREV.has(prev)) {
      i++;
      let inClass = false;
      while (i < n) {
        if (code[i] === "\\") {
          buf[i] = FILL;
          if (i + 1 < n) buf[i + 1] = FILL;
          i += 2;
          continue;
        }
        if (code[i] === "\n") break; // 判错了（其实是除号），别吞行
        if (code[i] === "[") inClass = true;
        else if (code[i] === "]") inClass = false;
        else if (code[i] === "/" && !inClass) {
          i++;
          while (i < n && /[a-z]/.test(code[i])) i++;
          break;
        }
        buf[i] = FILL;
        i++;
      }
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return buf.join("");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2 · 「写死的单个源码路径」的识别
// ═══════════════════════════════════════════════════════════════════════════════

/** 源码后缀：这些文件里的**符号**可以自由搬家，所以锚它的位置就是病。 */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
/** 一切读文件的入口（本仓实测出现过的全部写法）。 */
const READ_CALL = /\b(readFileSync|readFile|readRepo|readRepoFile|readSrc|readTextFile)\s*\(/;
/** 出现这些 ⇒ 扫的是**一批**文件，不是单个写死的锚点 ⇒ 本门放过（那正是修法样板的形态）。 */
const MULTI_FILE = /\b(readdirSync|globSync|walk\s*\(|listFiles|allFiles|\.flatMap\s*\(|datacoreCode\s*\(|srcFiles)\b/;

/** 取出语句里的全部字符串字面量内容。 */
function stringLiterals(stmt) {
  const out = [];
  const re = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(stmt))) out.push(m[2]);
  return out;
}

/** 语句里写死的**源码**路径（可能多个，例如模板串拼两份）。 */
function sourcePathsIn(stmt, pathConsts) {
  const paths = stringLiterals(stmt).filter((s) => SOURCE_EXT.test(s) && s.length > 4);
  for (const [name, p] of pathConsts) {
    if (new RegExp(`\\b${name}\\b`).test(stmt)) paths.push(p);
  }
  return [...new Set(paths)];
}

/**
 * 从 `from` 起读一条语句（到顶层分号为止）。结构走**遮罩版**，文本切**原文**。
 * @param {string} code 原文（已剥注释）
 * @param {string} mask 与 code 等长的遮罩串
 * @returns {{text:string, end:number}}
 */
function readStatement(code, mask, from) {
  let depth = 0;
  let i = from;
  for (; i < mask.length; i++) {
    const c = mask[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth <= 0) break;
    if (depth < 0) break;
  }
  return { text: code.slice(from, i), end: i };
}

/**
 * 收集「内容 = 某几个写死源码文件」的变量绑定。
 *
 * ⚠ **返回的是带下标的绑定列表，不是 name→paths 的字典**：一个测试文件里
 * `const code = …` 常出现三五次（每个 describe 一份，锚在**不同**文件上）。
 * 用字典就是先来后到，后面的全被前面的顶掉 —— 实测 `transit-flow.seam.test.tsx`
 * 有 3 个同名 `code`，字典版把 `TransitFlowLayer.tsx` / `SandboxConsole.tsx` 两处
 * 全报成 `transitFlow.ts`。解析时按「站点之前**最近**的那次声明」取，才是真作用域。
 *
 * @param {string} code 已剥注释
 * @param {string} [maskIn] 遮罩串（不传就现算）
 * @returns {{name:string, at:number, paths:string[]}[]} 按 at 升序
 */
export function collectAnchoredVars(code, maskIn) {
  const mask = maskIn ?? maskLiterals(code);
  /** @type {Map<string,string>} */
  const pathConsts = new Map();
  /** @type {{name:string, at:number, paths:string[]}[]} */
  const bindings = [];
  const pathsAt = (name, at) => {
    let best = null;
    for (const b of bindings) if (b.name === name && b.at <= at && (!best || b.at > best.at)) best = b;
    return best ? best.paths : null;
  };

  const decl = /(?:^|[\s;{}()])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  /** @type {{name:string, at:number, stmt:string}[]} */
  const decls = [];
  let m;
  while ((m = decl.exec(mask))) {
    const { text } = readStatement(code, mask, decl.lastIndex);
    decls.push({ name: m[1], at: m.index, stmt: text });
  }

  // 第 1 遍：纯路径常量（有源码路径字面量、但自己不读文件）
  for (const { name, stmt } of decls) {
    if (READ_CALL.test(stmt)) continue;
    const lits = stringLiterals(stmt).filter((s) => SOURCE_EXT.test(s) && s.length > 4);
    if (lits.length === 1) pathConsts.set(name, lits[0]);
  }

  // 第 2 遍 + 传播：读文件的变量，以及从它们派生的变量（`.replace(...)` / `stripComments(x)` / 模板拼接）
  const seen = new Set();
  for (let round = 0; round < 4; round++) {
    for (const d of decls) {
      const id = `${d.name}@${d.at}`;
      if (seen.has(id)) continue;
      if (MULTI_FILE.test(d.stmt)) continue;
      if (READ_CALL.test(d.stmt)) {
        const paths = sourcePathsIn(d.stmt, pathConsts);
        if (paths.length >= 1) {
          bindings.push({ name: d.name, at: d.at, paths });
          seen.add(id);
        }
        continue;
      }
      // 派生：只引用已锚定的变量、自己不读文件
      const refs = [...d.stmt.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)]
        .map((x) => pathsAt(x[1], d.at))
        .filter(Boolean);
      if (refs.length > 0) {
        const merged = [...new Set(refs.flat())];
        if (merged.length > 0) {
          bindings.push({ name: d.name, at: d.at, paths: merged });
          seen.add(id);
        }
      }
    }
  }

  // 循环变量：`for (const X of [A, B])` / `for (const [n, X] of [["a", A], ["b", B]] as const)`
  const forOf = /for\s*\(\s*const\s+(\[[^\]]*\]|[A-Za-z_$][\w$]*)\s+of\s+(\[[\s\S]{0,400}?\])\s*(?:as\s+const\s*)?\)/g;
  while ((m = forOf.exec(mask))) {
    const binder = m[1];
    const listAt = m.index + m[0].indexOf(m[2]);
    const list = code.slice(listAt, listAt + m[2].length);
    const refs = [...list.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((x) => pathsAt(x[1], m.index)).filter(Boolean);
    if (refs.length === 0) continue;
    const merged = [...new Set(refs.flat())];
    const names = binder.startsWith("[")
      ? [...binder.matchAll(/([A-Za-z_$][\w$]*)/g)].map((x) => x[1])
      : [binder];
    for (const nm of names) bindings.push({ name: nm, at: m.index, paths: merged });
  }
  bindings.sort((a, b) => a.at - b.at);
  return bindings;
}

/**
 * 循环里绑到**字符串字面量数组**的变量：`for (const field of ["orderDay","shipDay"])`。
 * 之后 `expect(ext, …).toContain(field)` 的探针就能还原成那几个字面量 ——
 * 不还原就会静默漏报（探针是个变量名，判据一律读作「不是符号」）。
 * @returns {{name:string, at:number, values:string[]}[]}
 */
export function collectLoopLiterals(code, maskIn) {
  const mask = maskIn ?? maskLiterals(code);
  const out = [];
  const re = /for\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+(\[[^\][]{0,400}?\])\s*(?:as\s+const\s*)?\)/g;
  let m;
  while ((m = re.exec(mask))) {
    const listAt = m.index + m[0].indexOf(m[2]);
    const list = code.slice(listAt, listAt + m[2].length);
    const values = stringLiterals(list);
    if (values.length > 0 && values.length === splitTopLevel(list, mask.slice(listAt, listAt + m[2].length), 1, list.length - 1).length) {
      out.push({ name: m[1], at: m.index, values });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3 · expect 站点的抽取
// ═══════════════════════════════════════════════════════════════════════════════

/** 取 `mask[open]` 处 `(` 的配对 `)` 下标（mask 已把字面量内容遮掉）。返回 -1 表示没配上。 */
function matchParen(mask, open) {
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    const c = mask[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 顶层逗号切分：结构看 mask，文本切 code（两者等长同下标）。 */
function splitTopLevel(code, mask, from, to) {
  const out = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = mask[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(code.slice(start, i));
      start = i + 1;
    }
  }
  if (code.slice(start, to).trim()) out.push(code.slice(start, to));
  return out;
}

/**
 * 抽取全部 `expect(...)` 断言站点。
 * @param {string} code 已剥注释
 * @param {string} [maskIn] 遮罩串（不传就现算）
 */
export function findExpectSites(code, maskIn) {
  const mask = maskIn ?? maskLiterals(code);
  const sites = [];
  const re = /\bexpect\s*\(/g;
  let m;
  while ((m = re.exec(mask))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(mask, open);
    if (close < 0) continue;
    const args = splitTopLevel(code, mask, open + 1, close);
    const tail = mask.slice(close + 1, close + 400);
    const chain = /^((?:\s*\.\s*(?:not|resolves|rejects))*)\s*\.\s*(to[A-Za-z]+)\s*\(/.exec(tail);
    if (!chain) continue;
    const matcherOpen = close + 1 + chain[0].length - 1;
    const matcherClose = matchParen(mask, matcherOpen);
    /**
     * 探针 = 匹配器的**第一个顶层实参**，不是 `(` 与 `)` 之间的整段原文。
     *
     * ⚠ 2026-08-16 实测的静默漏报（WO-FACTLOCK-TRIAGE）：原写法直接 `slice` 括号内全文，
     * 于是 prettier 的多行尾逗号会让探针带上一个 `,`：
     *     expect(pg, `033 建了 ${table}…`).toContain(
     *       `new PgStore(pool, "${table}")`,     ← 这个尾逗号
     *     );
     * `probeIsSymbol` 的三条外壳正则（`^"…"$` / `^\`…\`$` / `^/…/[a-z]*$`）全部要求**整串**
     * 就是一个字面量，带上 `,` 一条都不匹配 ⇒ 判「不是代码符号」⇒ **整个站点被跳过**。
     * 实测后果：`process-flow-time.seam.test.ts:354` 的 `repo/pg.ts` 落点锚一直没被咬中，
     * 而它 4 行之下**一模一样形态**的 `repo/memory.ts` 落点（单行、无尾逗号）被咬中了 ——
     * 同一个 `it`、同一条仓规、同一种病，一个报一个不报。
     *
     * 照 CLAUDE.md 铁律 0.6 的句式：
     *   **「我用『括号里的整段原文』当作『探针实参』的证据，而前者并不度量后者
     *     —— 只要 prettier 换了行，两者就不是一回事。」**
     * 这个坑 12 条金丝雀一条都没照到：它们全是**单行、单实参、无尾逗号**的手写样例，
     * 与生产格式化后的真实形状**交集为空**（同铁律 0.5 判据 #6「生产实参与测试实参交集为空」）。
     * 故同时补金丝雀 C7（尾逗号形态），与主逻辑共用本函数。
     */
    const matcherArgs = matcherClose > 0 ? splitTopLevel(code, mask, matcherOpen + 1, matcherClose) : [];
    sites.push({
      index: m.index,
      line: code.slice(0, m.index).split("\n").length,
      subject: (args[0] ?? "").trim(),
      message: (args[1] ?? "").trim(),
      negated: /\bnot\b/.test(chain[1]),
      matcher: chain[2],
      probeRaw: (matcherArgs[0] ?? "").trim(),
      text: code.slice(m.index, matcherClose > 0 ? matcherClose + 1 : close + 1),
    });
  }
  return sites;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4 · 探针「像不像代码符号」
// ═══════════════════════════════════════════════════════════════════════════════

const CJK = /[　-〿一-鿿＀-￯]/;

/**
 * 探针是否是**代码符号/调用片段**（而非中文文案、散文）。
 * 只有代码符号才可能「搬家」——那正是位置锚的病根。
 * @param {string} raw 匹配器的实参原文
 */
export function probeIsSymbol(raw) {
  const s = raw.trim();
  if (!s) return false;
  let text = null;
  const str = /^(["'])((?:\\.|(?!\1)[^\\])*)\1$/.exec(s);
  if (str) text = str[2];
  else if (/^`[^`]*`$/.test(s)) text = s.slice(1, -1);
  else if (/^\/.*\/[a-z]*$/s.test(s)) {
    // 正则：去掉常见的元字符外壳后按同一判据看
    text = s
      .slice(1, s.lastIndexOf("/"))
      .replace(/\\[sbdwSBDW]/g, " ")
      .replace(/[\\^$*+?{}|]/g, "")
      .replace(/\((\?<?[:=!][a-z]*)?/g, "(")
      .trim();
  } else return false;
  if (!text || CJK.test(text)) return false;
  if (text.trim().length < 3) return false;
  const t = text.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return true; // 裸标识符
  if (/^[A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)+$/.test(t)) return true; // 点链
  if (/[A-Za-z_$][\w$]*\s*[([]/.test(t)) return true; // 调用/下标片段
  if (/^(export|import|const|function|class|type|interface)\s+[A-Za-z_$]/.test(t)) return true; // 声明片段
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5 · 主判据（金丝雀与门本体共用**同一份**实现，不许各抄一份）
// ═══════════════════════════════════════════════════════════════════════════════

const sha16 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const norm = (s) => s.replace(/\s+/g, " ").trim();

/**
 * **位置锚事实锁**的判据。
 *
 * 命中 = ① 断言主语的内容来自**写死的源码文件**（不是扫一棵树）
 *      ② 方向是**正向**（`toContain` / `toMatch`，无 `.not`）——正向说的是「能力还在」，
 *         而能力与它住在哪个文件无关
 *      ③ 探针是**代码符号/调用片段**（会搬家的东西），不是中文文案
 *
 * @param {string} src 文件原文（未剥注释）
 * @param {string} rel 仓库相对路径（进 key）
 * @returns {{key:string,line:number,paths:string[],probe:string,matcher:string,message:string,snippet:string}[]}
 */
export function detectAnchors(src, rel) {
  const code = stripComments(src);
  const mask = maskLiterals(code);
  const bindings = collectAnchoredVars(code, mask);
  const loopLits = collectLoopLiterals(code, mask);
  const pathConsts = collectPathConsts(code, mask);
  /** 站点之前**最近**的那次同名声明才是它真正的锚（同名 `code` 在一个文件里能有三五个）。 */
  const pathsAt = (name, at) => {
    let best = null;
    for (const b of bindings) if (b.name === name && b.at <= at && (!best || b.at > best.at)) best = b;
    return best ? best.paths : null;
  };
  const out = [];
  const used = new Map();
  for (const site of findExpectSites(code, mask)) {
    if (site.negated) continue;
    if (site.matcher !== "toContain" && site.matcher !== "toMatch") continue;

    // 探针：字面量直接判；若是循环里绑到字符串数组的变量，先还原成那几个字面量
    let probeRaw = site.probeRaw;
    let probeNote = "";
    if (!probeIsSymbol(probeRaw) && /^[A-Za-z_$][\w$]*$/.test(probeRaw)) {
      let best = null;
      for (const l of loopLits) if (l.name === probeRaw && l.at <= site.index && (!best || l.at > best.at)) best = l;
      if (best && best.values.every((v) => probeIsSymbol(JSON.stringify(v)))) {
        probeNote = `（循环变量 ${probeRaw} = ${best.values.map((v) => JSON.stringify(v)).join(", ")}）`;
        probeRaw = JSON.stringify(best.values[0]);
      }
    }
    if (!probeIsSymbol(probeRaw)) continue;

    const subj = site.subject;
    if (MULTI_FILE.test(subj)) continue;
    /** @type {string[]} */
    let paths = [];
    if (READ_CALL.test(subj)) {
      paths = sourcePathsIn(subj, pathConsts);
    } else {
      paths = [
        ...new Set(
          [...subj.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)]
            .map((x) => pathsAt(x[1], site.index))
            .filter(Boolean)
            .flat(),
        ),
      ];
    }
    if (paths.length === 0) continue;

    // 同一文件里出现字节完全相同的两条断言时，key 加序号以免互相顶掉
    let key = `${rel}#${sha16(norm(site.text))}`;
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    if (n > 1) key += `~${n}`;

    out.push({
      key,
      line: site.line,
      paths,
      probe: norm(site.probeRaw) + probeNote,
      matcher: site.matcher,
      message: norm(site.message).slice(0, 120),
      snippet: norm(site.text).slice(0, 200),
    });
  }
  return out;
}

/** 路径常量表（`detectAnchors` 内联主语时要用）。 */
function collectPathConsts(code, maskIn) {
  const mask = maskIn ?? maskLiterals(code);
  const out = new Map();
  const decl = /(?:^|[\s;{}()])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while ((m = decl.exec(mask))) {
    const { text } = readStatement(code, mask, decl.lastIndex);
    if (READ_CALL.test(text)) continue;
    const lits = stringLiterals(text).filter((s) => SOURCE_EXT.test(s) && s.length > 4);
    if (lits.length === 1) out.set(m[1], lits[0]);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6 · 扫描面
// ═══════════════════════════════════════════════════════════════════════════════

function walkTests(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTests(p, acc);
    else if (/\.test\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 全仓测试文件（仓库相对路径）。 */
export function testFiles() {
  const roots = ["apps", "packages"].map((d) => join(REPO_ROOT, d)).filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  return roots.flatMap((r) => walkTests(r)).map((f) => f.slice(REPO_ROOT.length + 1)).sort();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7 · 金丝雀 —— 与主逻辑**共用** detectAnchors，不另抄一份正则
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 必咬样例：每条都是真实的病样形态。
 * ⚠ 第一条逐字取自 `e639a6c2^` 的 `stale-claims.seam.test.ts` §3（本门的来历）。
 */
const MUST_BITE = [
  {
    id: "C1·病样原文（e639a6c2^ stale-claims §3）",
    src: `const app = readRepo("apps/datacore/src/app.ts");
expect(app, "推演 tick 不再 buildCadenceGates —— K1 的「已在读回」变假").toContain("buildCadenceGates");
expect(app, "tick 不再 listByType(\\"Cadence\\")").toContain('listByType(c.tenantId, "Cadence")');`,
    min: 2,
  },
  {
    id: "C2·内联读 + 符号探针",
    src: `expect(readRepo("apps/datacore/src/synthetic/service.ts")).toContain('putAll("Cadence"');`,
    min: 1,
  },
  {
    id: "C3·thunk 形态（const f = () => readRepo(...)）",
    src: `const model = () => readRepo("apps/frontend-shell/src/views/sim/inspectorModel.ts");
expect(model()).toContain("deriveCadenceAbsence(");`,
    min: 1,
  },
  {
    id: "C4·派生变量（stripComments/replace 之后仍是同一个锚）",
    src: `const view = readRepo("apps/x/src/V.tsx");
const code = view.replace(/\\/\\*[\\s\\S]*?\\*\\//g, " ");
expect(code, "不再调用 parseCadenceRows").toContain("parseCadenceRows(");`,
    min: 1,
  },
  {
    id: "C5·路径常量间接（readRepo(pathVar)）",
    src: `const derivePath = "apps/frontend-shell/src/views/sim/chainLineMap.ts";
expect(readRepo(derivePath)).toContain("CHAIN_STAGES.filter");`,
    min: 1,
  },
  {
    id: "C6·toMatch + 正则符号探针",
    src: `const src = readFileSync(join(HERE, "../src/opsteam/replay.ts"), "utf8");
expect(src).toMatch(/deriveCadenceAbsence\\(\\s*\\{/);`,
    min: 1,
  },
  {
    /**
     * 2026-08-16 WO-FACTLOCK-TRIAGE 补：**prettier 多行尾逗号**形态。
     * 逐字取自 `apps/datacore/test/process-flow-time.seam.test.ts:352-357` 的真实格式化结果 ——
     * 这条形态此前被静默跳过（见 `findExpectSites` 里 `probeRaw` 的顶注病历）。
     * 前 6 条金丝雀全是单行无尾逗号的手写样例，对这个坑天然免疫。
     */
    id: "C7·多行尾逗号（prettier 格式化后的真实形状）",
    src: `const pg = await readFile(join(REPO_APP, "src/repo/pg.ts"), "utf8");
expect(pg, \`033 建了 \${table}，但 repo/pg.ts 没有它的 PgStore 落点 ⇒ pg 模式启动即炸\`).toContain(
  \`new PgStore(pool, "\${table}")\`,
);`,
    min: 1,
  },
];

/** 必不咬样例：钉死几种**误咬**形态，每条都对应一个真实的合法写法。 */
const MUST_NOT_BITE = [
  {
    id: "N1·修法样板（扫整棵树 + 剥注释）不许被咬",
    src: `const code = datacoreCode();
expect(factHits(code, 'putAll("Cadence"'), "承载没了").not.toEqual([]);`,
  },
  {
    id: "N2·反向断言（这个文件不许引用 X）—— 位置即事实",
    src: `const view = readRepo("apps/x/src/V.tsx");
expect(view, "图层又去读 CADENCE_ABSENCE 常量了").not.toContain("CADENCE_ABSENCE");`,
  },
  {
    id: "N3·非源码路径（gate.sh 里必须挂着某道门）—— 位置即事实",
    src: `expect(readRepo("scripts/gate.sh")).toContain("check-stale-claims.mjs");`,
  },
  {
    id: "N4·中文文案探针（这一屏必须写着 X）—— 位置即事实",
    src: `const model = () => readRepo("apps/frontend-shell/src/views/sim/inspectorModel.ts");
expect(model()).toContain("没有返工工时或天数字段");`,
  },
  {
    id: "N5·**只在注释里**出现的病样必须不中（剥注释真的在生效）",
    src: `/* 病历：原先写 const app = readRepo("apps/datacore/src/app.ts");
   然后 expect(app).toContain("buildCadenceGatesCANARY"); —— 这是散文，不是代码 */
const x = 1;`,
  },
  {
    id: "N6·读的是 fixture / JSON，不是源码符号",
    src: `const raw = JSON.parse(readFileSync(join(FIX, "chain-loss-real.json"), "utf8"));
expect(raw.stages).toContain("customs");`,
  },
];

/** @returns {{ok:boolean, lines:string[], bit:number, total:number}} */
function runCanaries() {
  const lines = [];
  let bit = 0;
  let total = 0;
  for (const c of MUST_BITE) {
    total++;
    const hits = detectAnchors(c.src, "canary/must-bite.test.ts");
    const ok = hits.length >= c.min;
    if (ok) bit++;
    lines.push(`  ${ok ? "✓" : "✗"} 必咬 ${c.id} → 命中 ${hits.length} 条（要求 ≥${c.min}）${ok ? "" : "  ⛔ 没咬中"}`);
  }
  for (const c of MUST_NOT_BITE) {
    total++;
    const hits = detectAnchors(c.src, "canary/must-not-bite.test.ts");
    const ok = hits.length === 0;
    if (ok) bit++;
    lines.push(`  ${ok ? "✓" : "✗"} 必放 ${c.id} → 命中 ${hits.length} 条（要求 0）${ok ? "" : `  ⛔ 误咬：${hits.map((h) => h.probe).join(" / ")}`}`);
  }
  return { ok: bit === total, lines, bit, total };
}

/**
 * 附加金丝雀（**机会性**）：真去 git 里取 `e639a6c2^` 的病样原文喂进来。
 * 取不到（浅克隆 / 无 git）⇒ 如实报「跳过」，**不计入通过**，也**不**因此判门坏。
 * 取到了却咬不中 ⇒ 门坏了（RC=2）—— 那是本门唯一的来历样例。
 */
function gitCanary() {
  const REV = "e639a6c2^:apps/frontend-shell/test/stale-claims.seam.test.ts";
  let blob;
  try {
    blob = execFileSync("git", ["show", REV], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return { state: "skipped", detail: `取不到 ${REV}（浅克隆或无 git）—— 本条不计入通过，也不判门坏` };
  }
  const hits = detectAnchors(blob, "apps/frontend-shell/test/stale-claims.seam.test.ts");
  return hits.length >= 2
    ? { state: "hit", detail: `${REV} 命中 ${hits.length} 条：${hits.map((h) => `L${h.line} ${h.probe}`).join(" · ")}` }
    : { state: "miss", detail: `${REV} 只命中 ${hits.length} 条（本门的来历样例，至少 2 条）` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8 · 主流程
// ═══════════════════════════════════════════════════════════════════════════════

function toolBroken(msg, extra = []) {
  console.error(`⛔ factlock-anchor:check —— **门自己坏了**，本次结论作废`);
  console.error(`   ${msg}`);
  for (const l of extra) console.error(l);
  console.error(`   ⚠ RC=2 只许读作「我没查出来」，**不许**读作「无位置锚 / 代码干净」。`);
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const selftest = argv.includes("--selftest");
  const report = argv.includes("--report");

  // ── ① 先自证工具（金丝雀与主逻辑共用 detectAnchors）─────────────────────────
  const can = runCanaries();
  const git = gitCanary();
  if (selftest || report) {
    console.log("· 金丝雀（与主逻辑共用 detectAnchors 本体）");
    for (const l of can.lines) console.log(l);
    console.log(`  · 来历样例（git）：${git.state === "hit" ? "✓" : git.state === "miss" ? "✗" : "—"} ${git.detail}`);
    console.log(`· 金丝雀 ${can.bit}/${can.total} 命中（现算，非写死）`);
  }
  if (!can.ok) {
    toolBroken(`金丝雀 ${can.bit}/${can.total} —— 有必咬样例没咬中或必放样例被误咬`, can.lines);
  }
  if (git.state === "miss") {
    toolBroken(`来历样例咬不中：${git.detail}`);
  }

  // ── ② 扫描面自证 ────────────────────────────────────────────────────────────
  const files = testFiles();
  if (files.length < MIN_TEST_FILES) {
    toolBroken(`只扫到 ${files.length} 个测试文件（下界 ${MIN_TEST_FILES}）—— 扫描面塌了，不是仓里没测试`);
  }

  // ── ③ 基线 ─────────────────────────────────────────────────────────────────
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (e) {
    toolBroken(`基线 ${BASELINE.slice(REPO_ROOT.length + 1)} 读不出/解析失败：${e.message}`);
  }
  const exemptions = baseline.exemptions ?? [];
  if (!Array.isArray(exemptions)) toolBroken("基线 exemptions 不是数组");
  const known = new Map(exemptions.map((e) => [e.key, e]));

  // ── ④ 全仓扫 ───────────────────────────────────────────────────────────────
  const found = [];
  for (const rel of files) {
    let src;
    try {
      src = readFileSync(join(REPO_ROOT, rel), "utf8");
    } catch (e) {
      toolBroken(`读不了 ${rel}：${e.message}`);
    }
    for (const a of detectAnchors(src, rel)) found.push(a);
  }

  if (selftest) {
    console.log(`· 扫描面：${files.length} 个测试文件（下界 ${MIN_TEST_FILES}）`);
    console.log(`· 现存位置锚候选：${found.length} 条 · 基线豁免 ${known.size} 条`);
    console.log("✅ factlock-anchor:check --selftest 通过（必咬全部咬中 · 必放全部放过 · 扫描规模达标）");
    return 0;
  }

  if (report) {
    console.log(`\n· 扫描面：${files.length} 个测试文件`);
    console.log(`· 候选位置锚：${found.length} 条\n`);
    for (const f of found) {
      const e = known.get(f.key);
      console.log(`${f.paths.length > 1 ? "[多锚]" : "      "} ${f.key.split("#")[0]}:${f.line}`);
      console.log(`        probe=${f.probe}  ← ${f.paths.join(" , ")}`);
      console.log(`        msg=${f.message || "(无)"}`);
      console.log(`        key=${f.key}  ${e ? `✓豁免(${e.verdict ?? "?"})` : "✗未登记"}`);
    }
    return 0;
  }

  // ── ⑤ 棘轮：只许减不许增 ────────────────────────────────────────────────────
  const news = found.filter((f) => !known.has(f.key));
  const stale = [...known.keys()].filter((k) => !found.some((f) => f.key === k));

  console.log(`· 扫描面（现算）：${files.length} 个测试文件 · 金丝雀 ${can.bit}/${can.total} 命中 · 来历样例 ${git.state === "hit" ? "命中" : git.state}`);
  console.log(`· 位置锚：现存 ${found.length} 条 · 基线豁免 ${known.size} 条 · 新增 ${news.length} 条 · 基线已失效 ${stale.length} 条`);

  if (news.length > 0) {
    console.error(`\n✗ factlock-anchor:check 未通过（新增 ${news.length} 条位置锚事实锁）：`);
    for (const f of news) {
      console.error(`  - ${f.key.split("#")[0]}:${f.line}  正向 ${f.matcher}(${f.probe})  ← 写死锚点 ${f.paths.join(" , ")}`);
      if (f.message) console.error(`      失败文案：${f.message}`);
      console.error(`      key: ${f.key}`);
    }
    console.error(`
  修法（照 apps/frontend-shell/test/stale-claims.seam.test.ts §3）：
    ① 扫**整棵源码树**，别写死单个文件；
    ② \`stripComments\` 剥注释 —— 注释里提一嘴不算「代码里有」；
    ③ 排除声明式：\`/(?<!function\\s)\\bfoo\\s*\\(/\` —— 光有定义是「没接线」不是「在调用」；
    ④ 两条金丝雀与主逻辑共用同一份实现。
  若这条**位置就是事实本身**（如「这个 CSS 模块必须定义某类」「gate.sh 里必须挂着某道门」），
  把上面的 key 连同 why/verdict 登记进 scripts/factlock-anchor-baseline.json。`);
    return 1;
  }

  if (stale.length > 0) {
    console.log(`  ℹ 基线里有 ${stale.length} 条已不再命中（断言被改写或删除），可清理：`);
    for (const k of stale) console.log(`    - ${k}`);
  }
  console.log("✅ factlock-anchor:check 通过（无新增位置锚事实锁）");
  return 0;
}

// 顶层兜底：**任何**未预料的异常一律归到 RC=2（门坏了），不许摔成 RC=1 被读作「真有新增」。
try {
  process.exit(main());
} catch (e) {
  toolBroken(`未捕获异常：${e && e.stack ? e.stack : e}`);
}
