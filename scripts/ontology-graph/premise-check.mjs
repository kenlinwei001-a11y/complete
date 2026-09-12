#!/usr/bin/env node
/**
 * WO-ONTOGRAPH-CONSUME · 派单前提自检器（本体图谱的第一个消费方）
 * ============================================================================
 *
 * 读一份派单 markdown，把里面的**事实声明**拿去和 `docs/ontology-graph/` 的图谱对账。
 *
 *   node scripts/ontology-graph/premise-check.mjs docs/WO-XXX.md
 *   node scripts/ontology-graph/premise-check.mjs docs/WO-XXX.md --graph docs/ontology-graph
 *   node scripts/ontology-graph/premise-check.mjs --selftest       # 回归用例 + 金丝雀
 *
 * ── 为什么有这个工具 ────────────────────────────────────────────────────────
 * 2026-09-12 一个会话里，审核方**连续五张派单的前提被 dev 实测推翻**，每次都让人白做：
 *
 *   | 派单里写的                  | 实测真相                                   | 当时用的错判据        |
 *   |----------------------------|-------------------------------------------|---------------------|
 *   | 求解器 60 个                | 63                                        | `grep -c` 的命中数    |
 *   | `args-schemas.ts` 是空的    | 22 行薄 re-export，真表在别处、已有 11 条    | 打开看了一眼文件短     |
 *   | 规则 39 条                  | 30                                        | grep `C\d\d` 的命中数 |
 *   | description 是一句话         | p90 ~301 字 / max 714，全量喂不起           | 抽样看了两条         |
 *   | `lineGranularity` 零调用方   | 5 处（service.ts:3512 → portfolio.ts ×5）   | 只看直接命中不追间接   |
 *
 * 共同形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用一次 grep 的命中数当作事实，而真相要用真数组 / 真服务 / 真引用图去量。」**
 *
 * ── ⛔ 这不是一道门 ─────────────────────────────────────────────────────────
 * 仓主禁令 3 冻结了新增门 / 棘轮 / 基线 JSON。本工具**不输出红绿判定**、不注册进 gate、
 * 对账结论一律 `rc=0`。非 0 只表示**工具自己没跑起来**：
 *   rc=3 用法错 / 文件读不到     rc=4 内部金丝雀不中（抽取器坏了，拒绝报任何否定结论）
 *
 * ── 输出形态：四列对账表 ───────────────────────────────────────────────────
 *   ① 你写的是 X   ② 图谱说是 Y   ③ 证据在哪   ④ **图谱这一格可不可信**
 *
 * 第四列不许省。图谱自己会错 —— 立项当天审核方的探针就报过两个假数
 * （「只有 test 引用 = 0」「`buildSliceIndex` 入边 = 0」），两个都是工具坏了不是代码干净。
 * **判据：一个读对账表的人，必须能分清「我写错了」和「图谱抽漏了」。分不清的表等于没用。**
 *
 * 所以第四列的可信度**不是一句形容词**，它由四个可验证的来源合成：
 *   (a) 该维度在 `INDEX.yaml` 的 `canary` 段有没有对应探针、探针过没过、expect 与 actual 自不自洽
 *   (b) 承载该结论的分片 YAML 解析有没有告警（块标量 / flow 残留 / 缩进异常）
 *   (c) 该维度有没有被图谱自己的**盲区清单**（`INDEX.blindSpots` 或 README「看不见什么」段）点名
 *   (d) 这一格是图谱**直接度量**的，还是本工具**代答/降级**来的（如用 `brief` 长度代答 `description`）
 *
 * ── 噪声纪律（和抓错一样重要）────────────────────────────────────────────────
 * 本仓实测过一个探针「空闲时报 0 正确、忙时把 worker 数成 2」——
 * **「错的时候能抓」不度量「对的时候不吵」。噪声大的工具没人会跑第二次。**
 * 故：① 词表覆盖不到的名词**不硬猜**，进「已识别·无法对账」区而不是进差异区；
 *     ② 代码围栏 / 行内代码里的数字不当声明；③ 相符的行照样打印（让人看见它核过了）。
 *
 * ── 金丝雀（铁律 0.6：扫描类结论一律先自证工具）──────────────────────────────
 * 每次运行**先**把一段内置样例喂给抽取器，抽不到预期声明数即报「抽取器坏了」并 rc=4，
 * ⛔ 不许报「本文件无可核声明」。「我没找到」和「它不存在」是两个不同的命题。
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_GRAPH = join(ROOT, "docs", "ontology-graph");

/** 行号容差：图谱里记的是**声明行/引用行**，派单里抄的坐标会随上游改动漂移。
 *  ±12 行 ≈ 一个函数头 + JSDoc 的高度；比这更宽就会把隔壁符号也认成「对上了」。
 *  可用 `--line-tolerance N` 覆盖。理由同样写进 docs/ontology-graph/PREMISE-CHECK.md。 */
const DEFAULT_LINE_TOLERANCE = 12;

// ══════════════════════════════════════════════════════════════════════════
// 0 · 极小 YAML 子集解析器
//    本仓的门脚本一律零依赖（`yaml` 包不在任何 package.json 里，实测 require.resolve 失败），
//    故自带解析器。**它必须自报读不懂的地方** —— 静默 mangle 比读不懂危险得多，
//    那会让「图谱抽漏了」伪装成「你写错了」。所有限制都抛 YamlLimit，最终落到第四列。
// ══════════════════════════════════════════════════════════════════════════

class YamlLimit extends Error {
  constructor(msg, where) {
    super(where ? `${msg}（${where}）` : msg);
    this.name = "YamlLimit";
    this.where = where;
  }
}

/** 去掉行尾注释（引号内的 `#` 不算）。 */
function stripComment(line) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && inD) { i++; continue; }
    if (c === '"' && !inS) inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function plainScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?(\d+\.\d*|\.\d+)$/.test(s)) return Number(s);
  return s;
}

/** flow 形态 `{a: b, c: [d, e]}` / `[a, b]` 的递归下降解析。 */
function parseFlow(text, where) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };

  function readQuoted() {
    const q = text[i];
    let j = i + 1;
    while (j < text.length) {
      if (q === '"' && text[j] === "\\") { j += 2; continue; }
      if (text[j] === q) {
        if (q === "'" && text[j + 1] === "'") { j += 2; continue; }
        j++; break;
      }
      j++;
    }
    const raw = text.slice(i, j);
    i = j;
    if (q === '"') {
      try { return JSON.parse(raw); } catch { throw new YamlLimit(`双引号标量解析失败 ${raw}`, where); }
    }
    return raw.slice(1, -1).replace(/''/g, "'");
  }

  function readKey() {
    ws();
    if (text[i] === '"' || text[i] === "'") { const k = readQuoted(); ws(); return String(k); }
    let j = i;
    // YAML 规则：plain scalar 里的 `:` 只有**后接空白**才是分隔符（故 `sym:apps/...` 是一个整体）
    while (j < text.length) {
      if (text[j] === ":" && (j + 1 >= text.length || /[\s,}\]]/.test(text[j + 1]))) break;
      if (text[j] === "," || text[j] === "}" || text[j] === "]") break;
      j++;
    }
    const k = text.slice(i, j).trim();
    i = j;
    if (!k) throw new YamlLimit("flow map 里出现空键", where);
    return k;
  }

  function readValue() {
    ws();
    if (i >= text.length) throw new YamlLimit("flow 提前结束", where);
    if (text[i] === "[") {
      i++; const out = []; ws();
      if (text[i] === "]") { i++; return out; }
      for (;;) {
        out.push(readValue()); ws();
        if (text[i] === ",") { i++; ws(); if (text[i] === "]") { i++; break; } continue; }
        if (text[i] === "]") { i++; break; }
        throw new YamlLimit(`flow seq 期望 , 或 ] 却见到 ${JSON.stringify(text[i] ?? "EOF")}`, where);
      }
      return out;
    }
    if (text[i] === "{") {
      i++; const out = {}; ws();
      if (text[i] === "}") { i++; return out; }
      for (;;) {
        const k = readKey(); ws();
        if (text[i] !== ":") throw new YamlLimit(`flow map 键 ${k} 后缺 :`, where);
        i++;
        out[k] = readValue(); ws();
        if (text[i] === ",") { i++; ws(); if (text[i] === "}") { i++; break; } continue; }
        if (text[i] === "}") { i++; break; }
        throw new YamlLimit(`flow map 期望 , 或 } 却见到 ${JSON.stringify(text[i] ?? "EOF")}`, where);
      }
      return out;
    }
    if (text[i] === '"' || text[i] === "'") return readQuoted();
    let j = i;
    while (j < text.length && !",]}".includes(text[j])) j++;
    const raw = text.slice(i, j);
    i = j;
    return plainScalar(raw);
  }

  const v = readValue();
  ws();
  if (i < text.length) throw new YamlLimit(`flow 尾部残留 ${JSON.stringify(text.slice(i, i + 24))}`, where);
  return v;
}

function bracketBalance(s) {
  let depth = 0, inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && inD) { i++; continue; }
    if (c === '"' && !inS) { inD = !inD; continue; }
    if (c === "'" && !inD) { inS = !inS; continue; }
    if (inS || inD) continue;
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth;
}

/**
 * 解析 YAML 子集：块映射 / 块序列 / flow 集合 / 标量 / 注释。
 * **不支持**块标量 `|` `>`、锚点 `&` `*`、多文档 `---`、复杂键 `? ` —— 全部抛 YamlLimit。
 * @returns {{ value: any, warnings: string[] }}
 */
