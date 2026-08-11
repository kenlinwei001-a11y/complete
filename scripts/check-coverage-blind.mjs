#!/usr/bin/env node
/**
 * 覆盖率盲区门 `coverage-blind:check`（假绿第 12 形态）
 * =====================================================
 *
 * ## 病：**测试咬的是「机制通不通」，对覆盖率全盲 —— 32% 与 100% 同色**
 *
 * 一个特性要求「N 个对象都得有 X」，测试却只断言「**存在**至少一个对象有 X」，
 * 或干脆把断言写进 `for` 里而不咬住这个 `for` 到底跑了几圈。
 * 于是 N 个里只做了 1 个也全绿、做满 N 个也全绿 —— **两种截然不同的完成度，同一个颜色**。
 *
 * 本仓已实测的同族实例（都不是假想）：
 *  · `apps/agentcore/src/agent/navigation-slice.ts` `SOLVER_CATALOG` 只有 **19** 条 `reads`，
 *    而 `apps/datacore/src/solvers/service.ts:51 SOLVER_KEYS` 有 **59** 个键 ⇒ 32%，
 *    而 `apps/agentcore/test/optimize-whatif-conversational-seam.test.ts` 只逐条断言
 *    `optimize_whatif` **这一个** solver 的 outputShape —— 另外 58 个漂了它一声不吭。
 *  · `apps/datacore/src/synthetic/service.ts:636 chainMode`：**生产三处调用点全部走 `false`**
 *    （`seed.ts:181` 显式 `viaModelingChain: false`；`app.ts:3806/4415`、`vle.ts:80/357/358` 不传 ⇒ undefined
 *    ⇒ `:201 input.viaModelingChain === true` 为假），而**测试三处调用点全部传 `true`**
 *    （`datamode-provenance.test.ts:49` / `demo-chain-provenance.test.ts:19,79`）
 *    ⇒ **生产实参与测试实参交集为空**：测试验的是生产从不走的那条路（CLAUDE.md 铁律 0.5 判据 #6）。
 *
 * ## 判据（四个检测器，都只看**测试自己的形状**，不需要知道 N 是多少）
 *
 * 门不可能知道「这个特性要求几个对象」——那是人的判断。
 * 但门可以断言 **测试必须带着能让 1/N 变红的那个装置**。装置有且只有两种：
 *   ① 遍历**全集**（不是被断言谓词过滤后的子集）+ 逐条断言；
 *   ② 咬住基数（`toHaveLength(k)` / `.length).toBe(k)` / `toEqual([...])`）。
 * 两个都没有 ⇒ 这条用例在 1/N 与 N/N 上必然同色 ⇒ 红。
 *
 * **D1 `LOOP_NO_FLOOR` · 循环在空集上恒真**
 *   `for (const x of XS) { expect(...) }` / `XS.forEach(x => expect(...))`，
 *   而整条 `it()` 里**没有任何**关于 `XS` 基数的断言。
 *   XS 为空时整条用例**恒绿且零断言执行**。这是"32% 与 100% 同色"的极端形态：0% 也同色。
 *
 * **D2 `EXISTS_FOR_ALL` · 拿 ∃ 冒充 ∀**
 *   `const XS = <某集合>.filter(...)`（或 `.map/.flatMap`），
 *   而 `it()` 里关于 `XS` 的断言**全部是存在性**（`toBeGreaterThan(0)` / `not.toHaveLength(0)` /
 *   `toContain(` / `.some(...)).toBe(true)` / `.find(...)).toBeDefined()`），
 *   既没有基数断言、也没有对 `XS` 的 ∀ 遍历。
 *
 * **D3 `FILTER_TAUTOLOGY` · 用被断言的谓词先把反例滤掉**
 *   `const XS = ALL.filter(x => x.p)` 之后再断言 `x.p` —— 这是最狠的一种：
 *   **它不只是盲，它是构造性地把反例排除在样本之外**，N 里做了 1 个和做了全部，
 *   连"样本量"这个唯一可能露馅的信号都一样。
 *
 * **D4 `SWITCH_ARG_UNCOVERED` · 生产实参与测试实参交集为空**
 *   某个**布尔开关键** `k`（形如 `k: true` / `k: false` 的对象字面量属性，且在 src 里有
 *   `k?: boolean` / `k: boolean` 的声明）：生产代码传的字面量集合 ∩ 测试传的字面量集合 = ∅。
 *   ⇒「这个函数有测试」证明不了「生产走的那个分支有测试」。
 *
 * ## 为什么是棘轮（`scripts/coverage-blind-baseline.json`）而不是一刀切红
 *
 * 存量 600+ 个测试文件里这四种形态成百上千，一刀切红等于把门关掉。
 * 棘轮的两条硬规矩：
 *   · **基线里没有的指纹 = 增量 = 红**（新写的测试不许再带盲区进来）；
 *   · **只降不升**：基线条目消失只打印"可收紧"，`--update` 才回写 —— 且 `--update`
 *     **拒绝新增条目**（只允许删除），所以没有"把红的塞进基线"这条逃生路。
 *
 * 指纹刻意**不含行号**（`file :: it 标题 :: 检测器 :: 目标符号`）：行号一漂全表失配，
 * 门就退化成噪声，几次之后没人再分辨该不该变 —— 那正是橡皮图章的成因。
 *
 * ## 金丝雀（与主逻辑**共用同一份实现**）
 *
 * 下方 `CANARY_CASES` 是内嵌的源码片段，逐条声明「应当被哪个检测器命中 / 应当不被命中」，
 * 由 **`analyzeSource()` 本身**（不是另抄一份正则）跑一遍。
 * 任一条不符 ⇒ **RC=2 工具坏了**，此时**不许**读作"仓库干净"。
 * 另有**真仓样本金丝雀**：`viaModelingChain` 这条 D4 已实测存在，扫不到它同样判 RC=2。
 *
 * ## 退出码三分
 *   0 = 干净（无基线外新增盲点）
 *   1 = 真有问题（有基线外新增盲点）
 *   2 = **工具自己坏了**（金丝雀不中 / 扫描面为空 / 基线文件坏）——不许据此报"干净"
 *
 * 用法：
 *   node scripts/check-coverage-blind.mjs            · pnpm coverage-blind:check
 *   node scripts/check-coverage-blind.mjs --report   （打印全部盲点，含基线内的）
 *   node scripts/check-coverage-blind.mjs --update   （棘轮收紧：只删不增）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "scripts", "coverage-blind-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const REPORT = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
/**
 * `--seed` 是**一次性**的建账入口，且**只在基线为空时**可用（下方会硬拦）。
 * 一旦基线有条目，唯一的写路径就是 `--update`，而 `--update` **只删不增** ——
 * 于是「把红的塞进基线」这条逃生路在结构上不存在，不靠人自觉。
 */
