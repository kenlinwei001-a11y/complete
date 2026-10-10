#!/usr/bin/env node
/**
 * ontology-index.mjs —— docs/SYSTEM-ONTOLOGY.md 的**可重新生成索引**（目录树 + 关系图 + 取原文口子）
 *
 * ⛔ 这是索引，不是转写。
 *   只抽「结构与指针」：节点 id/path · 标题**原文逐字截取** · 状态标记 · 锚点（原文怎么写就怎么存）· 行区间。
 *   ⛔ 不摘要、不改写、不翻译散文 —— 散文里嵌着「为什么」「哪天被推翻过」「病因订正」，
 *   摘要会把它们弄没，而且没人复核得了一份 29 万 token 的转写。
 *   ⇒ 语义的唯一真相源永远是 docs/SYSTEM-ONTOLOGY.md，本索引只是它的目录与地图。
 *
 * 用法
 *   node scripts/ontology-index.mjs                       生成 docs/system-ontology-index.yaml
 *   node scripts/ontology-index.mjs --check               重新生成并比对，不一致 exit 1 并点名「哪个节点·哪个字段」
 *   node scripts/ontology-index.mjs --ls   "8"            列出直接子节点（path · status · 行数 · title）
 *   node scripts/ontology-index.mjs --path "8/G-1"        打印该节点行区间的**原文**（--own 只打自有行）
 *   node scripts/ontology-index.mjs --grep "传导"          在 title/id 上搜，只回 path，不回正文
 *   node scripts/ontology-index.mjs --hops "2/Connection" --depth 2 [--undirected] [--include-derived]
 *   node scripts/ontology-index.mjs --why  "2/A" "2/B"    最短路径，每跳回 source_line
 *
 *   典型用法 = --grep/--ls 定位 → --path 只读那几十行。
 *   （今天这文件约 29 万 token，读不动；于是所有人只能 grep 碎片，而 grep 碎片在本仓已经错过很多次。）
 *
 * ⛔ 本脚本**不是门**：不许接进 scripts/gate.sh 或 package.json 的 gates（仓主 2026-08-20 冻结新增门）。它是工具。
 *
 * ── 确定性（R6）──────────────────────────────────────────────────────────
 *   无 Date.now / 无随机 / 无目录遍历顺序依赖；输出仅由源文件字节决定。连跑两次逐字节相同。
 *
 * ── 🐤 金丝雀（铁律 0.6：扫描类结论一律先自证工具）──────────────────────
 *   全部金丝雀**跑的就是主逻辑本身**（对 build() 的结果做断言），⛔ 不许各抄一份正则 ——
 *   抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。
 *   任一不成立 ⇒ 打印「量法坏了」并 exit 1，**不输出 YAML**。
 *
 * ── ⛔ 行分区硬判据 ──────────────────────────────────────────────────────
 *   每一行原文**恰好**属于一个节点的自有区间（own_lines）：无重叠、无空隙、总数匹配。
 *   不成立就 exit 1 并打印缺口/重叠区间，不出 YAML。
 *   理由：有行不属于任何节点，「按路径读原文」就会**静默漏掉**那一段，而漏了在屏上看不出来。
 *
 * ── ⛔ 两类边必须分开，查询默认只走 stated ────────────────────────────────
 *   stated       = 原文**明确陈述**的关系，每条必带 source_line + evidence（缺一个不收）。
 *   shared_anchor= **我们推断的**（两节点引用同一处 file:line），默认不参与多跳，要 --include-derived。
 *   ⛔ 绝不因为「这两节讲的事像是相关」就连边。没有原文句子 = 没有边。
 *   宁可稀疏而真，不要稠密而编。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC_REL = "docs/SYSTEM-ONTOLOGY.md";
const OUT_REL = "docs/system-ontology-index.yaml";
const SRC = path.join(ROOT, SRC_REL);
const OUT = path.join(ROOT, OUT_REL);

const HEADER_LINE =
  "# 本文件由 scripts/ontology-index.mjs 生成，⛔ 不要手改；改本体请改 docs/SYSTEM-ONTOLOGY.md 后重新生成。";

const TITLE_CP = 160; // 命名节点标题逐字截取码点数
const NOTE_CP = 60; // _note/_code/_thead 这类无名节点
const EVIDENCE_CP = 120;
const MAX_ANCHORS = 10;
const MAX_ID_CP = 24;

/* ═══════════════════════ 纯函数小工具 ═══════════════════════ */

/** 按**码点**截取，绝不劈开代理对（🔴/◑ 这类字符会被劈坏）。 */
function cut(s, n) {
  const cps = Array.from(s);
  return { text: cps.slice(0, n).join(""), truncated: cps.length > n };
}
function cutText(s, n) {
  return cut(s, n).text;
}

/** 去 markdown 装饰，**只为生成 id / 解析名字**用；title 一律保留原文。 */
function strip(s) {
  return s
    .replace(/~~/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

const FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|sql|json|ya?ml|sh|html|css|toml)\b/;

/** 代码锚点 = 反引号里像文件路径的片段，**原文逐字保留**（含 `:行号` 与 ` (符号)` 后缀）。 */
function anchorsFrom(text) {
  const seen = new Set();
  const out = [];
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    if (!FILE_RE.test(raw) || raw.length > 120) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= MAX_ANCHORS) break;
  }
  return out;
}

/**
 * 状态标记的**全集**。
 *
 * ⚠ 派单里写的是「🔴/◑/✅ 或无标记」三个 —— 实测本体**在用 5 个**：
 *   ✅ 352 · ◑ 129 · 🔴 12 · 🟡 8 · 🟢 6（§8 整节字符计数）。
 *   只认三个的那一版，把 8 条 🟡 / 🟢 的条目报成了「无标记」——
 *   即**把「我的词表里没有」说成了「原文没标」**。故按实测扩到 5 个，⛔ 不去凑派单里的那三个。
 *   下面的迁移正则由本数组**现算**，不另抄一份字符类（抄了就会漏掉后加的标记）。
 */
const STATUS_MARKS = ["🔴", "🟡", "🟢", "◑", "✅"];
const STATUS_CLASS = `[${STATUS_MARKS.join("")}]`;
const STATUS_TRANSITION_RE = new RegExp(`^\\s*(${STATUS_CLASS})\\s*→\\s*(${STATUS_CLASS})`, "u");

function marksIn(text) {
  const out = [];
  for (const ch of Array.from(text)) if (STATUS_MARKS.includes(ch)) out.push(ch);
  return out;
}

/** 首个 **粗体**；退而取 *斜体*；再退取整行开头。 */
function leadName(line) {
  const b = line.match(/\*\*([^*]+)\*\*/);
  if (b) return b[1].trim();
  const i = line.match(/\*([^*]+)\*/);
  if (i) return i[1].trim();
  return strip(line.replace(/^[\s>-]+/, ""));
}

/** 路径段必须短、稳定、不含 `/`。优先取编号类 token（G-xxx / R7 / WO-xxx / sys.x.y）。 */
const ID_TOKEN_RE =
  /(?:^|[\s`（(·])((?:G|GAP|BP|DL|RL|SA|TR|DF|C|R|WO|S)-[A-Za-z0-9][A-Za-z0-9-]*|sys\.[a-z_]+\.[a-z0-9_]+|[A-Z]\d{1,2}|R\d{1,2}|G-\d{1,3})(?=$|[\s`）)·：:,，。|])/;