function parseYamlSubset(text, label) {
  const warnings = [];
  const raw = text.split("\n");
  /** @type {{indent:number, content:string, ln:number}[]} */
  const lines = [];
  for (let n = 0; n < raw.length; n++) {
    let body = stripComment(raw[n]);
    if (!body.trim()) continue;
    if (/^\s*---\s*$/.test(body) || /^\s*\.\.\.\s*$/.test(body)) {
      warnings.push(`${label}:${n + 1} 出现文档分隔符（多文档不支持，已忽略该行）`);
      continue;
    }
    if (/\t/.test(body.match(/^\s*/)[0])) throw new YamlLimit(`缩进含 TAB`, `${label}:${n + 1}`);
    const indent = body.match(/^ */)[0].length;
    // flow 集合跨行 ⇒ 拼到括号平衡为止（`spannedTypes: [\n  A,\n  B\n]` 这种）
    let content = body.trim();
    let ln = n;
    while (bracketBalance(content) > 0 && n + 1 < raw.length) {
      n++;
      content += " " + stripComment(raw[n]).trim();
    }
    if (bracketBalance(content) !== 0) throw new YamlLimit(`括号不平衡`, `${label}:${ln + 1}`);
    lines.push({ indent, content, ln: ln + 1 });
  }
  if (!lines.length) return { value: null, warnings };

  let p = 0;
  function parseBlock(indent) {
    if (p >= lines.length) return null;
    if (lines[p].content.startsWith("- ")) return parseSeq(indent);
    if (lines[p].content === "-") return parseSeq(indent);
    return parseMap(indent);
  }

  function parseSeq(indent) {
    const out = [];
    while (p < lines.length && lines[p].indent === indent && (lines[p].content === "-" || lines[p].content.startsWith("- "))) {
      const { content, ln } = lines[p];
      const rest = content === "-" ? "" : content.slice(2).trim();
      const where = `${label}:${ln}`;
      p++;
      if (!rest) {
        out.push(p < lines.length && lines[p].indent > indent ? parseBlock(lines[p].indent) : null);
        continue;
      }
      if (rest[0] === "[" || rest[0] === "{") { out.push(parseFlow(rest, where)); continue; }
      const kv = splitKey(rest);
      if (kv) {
        // `- key: v` 起头的内联块映射：后续更深缩进的行并入同一项
        const item = {};
        assignKV(item, kv, where);
        const childIndent = indent + 2;
        while (p < lines.length && lines[p].indent > indent) {
          const sub = parseMapInto(item, lines[p].indent);
          if (!sub) break;
        }
        void childIndent;
        out.push(item);
        continue;
      }
      out.push(scalarOf(rest, where));
    }
    return out;
  }

  function parseMapInto(target, indent) {
    let touched = false;
    while (p < lines.length && lines[p].indent === indent && !lines[p].content.startsWith("- ")) {
      const { content, ln } = lines[p];
      const where = `${label}:${ln}`;
      const kv = splitKey(content);
      if (!kv) throw new YamlLimit(`不是 key: value 形态 ${JSON.stringify(content)}`, where);
      p++;
      touched = true;
      if (kv.value === "") {
        target[kv.key] = p < lines.length && lines[p].indent > indent ? parseBlock(lines[p].indent) : null;
      } else {
        assignKV(target, kv, where);
      }
    }
    return touched;
  }

  function parseMap(indent) {
    const out = {};
    parseMapInto(out, indent);
    return out;
  }

  function assignKV(target, kv, where) {
    target[kv.key] = scalarOf(kv.value, where);
  }

  function scalarOf(s, where) {
    const t = s.trim();
    if (t === "|" || t === ">" || /^[|>][-+0-9]*$/.test(t)) throw new YamlLimit("块标量 | / > 不支持", where);
    if (t.startsWith("&") || t.startsWith("*")) throw new YamlLimit("锚点/别名不支持", where);
    if (t[0] === "[" || t[0] === "{") return parseFlow(t, where);
    if (t[0] === '"' || t[0] === "'") { let i = 0; void i; return parseFlow(t, where); }
    return plainScalar(t);
  }

  function splitKey(s) {
    let inS = false, inD = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && inD) { i++; continue; }
      if (c === '"' && !inS) { inD = !inD; continue; }
      if (c === "'" && !inD) { inS = !inS; continue; }
      if (inS || inD) continue;
      if (c === "[" || c === "{") return null; // flow 值里的冒号不算键分隔
      if (c === ":" && (i + 1 >= s.length || /\s/.test(s[i + 1]))) {
        return { key: unquote(s.slice(0, i).trim()), value: s.slice(i + 1).trim() };
      }
    }
    return null;
  }

  function unquote(k) {
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) return k.slice(1, -1);
    return k;
  }

  const value = parseBlock(lines[0].indent);
  if (p < lines.length) warnings.push(`${label}:${lines[p].ln} 起 ${lines.length - p} 行未被解析（缩进形态超出子集）`);
  return { value, warnings };
}

// ══════════════════════════════════════════════════════════════════════════
// 1 · 载入图谱
// ══════════════════════════════════════════════════════════════════════════

/**
 * @returns {{
 *   ok: boolean, dir: string, index: any|null, atoms: any[], slices: any[],
 *   byName: Map<string, any[]>, byFile: Map<string, any[]>,
 *   warnings: string[], fatal: string[], shardHealth: Map<string, string[]>,
 *   blindSpots: string[], blindSpotSource: string
 * }}
 */