const SEED = ARGS.has("--seed");

/** RC=2 专用：工具坏了，**不是**"仓库干净"。 */
function toolBroken(why, detail) {
  console.error(`\n✗✗ coverage-blind:check —— **工具坏了**（RC=2），不是"仓库干净"：${why}`);
  if (detail) console.error(detail);
  console.error(
    `\n  ⚠ 报「0 命中 / 没有盲点 / 全部覆盖」这类否定结论之前，必须先有金丝雀命中证据。` +
      `\n    金丝雀不中 ⇒ 只能报「工具坏了」（CLAUDE.md 铁律 0.6）。`,
  );
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────────────
// §1 词法：把注释与字符串/模板字面量抹成等长空格（保住行号与偏移）
// ────────────────────────────────────────────────────────────────────────────
/**
 * 抹掉注释与字符串**内容**，保留定界符与长度。
 * 为什么必须做：`expect(x).toBe("for (const y of z)")` 这种字符串会把后面所有检测器带偏；
 * 而中文断言消息里出现 `.filter(` 更是家常便饭。
 */
export function blankOut(src) {
  const out = src.split("");
  const n = src.length;
  const wipe = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      wipe(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      wipe(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j++;
          break;
        }
        j++;
      }
      wipe(i + 1, Math.max(i + 1, j - 1));
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** 从抹白后的源取原文标题（`it("…"` 的第一个字符串实参）。 */
function titleAt(src, openParenIdx) {
  const m = /^\s*\(\s*(["'`])/.exec(src.slice(openParenIdx));
  if (!m) return "";
  const q = m[1];
  const start = openParenIdx + m[0].length;
  let j = start;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === q) break;
    j++;
  }
  return src.slice(start, j).replace(/\s+/g, " ").trim();
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** 从 `openIdx`（`{` 或 `(` 的位置）起做括号配对，返回闭合位置（含）。 */
function matchBrace(blanked, openIdx, open = "{", close = "}") {
  if (blanked[openIdx] !== open) return -1;
  let depth = 0;
  for (let i = openIdx; i < blanked.length; i++) {
    const c = blanked[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ────────────────────────────────────────────────────────────────────────────
// §2 切分 it()/test() 用例块
// ────────────────────────────────────────────────────────────────────────────
const CASE_RE = /\b(?:it|test)(?:\.(?:each|concurrent|only|skip|todo|fails))?\s*\(/g;

export function splitCases(src) {
  const b = blankOut(src);
  const cases = [];
  CASE_RE.lastIndex = 0;
  let m;
  while ((m = CASE_RE.exec(b)) !== null) {
    const parenIdx = m.index + m[0].length - 1;
    // 用例体 = 回调函数的 `{ … }`。找 `(` 之后第一个顶层的 `=> {` 或 `function … {`。
    const closeParen = matchBrace(b, parenIdx, "(", ")");
    if (closeParen < 0) continue;
    const inner = b.slice(parenIdx, closeParen + 1);
    const arrow = inner.indexOf("=>");
    if (arrow < 0) continue;
    let k = parenIdx + arrow + 2;
    while (k < b.length && /\s/.test(b[k])) k++;
    if (b[k] !== "{") continue; // 单表达式箭头体（无块），不在射程
    const bodyEnd = matchBrace(b, k, "{", "}");
    if (bodyEnd < 0) continue;
    cases.push({
      title: titleAt(src, parenIdx),
      startLine: lineOf(src, m.index),
      bodyStart: k,
      bodyEnd,
      body: b.slice(k, bodyEnd + 1),
      bodyRaw: src.slice(k, bodyEnd + 1),
      absOffset: k,
    });
    CASE_RE.lastIndex = m.index + m[0].length;
  }
  // 只保留最内层用例（describe 里嵌 it 不会误配，因为 CASE_RE 只认 it/test）
  return cases;
}

// ────────────────────────────────────────────────────────────────────────────
// §3 断言形态识别
// ────────────────────────────────────────────────────────────────────────────
/** 集合表达式 → 根标识符（`a.b.filter(x=>…)` → `a`；`res.json().items` → `res`）。 */
function rootIdent(expr) {
  const m = /([A-Za-z_$][\w$]*)/.exec(expr.trim().replace(/^\(*\s*(?:await\s+)?/, ""));
  return m ? m[1] : "";
}

/** 集合表达式 → 「被断言的那个名字」：优先取整条链前缀里最后一个标识符或完整链。 */
function collExprKey(expr) {
  return expr.trim().replace(/\s+/g, "");
}

/** 去掉全部空白（注释与字符串已在 blankOut 抹过，故安全）——让锚点匹配不受换行/缩进影响。 */
function squash(s) {
  return s.replace(/\s+/g, "");
}
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 该用例体里是否存在针对**这个集合表达式**的「非空锚点」。
 *
 * ⚠️ 判据必须落在**完整表达式**上，不能只看根标识符 —— 亲手实测的反例
 * （`apps/agentcore/test/agent-budget.test.ts:66`）：循环遍历 `result.answer.provenance`，
 * 而同条用例里有一句无关的 `expect(result.outcome).toBe("BUDGET_EXHAUSTED")`。
 * 按根标识符 `result` 判，这句会被误当成 `provenance` 的锚点 ⇒ **漏报**。
 * 「`result` 有断言」并不度量「`result.answer.provenance` 非空」——正是铁律 0.6 那句
 * 「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 */
export function hasCardinalityAnchor(body, expr) {
  if (!expr) return false;
  const e = squash(expr);
  if (!e) return false;
  const b = squash(body);
  const id = esc(e);
  const pats = [
    // expect(EXPR).toHaveLength(…) / .toEqual([…]) / .toMatchObject([…])
    new RegExp(`expect\\(${id}\\)\\.(?:not\\.)?(?:toHaveLength|toEqual|toStrictEqual|toMatchObject|toMatchInlineSnapshot|toMatchSnapshot)\\b`),
    // expect(EXPR.length / .size) 任意 matcher —— 咬住条数这件事本身
    new RegExp(`expect\\(${id}\\.(?:length|size)\\)`),
    new RegExp(`expect\\(Object\\.keys\\(${id}\\)(?:\\.length)?\\)`),
    new RegExp(`expect\\(Object\\.entries\\(${id}\\)(?:\\.length)?\\)`),
    // expect(EXPR.map(…)) / EXPR.filter(…).length —— 对整集的形状断言
    new RegExp(`expect\\(${id}\\.(?:map|filter|flatMap|slice|sort|every|join)\\(`),
    new RegExp(`expect\\(\\[\\.\\.\\.${id}`),
    new RegExp(`expect\\(${id}\\.size\\)`),
  ];
  return pats.some((p) => p.test(b));
}

/** 该用例体里针对 `name` 的断言是否**只有存在性**（∃ 冒充 ∀）。 */
const EXISTENTIAL_TAIL =
  /\)\s*\.\s*(?:not\s*\.\s*toHaveLength\s*\(\s*0\s*\)|toBeGreaterThan\s*\(\s*0\s*\)|toBeGreaterThanOrEqual\s*\(\s*1\s*\)|toBeTruthy\s*\(\s*\)|toBeDefined\s*\(\s*\)|toContain\b|toContainEqual\b)/;
/** 严格基数断言（咬死条数） */
const EXACT_TAIL = /\)\s*\.\s*(?:toHaveLength\s*\(\s*(?!0\s*\))|toBe\s*\(\s*\d|toEqual\s*\(|toStrictEqual\s*\(|toMatchObject\s*\(|toMatchInlineSnapshot\b|toBeGreaterThanOrEqual\s*\(\s*(?!0|1\s*\))\d)/;

/** 抽出用例体里所有 `expect( … )` 的完整片段（含尾部 matcher 链到行尾）。 */
export function expectStatements(body) {
  const out = [];
  const re = /expect\s*\(/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(body, open, "(", ")");
    if (close < 0) continue;
    // matcher 链：从 close 起到该语句结束（分号 / 换行且括号平衡）
    let j = close + 1;
    let depth = 0;
    while (j < body.length) {
      const c = body[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if ((c === ";" || c === "\n") && depth <= 0) break;
      j++;
    }
    out.push({ inner: body.slice(open + 1, close), tail: body.slice(close, j), whole: body.slice(m.index, j), at: m.index });
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// §4 四个检测器
// ────────────────────────────────────────────────────────────────────────────

/** 用例体里的循环：`for (… of EXPR)` 与 `EXPR.forEach(`。返回 {kind, expr, bodyStart, bodyEnd, at} */
function findLoops(body) {
  const loops = [];
  const forOf = /\bfor\s*\(\s*(?:const|let|var)\s+[^)]*?\bof\s+([^)]+)\)\s*\{/g;
  let m;
  while ((m = forOf.exec(body)) !== null) {
    const braceIdx = m.index + m[0].length - 1;
    const end = matchBrace(body, braceIdx, "{", "}");
    if (end < 0) continue;
    loops.push({ kind: "for-of", expr: m[1], at: m.index, inner: body.slice(braceIdx, end + 1) });
  }
  const fe = /([A-Za-z_$][\w$.[\]"'()]*?)\s*\.\s*forEach\s*\(/g;
  while ((m = fe.exec(body)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(body, open, "(", ")");
    if (close < 0) continue;
    loops.push({ kind: "forEach", expr: m[1], at: m.index, inner: body.slice(open, close + 1) });
  }
  return loops;
}

/**
 * 所有 `const/let/var NAME = …` 绑定 → `name → 右手边表达式`。
 *
 * ⚠️ 两个坑，都是亲手实测踩出来的（2026-08-11）：
 *  ① **类型标注里可能有 `;`**：`const cases: { input: string; op: string }[] = [...]`
 *     —— 用 `(?::[^=;]+)?=` 这种偷懒写法会整条匹配失败，于是"字面量数组"识别不出来，
 *     `apps/agentcore/test/a15-operation-classify.test.ts:45` 被误报成盲点。
 *     改为**从 NAME 之后按括号深度找第一个真正的赋值 `=`**（排除 `=>`/`==`/`>=`/`<=`/`!=`）。
 *  ② **绑定可能在 `it()` 外面**：`apps/agentcore/test/ceo-route-metric-split.test.ts:33`
 *     的 `const DEEP = [ …5 条… ]` 是模块级常量，用例里只是 `for (const x of DEEP)`。
 *     只扫用例体 ⇒ 查不到它是字面量数组 ⇒ 误报。故调用方必须把**文件级绑定**一起传进来。
 */
function collectBindings(text) {
  const map = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let i = m.index + m[0].length;
    let depth = 0;
    let eq = -1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if (c === ";" && depth === 0) break;
      else if (c === "\n" && depth === 0 && /[,)]/.test(text.slice(i - 1, i))) break;
      else if (c === "=" && depth === 0) {
        const prev = text[i - 1];
        const next = text[i + 1];
        if (next === "=" || next === ">" || prev === "=" || prev === "!" || prev === "<" || prev === ">") continue;
        eq = i;
        break;
      }
    }
    if (eq < 0) continue;
    let j = eq + 1;
    let d2 = 0;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "(" || c === "[" || c === "{") d2++;
      else if (c === ")" || c === "]" || c === "}") {
        if (d2 === 0) break;
        d2--;
      } else if (c === ";" && d2 === 0) break;
    }
    if (!map.has(name)) map.set(name, text.slice(eq + 1, j));
  }
  return map;
}

/** 字面量数组常量（条数写死在源码里 ⇒ 遍历它不可能"在空集上恒真"）。 */
function isLiteralArrayBinding(expr) {
  return /^\s*\[/.test(String(expr || ""));
}

/**
 * 标量（尤其是字符串）绑定 —— **不是集合**，`toContain(` 在它上面是子串断言不是存在量词。
 * 亲手实测的反例：`apps/agentcore/test/agent-budget.test.ts:61`
 *   `const md = result.answer.blocks.map((b) => …).join("\n");`
 * `md` 是一个 string。若把它当集合，`expect(md).toContain("…")` 会被读成"∃ 冒充 ∀"⇒ 误报。
 */
function isScalarBinding(expr) {
  const e = String(expr || "");
  return /\.\s*(?:join|toString|trim|toLowerCase|toUpperCase|padStart|padEnd|slice)\s*\([^)]*\)\s*$/.test(e.trim()) || /^\s*(?:JSON\s*\.\s*stringify|String|Number|Boolean)\s*\(/.test(e);
}

/** D1：循环体里有 expect，但整条用例对被遍历集合零非空锚点 ⇒ **空集恒绿、零断言执行**。 */
export function detectLoopNoFloor(kase, fileBinds = new Map()) {
  const hits = [];
  const binds = new Map([...fileBinds, ...collectBindings(kase.body)]);
  for (const loop of findLoops(kase.body)) {
    if (!/expect\s*\(/.test(loop.inner)) continue;
    const expr = loop.expr.trim();
    if (!rootIdent(expr)) continue;
    // ① 字面量数组直接遍历（`for (const k of ["a","b"])`）：条数写死在源码里，不可能空
    if (isLiteralArrayBinding(expr)) continue;
    // ② 遍历的是一个绑定到字面量数组的局部常量（同上，只是先起了个名字）
    //    实测反例：apps/agentcore/test/a15-operation-classify.test.ts:45 `const cases = [ …10 条… ]`
    const asIdent = /^[A-Za-z_$][\w$]*$/.test(expr) ? binds.get(expr) : undefined;
    if (asIdent !== undefined && isLiteralArrayBinding(asIdent)) continue;
    if (asIdent !== undefined && isScalarBinding(asIdent)) continue;
    // ③ Object.keys(X)/entries(X) → 锚点看 X 本身
    const oe = /Object\s*\.\s*(?:keys|values|entries)\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)/.exec(expr);
    const anchorExprs = oe ? [expr, oe[1]] : [expr];
    if (anchorExprs.some((a) => hasCardinalityAnchor(kase.body, a))) continue;
    // ④ 集合表达式本身带 .filter( 的交给 D2/D3，避免一条盲点报两遍
    if (/\.\s*filter\s*\(/.test(expr)) continue;
    hits.push({ detector: "LOOP_NO_FLOOR", symbol: collExprKey(expr).slice(0, 60), kind: loop.kind });
  }
  return hits;
}

/** 局部集合绑定：`const NAME = <expr>` 且 expr 含 .filter/.map/.flatMap。 */
function derivedBindings(body) {
  const out = [];
  const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const [, name, expr] = m;
    if (!/\.\s*(?:filter|map|flatMap)\s*\(/.test(expr)) continue;
    if (isScalarBinding(expr)) continue; // `.map(…).join("\n")` 是 string，不是集合
    out.push({ name, expr: expr.replace(/\s+/g, " ").trim(), at: m.index });
  }
  return out;
}

/** D2：派生集合的断言全是存在性，无基数、无 ∀ 遍历。 */
export function detectExistsForAll(kase) {
  const hits = [];
  for (const bind of derivedBindings(kase.body)) {
    const { name } = bind;
    const idRe = new RegExp(`\\b${esc(name)}\\b`);
    const stmts = expectStatements(kase.body).filter((s) => idRe.test(s.inner));
    if (stmts.length === 0) continue;
    // 有对该集合的 ∀ 遍历（for-of / forEach / every）就不算盲
    const loopedOver = findLoops(kase.body).some((l) => idRe.test(l.expr));
    if (loopedOver) continue;
    if (new RegExp(`\\b${esc(name)}\\s*\\.\\s*(?:every|forEach)\\s*\\(`).test(kase.body)) continue;
    const allExistential = stmts.every((s) => EXISTENTIAL_TAIL.test(s.tail) && !EXACT_TAIL.test(s.tail));
    if (!allExistential) continue;
    hits.push({ detector: "EXISTS_FOR_ALL", symbol: name, kind: "derived" });
  }
  return hits;
}

/** 从箭头谓词 `x => x.p` / `(x) => x.p && …` 抽取被测属性名集合。 */
function predProps(expr) {
  const m = /\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([\s\S]*)$/.exec(expr);
  if (!m) return { param: "", props: new Set() };
  const [, param, bodyPart] = m;
  const props = new Set();
  const pr = new RegExp(`\\b${param}\\s*(?:\\?)?\\.\\s*([A-Za-z_$][\\w$]*)`, "g");
  let p;
  while ((p = pr.exec(bodyPart)) !== null) props.add(p[1]);
  return { param, props };
}

/** D3：先用被断言的谓词把反例滤掉，再断言同一个谓词 —— 构造性排除反例。 */
export function detectFilterTautology(kase) {
  const hits = [];
  for (const bind of derivedBindings(kase.body)) {
    const fm = /\.\s*filter\s*\(\s*([\s\S]+)$/.exec(bind.expr);
    if (!fm) continue;
    const { props } = predProps(fm[1]);
    if (props.size === 0) continue;
    const idRe = new RegExp(`\\b${bind.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    // 该集合被遍历/被断言时，断言的属性是否就是刚才 filter 用的那个
    const loops = findLoops(kase.body).filter((l) => idRe.test(l.expr));
    const scopes = [...loops.map((l) => l.inner)];
    for (const s of expectStatements(kase.body)) if (idRe.test(s.inner)) scopes.push(s.whole);
    if (scopes.length === 0) continue;
    for (const prop of props) {
      const propRe = new RegExp(`\\.\\s*${prop}\\b`);
      const asserted = scopes.some((sc) => /expect\s*\(/.test(sc) && propRe.test(sc));
      if (!asserted) continue;
      // 有基数断言 ⇒ 至少能看出样本量，降级不报（仍会被 D2 视情形抓）
      if (hasCardinalityAnchor(kase.body, bind.name)) continue;
      hits.push({ detector: "FILTER_TAUTOLOGY", symbol: `${bind.name}.${prop}`, kind: "filter-then-assert-same" });
      break;
    }
  }
  return hits;
}

/** 单文件分析：D1–D3（D4 是跨文件的，另走）。 */
export function analyzeSource(src, file = "<inline>") {
  const cases = splitCases(src);
  const fileBinds = collectBindings(blankOut(src));
  const out = [];
  for (const kase of cases) {
    // D3/D2 先跑：同一条盲点若已被"更具体"的检测器定性，D1 不再重复报一遍。
    // （`const xs = all.filter(s => s.p)` + `for (const s of xs) expect(s.p)` 本是一条病，
    //   D1 只看到"xs 没有基数断言"，D3 看到的是"用被断言的谓词滤掉了反例" —— 后者才是修法。）
    const specific = [...detectFilterTautology(kase), ...detectExistsForAll(kase)];
    const claimed = new Set(specific.map((h) => String(h.symbol).split(".")[0]));
    const loopHits = detectLoopNoFloor(kase, fileBinds).filter((h) => !claimed.has(rootIdent(h.symbol)));
    for (const h of [...loopHits, ...specific]) {
      out.push({
        file,
        line: lineOf(src, kase.absOffset),
        title: kase.title,
        ...h,
        key: `${file} :: ${kase.title} :: ${h.detector} :: ${h.symbol}`,
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// §5 D4：布尔开关的生产实参 vs 测试实参
// ────────────────────────────────────────────────────────────────────────────
/**
 * 从 `idx` 向左找**最近一个未闭合的开括号**，返回它的字符与位置（找不到返回 null）。
 * 用于判定「这个对象字面量是被谁包着的」。
 */
function enclosingOpener(b, idx) {
  const closers = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (let i = idx - 1; i >= 0; i--) {
    const c = b[i];
    if (c === ")" || c === "]" || c === "}") stack.push(closers[c]);
    else if (c === "(" || c === "[" || c === "{") {
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
      else return { ch: c, at: i };
    }
  }
  return null;
}

/**
 * 抽出**作为调用实参传进去**的布尔开关：`foo(…, { …, key: false, … })`。
 *
 * ⚠️ 为什么必须限定"调用实参"，不能裸扫 `key: true|false`：
 * 裸扫会把**数据表**也算进来，而数据表里的同名键与开关毫无关系。
 * 亲手实测的反例（2026-08-11）：`apps/datacore/src/synthetic/view-manifest.ts:59` 的
 * `BUILTIN_VIEWS = [{ key:"dash", …, seed: true }, …]` —— 这里的 `seed` 是"这个视图要不要种"
 * 的**数据字段**，与测试里某处 `seed: false` 撞了名字，于是被误报成"生产/测试实参交集为空"。
 * 那正是铁律 0.6 的病：**拿一个看起来相关的数字当判据**（键名相同 ≠ 同一个开关）。
 * 判据改成"对象字面量的直接外层是 `(`" ⇒ 数据表（外层是 `[` 或 `=`）自然出局。
 */
export function boolLiteralProps(src) {
  const b = blankOut(src);
  const out = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*:\s*(true|false)\b/g;
  let m;
  while ((m = re.exec(b)) !== null) {
    const obj = enclosingOpener(b, m.index);
    if (!obj || obj.ch !== "{") continue; // 不在对象字面量里
    const outer = enclosingOpener(b, obj.at);
    if (!outer || outer.ch !== "(") continue; // 对象字面量的直接外层不是调用实参 ⇒ 数据表/配置常量，出局
    out.push({ key: m[1], value: m[2] === "true", line: lineOf(src, m.index) });
  }
  return out;
}

/** 声明处：`key?: boolean` / `key: boolean`（证明它真是个开关，不是随手写的对象字段）。 */
export function boolParamDecls(src) {
  const b = blankOut(src);
  const out = new Set();
  const re = /\b([A-Za-z_$][\w$]*)\s*\??\s*:\s*boolean\b/g;
  let m;
  while ((m = re.exec(b)) !== null) out.add(m[1]);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// §6 金丝雀 —— 与主逻辑**共用同一份实现**（跑的就是 analyzeSource / boolLiteralProps）
// ────────────────────────────────────────────────────────────────────────────
const CANARY_CASES = [
  {
    name: "D1 命中：循环体有 expect，全条零基数断言",
    src: `
import { it, expect } from "vitest";
it("每个求解器都要有 outputShape", () => {
  const solvers = registry.solvers;
  for (const s of solvers) {
    expect(s.outputShape).toBeDefined();
  }
});`,
    expect: ["LOOP_NO_FLOOR"],
  },
  {
    name: "D1 不命中：有基数断言咬住圈数",
    src: `
import { it, expect } from "vitest";
it("每个求解器都要有 outputShape", () => {
  const solvers = registry.solvers;
  expect(solvers).toHaveLength(59);
  for (const s of solvers) {
    expect(s.outputShape).toBeDefined();
  }
});`,
    expect: [],
  },
  {
    name: "D1 不命中：字面量数组遍历（条数写死在源码里）",
    src: `
import { it, expect } from "vitest";
it("三种角色都要能登录", () => {
  for (const role of ["admin", "planner", "base_manager"]) {
    expect(login(role)).toBe(true);
  }
});`,
    expect: [],
  },
  {
    // 回归金丝雀：类型标注里带 `;` 曾让绑定识别整条失配 ⇒ 字面量数组读不出来 ⇒ 误报
    name: "D1 不命中：带含 `;` 的类型标注的字面量数组",
    src: `
import { it, expect } from "vitest";
it("缺区操作不再落 QUERY", () => {
  const cases: { input: string; op: string; endpoint: string }[] = [
    { input: "a", op: "llm", endpoint: "/x" },
    { input: "b", op: "mcp", endpoint: "/y" },
  ];
  for (const c of cases) {
    expect(classify(c.input).op).toBe(c.op);
  }
});`,
    expect: [],
  },
  {
    // 回归金丝雀：绑定在 it() 外面（模块级常量）时，只扫用例体会读不到 ⇒ 误报
    name: "D1 不命中：模块级字面量数组常量",
    src: `
import { it, expect } from "vitest";
const DEEP = [
  { q: "问句一", route: "gap_attribution" },
  { q: "问句二", route: "decision_play" },
];
it("5 条深问 → 深路由", () => {
  for (const { q, route } of DEEP) {
    expect(resolveCeoRoute(q).route).toBe(route);
  }
});`,
    expect: [],
  },
  {
    // 反面：同样是模块级常量，但来自 import（条数不在本文件里，可能悄悄缩到 0）⇒ 必须命中
    name: "D1 命中：遍历 import 进来的注册表，无基数断言",
    src: `
import { it, expect } from "vitest";
import { CEO_INTENT_KEYS } from "../src/router/ceo-route.js";
it("每个 CEO 意图都有声明槽", () => {
  for (const key of CEO_INTENT_KEYS) {
    expect(intentByKey.get(key)).toBeTruthy();
  }
});`,
    expect: ["LOOP_NO_FLOOR"],
  },
  {
    name: "D2 命中：派生集合只有存在性断言",
    src: `
import { it, expect } from "vitest";
it("求解器带 reads", () => {
  const withReads = all.map((s) => s.reads);
  expect(withReads.length).toBeGreaterThan(0);
});`,
    expect: ["EXISTS_FOR_ALL"],
  },
  {
    name: "D2 不命中：存在性 + 基数双断言",
    src: `
import { it, expect } from "vitest";
it("求解器带 reads", () => {
  const withReads = all.map((s) => s.reads);
  expect(withReads.length).toBeGreaterThan(0);
  expect(withReads).toHaveLength(59);
});`,
    expect: [],
  },
  {
    name: "D3 命中：先按 dataMode 过滤，再断言 dataMode",
    src: `
import { it, expect } from "vitest";
it("推演求解器输出带 dataMode", () => {
  const simSolvers = catalog.filter((s) => s.dataMode);
  for (const s of simSolvers) {
    expect(s.dataMode).toBe("LIVE");
  }
});`,
    expect: ["FILTER_TAUTOLOGY"],
  },
  {
    name: "D3 不命中：过滤维度与断言维度不同",
    src: `
import { it, expect } from "vitest";
it("推演求解器输出带 dataMode", () => {
  const simSolvers = catalog.filter((s) => s.category === "sim");
  expect(simSolvers).toHaveLength(7);
  for (const s of simSolvers) {
    expect(s.dataMode).toBe("LIVE");
  }
});`,
    expect: [],
  },
  {
    name: "词法层：字符串里的 for/filter 不许把检测器带偏",
    src: `
import { it, expect } from "vitest";
it("错误消息文案", () => {
  const msg = "for (const x of xs) { expect(x.p).toBe(1) } .filter((s) => s.p)";
  expect(msg).toContain("for");
  expect(msg).toHaveLength(64);
});`,
    expect: [],
  },
];

/** D4 金丝雀：跑的是 `boolLiteralProps` 本体，不另抄一份正则。 */
const CANARY_D4 = [
  {
    name: "D4 命中：调用实参里的布尔开关",
    src: `await synthetic.runJob(ctx, { industry: "x", seed: 42, viaModelingChain: false });`,
    expect: [["viaModelingChain", false]],
  },
  {
    name: "D4 不命中：数据表里的同名字段（外层是 `[`，不是调用实参）",
    src: `export const BUILTIN_VIEWS = [\n  { key: "dash", title: "t", seed: true },\n  { key: "graph", title: "g", seed: true },\n];`,
    expect: [],
  },
  {
    name: "D4 不命中：顶层配置常量对象（外层是 `=`）",
    src: `const CONFIG = { debug: true, verbose: false };`,
    expect: [],
  },
  {
    name: "D4 命中：嵌在第二个实参、且对象里还有嵌套对象",
    src: `runJob(ctx, { nested: { a: 1 }, chainMode: true });`,
    expect: [["chainMode", true]],
  },
];

function runCanaries() {
  const bad = [];
  for (const c of CANARY_CASES) {
    const got = analyzeSource(c.src, "<canary>").map((h) => h.detector).sort();
    const want = [...c.expect].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`  · ${c.name}\n      期望 ${JSON.stringify(want)} · 实得 ${JSON.stringify(got)}`);
  }
  for (const c of CANARY_D4) {
    const got = boolLiteralProps(c.src).map((p) => [p.key, p.value]);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) bad.push(`  · ${c.name}\n      期望 ${JSON.stringify(c.expect)} · 实得 ${JSON.stringify(got)}`);
  }
  // 词法金丝雀：blankOut 必须把字符串内容抹掉且不改长度/行号
  const lex = `const a = "for (const";\nconst b = 1;`;
  const lexOut = blankOut(lex);
  if (lexOut.length !== lex.length) bad.push(`  · blankOut 改变了长度（${lex.length} → ${lexOut.length}）—— 行号会全错`);
  if (/for \(const/.test(lexOut)) bad.push(`  · blankOut 没抹掉字符串内容`);
  if (lexOut.split("\n").length !== lex.split("\n").length) bad.push(`  · blankOut 改变了行数`);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────────
// §7 扫描面
// ────────────────────────────────────────────────────────────────────────────
function gitLs(patterns) {
  try {
    return execFileSync("git", ["ls-files", "-z", "--", ...patterns], { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  } catch (e) {
    toolBroken("git ls-files 执行失败", String(e && e.message));
    return [];
  }
}

/**
 * ⚠️ pathspec 只用**最宽的一条**，精确过滤交给下面的 JS 正则。
 *
 * 理由是本仓踩过 4 次的坑（CLAUDE.md 铁律 0.6 表格第 1 行）：git pathspec 里的 `*`/`**`
 * 语义与直觉不符 —— 亲手实测（2026-08-11，本机）：
 *   `git ls-files -- "apps/*\/test/**\/*.test.ts"` → **0**（读作"全仓没有测试"）
 *   `git ls-files -- "apps/*\/test/*.test.ts"`     → 419
 *   `git ls-files -- "*.test.ts" "*.test.tsx"`     → 609  ← 用这条
 * 第一条会让整份报告得出"没有盲点"这个恰好相反的结论。**下面的扫描面自证就是为它准备的。**
 */
const TEST_GLOBS = ["*.test.ts", "*.test.tsx"];
const TEST_PATH_RE = /^(?:apps\/[^/]+\/test\/|packages\/[^/]+\/(?:test|src)\/)/;
const SRC_GLOBS = ["*.ts", "*.tsx"];
const SRC_PATH_RE = /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/src\/)/;

// ────────────────────────────────────────────────────────────────────────────
// §8 主流程
// ────────────────────────────────────────────────────────────────────────────
const canaryFail = runCanaries();
if (canaryFail.length) toolBroken("内嵌金丝雀不符（检测器实现坏了）", canaryFail.join("\n"));

const testFiles = gitLs(TEST_GLOBS).filter((f) => TEST_PATH_RE.test(f));
// 扫描面自证：pathspec 一旦坏掉（本仓踩过 4 次），这里会是 0 或极小
if (testFiles.length < 100) {
  toolBroken(
    `测试扫描面只有 ${testFiles.length} 个文件 —— 本仓实测 600+，几乎必然是 pathspec 坏了`,
    `  globs: ${TEST_GLOBS.join(" ")}  filter: ${TEST_PATH_RE}`,
  );
}
const KNOWN_TEST_FILE = "apps/datacore/test/catalog.test.ts";
if (!testFiles.includes(KNOWN_TEST_FILE)) {
  toolBroken(`已知必中的测试文件不在扫描面里：${KNOWN_TEST_FILE}`, `  实得 ${testFiles.length} 个文件`);
}

const srcFiles = gitLs(SRC_GLOBS).filter((f) => SRC_PATH_RE.test(f) && !/\.test\.tsx?$/.test(f));
if (srcFiles.length < 100) toolBroken(`源码扫描面只有 ${srcFiles.length} 个文件 —— 本仓实测 400+`, `  globs: ${SRC_GLOBS.join(" ")}`);
const KNOWN_SRC_FILE = "apps/datacore/src/synthetic/service.ts";
if (!srcFiles.includes(KNOWN_SRC_FILE)) toolBroken(`已知必中的源文件不在扫描面里：${KNOWN_SRC_FILE}`, `  实得 ${srcFiles.length} 个文件`);

// —— D1–D3 —— //
const hits = [];
for (const f of testFiles) {
  let src;
  try {
    src = readFileSync(join(ROOT, f), "utf8");
  } catch {
    continue;
  }
  hits.push(...analyzeSource(src, f));
}

// —— D4 —— //
const prodBool = new Map(); // key → Set<boolean>
const testBool = new Map();
const declared = new Set();
const prodSites = new Map();
const testSites = new Map();
for (const f of srcFiles) {
  const src = readFileSync(join(ROOT, f), "utf8");
  for (const k of boolParamDecls(src)) declared.add(k);
  for (const p of boolLiteralProps(src)) {
    if (!prodBool.has(p.key)) prodBool.set(p.key, new Set());
    prodBool.get(p.key).add(p.value);
    if (!prodSites.has(p.key)) prodSites.set(p.key, []);
    prodSites.get(p.key).push(`${f}:${p.line}=${p.value}`);
  }
}
for (const f of testFiles) {
  const src = readFileSync(join(ROOT, f), "utf8");
  for (const p of boolLiteralProps(src)) {
    if (!testBool.has(p.key)) testBool.set(p.key, new Set());
    testBool.get(p.key).add(p.value);
    if (!testSites.has(p.key)) testSites.set(p.key, []);
    testSites.get(p.key).push(`${f}:${p.line}=${p.value}`);
  }
}
const d4Covered = [];
for (const [key, pv] of [...prodBool.entries()].sort()) {
  if (!declared.has(key)) continue; // 必须是真声明过的布尔开关
  const tv = testBool.get(key);
  if (!tv || tv.size === 0) continue; // 测试压根不传 → 是另一种病（不在本门射程），不报
  const inter = [...pv].filter((v) => tv.has(v));
  if (inter.length > 0) {
    d4Covered.push(`${key}（生产 ${[...pv].join(",")} ∩ 测试 ${[...tv].join(",")} = ${inter.join(",")}）`);
    continue;
  }
  hits.push({
    file: (prodSites.get(key)[0] || "").split(":")[0],
    line: Number((prodSites.get(key)[0] || "::0").split(":")[1]) || 0,
    title: `开关 ${key}`,
    detector: "SWITCH_ARG_UNCOVERED",
    symbol: key,
    kind: `prod=${[...pv].join(",")} test=${[...tv].join(",")}`,
    key: `<switch> :: ${key} :: SWITCH_ARG_UNCOVERED :: ${key}`,
    detail: `生产 ${prodSites.get(key).slice(0, 4).join(" · ")}\n        测试 ${testSites.get(key).slice(0, 4).join(" · ")}`,
  });
}

// —— 真仓样本金丝雀：这条 D4 已实测存在，扫不到 = 工具坏了 —— //
const REPO_CANARY_D4 = "viaModelingChain";
const d4keys = hits.filter((h) => h.detector === "SWITCH_ARG_UNCOVERED").map((h) => h.symbol);
if (!d4keys.includes(REPO_CANARY_D4)) {
  // 只有当该开关在仓里还存在时才判工具坏（它被修好了是好事，不是工具坏）
  const stillProdFalse = prodBool.get(REPO_CANARY_D4);
  const stillTestTrue = testBool.get(REPO_CANARY_D4);
  if (stillProdFalse && stillTestTrue && ![...stillProdFalse].some((v) => stillTestTrue.has(v))) {
    toolBroken(
      `真仓金丝雀 D4 \`${REPO_CANARY_D4}\` 明明还在（生产 ${[...stillProdFalse]} / 测试 ${[...stillTestTrue]}，交集空）却没被 D4 抓到`,
      `  ⇒ D4 实现坏了`,
    );
  }
  console.log(`· 真仓金丝雀 D4 \`${REPO_CANARY_D4}\`：已不再是盲点（生产=${stillProdFalse ? [...stillProdFalse] : "无"} / 测试=${stillTestTrue ? [...stillTestTrue] : "无"}）——可从金丝雀降级`);
} else {
  console.log(`· 真仓金丝雀 D4 \`${REPO_CANARY_D4}\`：命中 ✓（工具有效，下面的计数是真的）`);
}

// —— 棘轮 —— //
let baseline = { note: "", entries: {} };
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (e) {
    toolBroken("基线文件解析失败", `  ${BASELINE_PATH}\n  ${String(e && e.message)}`);
  }
}
const baseKeys = new Set(Object.keys(baseline.entries || {}));
const seen = new Set(hits.map((h) => h.key));
const novel = hits.filter((h) => !baseKeys.has(h.key));
const vanished = [...baseKeys].filter((k) => !seen.has(k));

const byDetector = {};
for (const h of hits) byDetector[h.detector] = (byDetector[h.detector] || 0) + 1;

console.log(
  `· 覆盖率盲区门：扫 ${testFiles.length} 个测试文件 + ${srcFiles.length} 个源文件 · 命中 ${hits.length} 条 ` +
    `（${Object.entries(byDetector).map(([k, v]) => `${k}=${v}`).join(" · ") || "无"}）· 基线 ${baseKeys.size} 条`,
);

if (REPORT) {
  console.log(`\n=== D4 已覆盖的布尔开关（${d4Covered.length}）—— 生产实参真的被某个测试跑过 ===`);
  for (const c of d4Covered) console.log(`  ✓ ${c}`);
  const grouped = {};
  for (const h of hits) (grouped[h.detector] ||= []).push(h);
  for (const [det, list] of Object.entries(grouped)) {
    console.log(`\n=== ${det}（${list.length}）===`);
    for (const h of list.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line))) {
      console.log(`  ${h.file}:${h.line}  [${h.symbol}] ${h.kind}${baseKeys.has(h.key) ? "" : "   ← 基线外"}`);
      console.log(`      it: ${h.title}`);
      if (h.detail) console.log(`      ${h.detail}`);
    }
  }
}

/** 每条基线条目的 why —— 说清「这条今天盲在哪、能盲到什么程度」，不是一句"存量"糊过去。 */
const WHY_BY_DETECTOR = {
  LOOP_NO_FLOOR: (h) =>
    `遍历 \`${h.symbol}\` 的循环体里有 expect，但整条用例没有任何咬住 \`${h.symbol}\` 条数的断言 ⇒ ` +
    `该集合为空时循环一圈不跑、零断言执行、用例照绿。反例输入：让 \`${h.symbol}\` 返回 \`[]\` —— 0/N 与 N/N 同色。`,
  EXISTS_FOR_ALL: (h) =>
    `派生集合 \`${h.symbol}\` 上只有存在性断言（toBeGreaterThan(0) / not.toHaveLength(0) / toContain / toBeTruthy），` +
    `既无基数断言也无对全集的逐条遍历 ⇒ 拿 ∃ 冒充 ∀。反例输入：只产出 1 条也全绿 —— 1/N 与 N/N 同色。`,
  FILTER_TAUTOLOGY: (h) =>
    `先用 \`${String(h.symbol).split(".").slice(1).join(".")}\` 这个谓词把样本过滤一遍，再断言同一个属性 ⇒ ` +
    `**构造性地把反例排除在样本之外**。反例输入：让绝大多数元素不满足该谓词 —— 它们直接不进样本，用例照绿，连样本量都看不出异常。`,
  SWITCH_ARG_UNCOVERED: (h) =>
    `布尔开关 \`${h.symbol}\` 的生产实参集合与测试实参集合**交集为空**（${h.kind}）⇒ ` +
    `测试验的是生产从不走的那条分支。反例输入：把生产那条分支整个改坏 —— 全部测试照绿（CLAUDE.md 铁律 0.5 判据 #6）。`,
};

if (SEED) {
  if (baseKeys.size > 0) {
    console.error(
      `\n✗ --seed 拒绝：基线已有 ${baseKeys.size} 条。\n` +
        `  \`--seed\` 只在**基线为空**时可用（一次性建账）。此后唯一写路径是 \`--update\`，而它**只删不增**。\n` +
        `  这不是提示，是结构性约束：没有任何入口能把新的红条目塞进基线。`,
    );
    process.exit(1);
  }
  const entries = {};
  for (const h of hits.sort((a, b) => a.key.localeCompare(b.key))) {
    entries[h.key] = {
      detector: h.detector,
      file: `${h.file}:${h.line}`,
      symbol: h.symbol,
      why: (WHY_BY_DETECTOR[h.detector] || (() => "存量盲点"))(h),
    };
  }
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        note:
          "覆盖率盲区棘轮基线（假绿第 12 形态：测试咬的是「机制通不通」，对覆盖率全盲 —— 32% 与 100% 同色）。" +
          "本表是**存量清单**，不是逃生舱：`--update` 只删不增，新增盲点一律红。" +
          "指纹刻意不含行号（file :: it 标题 :: 检测器 :: 目标符号），行号一漂全表失配会让门退化成噪声。",
        seededAt: new Date().toISOString().slice(0, 10),
        gate: "scripts/check-coverage-blind.mjs",
        entries,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ 基线建账：${Object.keys(entries).length} 条（此后只降不升）`);
  process.exit(0);
}

if (UPDATE) {
  // 棘轮只许下降：`--update` 只删不增
  const next = { ...baseline, entries: {} };
  for (const k of baseKeys) if (seen.has(k)) next.entries[k] = baseline.entries[k];
  const removed = baseKeys.size - Object.keys(next.entries).length;
  if (novel.length) {
    console.error(`\n✗ --update 拒绝：有 ${novel.length} 条基线外新增盲点。棘轮只许下降，不许把红的塞进基线。`);
    for (const h of novel.slice(0, 20)) console.error(`  - ${h.file}:${h.line} [${h.detector}] ${h.symbol}`);
    process.exit(1);
  }
  next.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(`✓ 基线收紧：${baseKeys.size} → ${Object.keys(next.entries).length}（删 ${removed} 条）`);
  process.exit(0);
}

if (vanished.length) {
  console.log(`\n· 可收紧：${vanished.length} 条基线条目已消失（跑 \`node scripts/check-coverage-blind.mjs --update\` 落账）`);
  for (const k of vanished.slice(0, 10)) console.log(`    - ${k}`);
}

if (novel.length) {
  console.error(`\n✗ coverage-blind:check 未通过：${novel.length} 条**基线外**覆盖率盲点（假绿第 12 形态）`);
  for (const h of novel) {
    console.error(`  - ${h.file}:${h.line}  [${h.detector}] ${h.symbol}`);
    console.error(`      it: ${h.title}`);
    if (h.detail) console.error(`      ${h.detail}`);
    console.error(`      指纹: ${h.key}`);
  }
  console.error(
    `\n  ⚠ 为什么这条必须红：这几种形态下，「N 里只做了 1 个」与「做满 N 个」**测试给出同一个颜色**。` +
      `\n    修法（按检测器）：` +
      `\n      LOOP_NO_FLOOR       → 在循环前后加一条基数断言（\`expect(xs).toHaveLength(N)\`），空集就不再恒绿；` +
      `\n      EXISTS_FOR_ALL      → 把 \`toBeGreaterThan(0)\` 换成咬死条数的断言，或对全集逐条断言；` +
      `\n      FILTER_TAUTOLOGY    → **别用被断言的谓词去过滤样本**，遍历全集再断言（这条最狠：它构造性地把反例排除在样本外）；` +
      `\n      SWITCH_ARG_UNCOVERED→ 补一条**传生产那个值**的用例（"这个函数有测试" ≠ "生产走的那个分支有测试"）。` +
      `\n  ⚠ 不要用"加进基线"来消红：\`--update\` **只删不增**，没有这条逃生路。`,
  );
  process.exit(1);
}

console.log(`\n✓ coverage-blind:check 通过：无基线外新增覆盖率盲点（存量 ${hits.length} 条在基线内，只降不升）。`);
process.exit(0);