function makeId(raw) {
  const s = strip(raw);
  // `### A. 数据接入域（DataCore）` → `A`；`### 10.3 域内本体切片…` → `10.3`
  // （路径段要短、稳、不含中文长串；完整标题仍原样留在 title 字段里。）
  const sec = s.match(/^(\d+\.\d+(?:\.\d+)?)[\s．.、]/);
  if (sec) return sec[1];
  const letter = s.match(/^([A-Z])[.．、]\s/);
  if (letter) return letter[1];
  const tok = s.match(ID_TOKEN_RE);
  if (tok) return tok[1];
  // 取第一个 ` / ` 之前的片段，去掉括号补语
  let base = s.split(" / ")[0].split("（")[0].split("(")[0].trim();
  base = base.replace(/[：:，,。.]+$/, "").trim();
  if (!base) base = s;
  base = base.replace(/\//g, "-").replace(/\s+/g, " ");
  const c = cut(base, MAX_ID_CP);
  return c.text.trim() || "_unnamed";
}

/** §2 这类「A / B / C」声明多个名字 —— 全部注册为别名，但 id 只取第一个。 */
function aliasesFrom(raw) {
  const s = strip(raw);
  const out = [];
  for (let part of s.split(/\s*\/\s*/)) {
    part = part.split("（")[0].split("(")[0].trim();
    part = part.replace(/[：:，,。.]+$/, "").trim();
    if (part.length >= 2 && part.length <= 60) out.push(part);
  }
  return out;
}

/* ═══════════════════════ markdown 表格 ═══════════════════════ */

/**
 * 按**未转义、且不在反引号内**的 `|` 切单元格。
 *
 * ⚠ 两条都是被实测逼出来的，少一条就会把状态读到错的格子上：
 *   ① `RAW\|FINISHED\|TRANSIT` 这种**转义**竖线不是分隔符；
 *   ② 行内代码里的竖线（`` `method-match|path-only-blind` ``）**也不是** ——
 *      §8 的 3484 行不做保护会被切成 **10 格**（应为 4 格），于是「最后一格」落在一段正文上、
 *      状态被读成「无标记」，而它真实是 ✅。这正是同节 `G-GATE-EXTRACTOR-CROSS-OBJECT-MISBIND`
 *      记的那个形态：**把 A 的 key 绑到 B 的值上**。
 * 反引号数为奇数时保护不可靠，故若保护后格数**少于**表头列数，退回不保护的切法。
 */
function splitRowRaw(line, protectTicks) {
  const t = line.trim();
  const parts = [];
  let cur = "";
  let tick = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "\\|";
      i++;
      continue;
    }
    if (protectTicks && ch === "`") {
      tick = !tick;
      cur += ch;
      continue;
    }
    if (ch === "|" && !tick) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  if (parts.length && parts[0].trim() === "") parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
  return parts.map((s) => s.trim());
}

function splitRow(line, headerLen) {
  const protectedCells = splitRowRaw(line, true);
  if (headerLen && protectedCells.length < headerLen) {
    const plain = splitRowRaw(line, false);
    if (plain.length >= headerLen) return plain;
  }
  return protectedCells;
}

/**
 * 状态/编号所在的格子由**表头**定，不由「最后一格」定。
 * §8 的 3483 行结尾漏了 `|`，切出 5 格；「最后一格」是一段正文（无标记），
 * 而**表头第 4 列**才是真正的性质格（`◑→✅ …`）。判据落在语法位置上，不在「哪格排最后」。
 */
function cellByHeader(cells, headerLen, idx) {
  const i = Math.min(idx, headerLen - 1);
  return cells[i] ?? "";
}
const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

/**
 * 哪一列是这张表的「编号列」—— **按表头名判定，不假定恒为第 0 列**。
 * （§4 事件表第 0 列是「环」L1/L2…，拿它当 id 会把 99 条事件全压成 4 个 id —— 这是正金丝雀
 *  `event#ontology.published` 第一次跑就抓到的真实 bug。）
 */
function idColumnFor(headerCells) {
  const h = headerCells.map(strip);
  for (const name of ["编号", "事件", "切片键", "跨域节点", "节点", "域", "#"]) {
    const i = h.indexOf(name);
    if (i >= 0) return i;
  }
  return 0;
}

/**
 * 全文预扫表格：给每段连续 `|` 行定一个表头。
 *
 * ⚠ 必须有这一步，因为**本体里的长表是被打断的**：§8 主表 3476-3572 带表头，
 *   3574-3639 与 3652-3679 是**无表头的续段**（中间夹了散文行）。
 *   按「每段各自找表头」去解析，这两段 94 行会被当成散文丢掉 ——
 *   实测就是这样：§8 只抽到 96 条，而该节有 190 行编号行。
 *   续段判据落在**列数相同 + 与上一段间隔 ≤30 行**，不是「它长得像表」。
 */
function scanTableHeaders(lines) {
  const byRunStart = new Map();
  let last = null; // { cells, endLine }
  let n = 1;
  while (n <= lines.length) {
    if (!isTableLine(lines[n - 1])) {
      n++;
      continue;
    }
    let j = n;
    while (j <= lines.length && isTableLine(lines[j - 1])) j++;
    const end = j - 1;
    const first = splitRow(lines[n - 1], last ? last.cells.length : 0);
    const hasOwn = end >= n + 1 && isSeparatorRow(splitRow(lines[n]));
    if (hasOwn) {
      last = { cells: first, endLine: end };
      byRunStart.set(n, { header: first, own: true, dataFrom: n + 2, end });
    } else if (last && first.length === last.cells.length && n - last.endLine <= 30) {
      byRunStart.set(n, { header: last.cells, own: false, dataFrom: n, end });
      last = { cells: last.cells, endLine: end };
    } else {
      byRunStart.set(n, { header: null, own: false, dataFrom: n, end });
    }
    n = j;
  }
  return byRunStart;
}

/* ═══════════════════════ 行分类 ═══════════════════════ */

const isFence = (L) => /^```/.test(L);
const isTableLine = (L) => L.startsWith("|");
const isBullet = (L) => /^\s*-\s+\S/.test(L);
/**
 * 独占一行的 **粗体** 当作分组标题（§3 的链路分组名就是这个形态）。
 *
 * ⚠ 但**强调句不是标题**：§8 的 3649 行 `**这条红本身就是本门有牙的最强证据：…不是我造的变异。**`
 *   是段落里的强调，被当成标题之后，它后面整段表格都成了它的子节点，
 *   还生出 `8/这条红本身就是本门有牙的最强证据：它咬的是别人独/...` 这种路径。
 *   判据落在**句末标点**上，不在长度上 —— 实测 §3 真正的链路分组名最长 122 码点
 *   （`DRIL 智能资源路由链（WO-DRIL·Decision Resource Intelligence Layer·…`），
 *   用「≤40 码点」当判据会把 93/114/119/122 这几条**真**分组头一起砍掉：
 *   那又是一次「我用长度当作『这是不是标题』的证据，而长度并不度量它」。
 *   先剥掉结尾的引号/括号再判（`…而前者并不度量后者。」` 这种句号在引号里面）。
 */
const isBoldOnly = (L) => {
  const m = L.match(/^\*\*([^*].*)\*\*\s*$/);
  if (!m) return false;
  const inner = m[1].trim();
  if (Array.from(inner).length > 130) return false;
  const tail = inner.replace(/[」』"'）)\]】]+$/u, "");
  return !/[。！？；.!?;]$/.test(tail);
};

/** 标题层级：# → 1..6；独占一行的 **粗体** → 7（本体用它当 §3 的链路分组名）。 */
function headingLevel(L) {
  const m = L.match(/^(#{1,6})\s+\S/);
  if (m) return m[1].length;
  if (isBoldOnly(L)) return 7;
  return 0;
}
const isBlockStart = (L) => isTableLine(L) || isFence(L) || isBullet(L) || headingLevel(L) > 0;

/* ═══════════════════════ 树的构建（精确铺满，无缝无叠） ═══════════════════════ */

/**
 * 不变式（由构造保证，并由 checkPartition 复验）：
 *   · partitionRange(from,to,...) 返回的节点**恰好**铺满 [from,to]
 *   · 有子节点的节点：own = [start, children[0].start-1]，children 铺满 [children[0].start, end]
 *   ⇒ 全文每一行恰好属于一个节点的 own 区间。
 */
function partitionRange(ctx, from, to, level) {
  if (from > to) return [];
  if (level > 7) return blockPartition(ctx, from, to);

  const starts = [];
  for (let n = from; n <= to; n++) if (headingLevel(ctx.lines[n - 1]) === level) starts.push(n);
  if (starts.length === 0) return partitionRange(ctx, from, to, level + 1);

  const nodes = [];
  if (starts[0] > from) nodes.push(...partitionRange(ctx, from, starts[0] - 1, level + 1));

  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const e = i + 1 < starts.length ? starts[i + 1] - 1 : to;
    const raw = ctx.lines[s - 1];
    const titleRaw = level <= 6 ? raw.replace(/^#{1,6}\s+/, "").trim() : raw.replace(/^\*\*/, "").replace(/\*\*\s*$/, "").trim();
    const kids = partitionRange(ctx, s + 1, e, level + 1);
    const node = mkNode(ctx, {
      idRaw: titleRaw,
      titleRaw,
      start: s,
      end: e,
      ownEnd: kids.length ? kids[0].lines[0] - 1 : e,
      children: kids,
      form: level === 7 ? "group" : "heading",
      level,
      headLine: s,
    });
    nodes.push(node);
  }
  return nodes;
}

/** 块级铺满：表格（逐行）/ 代码块 / 列表项 / 散文段，四类互不重叠地铺满 [from,to]。 */
function blockPartition(ctx, from, to) {
  const nodes = [];
  const seq = { note: 0, code: 0, row: 0, thead: 0 };
  let n = from;
  while (n <= to) {
    const L = ctx.lines[n - 1];

    if (isTableLine(L)) {
      let j = n;
      while (j <= to && isTableLine(ctx.lines[j - 1])) j++;
      const end = j - 1;
      const info = ctx.tableHeaders.get(n);
      const header = info && info.header ? info.header : null;
      if (header) {
        if (info.own) {
          seq.thead++;
          nodes.push(
            mkNode(ctx, {
              idRaw: `_thead${seq.thead > 1 ? seq.thead : ""}`,
              titleRaw: ctx.lines[n - 1].trim(),
              start: n,
              end: n + 1,
              ownEnd: n + 1,
              children: [],
              form: "table_header",
              headerCells: header,
            })
          );
        }
        for (let r = info.own ? n + 2 : n; r <= end; r++) {
          const cells = splitRow(ctx.lines[r - 1], header.length);
          if (isSeparatorRow(cells)) {
            seq.note++;
            nodes.push(mkNode(ctx, { idRaw: `_sep${seq.note}`, titleRaw: "", start: r, end: r, ownEnd: r, children: [], form: "note" }));
            continue;
          }
          const idCol = idColumnFor(header);
          const first = strip(cells[idCol] ?? "");
          let idRaw = first;
          if (!idRaw) {
            seq.row++;
            idRaw = `_row${seq.row}`;
          }
          nodes.push(
            mkNode(ctx, {
              idRaw,
              // 标题 = 本行除编号列外的各单元格原文（逐字，只把分隔符规整成 " | "）
              titleRaw: cells.filter((_, i) => i !== idCol).join(" | ") || cells.join(" | "),
              start: r,
              end: r,
              ownEnd: r,
              children: [],
              form: "table_row",
              cells,
              headerCells: header,
            })
          );
        }
      } else {
        seq.note++;
        nodes.push(mkNode(ctx, { idRaw: `_note${seq.note}`, titleRaw: L.trim(), start: n, end, ownEnd: end, children: [], form: "note" }));
      }
      n = j;
      continue;
    }

    if (isFence(L)) {
      let j = n + 1;
      while (j <= to && !isFence(ctx.lines[j - 1])) j++;
      const end = Math.min(j, to);
      seq.code++;
      nodes.push(mkNode(ctx, { idRaw: `_code${seq.code}`, titleRaw: "", start: n, end, ownEnd: end, children: [], form: "code" }));
      n = end + 1;
      continue;
    }

    if (isBullet(L)) {
      let j = n + 1;
      while (j <= to && !isBlockStart(ctx.lines[j - 1])) j++;
      const end = j - 1;
      const indented = /^\s+-/.test(L);
      nodes.push(
        mkNode(ctx, {
          idRaw: leadName(L),
          titleRaw: L.replace(/^\s*-\s+/, "").trim(),
          start: n,
          end,
          ownEnd: end,
          children: [],
          form: indented ? "sub_item" : "item",
        })
      );
      n = j;
      continue;
    }

    // 散文 / 空行 / 引用块
    let j = n + 1;
    while (j <= to && !isBlockStart(ctx.lines[j - 1])) j++;
    const end = j - 1;
    let first = "";
    for (let k = n; k <= end; k++)
      if (ctx.lines[k - 1].trim()) {
        first = ctx.lines[k - 1].trim();
        break;
      }
    seq.note++;
    nodes.push(mkNode(ctx, { idRaw: `_note${seq.note}`, titleRaw: first, start: n, end, ownEnd: end, children: [], form: "note" }));
    n = j;
  }
  return nodes;
}

/* ═══════════════════════ 节点工厂（kind / status / anchors） ═══════════════════════ */

/**
 * ⚠ §8 状态判据**落在语法位置上，不是「出现过」**：
 *   · 表格行 ⇒ 只取**最后一列（性质）**里的 🔴/◑/✅
 *   · `###` 小节 ⇒ 只取**标题行**里的
 *   条目正文里的标记一律**不**当状态，另记进 body_marks —— 正文完全可能引用别的条目的状态。
 *   （「那个串出现过」不度量「那是它的赋值」。）
 */