function loadGraph(dir) {
  const g = {
    ok: false, dir, index: null, atoms: [], slices: [],
    byName: new Map(), byFile: new Map(),
    warnings: [], fatal: [], shardHealth: new Map(),
    blindSpots: [], blindSpotSource: "（缺失）",
  };

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    g.fatal.push(`图谱目录不存在：${dir}`);
    return g;
  }
  const indexPath = join(dir, "INDEX.yaml");
  if (!existsSync(indexPath)) {
    g.fatal.push(`缺 INDEX.yaml：${indexPath}`);
    return g;
  }
  try {
    const r = parseYamlSubset(readFileSync(indexPath, "utf8"), "INDEX.yaml");
    g.index = r.value;
    g.warnings.push(...r.warnings);
    g.shardHealth.set("INDEX.yaml", r.warnings);
  } catch (e) {
    g.fatal.push(`INDEX.yaml 解析失败：${e.message}`);
    return g;
  }
  if (!g.index || typeof g.index !== "object") {
    g.fatal.push("INDEX.yaml 顶层不是映射");
    return g;
  }
  // ⚠ counts 段缺失是**结构性损坏**，不许静默当 0（这正是本工具的第 2 条金丝雀）
  if (!g.index.counts || typeof g.index.counts !== "object") {
    g.fatal.push("INDEX.yaml 缺 counts 段 —— 图谱结构性损坏，一切计数结论均不可信（⛔ 不许当 0）");
  }

  const readShards = (sub, into) => {
    const d = join(dir, sub);
    if (!existsSync(d)) { g.warnings.push(`缺 ${sub}/ 子目录`); return; }
    for (const f of readdirSync(d).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const label = `${sub}/${f}`;
      try {
        const r = parseYamlSubset(readFileSync(join(d, f), "utf8"), label);
        g.shardHealth.set(label, r.warnings);
        g.warnings.push(...r.warnings);
        const v = r.value;
        if (Array.isArray(v)) into.push(...v.map((x) => ({ ...x, __shard: label })));
        else if (v && typeof v === "object") into.push({ ...v, __shard: label });
        else g.warnings.push(`${label} 顶层既不是序列也不是映射，已跳过`);
      } catch (e) {
        g.shardHealth.set(label, [`解析失败：${e.message}`]);
        g.warnings.push(`${label} 解析失败：${e.message}`);
      }
    }
  };
  readShards("atoms", g.atoms);
  readShards("slices", g.slices);

  for (const a of g.atoms) {
    if (a?.name) {
      if (!g.byName.has(a.name)) g.byName.set(a.name, []);
      g.byName.get(a.name).push(a);
    }
    if (a?.file) {
      if (!g.byFile.has(a.file)) g.byFile.set(a.file, []);
      g.byFile.get(a.file).push(a);
    }
  }

  // ── 盲区清单 ────────────────────────────────────────────────────────────
  // 两种形态，**精度不同，必须在第四列区分开**：
  //   ① 结构化 `- { dims: [NOREF, COORD], text: "…" }` ⇒ 精确命中，可以断言「图谱自认盲区」
  //   ② 纯字符串 `- "…"` ⇒ 只能拿关键词去撞，**可能撞错**，只配说「疑似」
  // 实测踩过：把「引用图看不见 re-export 形式的调用」这条（说的是 NOREF 维度）
  // 用关键词 "re-export" 撞到了**空文件声明**头上 —— 一次教科书式的
  // 「我用『两段文字有共同的词』当作『它们说的是同一件事』的证据」。
  const takeList = (arr, source) => {
    for (const b of arr) {
      if (b && typeof b === "object") {
        const dims = (Array.isArray(b.dims) ? b.dims : []).map((d) => String(d).toUpperCase());
        g.blindSpots.push({ text: String(b.text ?? ""), dims, exact: dims.length > 0 });
      } else {
        g.blindSpots.push({ text: String(b), dims: [], exact: false });
      }
    }
    g.blindSpotSource = source;
  };
  if (Array.isArray(g.index.blindSpots) && g.index.blindSpots.length) {
    takeList(g.index.blindSpots, "INDEX.yaml blindSpots");
  } else {
    const readme = join(dir, "README.md");
    if (existsSync(readme)) {
      const md = readFileSync(readme, "utf8").split("\n");
      const picked = [];
      let on = false;
      for (const line of md) {
        if (/^#{1,6}\s/.test(line)) { on = /看不见|盲区|不度量|测不到/.test(line); continue; }
        if (on) {
          const m = line.match(/^\s*[-*]\s+(.*\S)/);
          if (m) picked.push(m[1].replace(/[`*]/g, "").trim());
        }
      }
      if (picked.length) takeList(picked, "README.md「看不见什么」段（散文·只能关键词撞）");
    }
  }

  g.ok = g.fatal.length === 0;
  return g;
}

// ══════════════════════════════════════════════════════════════════════════
// 2 · 词表：派单里的名词 → 图谱里的可计数维度
//    ⚠ 词表覆盖不到的名词**一律不硬猜**，进「已识别·无法对账」区。
//    「我没找到」和「它不存在」是两个不同的命题 —— 硬猜等于把前者写成后者。
// ══════════════════════════════════════════════════════════════════════════

const LEXICON = [
  { key: "求解器", nouns: ["求解器", "solver", "solvers", "求解器注册表"], tag: "solver", indexCount: null },
  { key: "规则", nouns: ["规则", "规则库", "业务规则", "约束规则", "rule", "rules"], tag: "rule", indexCount: null },
  { key: "求解器参数模式", nouns: ["参数模式", "args schema", "args-schema", "SOLVER_ARGS_SCHEMAS", "求解器参数"], tag: "solver-args", indexCount: null },
  { key: "切片", nouns: ["切片", "本体切片", "slice", "slices"], tag: "slice", indexCount: "slices" },
  { key: "原子", nouns: ["原子", "符号", "atom", "atoms"], tag: null, indexCount: "atoms" },
  { key: "边", nouns: ["边", "引用边", "edge", "edges"], tag: null, indexCount: "edges" },
  { key: "对象类型", nouns: ["对象类型", "objectType", "object type"], tag: "objectType", indexCount: null },
  { key: "事件", nouns: ["事件", "event", "events"], tag: "event", indexCount: null },
  { key: "门", nouns: ["门", "gate", "gates", "门禁"], tag: "gate", indexCount: null },
];

function lookupNoun(noun) {
  const n = noun.toLowerCase();
  for (const e of LEXICON) {
    for (const alias of e.nouns) if (alias.toLowerCase() === n) return e;
  }
  return null;
}

/** 词表里全部别名，按长度降序 —— 长别名优先匹配，避免「求解器参数」被「求解器」吃掉。 */
const ALL_NOUN_ALIASES = LEXICON.flatMap((e) => e.nouns).sort((a, b) => b.length - a.length);

// ══════════════════════════════════════════════════════════════════════════
// 3 · 从派单 markdown 抽取事实声明
// ══════════════════════════════════════════════════════════════════════════

const COUNT_UNITS = "个|条|项|处|道|张|种|类|款|只|份|套|个数";
const NEG_REF_PRED = [
  "零调用方", "无调用方", "没有调用方", "没调用方",
  "零消费方", "无消费方", "没有消费方", "没消费方",
  "零引用", "无引用", "没有引用", "无人调用", "没人调用", "没人用",
  "死代码", "没接线", "未接线", "没有接线", "是孤儿", "孤儿代码",
  "只有 test 引用", "只有测试引用", "只被测试引用",
];
const EMPTY_PRED = ["是空的", "空文件", "是空文件", "没有内容", "没内容", "是空壳", "只有壳", "是占位", "占位文件", "什么都没有", "是空表", "空的"];
const SHORT_PRED = ["一句话", "只有一句", "一两句", "一行", "只有一行", "很短", "简短", "两三个字", "一句"];

/**
 * 否定词守卫 —— 噪声直接来源，实测抓到过。
 * 「`lineGranularity` **不是**死代码」里的「死代码」如果被当成零调用方声明，
 * 工具就会对一句**正确的话**报不一致。判据：谓词前缀（剥掉 `*`/空白/引号后）
 * 若以否定词收尾，则这不是一条声明而是对它的否认，⛔ 不许入账。
 */
const NEGATORS = ["不是", "并非", "而非", "不算", "远非", "绝非", "称不上", "不属于", "没说", "不该说", "误以为", "曾以为", "别写成", "不能写成", "不再是"];
function negatedBefore(text, at) {
  const prefix = text.slice(Math.max(0, at - 18), at).replace(/[*`「」“”"'：:，,\s]/g, "");
  return NEGATORS.some((n) => prefix.endsWith(n));
}

/** 取 `at` 所在行的文本与行内偏移 —— 上下文窗口**一律不许跨行**。
 *  实测教训：±24 字的全局窗口会跨过空行把下一段的名词吸进来，
 *  于是「…1 处写），\n不是死代码。\n\n求解器的 description…」里的「1 处」被认成了「求解器 = 1」。
 *  形态照旧：**我用「字符距离近」当作「说的是同一件事」的证据，而前者并不度量后者。** */
function lineWindow(text, at) {
  const s = text.lastIndexOf("\n", at - 1) + 1;
  let e = text.indexOf("\n", at);
  if (e < 0) e = text.length;
  return { line: text.slice(s, e), off: at - s };
}

/** 屏蔽代码围栏与行内代码（保留原长度，坐标不漂）。 */
function maskCode(text) {
  const lines = text.split("\n");
  const out = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; out.push(" ".repeat(line.length)); continue; }
    if (fenced) { out.push(" ".repeat(line.length)); continue; }
    out.push(line.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length)));
  }
  return out.join("\n");
}

/** 行内代码 span 的原文（用来抓 `符号` / `文件.ts` / `file.ts:123`）。 */
function inlineCodeSpans(text) {
  const spans = [];
  const lines = text.split("\n");
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) {
      spans.push({ text: m[1].trim(), line: i + 1, col: m.index, raw: lines[i] });
    }
  }
  return spans;
}

function lineOf(text, idx) {
  return text.slice(0, idx).split("\n").length;
}
function lineText(text, ln) {
  return (text.split("\n")[ln - 1] ?? "").trim();
}

/**
 * 抽取五类声明。
 * @returns {{claims: any[], unresolved: any[]}}
 */
function extractClaims(md) {
  const claims = [];
  const unresolved = [];
  const masked = maskCode(md);
  const spans = inlineCodeSpans(md);
  const push = (c) => claims.push(c);

  // ── ① 计数声明：`<名词> … N <量词>` 或 `N <量词> <名词>` ──────────────────
  // 数字可被 **粗体** 包裹；名词必须在**同一行**的 ±24 字窗口内且**命中词表**，否则不硬猜。
  const perLineCounted = new Set();
  for (const m of masked.matchAll(new RegExp(String.raw`(\d[\d,]*)\s*\*{0,2}\s*(${COUNT_UNITS})`, "g"))) {
    const num = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    const at = m.index;
    const { line: lineStr, off } = lineWindow(masked, at);
    const before = lineStr.slice(Math.max(0, off - 24), off);
    const after = lineStr.slice(off + m[0].length, off + m[0].length + 24);
    const ln = lineOf(masked, at);
    let hitNoun = null, side = null;
    for (const alias of ALL_NOUN_ALIASES) {
      if (before.toLowerCase().includes(alias.toLowerCase())) { hitNoun = alias; side = "before"; break; }
    }
    if (!hitNoun) {
      for (const alias of ALL_NOUN_ALIASES) {
        if (after.toLowerCase().includes(alias.toLowerCase())) { hitNoun = alias; side = "after"; break; }
      }
    }
    // 「N 处调用方 / N 处 src 引用」= 引用计数声明，不是注册表计数
    const REF_AFTER = /^\s*(src\s*|源码\s*)?(调用方|调用点|引用方|引用点|引用|消费方|使用方|调用)/;
    const REF_BEFORE = /(调用方|引用方|引用|消费方|使用方)\s*$/;
    if (REF_AFTER.test(after) || REF_BEFORE.test(before)) {
      const sym = nearestSymbol(spans, ln);
      if (sym) {
        push({ kind: "REFCOUNT", line: ln, raw: lineText(md, ln), symbol: sym, expect: num, polarity: "positive" });
        perLineCounted.add(ln);
        continue;
      }
      unresolved.push({ line: ln, raw: lineText(md, ln), why: `「${num} 处引用/调用方」附近没有行内代码形式的符号名，无法定位对账对象` });
      continue;
    }
    if (!hitNoun) {
      // 同一行已经有过可核声明、且这个数字在括号里 ⇒ 多半是那条声明的**明细分解**，不是独立声明
      const inParen = /[（(][^）)]*$/.test(before);
      unresolved.push({
        line: ln, raw: lineText(md, ln),
        why: perLineCounted.has(ln) && inParen
          ? `数字「${m[0]}」在括号内、且本行已有可核声明 ⇒ 判为那条声明的明细分解，未单独对账`
          : `数字「${m[0]}」同行 ±24 字内没有词表覆盖的名词 ⇒ 不硬猜（词表：${LEXICON.map((e) => e.key).join(" / ")}）`,
      });
      continue;
    }
    push({ kind: "COUNT", line: ln, raw: lineText(md, ln), noun: hitNoun, entry: lookupNoun(hitNoun), expect: num, side });
    perLineCounted.add(ln);
  }

  // ── ② 零调用方声明 ──────────────────────────────────────────────────────
  for (const pred of NEG_REF_PRED) {
    let from = 0;
    for (;;) {
      const at = masked.indexOf(pred, from);
      if (at < 0) break;
      from = at + pred.length;
      if (negatedBefore(masked, at)) continue; // 「不是死代码」= 否认，不是声明
      const ln = lineOf(masked, at);
      const sym = nearestSymbol(spans, ln);
      if (!sym) {
        unresolved.push({ line: ln, raw: lineText(md, ln), why: `「${pred}」这句附近没有行内代码形式的符号名（请写成 \`someSymbol\`），无法定位对账对象` });
        continue;
      }
      if (claims.some((c) => c.kind === "NOREF" && c.line === ln && c.symbol === sym)) continue;
      push({ kind: "NOREF", line: ln, raw: lineText(md, ln), symbol: sym, pred });
    }
  }

  // ── ③ 空文件声明 ────────────────────────────────────────────────────────
  for (const pred of EMPTY_PRED) {
    let from = 0;
    for (;;) {
      const at = masked.indexOf(pred, from);
      if (at < 0) break;
      from = at + pred.length;
      if (negatedBefore(masked, at)) continue; // 「不是空的」= 否认
      const ln = lineOf(masked, at);
      const file = nearestFile(spans, ln);
      if (!file) {
        unresolved.push({ line: ln, raw: lineText(md, ln), why: `「${pred}」这句附近没有行内代码形式的文件路径，无法定位对账对象` });
        continue;
      }
      if (claims.some((c) => c.kind === "EMPTYFILE" && c.line === ln && c.file === file)) continue;
      push({ kind: "EMPTYFILE", line: ln, raw: lineText(md, ln), file, pred });
    }
  }

  // ── ④ file:line 坐标（只认行内代码里的，避免把散文里的比例 3:1 当坐标）─────
  for (const s of spans) {
    const m = s.text.match(/^([A-Za-z0-9_@./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|sql|json|yaml|yml)):(\d+)$/);
    if (!m) continue;
    push({ kind: "COORD", line: s.line, raw: lineText(md, s.line), file: m[1], at: Number(m[2]) });
  }

  // ── ⑤ 长度声明（逐行扫；**量化优先于定性**，同一行可有多个分位数）──────────
  const STAT_RE = /(p50|p90|p95|max|最长|中位)\s*[:：]?\s*(?:约|≈|~)?\s*\*{0,2}\s*(\d[\d,]*)\s*\*{0,2}\s*(字|字符|chars?)/gi;
  const mLines = masked.split("\n");
  const lengthLines = new Set();
  for (let i = 0; i < mLines.length; i++) {
    const lineStr = mLines[i];
    const stats = [...lineStr.matchAll(STAT_RE)];
    if (!stats.length) continue;
    const ln = i + 1;
    // 字段名：该行第一个 stat 之前最近的标识符；退化到该行行内代码里的标识符
    const head = lineStr.slice(0, stats[0].index);
    const fieldM = [...head.matchAll(/([A-Za-z_][A-Za-z0-9_.]{2,})/g)].pop();
    const field = fieldM ? fieldM[1] : nearestFieldName(spans, ln);
    if (!field) {
      unresolved.push({ line: ln, raw: lineText(md, ln), why: `本行有分位数长度（${stats.map((s) => s[1] + " " + s[2]).join("、")}）但没写清是哪个字段` });
      continue;
    }
    const scopeNoun = ALL_NOUN_ALIASES.find((a) => head.toLowerCase().includes(a.toLowerCase())) ?? null;
    for (const s of stats) {
      push({
        kind: "LENGTH", line: ln, raw: lineText(md, ln), field,
        stat: s[1].toLowerCase().replace("最长", "max").replace("中位", "p50"),
        expect: Number(s[2].replace(/,/g, "")),
        scopeNoun,
      });
    }
    lengthLines.add(ln);
  }
  // 定性长度：「description 是一句话 / 很短」
  for (const pred of SHORT_PRED) {
    let from = 0;
    for (;;) {
      const at = masked.indexOf(pred, from);
      if (at < 0) break;
      from = at + pred.length;
      if (negatedBefore(masked, at)) continue; // 「不是一句话」= 否认
      const ln = lineOf(masked, at);
      if (lengthLines.has(ln) || claims.some((c) => c.kind === "LENGTH" && c.line === ln)) continue;
      const { line: lineStr, off } = lineWindow(masked, at);
      const before = lineStr.slice(Math.max(0, off - 40), off);
      const fieldM = before.match(/([A-Za-z_][A-Za-z0-9_.]{2,})\s*(?:字段|的)?\s*(?:是|只是|就|仅)?\s*$/);
      const field = fieldM ? fieldM[1] : nearestFieldName(spans, ln);
      if (!field) {
        unresolved.push({ line: ln, raw: lineText(md, ln), why: `「${pred}」这句没找到它在说哪个字段（请写成 \`description\` 或 “description 是一句话”）` });
        continue;
      }
      const scopeNoun = ALL_NOUN_ALIASES.find((a) => before.toLowerCase().includes(a.toLowerCase())) ?? null;
      push({ kind: "LENGTH", line: ln, raw: lineText(md, ln), field, pred, scopeNoun });
      lengthLines.add(ln);
    }
  }

  claims.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return { claims, unresolved };
}

/** 同一行（或紧邻上一行）里最像「符号名」的行内代码。 */
function nearestSymbol(spans, ln) {
  const cand = spans
    .filter((s) => s.line === ln || s.line === ln - 1)
    .map((s) => s.text)
    .filter((t) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t) || /^[A-Z][A-Z0-9_]+$/.test(t));
  return cand[0] ?? null;
}
function nearestFile(spans, ln) {
  const cand = spans
    .filter((s) => s.line === ln || s.line === ln - 1)
    .map((s) => s.text)
    .filter((t) => /\.(ts|tsx|js|jsx|mjs|cjs|md|sql|json|ya?ml)$/.test(t));
  return cand[0] ?? null;
}
function nearestFieldName(spans, ln) {
  const cand = spans.filter((s) => s.line === ln).map((s) => s.text).filter((t) => /^[A-Za-z_][A-Za-z0-9_.]{2,}$/.test(t));
  return cand[0] ?? null;
}

// ══════════════════════════════════════════════════════════════════════════
// 4 · 第四列：图谱这一格可不可信
// ══════════════════════════════════════════════════════════════════════════

/** 维度 → 该维度金丝雀 probe 里应出现的关键词。 */
const CANARY_KEYWORDS = {
  COUNT: ["注册表", "registry", "计数", "count", "catalog"],
  REFCOUNT: ["入边", "inbound", "引用", "调用", "refgraph", "edge"],
  NOREF: ["入边", "inbound", "引用", "调用", "refgraph", "edge", "test-only"],
  EMPTYFILE: ["原子", "atom", "re-export", "reexport", "分片", "shard"],
  COORD: ["行号", "line", "坐标", "原子", "atom"],
  LENGTH: ["长度", "brief", "描述", "description", "字节", "字数"],
};

function canaryFor(graph, kind) {
  const list = Array.isArray(graph.index?.canary) ? graph.index.canary : [];
  if (!list.length) return { status: "none", note: "INDEX.yaml 无 canary 段 ⇒ 图谱没有自证过任何维度" };
  const kws = CANARY_KEYWORDS[kind] ?? [];
  const hit = list.find((c) => kws.some((k) => String(c?.probe ?? "").toLowerCase().includes(k.toLowerCase())));
  if (!hit) return { status: "none", note: `canary 段有 ${list.length} 条，但没有一条探针覆盖「${kind}」这一维度` };
  const expect = String(hit.expect ?? "");
  const actual = hit.actual;
  let consistent = true;
  let why = "";
  const mGt = expect.match(/^>\s*(-?\d+)$/);
  const mGe = expect.match(/^>=\s*(-?\d+)$/);
  const mEq = expect.match(/^=?\s*(-?\d+)$/);
  if (mGt) { consistent = Number(actual) > Number(mGt[1]); why = `expect ${expect} / actual ${actual}`; }
  else if (mGe) { consistent = Number(actual) >= Number(mGe[1]); why = `expect ${expect} / actual ${actual}`; }
  else if (mEq) { consistent = Number(actual) === Number(mEq[1]); why = `expect ${expect} / actual ${actual}`; }
  else why = `expect ${JSON.stringify(hit.expect)} / actual ${JSON.stringify(actual)}`;
  if (hit.ok === false) return { status: "fail", note: `金丝雀「${hit.probe}」自报未过（${why}）⇒ 该维度不可信`, probe: hit.probe };
  if (!consistent) {
    return { status: "contradict", note: `金丝雀「${hit.probe}」标了 ok 但 ${why} 自相矛盾 ⇒ 图谱在这一格骗人`, probe: hit.probe };
  }
  return { status: "pass", note: `金丝雀「${hit.probe}」${why} ✔`, probe: hit.probe };
}

/**
 * 合成第四列。
 * @param {object} graph
 * @param {string} kind      声明维度
 * @param {string[]} shards  承载本结论的分片（用来查解析告警）
 * @param {string[]} degrade 本工具自己的降级说明（如「用 brief 代答 description」）
 */
function trustCell(graph, kind, shards, degrade = []) {
  const parts = [];
  let level = "可信";

  const can = canaryFor(graph, kind);
  parts.push(can.note);
  if (can.status === "fail" || can.status === "contradict") level = "不可信";
  else if (can.status === "none") level = "存疑";

  const badShards = [];
  for (const s of shards) {
    const w = graph.shardHealth.get(s);
    if (w === undefined) badShards.push(`${s}（未载入）`);
    else if (w.length) badShards.push(`${s}：${w[0]}`);
  }
  if (badShards.length) {
    parts.push(`分片有告警 → ${badShards.join("；")}`);
    level = level === "不可信" ? "不可信" : "存疑";
  } else if (shards.length) {
    parts.push(`分片 ${shards.join(" / ")} 解析无告警`);
  }

  const exact = graph.blindSpots.filter((b) => b.exact && b.dims.includes(kind));
  const fuzzy = graph.blindSpots.filter((b) => !b.exact && blindHits(b.text, kind));
  if (exact.length) {
    parts.push(`⛔ 图谱自己的盲区清单**点名**了这一维度：「${exact[0].text}」`);
    level = "图谱自认盲区";
  } else if (fuzzy.length) {
    // ⚠ 散文盲区只能关键词撞，撞到不等于说的就是这件事 ⇒ 只降到「存疑」，不许升格成断言
    parts.push(`◑ 疑似落在盲区（散文条目关键词命中，**未必说的是同一件事**）：「${fuzzy[0].text}」`);
    level = level === "不可信" ? "不可信" : "存疑";
  } else if (!graph.blindSpots.length) {
    parts.push(`盲区清单缺失（${graph.blindSpotSource}）⇒ 无法排除「图谱压根没看这一维度」`);
    level = level === "可信" ? "存疑" : level;
  } else {
    parts.push(`盲区清单（${graph.blindSpotSource}，${graph.blindSpots.length} 条）未列此维度`);
  }

  if (degrade.length) {
    parts.push(...degrade.map((d) => `⚠ 本工具降级代答：${d}`));
    level = level === "可信" ? "存疑" : level;
  }

  return { level, note: parts };
}