function mkNode(ctx, o) {
  const body = ctx.lines.slice(o.start - 1, o.end).join("\n");
  const isAnon = /^_/.test(o.idRaw);
  const id = isAnon ? o.idRaw : makeId(o.idRaw);
  const cap = isAnon ? NOTE_CP : TITLE_CP;
  const t = cut(o.titleRaw, cap);

  const node = {
    id,
    path: "",
    kind: "",
    form: o.form,
    title: t.text,
    title_truncated: t.truncated,
    lines: [o.start, o.end],
    own_lines: [o.start, o.ownEnd],
    status: null,
    body_marks: 0,
    anchors: anchorsFrom(body),
    children: o.children ?? [],
    _cells: o.cells,
    _header: o.headerCells,
    _level: o.level,
    _idRaw: o.idRaw,
  };
  return node;
}

/** 第二遍：给每个节点定 path / kind / status（需要祖先与章节上下文，故独立一遍）。 */
function annotate(nodes, parentPath, sectionKey, ctx) {
  const used = new Map();
  for (const nd of nodes) {
    let id = nd.id;
    const n = (used.get(id) ?? 0) + 1;
    used.set(id, n);
    if (n > 1) id = `${id}#${n}`;
    nd.id = id;
    nd.path = parentPath ? `${parentPath}/${id}` : id;

    nd.kind = classify(nd, sectionKey);

    if (nd.kind === "breakpoint") {
      if (nd.form === "table_row") {
        const hlen = (nd._header ?? []).length || nd._cells.length;
        const statusIdx = hlen - 1;
        const last = cellByHeader(nd._cells, hlen, statusIdx);
        const st = marksIn(last);
        // 性质格**以** `X→Y` 开头 = 作者在写状态迁移（如 `◑→✅ 增量封死 + 存量清零`），取箭头右侧＝当前态。
        // 这是**语法**规则（开头处的「标记 箭头 标记」），不是读语义猜意图；取左侧会把已闭的条目报成半开。
        const trans = last.match(STATUS_TRANSITION_RE);
        if (trans) {
          nd.status = trans[2];
          nd.status_note = `原文写作状态迁移 ${trans[1]}→${trans[2]}，取箭头右侧（当前态）`;
        } else nd.status = st.length ? st[0] : "无标记";
        nd.status_from = `表头第 ${statusIdx + 1} 列（性质）`;
        nd.status_cell = cutText(last, 110);
        nd.body_marks = marksIn(nd._cells.filter((_, i) => i !== 0 && i !== statusIdx).join(" ")).length;
      } else {
        const head = ctx.lines[nd.lines[0] - 1];
        const st = marksIn(head);
        nd.status = st.length ? st[0] : "无标记";
        nd.status_from = "小节标题行";
        nd.status_cell = cutText(head.replace(/^#{1,6}\s+/, ""), 110);
        nd.body_marks = marksIn(ctx.lines.slice(nd.lines[0], nd.lines[1]).join("\n")).length;
      }
    }

    annotate(nd.children, nd.path, sectionKey, ctx);
  }
}

function classify(nd, sec) {
  if (/^_thead/.test(nd.id)) return "table_header";
  if (/^_code/.test(nd.id)) return "code_block";
  if (/^_note/.test(nd.id) || /^_sep/.test(nd.id)) return "note";
  // §8 的 `###` 小节本身就是断点条目（G-ONTOLOGY-INVARIANT-… / G-DSH-GOV-CREDENTIAL / G-OBJECTIVE-…），
  // 必须排在通用 heading 判定之前，否则整类被读成普通小节、状态永远抽不到。
  if (nd.form === "heading" && sec === "8" && /^(?:G|GAP|BP|DL|RL)-/.test(nd.id)) return "breakpoint";
  if (nd.form === "heading") return sec === null ? "section" : "subsection";
  if (nd.form === "group") return sec === "3" ? "link_chain" : "group";

  const h = (nd._header ?? []).map(strip);
  if (nd.form === "table_row") {
    if (h[0] === "编号") return "breakpoint";
    if (h.includes("事件")) return "event";
    if (h[0] === "#" && h.includes("不变量")) return "invariant";
    if (h[0] === "域") return "self_domain";
    if (h[0] === "切片键") return "slice";
    if (h[0] === "跨域节点" || h[0] === "节点") return "cross_domain_node";
    return "table_row";
  }
  if (nd.form === "item" || nd.form === "sub_item") {
    if (sec === "2") return nd.form === "sub_item" ? "object_group" : "object_type";
    if (sec === "7") return "gate";
    return "item";
  }
  if (sec === "3") return "link_chain";
  if (sec === "8" && /^(G|GAP|BP|C\d)/.test(nd.id)) return "breakpoint";
  return nd.form;
}

/* ═══════════════════════ 遍历 / 查找 ═══════════════════════ */

function walk(nodes, fn, parent = null) {
  for (const nd of nodes) {
    fn(nd, parent);
    walk(nd.children, fn, nd);
  }
}
function flatten(tree) {
  const out = [];
  walk(tree, (nd) => out.push(nd));
  return out;
}

/* ═══════════════════════ 行分区自检（硬判据） ═══════════════════════ */

function checkPartition(tree, total) {
  const all = flatten(tree)
    .map((nd) => ({ from: nd.own_lines[0], to: nd.own_lines[1], path: nd.path }))
    .filter((r) => r.to >= r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const gaps = [];
  const overlaps = [];
  let cursor = 1;
  for (const r of all) {
    if (r.from > cursor) gaps.push({ lines: `${cursor}-${r.from - 1}`, count: r.from - cursor, before: r.path });
    else if (r.from < cursor) overlaps.push({ lines: `${r.from}-${Math.min(r.to, cursor - 1)}`, count: Math.min(r.to, cursor - 1) - r.from + 1, at: r.path });
    cursor = Math.max(cursor, r.to + 1);
  }
  if (cursor <= total) gaps.push({ lines: `${cursor}-${total}`, count: total - cursor + 1, before: "<文件末尾>" });

  const covered = all.reduce((a, r) => a + (r.to - r.from + 1), 0);
  return {
    exact: gaps.length === 0 && overlaps.length === 0 && covered === total,
    total_lines: total,
    covered_lines: covered,
    own_intervals: all.length,
    gaps,
    overlaps,
  };
}

/* ═══════════════════════ 名字解析（别名 → path） ═══════════════════════ */

const NAMED_KINDS = new Set([
  "object_type",
  "object_group",
  "event",
  "invariant",
  "gate",
  "breakpoint",
  "slice",
  "self_domain",
  "cross_domain_node",
  "link_chain",
]);

function buildResolver(tree) {
  // alias -> Map<path, rank>；rank 0 = §2 对象类型目录（**定义所在地**），rank 1 = 其它引用处。
  //
  // ⚠ 没有这层优先级，整张图基本连不起来：§10.4「跨域节点」表把 §2 的对象名**又列了一遍**
  //   （Solver / Intent / SliceSpec / Rule …），于是每个横切对象都有 2 个承载 ⇒ 一律判歧义 ⇒ 拒绝解析
  //   ⇒ §3 那 245 行箭头一条边都连不出来。实测就是这样（修前 §3 stated 边 = 0）。
  //   优先级**不是**随手挑一个：§2 标题就是「对象类型目录」= 定义；§10.4 自述「横跨多域的对象」= 视图。
  //   §2 内部若仍有同名两条（如 Solver 与 Solver#2），**照旧判歧义、拒绝替人挑**。
  const map = new Map();
  const add = (alias, p, rank) => {
    const a = alias.trim();
    if (a.length < 2 || a.length > 60) return;
    if (!map.has(a)) map.set(a, new Map());
    const m = map.get(a);
    if (!m.has(p) || m.get(p) > rank) m.set(p, rank);
  };
  walk(tree, (nd) => {
    if (!NAMED_KINDS.has(nd.kind)) return;
    const rank = nd.kind === "object_type" || nd.kind === "object_group" ? 0 : 1;
    add(nd.id, nd.path, rank);
    if (nd.kind === "object_type" || nd.kind === "object_group" || nd.kind === "self_domain")
      for (const a of aliasesFrom(nd._idRaw ?? nd.id)) add(a, nd.path, rank);
  });

  /** 歧义一律**拒绝解析**（不替人挑，同 rule-scope.ts 的 AMBIGUOUS 三态纪律）。 */
  function resolve(tokenRaw) {
    let t = strip(String(tokenRaw))
      .replace(/^[\s·⚠️⚠✅◑🔴*]+/u, "")
      .replace(/[\s·。，,：:、]+$/u, "")
      .split("（")[0]
      .split("(")[0]
      .trim();
    if (!t) return null;
    const s = map.get(t);
    if (!s || s.size === 0) return null;
    const best = Math.min(...s.values());
    const top = [...s].filter(([, r]) => r === best).map(([p]) => p);
    return top.length === 1 ? top[0] : null;
  }
  resolve.map = map;
  return resolve;
}

/* ═══════════════════════ 边抽取 ═══════════════════════
 * 三个来源，全部是**原文里的一句话**，每条都带 source_line + evidence：
 *   ① §3 代码块里的 `A --关系--> B` 箭头行
 *   ② §10.3 切片行的 `root → hop → hop` 跳链
 *   ③ §10.2 域清单行的「主要对象类型」成员列
 * ⛔ 不做别的推断。没有原文句子 = 没有边。
 */
/**
 * 把一行箭头图解析成**链**：`A --k1--> B --k2--> C` ⇒ [(A,k1,B), (B,k2,C)]。
 *
 * ⚠ 必须按链走，⛔ 不许「行首那个 source 配上本行所有 target」——
 *   原文 434 行正是 `Query --classify--> Intent --planRef--> ExecutionPlan --step--> {…}`，
 *   那种写法会凭空造出 Query→ExecutionPlan 这条**原文没说过**的边。
 *   一条错的推断边不会红，只会让下次分析多走两跳、得出一个看着合理的错结论。
 */
function parseArrowChain(line) {
  const re = /--(?:\[([^\]]*)\]|([^[\]]*?))-->/g;
  const arrows = [];
  let m;
  while ((m = re.exec(line)) !== null)
    arrows.push({ label: (m[1] ?? m[2] ?? "").trim(), start: m.index, end: re.lastIndex });
  if (!arrows.length) return [];
  const out = [];
  for (let i = 0; i < arrows.length; i++) {
    const fromSeg = line.slice(i === 0 ? 0 : arrows[i - 1].end, arrows[i].start);
    const toSeg = line.slice(arrows[i].end, i + 1 < arrows.length ? arrows[i + 1].start : line.length);
    const kind = cutText(strip(arrows[i].label).replace(/\s+/g, " "), 60) || "-->";
    out.push({ fromSeg, toSeg, kind });
  }
  return out;
}

/** 从箭头两端的片段里取名字；`{A | B | C}` 这种选择组按原文展开成多个端点（不是丢掉、也不是编造）。 */
function segNames(seg) {
  const s = seg.replace(/^[\s│├└─┌┐┘┬┴┼↓→⇒*>·]+/u, "").trim();
  if (!s) return [];
  const brace = s.match(/^\{([^}]*)\}/);
  const parts = brace ? brace[1].split("|") : [s];
  const out = [];
  for (const p of parts) {
    const c = p.replace(/^[\s*·、,，]+/u, "");
    const m = c.match(/^([A-Za-z_一-龥][A-Za-z0-9_.一-龥]*)/u);
    if (m && m[1].length >= 2) out.push(m[1]);
  }
  return [...new Set(out)];
}

function extractStatedEdges(ctx, tree, resolve) {
  const edges = [];
  const seen = new Set();
  const unresolved = { arrow_endpoints: 0, hop_tokens: 0, member_tokens: 0 };
  const push = (from, to, kind, line, evidence, via) => {
    if (!from || !to || from === to) return;
    const k = `${from} ${to} ${kind} ${line}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ from, to, kind, source_line: line, source_section: via, evidence: cutText(evidence, EVIDENCE_CP) });
  };

  const sec = (key) => flatten(tree).find((nd) => nd.path === key);

  // ① §3 箭头行 —— **按链解析**，只收相邻对
  const s3 = sec("3");
  if (s3) {
    for (let n = s3.lines[0]; n <= s3.lines[1]; n++) {
      const L = ctx.lines[n - 1];
      if (!L.includes("-->")) continue;
      const chain = parseArrowChain(L);
      if (chain.length === 0) {
        unresolved.arrow_endpoints++;
        continue;
      }
      for (const seg of chain) {
        const froms = segNames(seg.fromSeg);
        const tos = segNames(seg.toSeg);
        if (!froms.length || !tos.length) {
          unresolved.arrow_endpoints++;
          continue;
        }
        for (const f of froms)
          for (const t of tos) {
            const a = resolve(f);
            const b = resolve(t);
            if (!a || !b) {
              unresolved.arrow_endpoints++;
              continue;
            }
            push(a, b, seg.kind, n, L.trim(), "3");
          }
      }
    }
  }

  // ②③ §10 表格
  const s10 = sec("10");
  if (s10) {
    walk([s10], (nd) => {
      if (nd.form !== "table_row" || !nd._cells) return;
      const h = (nd._header ?? []).map(strip);
      const line = nd.lines[0];
      if (h[0] === "切片键") {
        const cell = nd._cells[2] ?? "";
        const toks = cell.split("→");
        for (let i = 0; i + 1 < toks.length; i++) {
          const a = resolve(toks[i].split(/[·,，]/).pop() ?? toks[i]);
          const b = resolve(toks[i + 1].split(/[·,，]/)[0] ?? toks[i + 1]);
          if (!a || !b) {
            unresolved.hop_tokens++;
            continue;
          }
          push(a, b, "→（切片跳）", line, cell, "10.3");
        }
        const rootPath = nd.path;
        const firstTok = resolve(toks[0] ?? "");
        if (firstTok) push(rootPath, firstTok, "切片 root", line, cell, "10.3");
      } else if (h[0] === "域") {
        const cell = nd._cells[2] ?? "";
        for (const tok of cell.split("·")) {
          const t = resolve(tok);
          if (!t) {
            unresolved.member_tokens++;
            continue;
          }
          push(nd.path, t, "域含（主要对象类型）", line, cell, "10.2");
        }
      } else if (h[0] === "跨域节点") {
        // ④ 「桥接的域」列：D2↔D1↔D4… —— 原文明说这个节点桥接了哪些域
        const bridge = nd._cells[1] ?? "";
        for (const tok of bridge.match(/\bD\d{1,2}\b/g) ?? []) {
          const t = resolve(tok);
          if (t) push(nd.path, t, "桥接的域", line, bridge, "10.4");
          else unresolved.member_tokens++;
        }
        // ⑤ 「关联断点」列：G-1 / R4 / D-29 … —— 原文明说这个接缝关联哪些断点/不变量
        const rel = nd._cells[2] ?? "";
        for (const tok of rel.match(/(?:G|GAP|BP|DL|RL)-[A-Z0-9][A-Z0-9-]*|\bR\d{1,2}\b|\bD-\d+\b/g) ?? []) {
          const t = resolve(tok);
          if (t) push(nd.path, t, "关联断点", line, rel, "10.4");
          else unresolved.member_tokens++;
        }
      }
    });
  }

  edges.sort(
    (a, b) => a.source_line - b.source_line || a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind)
  );
  return { edges, unresolved };
}

/** 派生边：两节点引用同一处 `file:line`（**推断，不是陈述**）。默认不参与多跳。 */
function extractSharedAnchorEdges(tree) {
  const byAnchor = new Map();
  walk(tree, (nd) => {
    if (!NAMED_KINDS.has(nd.kind)) return;
    for (const a of nd.anchors) {
      if (!/:\d+/.test(a)) continue; // 只认带行号的精确锚点
      if (!byAnchor.has(a)) byAnchor.set(a, []);
      byAnchor.get(a).push(nd.path);
    }
  });
  const out = [];
  for (const a of [...byAnchor.keys()].sort()) {
    const paths = [...new Set(byAnchor.get(a))].sort();
    if (paths.length < 2 || paths.length > 6) continue;
    for (let i = 0; i < paths.length; i++)
      for (let j = i + 1; j < paths.length; j++) out.push({ from: paths[i], to: paths[j], anchor: a });
  }
  return out.slice(0, 2000);
}

/* ═══════════════════════ 图查询 ═══════════════════════ */

function buildGraph(stated, derived, includeDerived) {
  const adj = new Map();
  const add = (a, b, e) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, edge: e });
  };
  for (const e of stated) add(e.from, e.to, e);
  if (includeDerived) for (const e of derived) { add(e.from, e.to, { ...e, kind: "shared_anchor", derived: true }); add(e.to, e.from, { ...e, kind: "shared_anchor", derived: true }); }
  return adj;
}

function bfs(adj, start, depth, undirected, stated) {
  const rev = new Map();
  if (undirected) for (const e of stated) { if (!rev.has(e.to)) rev.set(e.to, []); rev.get(e.to).push({ to: e.from, edge: e, back: true }); }
  const seen = new Map([[start, { hops: 0, link: [] }]]);
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const cur of frontier) {
      const outs = [...(adj.get(cur) ?? []), ...(undirected ? rev.get(cur) ?? [] : [])];
      for (const { to, edge, back } of outs) {
        if (seen.has(to)) continue;
        seen.set(to, { hops: d, link: [...seen.get(cur).link, (back ? "←" : "") + edge.kind], via: edge });
        next.push(to);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  seen.delete(start);
  return seen;
}

function shortestPath(adj, from, to, undirected, stated) {
  const rev = new Map();
  if (undirected) for (const e of stated) { if (!rev.has(e.to)) rev.set(e.to, []); rev.get(e.to).push({ to: e.from, edge: e, back: true }); }
  const prev = new Map([[from, null]]);
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      const outs = [...(adj.get(cur) ?? []), ...(undirected ? rev.get(cur) ?? [] : [])];
      for (const { to: t, edge, back } of outs) {
        if (prev.has(t)) continue;
        prev.set(t, { from: cur, edge, back });
        if (t === to) {
          const chain = [];
          let node = to;
          while (prev.get(node)) {
            const st = prev.get(node);
            chain.unshift({ from: st.from, to: node, edge: st.edge, back: Boolean(st.back) });
            node = st.from;
          }
          return chain;
        }
        next.push(t);
      }
    }
    frontier = next;
  }
  return null;
}

/* ═══════════════════════ 🐤 金丝雀（跑的就是主逻辑的结果） ═══════════════════════ */

const CANARY_POSITIVE = [
  { id: "R1", kind: "invariant", why: "§5 首条不变量，原文 3206 行亲眼可见" },
  { id: "G-1", kind: "breakpoint", why: "§8 主表条目，原文 3504 行亲眼可见" },
  { id: "G-DIST-STALE-READ", kind: "breakpoint", why: "§8 主表首行，原文 3478 行亲眼可见" },
  { id: "SliceSpec", kind: "object_type", why: "§2.B 制品，原文 79 行亲眼可见" },
  { id: "ontology.published", kind: "event", why: "§4 L1 事件，原文 3085 行亲眼可见" },
  { id: "sys.ingest.data_to_object", kind: "slice", why: "§10.3 切片键，原文 3804 行亲眼可见" },
];
const CANARY_NEGATIVE = ["G-ZZZ-NOT-REAL", "R-ZZZ-NOT-REAL", "sys.zzz.not_real", "zzz.never.emitted"];

/** 多跳专属金丝雀：正 = 一条亲眼读到的关系；反 = 确知无关的一对；再加「不存在的节点」必须报错不静默。 */
const HOP_CANARY = {
  positive: {
    from: "Connector",
    to: "RawDataset",
    // 原文 §10.3（3804 行）：`sys.ingest.data_to_object` | D1→D2 | Connector→RawDataset→ObjectType→ObjectInstance→Derivation
    expect_evidence_contains: ["Connector", "RawDataset"],
  },
  negative: { from: "R1", to: "R7" }, // 同属 §5，⛔ 不许因为同节就连上
  missing_node: "9/ZZZ-NOT-REAL",
};

function runCanaries(tree, stated, resolve, nodeByPath) {
  const all = flatten(tree);
  const byId = new Map();
  for (const nd of all) {
    if (!NAMED_KINDS.has(nd.kind)) continue;
    const key = `${nd.kind}#${nd.id}`;
    if (!byId.has(key)) byId.set(key, nd.path);
  }
  const idsAll = new Set(all.map((nd) => nd.id));

  const positive = CANARY_POSITIVE.map((c) => ({ ...c, hit: byId.has(`${c.kind}#${c.id}`), at: byId.get(`${c.kind}#${c.id}`) ?? null }));
  const negative = CANARY_NEGATIVE.map((id) => ({ id, hit: idsAll.has(id) }));

  // 多跳
  const adj = buildGraph(stated, [], false);
  const pFrom = resolve(HOP_CANARY.positive.from);
  const pTo = resolve(HOP_CANARY.positive.to);
  const chain = pFrom && pTo ? shortestPath(adj, pFrom, pTo, false, stated) : null;
  const evOk =
    Boolean(chain) &&
    chain.every((h) => h.edge.source_line > 0) &&
    HOP_CANARY.positive.expect_evidence_contains.every((s) => chain.some((h) => h.edge.evidence.includes(s)));
  const hopPositive = {
    from: HOP_CANARY.positive.from,
    to: HOP_CANARY.positive.to,
    from_path: pFrom,
    to_path: pTo,
    hops: chain ? chain.length : 0,
    source_lines: chain ? chain.map((h) => h.edge.source_line) : [],
    hit: evOk,
  };

  const nFrom = byId.get(`invariant#${HOP_CANARY.negative.from}`);
  const nTo = byId.get(`invariant#${HOP_CANARY.negative.to}`);
  const negChain = nFrom && nTo ? shortestPath(adj, nFrom, nTo, true, stated) : null;
  const hopNegative = { from: nFrom, to: nTo, hit: negChain === null, note: "同属 §5；⛔ 不许因为同节就连上" };

  const missing = { path: HOP_CANARY.missing_node, resolves: nodeByPath.has(HOP_CANARY.missing_node) };

  const nonEmpty = ["link_chain", "gate", "object_type", "breakpoint", "event"].map((k) => {
    const count = all.filter((nd) => nd.kind === k).length;
    return { kind: k, count, hit: count > 0 };
  });

  const ok =
    positive.every((c) => c.hit) &&
    negative.every((c) => !c.hit) &&
    nonEmpty.every((c) => c.hit) &&
    hopPositive.hit &&
    hopNegative.hit &&
    !missing.resolves;

  return { ok, positive, negative, non_empty: nonEmpty, hop_positive: hopPositive, hop_negative: hopNegative, missing_node: missing };
}

/* ═══════════════════════ 组装 ═══════════════════════ */

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
const round4 = (x) => Math.round(x * 10000) / 10000;

function build(text) {
  const lines = text.split("\n");
  // 文件以 \n 结尾时 split 会多出一个空串尾元素 —— 不去掉，行号就整体比 wc -l / 编辑器多 1，
  // 而「--path 报的行号」正是这个索引唯一的用处。
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const ctx = { lines, tableHeaders: scanTableHeaders(lines) };

  // 顶层：前言 + 各 `##` 章节（路径段用章节号，短而稳）
  const secStarts = [];
  for (let n = 1; n <= lines.length; n++) if (/^##\s+/.test(lines[n - 1])) secStarts.push(n);

  const tree = [];
  if (secStarts.length && secStarts[0] > 1) {
    const kids = partitionRange(ctx, 2, secStarts[0] - 1, 3);
    const nd = mkNode(ctx, {
      idRaw: "_preamble",
      titleRaw: lines[0].replace(/^#\s+/, "").trim(),
      start: 1,
      end: secStarts[0] - 1,
      ownEnd: kids.length ? kids[0].lines[0] - 1 : secStarts[0] - 1,
      children: kids,
      form: "heading",
    });
    tree.push(nd);
  }
  for (let i = 0; i < secStarts.length; i++) {
    const s = secStarts[i];
    const e = i + 1 < secStarts.length ? secStarts[i + 1] - 1 : lines.length;
    const raw = lines[s - 1].replace(/^##\s+/, "").trim();
    const m = raw.match(/^(\d+)\.\s*(.*)$/);
    const secId = m ? m[1] : makeId(raw);
    const kids = partitionRange(ctx, s + 1, e, 3);
    const nd = mkNode(ctx, {
      idRaw: secId,
      titleRaw: m ? m[2] : raw,
      start: s,
      end: e,
      ownEnd: kids.length ? kids[0].lines[0] - 1 : e,
      children: kids,
      form: "heading",
    });
    nd.id = secId;
    tree.push(nd);
  }

  // 第二遍：path / kind / status
  {
    const used = new Map();
    for (const nd of tree) {
      let id = nd.id;
      const n = (used.get(id) ?? 0) + 1;
      used.set(id, n);
      if (n > 1) id = `${id}#${n}`;
      nd.id = id;
      nd.path = id;
      nd.kind = "section";
      annotate(nd.children, nd.path, /^\d+$/.test(id) ? id : null, ctx);
    }
  }

  const partition = checkPartition(tree, lines.length);
  const resolve = buildResolver(tree);
  const { edges: stated, unresolved } = extractStatedEdges(ctx, tree, resolve);
  const derived = extractSharedAnchorEdges(tree);

  const nodeByPath = new Map();
  walk(tree, (nd) => nodeByPath.set(nd.path, nd));

  const canary = runCanaries(tree, stated, resolve, nodeByPath);

  return { lines, ctx, tree, partition, stated, derived, unresolved, resolve, nodeByPath, canary, text };
}

function buildDoc(B) {
  const all = flatten(B.tree);
  const byKind = {};
  for (const nd of all) byKind[nd.kind] = (byKind[nd.kind] ?? 0) + 1;

  const bps = all.filter((nd) => nd.kind === "breakpoint");
  const dist = {};
  for (const m of STATUS_MARKS) dist[m] = 0;
  dist["无标记"] = 0;
  for (const e of bps) dist[e.status] = (dist[e.status] ?? 0) + 1;
  const sec8 = B.nodeByPath.get("8");
  const sec8Text = sec8 ? B.lines.slice(sec8.lines[0] - 1, sec8.lines[1]).join("\n") : "";
  const raw8 = {};
  for (const m of STATUS_MARKS) raw8[m] = 0;
  for (const ch of marksIn(sec8Text)) raw8[ch]++;

  // 哪几节**说出了**关系（按 source_section = 陈述句所在的那一节），哪几节一条都没说。
  //
  // ⚠ 判据必须落在 source_section 上，**不是**「该节的节点有没有当过端点」——
  //   §3 的箭头陈述连的是 §2 的对象，端点全是 `2/...`，按端点数会得出「§3 零边」这个**恰好相反**的结论。
  //   （实测踩过：改这一句之前屏上就是这么报的。形态还是那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」。）
  const stmtBySection = {};
  for (const e of B.stated) stmtBySection[e.source_section] = (stmtBySection[e.source_section] ?? 0) + 1;
  const endpointSections = new Set();
  for (const e of B.stated) {
    endpointSections.add(e.from.split("/")[0]);
    endpointSections.add(e.to.split("/")[0]);
  }
  const statedRoots = new Set(Object.keys(stmtBySection).map((k) => k.split(".")[0]));
  const noEdgeSections = B.tree
    .filter((s) => !statedRoots.has(s.id))
    .map((s) => ({
      section: s.id,
      title: s.title,
      // ⚠ 措辞必须只说**测到了什么**：说「该节没有关系陈述」会把 §4 冤枉了 ——
      //   §4 的「生产者 / 失效下游」列**是**关系陈述，只是下游是前端视图键、不是本索引的节点。
      //   「我没抽出来」和「它没有」是两个命题，写成一句就是本仓反复栽的那个形态。
      reason:
        "本索引未从该节抽出 stated 边。抽边只认三种原文句式：§3 的箭头行 · §10.3 的跳链 · §10.2/§10.4 的成员与桥接列。" +
        "该节要么没有这些句式，要么句中端点不是本索引的节点（如 §4 的「失效下游」是前端视图键、非本体节点）。⛔ 未凭相关性补边。",
    }));

  const dupes = [];
  {
    const m = new Map();
    for (const nd of all) {
      if (!NAMED_KINDS.has(nd.kind)) continue;
      const k = `${nd.kind}#${nd.id.replace(/#\d+$/, "")}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...m].sort()) if (n > 1) dupes.push({ key: k, occurrences: n });
  }

  const doc = {
    meta: {
      source: SRC_REL,
      generator: "scripts/ontology-index.mjs",
      source_lines: B.lines.length,
      source_sha256: sha256(B.text),
      anchor_verified: false,
      anchor_note: "锚点 file:line 照抄原文、未做存在性校准（原文里很多行号已过期）。校准不在本索引职责内。",
      contract:
        "索引只存结构与指针：path · 标题原文逐字截取 · 状态 · 锚点原文 · 行区间。⛔ 不是转写/摘要/第二套真相源。" +
        "语义一律以 docs/SYSTEM-ONTOLOGY.md 为准。取原文：node scripts/ontology-index.mjs --path <path>。",
      edge_contract:
        "stated = 原文明确陈述的关系，必带 source_line + evidence；shared_anchor = 推断（两节点引同一 file:line），" +
        "默认不参与多跳，需 --include-derived。⛔ 不因「看着相关」连边。",
    },
    canary: B.canary,
    partition_check: B.partition,
    counts: { nodes_total: all.length, by_kind: byKind, stated_edges: B.stated.length, shared_anchor_edges: B.derived.length },
    section_8_summary: {
      entries_total: bps.length,
      from_table_rows: bps.filter((e) => e.form === "table_row").length,
      from_headings: bps.filter((e) => e.form !== "table_row").length,
      unique_ids: new Set(bps.map((e) => e.id.replace(/#\d+$/, ""))).size,
      status_by_syntax_position: dist,
      raw_marker_occurrences_in_section_text: raw8,
      note:
        "status 只取语法位置（表格最后一列『性质』/ 小节标题行）；条目正文里的标记记在 body_marks，⛔ 不当该条目的状态 —— " +
        "正文完全可能引用别的条目的状态。raw_marker_occurrences 是整节文本的字符出现次数，与条目数天然不等，仅供对账。",
    },
    edges_summary: {
      stated: B.stated.length,
      shared_anchor: B.derived.length,
      stated_statements_by_source_section: stmtBySection,
      endpoint_sections: [...endpointSections].sort(),
      unresolved_endpoints: B.unresolved,
      unresolved_note:
        "未解析 = 箭头/跳链端点不是本索引的节点（多为代码符号、续行、或同名歧义被拒绝）。" +
        "如实报稀疏，⛔ 不为了图好看去补 —— 一张稀疏但真实的图比稠密但有编造边的图有用。",
      sections_without_stated_edges: noEdgeSections,
    },
    duplicate_ids: dupes,
    tree: B.tree,
    edges: { stated: B.stated, shared_anchor: B.derived },
  };
  return doc;
}

/* ═══════════════════════ YAML 序列化（确定性） ═══════════════════════ */

const NODE_EMIT_KEYS = [
  "id",
  "path",
  "kind",
  "form",
  "title",
  "title_truncated",
  "lines",
  "own_lines",
  "status",
  "status_from",
  "status_note",
  "status_cell",
  "body_marks",
  "anchors",
  "children",
];

function cleanNode(nd) {
  const o = {};
  for (const k of NODE_EMIT_KEYS) {
    if (!(k in nd)) continue;
    if (k === "children") {
      o.children = nd.children.map(cleanNode);
      continue;
    }
    const v = nd[k];
    if (v === null && !["status"].includes(k)) continue;
    if (k === "body_marks" && !v) continue;
    if (k === "anchors" && (!v || v.length === 0)) continue;
    if (k === "title_truncated" && !v) continue;
    o[k] = v;
  }
  return o;
}

function yamlScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(String(v)); // JSON 字符串是合法 YAML 1.2 双引号标量，Unicode 原样保留
}

function emit(node, indent, out) {
  const pad = " ".repeat(indent);
  if (Array.isArray(node)) {
    if (node.length === 0) {
      out[out.length - 1] += " []";
      return;
    }
    for (const item of node) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (!keys.length) {
          out.push(`${pad}- {}`);
          continue;
        }
        let first = true;
        for (const k of keys) {
          const v = item[k];
          const lead = first ? `${pad}- ` : `${pad}  `;
          if (v !== null && typeof v === "object") {
            if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) {
              out.push(`${lead}${k}:`);
              emitInlineArray(v, indent + 4, out);
            } else {
              out.push(`${lead}${k}:`);
              emit(v, indent + 4, out);
            }
          } else out.push(`${lead}${k}: ${yamlScalar(v)}`);
          first = false;
        }
      } else out.push(`${pad}- ${yamlScalar(item)}`);
    }
    return;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v !== null && typeof v === "object") {
      out.push(`${pad}${k}:`);
      if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) emitInlineArray(v, indent + 2, out);
      else emit(v, indent + 2, out);
    } else out.push(`${pad}${k}: ${yamlScalar(v)}`);
  }
}
function emitInlineArray(arr, indent, out) {
  if (!arr.length) {
    out[out.length - 1] += " []";
    return;
  }
  const pad = " ".repeat(indent);
  for (const x of arr) out.push(`${pad}- ${yamlScalar(x)}`);
}

function toYaml(doc) {
  const d = { ...doc, tree: doc.tree.map(cleanNode) };
  const out = [HEADER_LINE];
  emit(d, 0, out);
  return out.join("\n") + "\n";
}

/* ═══════════════════════ --check 的结构化差异 ═══════════════════════ */

/** 解析**本脚本自己的**输出：每个节点以 `id:` 紧跟 `path:` 开头，故 path 行即节点边界。 */
function parseOwn(text) {
  const fields = new Map();
  let cur = "<顶层>";
  let pendingId = null; // `- id:` 排在 `path:` 之前，先挂起，等 path 定了上下文再记，
  //                       否则它会被算到**上一个**节点头上（变异反证时屏上就是这么错报的）。
  for (const L of text.split("\n")) {
    if (L.startsWith("#")) continue;
    const mid = L.match(/^\s*- id:\s*(.*)$/);
    if (mid) {
      pendingId = mid[1];
      continue;
    }
    const mp = L.match(/^\s*(?:- )?path:\s*(".*")\s*$/);
    if (mp) {
      cur = JSON.parse(mp[1]);
      if (pendingId !== null) {
        fields.set(`${cur} id`, pendingId);
        pendingId = null;
      }
      continue;
    }
    const mf = L.match(/^\s*(?:- )?([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
    if (!mf) continue;
    if (mf[1] === "children") continue;
    const key = `${cur} ${mf[1]}`;
    if (!fields.has(key)) fields.set(key, mf[2]);
  }
  return fields;
}

function diffSummary(oldText, newText) {
  const A = parseOwn(oldText);
  const B = parseOwn(newText);
  const nodesA = new Set([...A.keys()].map((k) => k.split(" ")[0]));
  const nodesB = new Set([...B.keys()].map((k) => k.split(" ")[0]));
  const out = [];

  const gone = [...nodesA].filter((n) => !nodesB.has(n)).sort();
  const added = [...nodesB].filter((n) => !nodesA.has(n)).sort();
  if (gone.length) {
    out.push(`  节点消失（现有索引有、重新生成后没有）：${gone.length} 个`);
    for (const n of gone.slice(0, 20)) out.push(`    - ${n}`);
    if (gone.length > 20) out.push(`    … 另有 ${gone.length - 20} 个`);
  }
  if (added.length) {
    out.push(`  节点新增（重新生成后才有）：${added.length} 个`);
    for (const n of added.slice(0, 20)) out.push(`    + ${n}`);
    if (added.length > 20) out.push(`    … 另有 ${added.length - 20} 个`);
  }

  const changed = [];
  for (const k of [...A.keys()].sort()) {
    if (!B.has(k)) continue;
    if (A.get(k) !== B.get(k)) {
      const [node, field] = k.split(" ");
      changed.push({ node, field, was: A.get(k), now: B.get(k) });
    }
  }
  if (changed.length) {
    out.push(`  字段变更：${changed.length} 处`);
    for (const c of changed.slice(0, 30)) {
      out.push(`    ~ 节点 ${c.node} · 字段 ${c.field}`);
      out.push(`        was: ${cutText(c.was, 110)}`);
      out.push(`        now: ${cutText(c.now, 110)}`);
    }
    if (changed.length > 30) out.push(`    … 另有 ${changed.length - 30} 处`);
  }
  if (!out.length) out.push("  （无结构化差异，但字节不同 —— 可能是空白或键序改变）");
  return out.join("\n");
}

/* ═══════════════════════ CLI ═══════════════════════ */

function argOf(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function needNode(B, p) {
  const nd = B.nodeByPath.get(p);
  if (!nd) {
    // ⛔ 「没找到」和「不存在」是两个命题 —— 明确报错，绝不静默回空集
    const near = [...B.nodeByPath.keys()].filter((k) => k.includes(p.split("/").pop() ?? "")).slice(0, 5);
    console.error(`[ontology-index] ❌ 节点不存在：${p}`);
    if (near.length) console.error(`  近似路径：${near.join("  ")}`);
    console.error(`  用 --ls <父路径> 或 --grep <关键词> 找正确路径。`);
    process.exit(1);
  }
  return nd;
}

function main() {
  const args = process.argv.slice(2);
  if (!existsSync(SRC)) fail(`[ontology-index] 源文件不存在：${SRC_REL}`, 2);
  const text = readFileSync(SRC, "utf8");
  const B = build(text);

  // 金丝雀 & 行分区：任何查询之前先自证工具
  if (!B.canary.ok) {
    console.error("🐤 量法坏了 —— 金丝雀不通过，⛔ 不输出 YAML（「我没找到」和「它不存在」是两个命题）。");
    for (const c of B.canary.positive) if (!c.hit) console.error(`  正金丝雀未命中：${c.kind}#${c.id}（${c.why}）`);
    for (const c of B.canary.negative) if (c.hit) console.error(`  反金丝雀反而命中：${c.id}（这编号是编的，本不该存在）`);
    for (const c of B.canary.non_empty) if (!c.hit) console.error(`  抽取器产出 0 条：${c.kind}`);
    if (!B.canary.hop_positive.hit)
      console.error(`  多跳正金丝雀失败：${HOP_CANARY.positive.from} → ${HOP_CANARY.positive.to} 走不通或 evidence 对不上`);
    if (!B.canary.hop_negative.hit) console.error(`  多跳反金丝雀失败：R1 与 R7 之间被连出了路径（⛔ 同节不等于有关系）`);
    if (B.canary.missing_node.resolves) console.error(`  不存在的节点竟然解析成功：${B.canary.missing_node.path}`);
    process.exit(1);
  }
  if (!B.partition.exact) {
    console.error("⛔ 行分区不成立 —— 有行不属于任何节点（或被多个节点重复认领），不出 YAML。");
    console.error(`  总行 ${B.partition.total_lines} · 已覆盖 ${B.partition.covered_lines}`);
    for (const g of B.partition.gaps.slice(0, 20)) console.error(`  空隙 ${g.lines}（${g.count} 行）`);
    for (const o of B.partition.overlaps.slice(0, 20)) console.error(`  重叠 ${o.lines}（${o.count} 行）于 ${o.at}`);
    process.exit(1);
  }

  /* ── 查询模式 ── */
  if (args.includes("--ls")) {
    const p = argOf(args, "--ls");
    const kids = p ? needNode(B, p).children : B.tree;
    if (!kids.length) return console.log(`（${p} 无子节点；用 --path ${p} 直接读原文）`);
    for (const k of kids)
      console.log(
        `${k.path}\t[${k.kind}${k.status ? " " + k.status : ""}]\t${k.lines[0]}-${k.lines[1]}(${k.lines[1] - k.lines[0] + 1}行)\t${cutText(k.title, 70)}`
      );
    return;
  }

  if (args.includes("--path")) {
    const p = argOf(args, "--path");
    const nd = needNode(B, p);
    const own = args.includes("--own");
    const [a, b] = own ? nd.own_lines : nd.lines;
    console.log(`── ${nd.path}  [${nd.kind}${nd.status ? " " + nd.status : ""}]  ${SRC_REL}:${a}-${b}${own ? " (own)" : ""} ──`);
    for (let n = a; n <= b; n++) console.log(`${n}\t${B.lines[n - 1]}`);
    return;
  }

  // 诊断：某个名字解析到哪个节点。报「边很稀疏」这种否定结论时，用它给出证据。
  if (args.includes("--resolve")) {
    const t = argOf(args, "--resolve");
    if (!t) fail("[ontology-index] --resolve 需要一个名字");
    const hit = B.resolve(t);
    const all = B.resolve.map.get(t.trim());
    if (hit) {
      console.log(`✅ "${t}" → ${hit}`);
      if (all && all.size > 1)
        for (const [p, r] of [...all].sort()) if (p !== hit) console.log(`    （另有 rank${r} 承载：${p}）`);
    } else if (all && all.size > 1) {
      console.log(`⚠ "${t}" **歧义**（${all.size} 个同优先级承载），⛔ 拒绝替你挑：`);
      for (const [p, r] of [...all].sort()) console.log(`    rank${r}  ${p}`);
    } else console.log(`❌ "${t}" 未注册为任何节点的名字/别名（这是「没注册」，不等于「本体没提过它」）`);
    return;
  }

  if (args.includes("--grep")) {
    const q = (argOf(args, "--grep") ?? "").toLowerCase();
    if (!q) fail("[ontology-index] --grep 需要一个关键词");
    let hits = 0;
    walk(B.tree, (nd) => {
      if (nd.id.toLowerCase().includes(q) || nd.title.toLowerCase().includes(q)) {
        hits++;
        console.log(`${nd.path}\t[${nd.kind}${nd.status ? " " + nd.status : ""}]\t${nd.lines[0]}-${nd.lines[1]}\t${cutText(nd.title, 70)}`);
      }
    });
    if (!hits) console.log(`（title/id 上无命中：${q} —— 这是「没找到」，不等于「本体里不存在」，正文未被索引）`);
    return;
  }

  if (args.includes("--hops")) {
    const p = argOf(args, "--hops");
    const nd = needNode(B, p);
    const depth = Number(argOf(args, "--depth") ?? 1) || 1;
    const undirected = args.includes("--undirected");
    const inc = args.includes("--include-derived");
    const adj = buildGraph(B.stated, B.derived, inc);
    const got = bfs(adj, nd.path, depth, undirected, B.stated);
    console.log(`── 从 ${nd.path} 起 ${depth} 跳${undirected ? "（无向）" : "（有向）"}${inc ? " + 派生边" : "（只走 stated）"} ──`);
    if (!got.size) return console.log(`（0 个可达节点。注意：这是「图上没有陈述边通向它」，不是「本体里没关系」—— 原文的关系陈述本就稀疏）`);
    for (const [pp, v] of [...got].sort((x, y) => x[1].hops - y[1].hops || x[0].localeCompare(y[0]))) {
      const t = B.nodeByPath.get(pp);
      console.log(`${v.hops}跳\t${pp}\tlinkPath=[${v.link.join(" → ")}]\t${cutText(t ? t.title : "", 50)}`);
    }
    return;
  }

  if (args.includes("--why")) {
    const i = args.indexOf("--why");
    const a = args[i + 1];
    const b = args[i + 2];
    if (!a || !b) fail("[ontology-index] --why 需要两个路径");
    const na = needNode(B, a);
    const nb = needNode(B, b);
    const inc = args.includes("--include-derived");
    const undirected = args.includes("--undirected");
    const adj = buildGraph(B.stated, B.derived, inc);
    const chain = shortestPath(adj, na.path, nb.path, undirected, B.stated);
    if (!chain) {
      console.log(`── ${na.path} ⇢ ${nb.path}：**无路径**${undirected ? "（无向）" : "（有向，可试 --undirected）"} ──`);
      console.log(`（无路径 = 原文没有把这两者连起来的陈述句。⛔ 不因为「看着相关」就连边。）`);
      return;
    }
    console.log(`── ${na.path} ⇢ ${nb.path}：${chain.length} 跳 ──`);
    for (const h of chain) {
      const t = B.nodeByPath.get(h.to);
      console.log(`  ${h.from}\n    --[${h.back ? "←" : ""}${h.edge.kind}]--> ${h.to}   (${cutText(t ? t.title : "", 40)})`);
      console.log(`    据 ${SRC_REL}:${h.edge.source_line}  ${cutText(h.edge.evidence, 100)}`);
    }
    return;
  }

  /* ── 生成 / 校验 ── */
  const doc = buildDoc(B);
  const yaml = toYaml(doc);

  if (args.includes("--check")) {
    if (!existsSync(OUT)) fail(`[ontology-index] --check 失败：${OUT_REL} 不存在，请先运行 node scripts/ontology-index.mjs`);
    const cur = readFileSync(OUT, "utf8");
    if (cur === yaml) {
      console.log(`[ontology-index] --check ✅ 一致（${doc.meta.source_lines} 行本体 / ${doc.counts.nodes_total} 个节点 / ${doc.counts.stated_edges} 条 stated 边）`);
      process.exit(0);
    }
    console.error("[ontology-index] --check ❌ 索引已漂移（本体改了没重新生成，或有人手改了索引）：");
    console.error(diffSummary(cur, yaml));
    console.error("\n  修法：node scripts/ontology-index.mjs");
    process.exit(1);
  }

  writeFileSync(OUT, yaml, "utf8");
  const c = doc.counts;
  const p = doc.partition_check;
  const s8 = doc.section_8_summary;
  console.log(`[ontology-index] 已写出 ${OUT_REL}`);
  console.log(`  🐤 金丝雀：正 ${doc.canary.positive.length} 全中 · 反 ${doc.canary.negative.length} 全未中 · 多跳正/反/不存在节点 全过 ✅`);
  console.log(`  ⛔ 行分区自检：无重叠 · 无空隙 · 总行数匹配 ${p.covered_lines}/${p.total_lines}（${p.own_intervals} 个自有区间）`);
  console.log(`  节点 ${c.nodes_total} 个：` + Object.entries(c.by_kind).sort().map(([k, v]) => `${k}=${v}`).join(" · "));
  console.log(`  边：stated ${c.stated_edges} · shared_anchor ${c.shared_anchor_edges}（派生，默认不走）`);
  console.log(`  §8：条目 ${s8.entries_total}（表行 ${s8.from_table_rows} + 小节 ${s8.from_headings}）· 不重复 id ${s8.unique_ids}`);
  const d = s8.status_by_syntax_position;
  console.log(`  §8 状态（按语法位置）：` + Object.entries(d).map(([k, v]) => `${k} ${v}`).join(" · "));
  const r = s8.raw_marker_occurrences_in_section_text;
  console.log(`  §8 整节标记原始出现次数（仅对账，与条目数天然不等）：` + Object.entries(r).map(([k, v]) => `${k} ${v}`).join(" · "));
  if (doc.edges_summary.sections_without_stated_edges.length)
    console.log(`  无 stated 边的章节：` + doc.edges_summary.sections_without_stated_edges.map((s) => `§${s.section}`).join(" "));
}

main();