function blindHits(blindText, kind) {
  const t = String(blindText).toLowerCase();
  const kws = {
    COUNT: ["注册表", "计数", "count"],
    REFCOUNT: ["引用", "调用", "入边", "inbound"],
    NOREF: ["引用", "调用", "入边", "inbound", "动态", "字符串键", "依赖注入"],
    EMPTYFILE: ["re-export", "reexport", "转出", "原子"],
    COORD: ["行号", "line", "坐标"],
    LENGTH: ["长度", "brief", "description", "描述"],
  }[kind] ?? [];
  return kws.some((k) => t.includes(k.toLowerCase()));
}

// ══════════════════════════════════════════════════════════════════════════
// 5 · 对账
// ══════════════════════════════════════════════════════════════════════════

function findRegistry(graph, entry) {
  const regs = Array.isArray(graph.index?.registries) ? graph.index.registries : [];
  for (const r of regs) {
    const names = [r?.name, ...(Array.isArray(r?.aliases) ? r.aliases : [])].filter(Boolean).map(String);
    if (names.some((n) => n === entry.key || entry.nouns.some((a) => a.toLowerCase() === n.toLowerCase()))) return r;
  }
  return null;
}

function atomsByTag(graph, tag) {
  if (!tag) return null;
  return graph.atoms.filter((a) => Array.isArray(a?.tags) && a.tags.map(String).includes(tag));
}

function inboundOf(atom) {
  const ib = atom?.inbound ?? {};
  const src = Array.isArray(ib.src) ? ib.src : [];
  const test = Array.isArray(ib.test) ? ib.test : [];
  return { src, test };
}
function fmtRefs(refs, n = 5) {
  const head = refs.slice(0, n).map((r) => `${r?.file ?? "?"}:${r?.line ?? "?"}`);
  return head.join(" · ") + (refs.length > n ? ` …(+${refs.length - n})` : "");
}

function reconcile(graph, claim) {
  const row = {
    kind: claim.kind, line: claim.line, raw: claim.raw,
    wrote: "", says: "", evidence: [], trust: null, verdict: "一致",
  };

  // ── ① 计数 ─────────────────────────────────────────────────────────────
  if (claim.kind === "COUNT") {
    const entry = claim.entry;
    row.wrote = `${entry.key} = ${claim.expect} ${claim.raw.includes("条") ? "条" : "个"}`;
    const reg = findRegistry(graph, entry);
    const tagged = atomsByTag(graph, entry.tag);
    const idxCount = entry.indexCount ? graph.index?.counts?.[entry.indexCount] : undefined;
    const degrade = [];
    let actual = null, src = "";

    if (reg && Number.isFinite(Number(reg.count))) {
      actual = Number(reg.count);
      src = `INDEX.yaml registries[${reg.name}] ← ${reg.source ?? "（未标来源）"}`;
      if (reg.breakdown) src += `\n= ${typeof reg.breakdown === "string" ? reg.breakdown : JSON.stringify(reg.breakdown)}`;
    } else if (Number.isFinite(Number(idxCount))) {
      actual = Number(idxCount);
      src = `INDEX.yaml counts.${entry.indexCount}`;
      degrade.push(`用 INDEX.counts.${entry.indexCount} 代答「${entry.key}」的注册表规模`);
    } else if (tagged && tagged.length) {
      actual = tagged.length;
      src = `图谱内 tag=${entry.tag} 的原子共 ${tagged.length} 条（分片 ${[...new Set(tagged.map((a) => a.__shard))].join(" / ")}）`;
      degrade.push(`图谱无 registries[${entry.key}] 声明，改用「同标签原子条数」代答 —— 分片不全时会偏小`);
    } else {
      row.says = "（图谱无对应注册表，也无同标签原子）";
      row.verdict = "无法对账";
      row.evidence.push(`词表认得「${entry.key}」，但图谱里既无 registries 条目也无 tag=${entry.tag ?? "-"} 的原子`);
      row.trust = trustCell(graph, "COUNT", ["INDEX.yaml"], ["图谱缺该维度 ⇒ 本行是『图谱抽漏了』，不是『你写错了』"]);
      return row;
    }

    // 交叉核对：注册表声明数 vs 图谱内同标签原子数。
    // **核不动也要说出来** —— 「没做交叉核对」和「交叉核对过了」是两个不同的证据强度。
    if (reg) {
      if (!entry.tag) row.evidence.push(`交叉核对：词表未给「${entry.key}」定义标签选择器 ⇒ 本行只有注册表声明这一个来源`);
      else if (!tagged || !tagged.length) row.evidence.push(`交叉核对：图谱里没有 tag=${entry.tag} 的原子 ⇒ **无法**与注册表声明互证，本行只有一个来源`);
      else if (Number(reg.count) !== tagged.length) {
        degrade.push(`注册表声明 ${reg.count}，而图谱内 tag=${entry.tag} 原子仅 ${tagged.length} 条 ⇒ 分片可能不全；本行取注册表声明，其可信度由金丝雀背书`);
      } else row.evidence.push(`交叉核对：图谱内 tag=${entry.tag} 原子 ${tagged.length} 条，与注册表声明一致 ✔`);
    }

    row.says = `${entry.key} = ${actual}`;
    row.evidence.push(src);
    row.verdict = actual === claim.expect ? "一致" : `不一致（你写的比真值${claim.expect > actual ? "多" : "少"} ${Math.abs(claim.expect - actual)}）`;
    row.trust = trustCell(graph, "COUNT", ["INDEX.yaml", ...new Set((tagged ?? []).map((a) => a.__shard))], degrade);
    return row;
  }

  // ── ② 零调用方 / 引用计数 ───────────────────────────────────────────────
  if (claim.kind === "NOREF" || claim.kind === "REFCOUNT") {
    const sym = claim.symbol;
    const atoms = graph.byName.get(sym) ?? [];
    row.wrote = claim.kind === "NOREF" ? `${sym} —— ${claim.pred}` : `${sym} 有 ${claim.expect} 处引用/调用方`;
    if (!atoms.length) {
      row.says = "（图谱里没有这个符号）";
      row.verdict = "无法对账";
      row.evidence.push(`byName 索引里无 \`${sym}\`；图谱共载入 ${graph.atoms.length} 个原子`);
      row.trust = trustCell(graph, claim.kind, ["INDEX.yaml"], [
        "符号缺席有两种可能：抽取器没覆盖该包 / 该符号确实不存在 —— 本工具分不开，**这一格算「图谱抽漏了」的嫌疑更大**",
      ]);
      return row;
    }
    // ⚠ 同名原子必须**合并计数**，不许「取第一个」。
    //   真仓里 `lineGranularity` 就同时是 portfolio.ts:55 的 TS 字段和 global-sim.ts:128 的
    //   zod 契约字段 —— 取第一个会得到「1 处」或「5 处」两个都不对的数，且取哪个取决于
    //   分片的载入顺序（字母序）。**让答案取决于文件名排序，就是又一次「拿 X 当 Y 的证据」。**
    const shards = [...new Set(atoms.map((x) => x.__shard))];
    const perAtom = atoms.map((a) => ({ a, ...inboundOf(a) }));
    const uniq = (refs) => [...new Map(refs.map((r) => [`${r?.file}:${r?.line}`, r])).values()];
    const src = uniq(perAtom.flatMap((x) => x.src));
    const test = uniq(perAtom.flatMap((x) => x.test));
    const states = [...new Set(atoms.map((a) => String(a.state ?? "?")))];

    row.says = `state=${states.join("/")} · src 入边 ${src.length} · test 入边 ${test.length}` +
      (atoms.length > 1 ? `（${atoms.length} 个同名原子合并去重后）` : "");
    for (const x of perAtom) {
      row.evidence.push(`原子 ${x.a.id ?? sym} @ ${x.a.file ?? "?"}:${x.a.line ?? "?"} · state=${x.a.state ?? "?"} · src ${x.src.length} / test ${x.test.length}`);
    }
    if (src.length) row.evidence.push(`src 调用方：${fmtRefs(src, 8)}`);
    if (test.length) row.evidence.push(`test 调用方：${fmtRefs(test, 8)}`);

    if (claim.kind === "NOREF") {
      const onlyTestClaim = /test|测试/.test(claim.pred);
      if (onlyTestClaim) {
        row.verdict = src.length === 0 ? "一致" : `不一致（除 test 外还有 ${src.length} 处 src 调用方）`;
      } else {
        row.verdict = src.length === 0 && test.length === 0
          ? "一致"
          : `不一致（图谱记到 ${src.length} 处 src + ${test.length} 处 test 入边）`;
      }
    } else if (src.length === claim.expect) {
      row.verdict = "一致";
    } else if (atoms.length > 1 && perAtom.some((x) => x.src.length === claim.expect)) {
      // 图谱把入边拆到了多个同名条目上 ⇒ 这是**图谱的歧义**，不是作者写错，不许报「不一致」
      const m = perAtom.find((x) => x.src.length === claim.expect);
      row.verdict = `歧义（你写的 ${claim.expect} 与 ${m.a.file}:${m.a.line} 这一个条目相符；图谱里同名原子共 ${atoms.length} 个、合并后 ${src.length} 处 —— 请在派单里写明是哪一个）`;
    } else {
      row.verdict = `不一致（图谱记到 ${src.length} 处 src 入边）`;
    }

    const degrade = [];
    if (atoms.length > 1) {
      degrade.push(`符号 \`${sym}\` 在图谱里有 ${atoms.length} 个同名原子（${atoms.map((x) => `${x.file}:${x.line}`).join(" / ")}）—— 本行取的是**合并去重后的并集**；若抽取器把同一个概念拆成了两条，这个并集偏大，若它漏了一条则偏小`);
    }
    degrade.push("引用图只看得见**静态可解析**的调用；re-export / 高阶函数 / 依赖注入 / 字符串键分发 / 事件订阅这五类它一条都看不见（CLAUDE.md 铁律 0.5 第 3 条）");
    row.trust = trustCell(graph, claim.kind, ["INDEX.yaml", ...shards], degrade);
    return row;
  }

  // ── ③ 空文件 ───────────────────────────────────────────────────────────
  if (claim.kind === "EMPTYFILE") {
    const want = claim.file;
    row.wrote = `${want} —— ${claim.pred}`;
    let key = graph.byFile.has(want) ? want : null;
    if (!key) {
      const tails = [...graph.byFile.keys()].filter((f) => f.endsWith("/" + want) || basename(f) === basename(want));
      if (tails.length === 1) key = tails[0];
      else if (tails.length > 1) {
        row.says = `（同名文件 ${tails.length} 个，无法确定你说的是哪个）`;
        row.verdict = "无法对账";
        row.evidence.push(tails.join(" / "));
        row.trust = trustCell(graph, "EMPTYFILE", ["INDEX.yaml"], ["派单里请写全仓库相对路径而不是裸文件名"]);
        return row;
      }
    }
    if (!key) {
      row.says = "（图谱里没有这个文件的原子）";
      row.verdict = "无法对账";
      row.evidence.push(`byFile 索引覆盖 ${graph.byFile.size} 个文件，其中不含 ${want}`);
      row.trust = trustCell(graph, "EMPTYFILE", ["INDEX.yaml"], [
        "文件缺席有两种可能：抽取器没覆盖该包 / 该文件真的没有任何导出符号 —— 本工具分不开",
      ]);
      return row;
    }
    const atoms = graph.byFile.get(key);
    const shards = [...new Set(atoms.map((x) => x.__shard))];
    const reexports = atoms.filter((a) => a.reexportOf);
    row.says = `${key} 有 ${atoms.length} 个原子${reexports.length ? `，其中 ${reexports.length} 个是 re-export` : ""}`;
    row.evidence.push(`原子：${atoms.slice(0, 8).map((a) => a.name).join(" · ")}${atoms.length > 8 ? ` …(+${atoms.length - 8})` : ""}`);
    for (const r of reexports.slice(0, 3)) row.evidence.push(`\`${r.name}\` 实为 re-export ← ${r.reexportOf}`);
    if (atoms.length === 0) row.verdict = "一致";
    else if (reexports.length === atoms.length) {
      row.verdict = `不一致（不是空的，是**薄 re-export**：${atoms.length} 个符号全部转出自 ${[...new Set(reexports.map((r) => String(r.reexportOf).split("#")[0]))].join(" / ")}）`;
    } else row.verdict = `不一致（有 ${atoms.length} 个原子）`;
    row.trust = trustCell(graph, "EMPTYFILE", ["INDEX.yaml", ...shards], []);
    return row;
  }

  // ── ④ file:line 坐标 ───────────────────────────────────────────────────
  if (claim.kind === "COORD") {
    const tol = CFG.lineTolerance;
    row.wrote = `${claim.file}:${claim.at}`;
    const keys = [...graph.byFile.keys()].filter((f) => f === claim.file || f.endsWith("/" + claim.file));
    // 坐标既可能指**声明**，也可能指**调用点** —— 两边都查
    const near = [];
    for (const k of keys) for (const a of graph.byFile.get(k)) {
      if (Number.isFinite(Number(a.line)) && Math.abs(Number(a.line) - claim.at) <= tol) near.push({ what: `声明 ${a.name}`, line: Number(a.line), atom: a });
    }
    for (const a of graph.atoms) {
      const { src, test } = inboundOf(a);
      for (const r of [...src, ...test]) {
        if (!r?.file) continue;
        if (!(r.file === claim.file || r.file.endsWith("/" + claim.file))) continue;
        if (Math.abs(Number(r.line) - claim.at) <= tol) near.push({ what: `对 \`${a.name}\` 的引用`, line: Number(r.line), atom: a });
      }
    }
    if (!keys.length && !near.length) {
      row.says = "（图谱不覆盖这个文件）";
      row.verdict = "无法对账";
      row.evidence.push(`byFile 索引里没有 ${claim.file}`);
      row.trust = trustCell(graph, "COORD", ["INDEX.yaml"], ["文件不在图谱覆盖面内 ⇒ 这一格是『图谱抽漏了』"]);
      return row;
    }
    near.sort((a, b) => Math.abs(a.line - claim.at) - Math.abs(b.line - claim.at));
    if (!near.length) {
      const lines = keys.flatMap((k) => graph.byFile.get(k).map((a) => Number(a.line))).filter(Number.isFinite).sort((a, b) => a - b);
      row.says = `${claim.file} ±${tol} 行内没有任何原子或引用`;
      row.verdict = `存疑（坐标可能已漂；该文件图谱记到的行号：${lines.slice(0, 10).join(", ")}${lines.length > 10 ? " …" : ""}）`;
      row.evidence.push(`容差 ±${tol} 行（见 docs/ontology-graph/PREMISE-CHECK.md「为什么是 ±12」）`);
    } else {
      const best = near[0];
      const delta = best.line - claim.at;
      row.says = `${best.what} @ ${claim.file}:${best.line}`;
      row.verdict = delta === 0 ? "一致" : `一致（偏 ${delta > 0 ? "+" : ""}${delta} 行，在 ±${tol} 容差内）`;
      row.evidence.push(`±${tol} 行内共 ${near.length} 个落点：${near.slice(0, 3).map((n) => `${n.line}(${n.what})`).join(" · ")}`);
    }
    const shards = [...new Set(keys.flatMap((k) => graph.byFile.get(k).map((a) => a.__shard)))];
    row.trust = trustCell(graph, "COORD", ["INDEX.yaml", ...shards], [
      `行号会漂。图谱的 generatedFrom = ${graph.index?.generatedFrom ?? "（未标）"}；派单若基于更新的树，本行「对上了」只说明 ±${tol} 行内有东西，不证明是同一处`,
    ]);
    return row;
  }

  // ── ⑤ 长度 ─────────────────────────────────────────────────────────────
  if (claim.kind === "LENGTH") {
    const stat = claim.stat ?? null;
    row.wrote = stat ? `${claim.field} ${stat} = ${claim.expect} 字` : `${claim.field} —— ${claim.pred}`;
    const fs = Array.isArray(graph.index?.fieldStats) ? graph.index.fieldStats : [];
    const hit = fs.find((f) => {
      const n = String(f?.field ?? "");
      return n === claim.field || n.endsWith("." + claim.field) || n.toLowerCase() === claim.field.toLowerCase();
    });
    const degrade = [];
    let dist = null, src = "";

    if (hit) {
      dist = { n: hit.n, min: hit.minChars, p50: hit.p50, p90: hit.p90, max: hit.maxChars, bytes: hit.totalBytes };
      src = `INDEX.yaml fieldStats[${hit.field}] ← ${hit.source ?? "（未标来源）"}`;
    } else {
      const entry = claim.scopeNoun ? lookupNoun(claim.scopeNoun) : null;
      const pool = entry ? (atomsByTag(graph, entry.tag) ?? []) : graph.atoms;
      const lens = pool.map((a) => [...String(a?.brief ?? "")].length).filter((x) => x > 0).sort((a, b) => a - b);
      if (!lens.length) {
        row.says = "（图谱既无 fieldStats，也没有可度量的 brief）";
        row.verdict = "无法对账";
        row.evidence.push(`fieldStats 段 ${fs.length} 条，均不覆盖 \`${claim.field}\``);
        row.trust = trustCell(graph, "LENGTH", ["INDEX.yaml"], ["图谱没度量任何字段长度 ⇒ 这一格是『图谱抽漏了』"]);
        return row;
      }
      const q = (p) => lens[Math.min(lens.length - 1, Math.floor(p * (lens.length - 1)))];
      dist = { n: lens.length, min: lens[0], p50: q(0.5), p90: q(0.9), max: lens[lens.length - 1], bytes: null };
      src = `图谱 brief 长度分布${entry ? `（限 tag=${entry.tag}）` : "（全量原子）"}`;
      degrade.push(`图谱无 fieldStats[\`${claim.field}\`]，改用**图谱侧 \`brief\` 的长度**代答 —— \`brief\` 是抽取器写的摘要，**不等于产品字段 \`${claim.field}\` 的真实长度**。这一格只能当量级参考，不能当证据。`);
    }

    row.says = `n=${dist.n} · min ${dist.min} 字 · p50 ${dist.p50} 字 · p90 ${dist.p90} 字 · max ${dist.max} 字${dist.bytes ? ` · 全量 ${dist.bytes} 字节` : ""}`;
    row.evidence.push(src);
    if (stat) {
      const got = dist[stat] ?? null;
      row.verdict = got === null ? `无法对账（图谱没给 ${stat}）`
        : got === claim.expect ? "一致"
          : `不一致（图谱 ${stat} = ${got}）`;
    } else {
      // 定性声明「一句话/很短」：判据取 p90。中文一句话 ≈ ≤40 字，取 40 为界并写进 README。
      const ONE_SENTENCE_CHARS = 40;
      row.verdict = dist.p90 <= ONE_SENTENCE_CHARS
        ? `一致（p90 ${dist.p90} 字 ≤ 一句话阈值 ${ONE_SENTENCE_CHARS}）`
        : `不一致（p90 ${dist.p90} 字 / max ${dist.max} 字，远超一句话阈值 ${ONE_SENTENCE_CHARS}）`;
      row.evidence.push(`「一句话」的量化界 = 40 字（中文单句常见上界，理由见 docs/ontology-graph/PREMISE-CHECK.md）`);
    }
    row.trust = trustCell(graph, "LENGTH", ["INDEX.yaml"], degrade);
    return row;
  }

  row.says = "（未实现的声明类型）";
  row.verdict = "无法对账";
  row.trust = trustCell(graph, claim.kind, ["INDEX.yaml"], []);
  return row;
}

// ══════════════════════════════════════════════════════════════════════════
// 6 · 金丝雀：先自证抽取器是好的（铁律 0.6）
// ══════════════════════════════════════════════════════════════════════════

const CANARY_DOC = `# 金丝雀派单（本工具内置，不是真单）

今天求解器一共 **60** 个，注册表散在两处。
\`args-schemas.ts\` 是空的，只留了个壳。
规则库里规则 **39** 条。
\`lineGranularity\` 零调用方，属于死代码。
求解器的 description 是一句话，全量喂给 LLM 没有压力。
坐标：\`apps/datacore/src/solvers/service.ts:3512\`
`;

/** 内置金丝雀必须命中的五个维度。抽不到 ⇒ 抽取器坏了，⛔ 不许报「无可核声明」。 */
const CANARY_EXPECT = ["COUNT", "EMPTYFILE", "NOREF", "LENGTH", "COORD"];

function runExtractorCanary() {
  const { claims } = extractClaims(CANARY_DOC);
  const got = new Set(claims.map((c) => c.kind));
  const missing = CANARY_EXPECT.filter((k) => !got.has(k));
  return {
    ok: missing.length === 0,
    got: [...got].sort(),
    missing,
    detail: claims.map((c) => `${c.kind}@L${c.line}`).join(" "),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 7 · 渲染
// ══════════════════════════════════════════════════════════════════════════

const KIND_LABEL = {
  COUNT: "① 计数声明", REFCOUNT: "② 引用计数声明", NOREF: "② 零调用方声明",
  EMPTYFILE: "③ 空文件声明", COORD: "④ file:line 坐标", LENGTH: "⑤ 长度声明",
};
const TRUST_MARK = { 可信: "✔ 可信", 存疑: "◑ 存疑", 不可信: "✗ 不可信", 图谱自认盲区: "⛔ 图谱自认盲区" };

function renderText(res) {
  const L = [];
  const W = 76;
  L.push("═".repeat(W));
  L.push(`派单前提自检 · ${res.woPath}`);
  L.push(`图谱 ${res.graphDir}` + (res.graph.index?.generatedFrom ? ` · generatedFrom ${res.graph.index.generatedFrom}` : ""));
  L.push(`⛔ 本工具不是门：以下是**对账表**不是红绿判定。rc 恒 0；rc≠0 只表示工具自己没跑起来。`);
  L.push("═".repeat(W));

  L.push(`金丝雀 · 抽取器  ${res.canary.ok ? "✔ 命中" : "✗ 未命中"}  维度 ${res.canary.got.join("/") || "（空）"}${res.canary.missing.length ? ` · 缺 ${res.canary.missing.join("/")}` : ""}`);
  L.push(`金丝雀 · 图谱    ${res.graph.ok ? "✔ INDEX.yaml 结构完整" : "✗ " + res.graph.fatal.join("；")}`);
  L.push(`覆盖面          原子 ${res.graph.atoms.length} · 切片 ${res.graph.slices.length} · 文件 ${res.graph.byFile.size} · 盲区清单 ${res.graph.blindSpots.length} 条（${res.graph.blindSpotSource}）`);
  if (res.graph.warnings.length) {
    L.push(`解析告警 ${res.graph.warnings.length} 条：`);
    for (const w of res.graph.warnings.slice(0, 6)) L.push(`  · ${w}`);
  }
  L.push("");

  if (!res.graph.ok) {
    L.push("⛔ 图谱不可信 —— 结构性损坏，拒绝据此对账：");
    for (const f of res.graph.fatal) L.push(`   · ${f}`);
    L.push("   ⚠ ⛔ 不许把缺失的 counts 当成 0。「我没读到」和「它是 0」是两个不同的命题。");
    L.push("   处置：先修图谱（重跑抽取器），再回来对账。");
    L.push("");
    return L.join("\n");
  }

  if (!res.rows.length && !res.unresolved.length) {
    L.push(res.canary.ok
      ? "本文件无可核声明 —— 全文没有计数 / 零调用方 / 空文件 / 坐标 / 长度这五类事实声明。"
      : "⛔ 抽取器坏了（金丝雀未命中），拒绝报「无可核声明」。");
    L.push(`（金丝雀证据：内置样例抽到 ${res.canary.detail || "（空）"}）`);
    L.push("");
    return L.join("\n");
  }

  for (const r of res.rows) {
    L.push("─".repeat(W));
    L.push(`${KIND_LABEL[r.kind] ?? r.kind}   ${res.woName}:${r.line}`);
    L.push(`  原文      「${r.raw}」`);
    L.push(`  你写的是  ${r.wrote}`);
    L.push(`  图谱说是  ${r.says}`);
    L.push(`  证据      ${r.evidence.join("\n            ")}`);
    L.push(`  图谱可信  ${TRUST_MARK[r.trust.level] ?? r.trust.level}`);
    for (const n of r.trust.note) L.push(`            · ${n}`);
    L.push(`  结论      ${r.verdict.startsWith("一致") ? "✔ " : r.verdict.startsWith("无法对账") ? "— " : "⚠ "}${r.verdict}`);
  }
  L.push("─".repeat(W));

  if (res.unresolved.length) {
    L.push("");
    L.push(`已识别但无法对账 · ${res.unresolved.length} 条（⛔ 不当成「没有声明」）`);
    for (const u of res.unresolved) L.push(`  ${res.woName}:${u.line}  ${u.why}\n      「${u.raw}」`);
  }

  const diff = res.rows.filter((r) => r.verdict.startsWith("不一致"));
  const uncheck = res.rows.filter((r) => r.verdict.startsWith("无法对账"));
  const susp = res.rows.filter((r) => r.verdict.startsWith("存疑"));
  L.push("");
  L.push(`小结  可核声明 ${res.rows.length} 条 → 相符 ${res.rows.length - diff.length - uncheck.length - susp.length} · 不一致 ${diff.length} · 存疑 ${susp.length} · 无法对账 ${uncheck.length} · 未识别 ${res.unresolved.length}`);
  const lowTrust = res.rows.filter((r) => r.trust.level !== "可信").length;
  L.push(`      其中 ${lowTrust} 条的**图谱侧**本身就不完全可信 —— 那些行的「不一致」可能是图谱抽漏，不是你写错。`);
  L.push("");
  return L.join("\n");
}

function renderMd(res) {
  const L = [];
  L.push(`### 派单前提自检 · \`${res.woPath}\``);
  L.push("");
  L.push(`> 图谱 \`${res.graphDir}\`${res.graph.index?.generatedFrom ? ` · generatedFrom \`${res.graph.index.generatedFrom}\`` : ""} · 原子 ${res.graph.atoms.length} · 盲区清单 ${res.graph.blindSpots.length} 条`);
  L.push("> ⛔ 这是对账表，不是红绿判定。");
  L.push("");
  if (!res.graph.ok) {
    L.push("**⛔ 图谱不可信** —— " + res.graph.fatal.join("；") + "。⛔ 不许把缺失的 counts 当 0。");
    return L.join("\n");
  }
  if (!res.rows.length) {
    L.push(res.canary.ok ? "**本文件无可核声明。**" : "**⛔ 抽取器坏了（金丝雀未命中），拒绝报「无可核声明」。**");
    return L.join("\n");
  }
  L.push("| 声明 | 你写的是 | 图谱说是 | 证据 | 图谱这一格可不可信 |");
  L.push("|---|---|---|---|---|");
  for (const r of res.rows) {
    const cell = (s) => String(s).replace(/\n/g, "<br>").replace(/\|/g, "\\|");
    L.push(`| ${KIND_LABEL[r.kind]}<br>L${r.line} | ${cell(r.wrote)} | ${cell(r.says)} | ${cell(r.evidence.join("\n"))} | **${TRUST_MARK[r.trust.level]}**<br>${cell(r.trust.note.join("\n"))} |`);
  }
  return L.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════
// 8 · 自测（回归用例 + 两条金丝雀）—— `--selftest`
//    ⚠ 每条用例**两个方向都验**：写错的抓到没 · 写对的误报没。
//    本仓实测过一个探针「空闲时报 0 正确、忙时把 worker 数成 2」——
//    「错的时候能抓」不度量「对的时候不吵」。
// ══════════════════════════════════════════════════════════════════════════

const FIX = join(HERE, "fixtures");

function analyze(woPath, graphDir) {
  const md = readFileSync(woPath, "utf8");
  const graph = loadGraph(graphDir);
  const canary = runExtractorCanary();
  const { claims, unresolved } = extractClaims(md);
  const rows = graph.ok ? claims.map((c) => reconcile(graph, c)) : [];
  return { woPath, woName: basename(woPath), graphDir, graph, canary, claims, rows, unresolved };
}

/**
 * 五条回归用例 = 本会话被 dev 实测推翻的**真实**五条派单前提（⛔ 一条都没自己编）。
 * 每条两个方向：
 *   A 写错的派单 → 必须点出来（`wrongKind` 那类声明必须出现且判「不一致」）
 *   B 写对的派单 → **必须不误报**（`rightKind` 那类声明要么不出现 —— 因为作者压根没作这个
 *     声明 —— 要么判「一致」。⛔ 但绝不许出现「不一致」。）
 * ⚠ B 方向不许要求「必须出现某条声明」：订正版把「是空的」改写成了「是薄 re-export」，
 *   那本来就**不是一条空文件声明**，抽不到它才是对的。硬要求它出现会逼工具去过度抽取，
 *   而过度抽取正是噪声的来源。
 */
const CASES = [
  { id: "① 计数声明 · 求解器", wrongKind: "COUNT", rightKind: "COUNT", needle: "求解器" },
  { id: "③ 空文件声明 · args-schemas.ts", wrongKind: "EMPTYFILE", rightKind: "EMPTYFILE", needle: "args-schemas", wrongExtra: /re-export/ },
  { id: "① 计数声明 · 规则", wrongKind: "COUNT", rightKind: "COUNT", needle: "规则" },
  { id: "⑤ 长度声明 · description", wrongKind: "LENGTH", rightKind: "LENGTH", needle: "description" },
  { id: "② 零调用方 · lineGranularity", wrongKind: "NOREF", rightKind: "REFCOUNT", needle: "lineGranularity" },
];

function selftest() {
  const out = [];
  let fail = 0;
  const P = (s) => out.push(s);
  P("═".repeat(76));
  P("premise-check.mjs · 自测（回归用例 ×5 双向 + 金丝雀 ×2）");
  P("═".repeat(76));

  const graphDir = join(FIX, "graph");
  const wrong = analyze(join(FIX, "wo-wrong.md"), graphDir);
  const right = analyze(join(FIX, "wo-right.md"), graphDir);

  const pickAll = (res, kind, needle) =>
    res.rows.filter((r) => r.kind === kind && (r.wrote + r.raw).toLowerCase().includes(needle.toLowerCase()));

  P("");
  P("── 方向 A：写错的派单，必须点出来 ──────────────────────────────────────");
  for (const c of CASES) {
    const rs = pickAll(wrong, c.wrongKind, c.needle);
    const hit = rs.find((r) => r.verdict.startsWith("不一致") && (!c.wrongExtra || c.wrongExtra.test(r.verdict)));
    const ok = Boolean(hit);
    if (!ok) fail++;
    P(`  ${ok ? "✔" : "✗"} ${c.id}`);
    P(`      ${hit ? `你写的是 ${hit.wrote} → 图谱说是 ${hit.says}` : rs.length ? `抽到 ${rs.length} 条但无一判不一致` : "未抽到该声明"}`);
    P(`      结论：${hit ? hit.verdict : rs.map((r) => r.verdict).join(" / ") || "（无）"}`);
    if (ok) P(`      图谱可信：${TRUST_MARK[hit.trust.level]}`);
  }

  P("");
  P("── 方向 B：写对的派单，必须不误报 ──────────────────────────────────────");
  P("   判据：该类声明要么不出现（作者本来就没作这个声明），要么判「一致」；⛔ 绝不许「不一致」。");
  for (const c of CASES) {
    const rs = pickAll(right, c.rightKind, c.needle);
    const bad = rs.filter((r) => r.verdict.startsWith("不一致"));
    const ok = bad.length === 0;
    if (!ok) fail++;
    P(`  ${ok ? "✔" : "✗"} ${c.id}  —— 抽到 ${rs.length} 条 · 误报 ${bad.length} 条`);
    for (const r of rs) P(`      ${r.verdict.startsWith("一致") ? "·" : "✗"} 你写的是 ${r.wrote} → 图谱说是 ${r.says} → ${r.verdict}`);
    if (!rs.length) P(`      · 未抽到（订正版把这句改写成了不构成该类声明的说法，抽不到即正确）`);
  }
  {
    // 全局零误报总判据：写对的那份里**一条差异都不许有**
    // 「错的时候能抓」不度量「对的时候不吵」—— 本仓实测过一个探针空闲报 0 正确、忙时把 worker 数成 2。
    const noise = right.rows.filter((x) => x.verdict.startsWith("不一致"));
    const ok = noise.length === 0;
    if (!ok) fail++;
    P(`  ${ok ? "✔" : "✗"} 【零噪声总判据】写对的派单共 ${right.rows.length} 条可核声明，产出 ${noise.length} 条「不一致」（必须 0）`);
    for (const n of noise) P(`        ✗ 误报：L${n.line} ${n.wrote} → ${n.verdict}`);
  }

  P("");
  P("── 金丝雀 1：纯散文、零事实声明 ⇒ 必须报「本文件无可核声明」，不许报「全部通过」──");
  {
    const prose = analyze(join(FIX, "wo-prose.md"), graphDir);
    const txt = renderText(prose);
    const ok = prose.rows.length === 0 && prose.canary.ok && txt.includes("本文件无可核声明") && !/全部通过|全绿|PASS/.test(txt);
    if (!ok) fail++;
    P(`  ${ok ? "✔" : "✗"} 可核声明 ${prose.rows.length} 条 · 未识别 ${prose.unresolved.length} 条 · 抽取器金丝雀 ${prose.canary.ok ? "命中" : "未命中"}`);
    P(`      输出关键行：${txt.split("\n").find((l) => l.includes("本文件无可核声明")) ?? "（未找到）"}`);
    P(`      金丝雀证据：内置样例抽到 ${prose.canary.detail}`);
  }

  P("");
  P("── 金丝雀 2：故意损坏的 INDEX.yaml（counts 段删掉）⇒ 必须报「图谱不可信」，不许静默当 0 ──");
  {
    const broken = analyze(join(FIX, "wo-wrong.md"), join(FIX, "graph-broken"));
    const txt = renderText(broken);
    const ok = !broken.graph.ok && txt.includes("图谱不可信") && broken.rows.length === 0 && /不许把缺失的 counts 当成 0/.test(txt);
    if (!ok) fail++;
    P(`  ${ok ? "✔" : "✗"} graph.ok=${broken.graph.ok} · 对账行 ${broken.rows.length} 条（必须 0，⛔ 不许拿 0 去和 60 比）`);
    P(`      fatal：${broken.graph.fatal.join("；")}`);
  }

  P("");
  P("── 金丝雀 3（工具自证）：抽取器内置样例 ──────────────────────────────────");
  {
    const c = runExtractorCanary();
    if (!c.ok) fail++;
    P(`  ${c.ok ? "✔" : "✗"} 命中维度 ${c.got.join("/")}${c.missing.length ? ` · 缺 ${c.missing.join("/")}` : ""}`);
    P(`      明细：${c.detail}`);
  }

  P("");
  P("═".repeat(76));
  P(fail === 0 ? `自测全部通过（${CASES.length} 条 × 双向 + 3 条金丝雀）` : `⛔ 自测失败 ${fail} 项`);
  P("═".repeat(76));
  console.log(out.join("\n"));
  return fail === 0 ? 0 : 4;
}

// ══════════════════════════════════════════════════════════════════════════
// 9 · CLI
// ══════════════════════════════════════════════════════════════════════════

const CFG = { lineTolerance: DEFAULT_LINE_TOLERANCE };

function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`用法：
  node scripts/ontology-graph/premise-check.mjs <派单.md> [--graph <目录>] [--md] [--line-tolerance N]
  node scripts/ontology-graph/premise-check.mjs --selftest

  --graph           图谱目录（默认 docs/ontology-graph）
  --md              以 markdown 表格输出（贴进报告用）
  --line-tolerance  file:line 坐标容差，默认 ${DEFAULT_LINE_TOLERANCE} 行
  --selftest        跑回归用例与金丝雀（不需要真图谱）

⛔ 这不是门：对账结论一律 rc=0。rc=3 用法错 / 读不到文件；rc=4 工具自证失败。`);
    return 0;
  }
  if (args.includes("--selftest")) return selftest();

  let graphDir = DEFAULT_GRAPH;
  let md = false;
  let wo = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--graph") { graphDir = resolve(process.cwd(), args[++i] ?? ""); continue; }
    if (a === "--md") { md = true; continue; }
    if (a === "--line-tolerance") { CFG.lineTolerance = Number(args[++i]); continue; }
    if (a.startsWith("--")) { console.error(`未知参数 ${a}`); return 3; }
    wo = resolve(process.cwd(), a);
  }
  if (!wo) { console.error("缺少派单 markdown 路径。--help 看用法。"); return 3; }
  if (!existsSync(wo)) { console.error(`读不到派单文件：${wo}`); return 3; }

  // 铁律 0.6：扫描类结论之前先自证工具
  const canary = runExtractorCanary();
  if (!canary.ok) {
    console.error("⛔ 抽取器坏了 —— 内置金丝雀样例抽不到 " + canary.missing.join("/") + " 维度。");
    console.error("   ⛔ 拒绝输出任何「无可核声明 / 没有问题」这类否定结论。「我没找到」≠「它不存在」。");
    console.error("   明细：" + canary.detail);
    return 4;
  }

  const res = analyze(wo, graphDir);
  res.woPath = relative(ROOT, wo) || wo;
  console.log(md ? renderMd(res) : renderText(res));
  return 0;
}

process.exit(main(process.argv));
