#!/usr/bin/env node
/**
 * PRD 数据承载门 —— 本体 §8 `G-PRD-DATA-UNGROUNDED` 的机械那一半。
 *
 * ── 存在理由（结构性，不是个案）────────────────────────────────────────────
 * 2026-08-11 全仓统计，**口径已订正为「只扫验收章」**（这是唯一可比的口径）：
 *   **103 份有验收章的 PRD 中，57 份（55%）在验收章里零数据层讨论。**
 *
 * ⚠️ 这个数字被修过两轮，值得记账（铁律 0.6：拿一个没验证过「在度量什么」的数字当判据，
 * 是本仓最贵的一类错）：**初版口径「86%」与本门作者的独立复核「59%」都是错的** ——
 * 两者都扫了**整份文档**，于是正文里随便一句 `SEED_DEMO=1` 就被算成「谈了数据」，
 * 而验收章里其实一个字都没谈。三个数分别是 86% / 59% / 55%，**分歧全部来自口径而非事实**。
 * 只有「只扫验收章」这一口径回答的才是我们真正要问的问题：**验收判据本身有没有考虑数据前置**。
 *
 * 定性结论不依赖具体数字，三个口径都指向它：
 *   **数据可得性只在「主题是数据」时才被讨论；只要主题是功能，数据就被默认成既有事实。**
 * 真正被亲手复验、且本门赖以立门的，是**下面那个 A6 个案**（逐字读过属性表），不是百分比。
 *
 * **存量实测比预估短得多**（WO-PRD-FIELD-AUDIT 逐条读原文 + 本门作者独立复核抽样）：
 * 🔴「字段不存在」**只有 7 处 / 6 个 `Type.field` / 5 份 PRD**，🟡「字段在但恒空」**0 条**；
 * 而且 6 条里 4 条是**命名漂移、数据都在**（`ChangeoverMatrix.changeoverMin`→真名 `minutes`，
 * **30 条实例数据都在** / `Metric.gap`→`delta`·`gapPct` / `Cadence.kind`→`cadenceKind`）。
 * ⇒ 棘轮只需装 7 条，**门因此可以做得比"存量几百条"的假设严得多**。
 *
 * 已坐实的后果（A6 · `PRD-segment-scoped-gap-attribution.md`）：
 * PRD 要求「同一条线被三个 seg 争用时保谁」，判据源 `SEG_REGISTRY` 有数据，
 * 但**「这条线属于哪几个 seg」这层归属根本不存在** —— `Line`/`Process` 属性表里无业务线字段
 * （本门实测：`Line` 仅 11 个属性 `lineId/baseId/name/utilization/actual_output_daily/
 * schedule_attainment/line_code/max_capacity_day/capacityDaily/target_yield/status`，无任何 seg 归属字段）。
 * 需求建立在一个**不存在的关系**上，而 PRD 的验收判据（「改 `SEG_REGISTRY` 一个值 → 结论跟着变」）
 * **只咬后半段**：前半段不成立时它无法失败。
 *
 * 同一份 PRD 的 A1 判据被这么修过一次（`PRD-sandbox-redesign.md` · 2026-08-08 实测）：
 * 原措辞「`evidence.solverKey` 指向的求解器真被调用过」，实测 15 条阻滞点的 `solverKey`
 * **全部等于 `chain_impediments` 自己** ⇒「指向自己」永远为真、**断言无法失败**、照原文建门 = 恒绿哑门。
 * **A6 是同一个病，只是当时没跑到。** 按 CLAUDE.md 铁律 0.6「同一个错第二次必须建机制」，本门即该机制。
 *
 * ── 判据（三层，层层可失败）──────────────────────────────────────────────
 *  ① `PDG-1/2/3 · 《数据承载核对》表自校验`（**精确层·零启发式**）
 *     模板新增的《数据承载核对》表是一份**机器可核对的契约**。逐行读回真值源：
 *       · PDG-1 表称「有/✅」而字段在本体里**不存在**      → 红（PRD 把不存在的字段当既有事实）
 *       · PDG-2 表称「不存在/❌」而字段**其实已有**        → 红（过期声明·同 `check-stale-claims` 那一族）
 *       · PDG-3 表引用了**未知对象类型**且未标「新建/绿地」→ 红
 *     这一层不猜「现状还是目标」——**表格自己声明了状态**，所以能精确判。
 *
 *  ② `PDG-4 · 正文断言字段存在、实则不存在`（**发现层·带棘轮**）
 *     扫正文里的 `` `Type.field` ``，Type 必须是已知对象类型。字段不存在时**再看语境**：
 *       · 提案语境（新增/建议补/拟/待建/目标态/← 新增 …）→ **不算缺陷**（PRD 本就在提议新增字段）
 *       · 断言语境（已有/现有/字段存在/落值/读取 …）    → **红**
 *       · 两者都不成立                                   → **`PDG-5 · 未判定`，不进红**
 *     判据 #5「区分描述现状与描述目标」在此落地：**判不准的落未判定，不硬塞进红**。
 *
 *  ③ `PDG-6 · 变量判据缺前置声明`（WO §4 · 带棘轮）
 *     凡验收判据形如「改 X → 结论跟着变」，必须同时声明「X 要能影响结论，前置是 Y」。
 *     A6 的判据就是缺了这一句 —— 它只咬后半段，前半段（归属关系存在）不成立时**无法失败**。
 *     本门只能验「**有没有**声明前置」，验不了「声明的前置**对不对**」（见文件末尾《做不到的部分》）。
 *
 * ── 棘轮 ────────────────────────────────────────────────────────────────
 * 存量 80 份，一刀切红会把仓砸死 ⇒ `scripts/prd-data-grounding-baseline.json` 记存量豁免，
 * 每条带 `why` + 归属 PRD。**只降不升**：新增的红一律拦。规则见基线文件 note。
 *
 * ── 金丝雀（门自己会瞎）──────────────────────────────────────────────────
 * 本仓已实测过多次「工具骗人」：`git grep -- "apps/<星>/src"` 恒 0 命中（pathspec 通配符不跨 `/`）；
 * 120 字窗口把 `G-NO-FREIGHT-COST` 截成 `-CO`；事件名是第二个实参而非第一个。
 * 共同后果都是**门报绿，而它其实一个字都没扫到**。故本门开跑前先跑 `selftest()`：
 *   · 必咬样例（含 A6 原型）过一遍**主逻辑同一份实现** —— 不另抄正则（抄了就是装饰品）；
 *   · 真值源规模下限（类型数/属性数/PRD 文件数）—— 扫空即红；
 *   · 已知必中的锚点对（`Line.utilization` 在 / `Line.businessType` 不在）—— 锚点不符即判**工具坏了**。
 * 任一条不过 ⇒ 打印「⛔ 门自己瞎了」并 **exit 2**，**不许**报「代码干净」。
 *
 * ── 退出码三分 ──────────────────────────────────────────────────────────
 *   0 = 干净 · 1 = 真有问题 · 2 = 工具自己坏了（**不许据此报「干净」**）
 *
 * 用法：
 *   node scripts/check-prd-data-grounding.mjs             # 门
 *   node scripts/check-prd-data-grounding.mjs --list      # 列出全部现存违规（写基线用）
 *   node scripts/check-prd-data-grounding.mjs --selftest  # 只跑金丝雀
 *   node scripts/check-prd-data-grounding.mjs --explain <PRD.md>   # 单文件逐条解释
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = "docs";
const BASELINE_PATH = "scripts/prd-data-grounding-baseline.json";
/** 真值源：合成种子里的对象类型/属性声明（demo 租户已发布本体的同一出处）。 */
const TYPE_SOURCES = ["apps/datacore/src/synthetic/battery.ts", "apps/datacore/src/synthetic/battery-extended.ts"];

const RC_OK = 0;
const RC_VIOLATION = 1;
const RC_TOOL_BROKEN = 2;

/** 豁免必须自报形态（铁律 0.5 三分法）—— 三者修法完全不同，混了必修错地方。 */
const EXEMPTION_KINDS = new Set(["待修", "误报", "覆盖不到"]);

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 真值源：对象类型 → 属性集合
// ══════════════════════════════════════════════════════════════════════════════
//
// 为什么解析源码而不 import dist：本门要能在**任何**工作树上独立跑（`pnpm gates` 的静态门一族），
// 而 dist 需要先 build。代价是解析可能失配 —— 故 §5 金丝雀用**已知锚点对**自证解析没瞎，
// 且当 dist 恰好存在时做**双源交叉核对**（两条独立路径不一致 ⇒ 判工具坏，不判代码脏）。

/** 从 openIdx（须为 openCh）起做括号配对，返回含两端的整段；跳过字符串字面量。 */
function matchPair(src, openIdx, openCh, closeCh) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  return null;
}

/** 顶层逗号切分实参（忽略嵌套括号与字符串内逗号）。入参含两端圆括号。 */
function splitArgs(callParen) {
  const inner = callParen.slice(1, -1);
  const out = [];
  let depth = 0;
  let inStr = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      cur += c;
      if (c === "\\") { cur += inner[++i] ?? ""; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const propKeysIn = (block) => [...block.matchAll(/propKey:\s*"([^"]+)"/g)].map((m) => m[1]);
/** battery-extended.ts 的简写构造器 `p()/pd()/rd()`，首参即 propKey。 */
const shorthandKeysIn = (block) => [...block.matchAll(/\b(?:p|pd|rd)\(\s*"([^"]+)"/g)].map((m) => m[1]);
const unquote = (s) => (/^"([^"]*)"$/.test(String(s).trim()) ? String(s).trim().slice(1, -1) : null);

/**
 * 建立 `Map<typeKey, Set<propKey>>`。
 * 覆盖三种登记形态（本仓实际存在的全部形态）：
 *   A `plain("Key","名", xProps)` / `plainD("Key","名","描述", xProps)`   —— battery.ts
 *   B `properties: withGovernance("Key", xProps)`                        —— battery.ts 内联对象
 *   C `derivedProperties: xDerived`                                      —— 回溯所属对象字面量的 key
 *   D `def("Key","名","域",[ …内联… ])`                                  —— battery-extended.ts
 */
export function buildUniverse(root) {
  const types = new Map();
  const stats = { arrays: 0, registrations: 0, extendedDefs: 0, sourcesRead: 0 };
  const add = (key, props) => {
    if (!types.has(key)) types.set(key, new Set());
    for (const p of props) types.get(key).add(p);
  };

  const batteryPath = join(root, TYPE_SOURCES[0]);
  if (existsSync(batteryPath)) {
    const b = readFileSync(batteryPath, "utf8");
    stats.sourcesRead++;
    const arrays = new Map();
    for (const m of b.matchAll(/const\s+(\w+)\s*:\s*(?:PropertyDef|DerivedPropertyDef)\[\]\s*=\s*(\[)/g)) {
      const blk = matchPair(b, m.index + m[0].length - 1, "[", "]");
      if (blk) { arrays.set(m[1], propKeysIn(blk)); stats.arrays++; }
    }
    // 形态 A —— 必须**整调用**配对后按顶层实参取，不能用固定字符窗口：
    // 窗口会跨进相邻的 plain(...) 调用，把邻居的属性算到自己头上（本门开发时实测踩过：
    // `Line` 一度吃进 Process/Equipment/Warehouse 的属性，从 11 个膨胀到 54 个）。
    for (const m of b.matchAll(/\bplainD?\(/g)) {
      const call = matchPair(b, m.index + m[0].length - 1, "(", ")");
      if (!call) continue;
      const args = splitArgs(call);
      const key = unquote(args[0] ?? "");
      if (!key) continue;
      for (const a of args.slice(1)) if (arrays.has(a)) { add(key, arrays.get(a)); stats.registrations++; }
    }
    // 形态 B —— 实参自带类型键，无需窗口
    for (const m of b.matchAll(/withGovernance\(\s*"([A-Za-z]\w*)"\s*,\s*(\w+)\s*\)/g)) {
      if (arrays.has(m[2])) { add(m[1], arrays.get(m[2])); stats.registrations++; }
    }
    // 形态 C —— 回溯所属 `{`
    for (const m of b.matchAll(/derivedProperties:\s*(\w+)\b/g)) {
      if (!arrays.has(m[1])) continue;
      let depth = 0;
      let start = -1;
      for (let i = m.index; i >= 0; i--) {
        const c = b[i];
        if (c === "}") depth++;
        else if (c === "{") { if (depth === 0) { start = i; break; } depth--; }
      }
      if (start < 0) continue;
      const km = /key:\s*"([A-Za-z]\w*)"/.exec(b.slice(start, m.index));
      if (km) { add(km[1], arrays.get(m[1])); stats.registrations++; }
    }
  }

  const extPath = join(root, TYPE_SOURCES[1]);
  if (existsSync(extPath)) {
    const e = readFileSync(extPath, "utf8");
    stats.sourcesRead++;
    for (const m of e.matchAll(/\bdef\(/g)) {
      const call = matchPair(e, m.index + m[0].length - 1, "(", ")");
      if (!call) continue;
      const args = splitArgs(call);
      const key = unquote(args[0] ?? "");
      if (!key) continue;
      const arr = args.find((a) => a.startsWith("["));
      if (!arr) continue;
      add(key, [...propKeysIn(arr), ...shorthandKeysIn(arr)]);
      stats.extendedDefs++;
    }
  }

  const propCount = [...types.values()].reduce((a, s) => a + s.size, 0);
  // 另外两个命名空间的真值源（判义用，见 §3.5）——本门**不核**它们，只用来把它们与本体属性区分开。
  const simStateVars = loadSimStateVars(root);
  const ruleScopeKeys = loadRuleScopeKeys(root);
  return { types, stats, propCount, simStateVars, ruleScopeKeys };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 语境判别：描述现状 vs 描述目标（判据 #5）
// ══════════════════════════════════════════════════════════════════════════════
//
// PRD 里的字段引用有两种完全不同的意思：
//   · **断言现状**：「`Order.businessType` 字段存在且正确落值」—— 若字段不存在，这是**缺陷**。
//   · **提议新增**：「建议把 `Metric.businessType` 升为一等字段」—— 字段不存在**正是本 PRD 的理由**，不是缺陷。
// 二者判反了都很贵：把提案判红 ⇒ 门变噪声、被加白名单绕过；把断言判绿 ⇒ 就是 A6 那个漏。
// 故本门**只在语境明确时下结论**，暧昧的一律落 `PDG-5 · 未判定`（不进红、不进棘轮）。

/**
 * **缺失自认**语境（优先级最高）。PRD 自己已经点明「这个字段今天没有」——
 * 这**正是本门想要的行为**，不是缺陷，绝不能判红。
 *
 * ⚠️ 这一档是开发时**实测逼出来的**，不是预先想到的：初版没有它，全仓 3 条 PDG-4 命中
 * （`PRD-ontology-7elements.md:557` `Process.capacity`「属性缺失的具体波及面」/
 * `PRD-sandbox-a2.md:50` `Order.changeoverMin`「无对象承载而 UNRESOLVED」/
 * `PRD-stale-claims.md:82` `Cadence.kind`「今天 `Cadence` 对象 0 条」）
 * **三条全是误报** —— 三句话都在说「它没有」，却因同句里含「复用/来自」等宽泛词被判成断言。
 * 若照初版报出去，就是把「PRD 做对了的地方」当成缺陷报，正是 CLAUDE.md 铁律 0.5 警告的
 * 「拿 grep 的直接命中当结论」。故 ASSERTION_MARKERS 同时删掉了 `复用/来自/取自/读取` 这几个
 * 宽泛词 —— 它们出现在任何句子里都不足以证明「在断言该字段已有」。
 */
const ABSENCE_ACK_MARKERS = [
  "缺失", "无对象承载", "没有对象承载", "无承载", "未承载", "不存在", "没定义", "未定义", "无此字段",
  "缺该字段", "尚未建模", "未建模", "尚无", "0 条", "零条", "无数据", "没数据", "缺数据",
  "UNRESOLVED", "空", "缺口", "待补", "补不上", "查无",
];
/** 提案语境：出现即认为该引用在描述**目标态**，字段不存在属正常。 */
const PROPOSAL_MARKERS = [
  "新增", "建议", "拟增", "拟补", "待建", "补上", "补一个", "需补", "应补", "增补",
  "目标态", "改为", "升为", "提议", "将增", "计划", "后续", "TODO", "绿地", "新建", "本 PRD 建议",
  "需要新增", "引入", "应来自", "应取自", "则来自",
];
/**
 * 断言语境：出现即认为该引用在断言**现状已有**，字段不存在就是缺陷。
 * 只收**强**标记 —— 弱标记（复用/来自/读取）会把「讨论缺口」的句子误判成「断言已有」。
 */
const ASSERTION_MARKERS = [
  "已有", "现有", "字段存在", "已存在", "正确落值", "已落值", "已落库", "已建模",
  "一等字段", "已经有", "既有", "已在册",
];

/**
 * 判定单行/单单元的语境。返回 "acknowledged" | "proposal" | "assertion" | "unknown"。
 * 优先级：缺失自认 > 提案/断言 > 未判定。
 */
export function judgeContext(text) {
  if (ABSENCE_ACK_MARKERS.some((k) => text.includes(k))) return "acknowledged";
  const hasProposal = PROPOSAL_MARKERS.some((k) => text.includes(k));
  const hasAssertion = ASSERTION_MARKERS.some((k) => text.includes(k));
  if (hasProposal && !hasAssertion) return "proposal";
  if (hasAssertion && !hasProposal) return "assertion";
  return "unknown"; // 两者都有 / 都没有 —— 判不准就是判不准
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 《数据承载核对》表解析（精确层）
// ══════════════════════════════════════════════════════════════════════════════

/** 表头识别：模板规定的节标题。 */
const TABLE_SECTION_RE = /数据承载核对/;
/** 「有值」列的判读。表格自己声明状态，故这一层不需要猜语境。 */
const CELL_YES = /✅|√|是|有值|已有|存在/;
const CELL_NO = /❌|✗|×|否|无|不存在|缺/;
/** 行内允许的「本 PRD 拟新增」标记 —— 这类行不参与 PDG-2（它本就该不存在）。 */
const ROW_PLANNED = /新增|拟|待建|本 ?PRD|目标态|绿地|新建/;

/**
 * 解析一份 PRD 里的《数据承载核对》表。
 * 返回 [{ line, type, field, claimsExists, planned, raw }]，无表则空数组。
 */
export function parseGroundingTable(src) {
  const lines = src.split("\n");
  const rows = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l) || /^\*\*.*\*\*\s*$/.test(l)) {
      inSection = TABLE_SECTION_RE.test(l);
      continue;
    }
    if (!inSection) continue;
    if (!l.trim().startsWith("|")) continue;
    const cells = l.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^-+:?$|^:?-+/.test(cells[0])) continue; // 分隔行
    const fieldCell = cells[0];
    const m = /`?([A-Z][A-Za-z0-9]*)\.([A-Za-z_][A-Za-z0-9_]*)`?/.exec(fieldCell);
    if (!m) continue;
    if (/字段|field/i.test(fieldCell) && !m) continue; // 表头行
    const statusCell = cells[1] ?? "";
    const yes = CELL_YES.test(statusCell);
    const no = CELL_NO.test(statusCell);
    if (!yes && !no) continue; // 状态没填 —— 由 PDG-7 另判（见 §4）
    rows.push({
      line: i + 1,
      type: m[1],
      field: m[2],
      claimsExists: yes && !no,
      planned: ROW_PLANNED.test(l),
      raw: l.trim().slice(0, 160),
    });
  }
  return rows;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 「改 X → 结论跟着变」判据的前置声明（WO §4 · PDG-6）
// ══════════════════════════════════════════════════════════════════════════════
//
// A6 的病：判据写「改 `SEG_REGISTRY` 一个值 → 结论跟着变」，而「线属于哪个 seg」这层归属不存在
// ⇒ X 根本影响不到结论，判据**无法失败**。修法不是删判据，是**逼它把前置写出来**：
// 「X 要能影响结论，前置是 Y」，且 Y 自己要有一条能红的判据（本门只能验前半 —— 见《做不到的部分》）。

/** 变量判据的形状：改动某物 → 结论随之变化。 */
const VARIABLE_CRITERION_RE =
  /(改|调整|修改|变更|换)[^。；\n]{0,40}?(一个值|一条|某条|某个|任一|其中一)?[^。；\n]{0,40}?(→|->|则|就|后)[^。；\n]{0,40}?(结论|结果|输出|判断|归因|排序|推荐)[^。；\n]{0,20}?(跟着变|随之变|变化|会变|不同|改变)/;
/** 前置声明的标记 —— 判据里必须点明「Y 成立才谈得上 X 影响结论」。 */
const PRECONDITION_MARKERS = ["前置", "先决", "依赖于", "成立条件", "前提", "先要", "必须先", "承载于", "数据前置"];

/** 找出验收章里形如「改 X → 结论跟着变」但缺前置声明的判据。 */
export function findVariableCriteria(src) {
  const lines = src.split("\n");
  const out = [];
  let inAcceptance = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) {
      inAcceptance = /验收|判据|DoD|Definition of Done|接受标准/i.test(l);
      continue;
    }
    if (!inAcceptance) continue;
    if (!VARIABLE_CRITERION_RE.test(l)) continue;
    // 前置声明允许写在同一条判据的邻近行（表格行 / 列表项常换行续写）
    const windowText = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
    if (PRECONDITION_MARKERS.some((k) => windowText.includes(k))) continue;
    out.push({ line: i + 1, raw: l.trim().slice(0, 160) });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 扫描主逻辑
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 正文里的字段引用：**反引号代码段内**的 `Type.field`（不要求它独占整段 ——
 * 早期版本要求整段完全等于 `Type.field`，于是 `` `Metric.gap → 结构反向分摊…` `` 这种
 * **一整句写在一对反引号里**的写法一条都抓不到，实测漏掉了存量清单 7 条里的数条）。
 * Type 首字母大写且 ≥3 字符（避开 `A.b` 这类章节号）；后跟 `(` 的排除（那是方法调用不是字段）。
 */
const PROSE_REF_RE = /\b([A-Z][A-Za-z0-9]{2,})\.([a-z_][A-Za-z0-9_]*)\b(?!\s*\()/g;
/** 取一行里所有反引号代码段（散文里裸写的 "xx.yy" 不算引用，同本体锚点门的取舍）。 */
const backtickSpans = (line) => (line.match(/`[^`]*`/g) ?? []);

/** 内容锚：豁免锚在**那句话本身**，不锚行号。 */
const sha16 = (s) => createHash("sha256").update(String(s).trim()).digest("hex").slice(0, 16);

// ══════════════════════════════════════════════════════════════════════════════
// § 3.5 · `Type.field` 是**四义词** —— 判义在前，核对在后
// ══════════════════════════════════════════════════════════════════════════════
//
// 本仓 `Type.field` 至少有四种互不相干的意思，**校验强度天差地别**，一视同仁必然
// 同时制造大量误报（把有编译器兜底的 TS 契约类型当本体属性报）和漏报（②③ 的真病放过去）：
//
//   | 义 | 例 | 有无校验 | 本门怎么办 |
//   |---|---|---|---|
//   | ① 本体属性         | `Base.baseId`                          | 有（本体/契约） | **本门的射程**：核对属性表 |
//   | ② **仿真状态变量** | `Base.load` 实为 `targetStateVar:"loadIndex"` | **零校验** | 判为 ②，**不当本体属性报**，另出 `PDG-7` 提示 |
//   | ③ **规则注入命名空间** | `BATTERY_RULE_SCOPES` 的 scope 键（`Batch`/`Cert`/`Lta`…） | **零校验** | 判为 ③，另出 `PDG-8` 提示 |
//   | ④ 前端原型全局 / TS 契约类型 | —                              | 编译器兜底 | LHS 不在本体类型集 ⇒ 天然不进射程 |
//
// ② 有一条已坐实的**静默病**：`readVar`（`apps/datacore/src/sim/propagation.ts`）名字写错
// **静默返 0** —— 不报错、不告警，于是沙盘建出的图**永远不读真实对象属性**。
// 本门**不假装能核 ②③**（它们今天零校验，核它们需要另一套真值源），只做两件事：
// **把它们与 ① 区分开**（避免误报），并**让它们可见**（避免"看不见 = 不存在"）。

/** ② 的真值源：仿真状态变量名（`targetStateVar: "x"`）。 */
function loadSimStateVars(root) {
  const out = new Set();
  for (const rel of ["apps/datacore/src/seed.ts", "apps/datacore/src/sim/propagation.ts"]) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/targetStateVar:\s*"([^"]+)"/g)) out.add(m[1]);
  }
  return out;
}

/** ③ 的真值源：规则注入命名空间的 scope 键（`BATTERY_RULE_SCOPES`）。 */
function loadRuleScopeKeys(root) {
  const out = new Set();
  const p = join(root, TYPE_SOURCES[0]);
  if (!existsSync(p)) return out;
  const src = readFileSync(p, "utf8");
  const i = src.indexOf("BATTERY_RULE_SCOPES");
  if (i === -1) return out;
  const open = src.indexOf("{", i);
  const blk = matchPair(src, open, "{", "}");
  if (!blk) return out;
  for (const m of blk.matchAll(/"([A-Z][A-Za-z0-9]*)"/g)) out.add(m[1]);
  return out;
}

/**
 * 仿真语境标记 —— 只收**强标记**。
 *
 * ⚠️ 这份名单被实测砍过一轮：初版把「沙盘/推演/传导/仿真/tick/扰动」也算进来，结果
 * `Base.weeklyCap`（`PRD-capacity-live-cockpit.md`，本体属性真缺失）与 `Metric.gap`
 * （`PRD-capacity-inference-completion.md`，真名 `delta`/`gapPct`）**双双被误判成仿真状态变量**
 * 而逃出射程 —— 只因那两行里各有一个「推演」。**弱标记在 PRD 正文里到处都是**，
 * 拿它当判义证据，就是「用 X 当作 Y 的证据，而 X 并不度量 Y」（铁律 0.6 的那个形态）。
 * 现只保留**指名道姓提到状态变量机制**的词；判不准的宁可落 `PDG-5` 未判定，也不误判成 ②。
 */
const SIM_CONTEXT_MARKERS = [
  "状态变量", "stateVar", "targetStateVar", "readVar", "PropagationRule", "传导边", "沙盘状态",
];

/**
 * 判 `Type.field` 属于四义中的哪一义。
 * @returns "ontology" | "simStateVar" | "ruleScope" | "outOfRange"
 */
export function judgeSense(type, field, lineText, facts) {
  // ② 优先于 ①：`Base` 既是本体类型又可作沙盘目标，靠**语境 + 状态变量名**区分
  if (facts.simStateVars.has(field) || (SIM_CONTEXT_MARKERS.some((k) => lineText.includes(k)) && !facts.types.get(type)?.has(field))) {
    return "simStateVar";
  }
  if (facts.types.has(type)) return "ontology";
  if (facts.ruleScopeKeys.has(type)) return "ruleScope";
  return "outOfRange"; // ④ TS 契约类型 / 前端全局 / 文件名 —— 有编译器兜底，不属本门风险类
}

/**
 * 判定一份 PRD。**金丝雀与门共用这一个函数** —— 不另抄正则。
 * @returns {{violations: Array, undecided: Array}}
 */
export function judgePrd(file, src, universe) {
  const violations = [];
  const undecided = [];
  const lines = src.split("\n");
  const known = (t) => universe.types.has(t);
  const hasField = (t, f) => universe.types.get(t)?.has(f) ?? false;

  // ── 层 ① 《数据承载核对》表自校验（精确） ──────────────────────────────
  for (const r of parseGroundingTable(src)) {
    const key = `${file}#PDG:${r.type}.${r.field}`;
    if (!known(r.type)) {
      if (!r.planned) {
        violations.push({ file, line: r.line, code: "PDG-3", key,
          detail: `《数据承载核对》表引用未知对象类型 \`${r.type}\`（真值源里没有这个类型），且未标「新建/绿地」`,
          sample: r.raw });
      }
      continue;
    }
    const exists = hasField(r.type, r.field);
    if (r.claimsExists && !exists) {
      violations.push({ file, line: r.line, code: "PDG-1", key,
        detail: `表称 \`${r.type}.${r.field}\` **有值/存在**，但真值源里该字段**不存在**（${r.type} 现有属性：${[...universe.types.get(r.type)].join("/")}）`,
        sample: r.raw });
    } else if (!r.claimsExists && exists && !r.planned) {
      violations.push({ file, line: r.line, code: "PDG-2", key,
        detail: `表称 \`${r.type}.${r.field}\` **不存在**，但真值源里该字段**已经有了** —— 过期声明，把话改对而不是加豁免`,
        sample: r.raw });
    }
  }

  // ── 层 ② 正文引用扫描（先判义 → 再按义核 → 带语境判别 + 棘轮） ─────────
  const facts = { types: universe.types, simStateVars: universe.simStateVars, ruleScopeKeys: universe.ruleScopeKeys };
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    for (const span of backtickSpans(lines[i])) {
      for (const m of span.matchAll(PROSE_REF_RE)) {
        const [, t, f] = m;
        const dedup = `${t}.${f}`;
        if (seen.has(dedup)) continue;

        // ★ 判义在前、核对在后。一视同仁会同时制造误报（把 TS 契约类型当本体属性报）
        //   和漏报（仿真状态变量 / 规则命名空间的真病被当成本体属性放过去）。
        const sense = judgeSense(t, f, lines[i], facts);
        const rec = { file, line: i + 1, sample: lines[i].trim().slice(0, 160) };

        if (sense === "outOfRange") continue; // ④ 有编译器兜底，不属本门风险类

        if (sense === "simStateVar") {
          seen.add(dedup);
          undecided.push({ ...rec, code: "PDG-7", key: `${file}#SIM:${dedup}`,
            detail: `\`${dedup}\` 是**仿真状态变量**（第二命名空间，非本体属性）——本门**不核**它，因为它今天**零校验**：` +
              `\`readVar\` 名字写错**静默返 0**（不报错不告警），沙盘据此建出的图可能永远不读真实对象属性。` +
              `本门只负责**把它与本体属性区分开**（否则会被误报成"字段不存在"）并让它可见；真要核它需另一套真值源与另一道门。` });
          continue;
        }
        if (sense === "ruleScope") {
          seen.add(dedup);
          undecided.push({ ...rec, code: "PDG-8", key: `${file}#SCOPE:${dedup}`,
            detail: `\`${t}\` 是**规则注入命名空间**的 scope 键（\`BATTERY_RULE_SCOPES\`），不是本体对象类型 —— 同样**零校验**，本门不核，仅标注可见。` });
          continue;
        }

        // sense === "ontology" —— 这一路才轮到属性表核对
        if (hasField(t, f)) continue;
        seen.add(dedup);
        const ctx = judgeContext(lines[i]);
        const key = `${file}#REF:${dedup}`;
        if (ctx === "assertion") {
          violations.push({ ...rec, key, code: "PDG-4",
            detail: `正文**断言**\`${dedup}\` 已有，但真值源里该字段不存在（${t} 现有属性：${[...universe.types.get(t)].join("/")}）` });
        } else if (ctx === "unknown") {
          undecided.push({ ...rec, key, code: "PDG-5",
            detail: `\`${dedup}\` 在真值源里不存在，但**判不准**这句是在描述现状还是提议新增 —— 落未判定，不进红` });
        }
        // ctx === "proposal"     ⇒ PRD 在提议新增该字段，正常，不记
        // ctx === "acknowledged" ⇒ PRD 自己已点明「今天没有」，**这正是本门想要的行为**，不记
      }
    }
  }

  // ── 层 ③ 变量判据缺前置声明 ────────────────────────────────────────────
  // key 锚在**判据原文的哈希**上，不锚行号 —— 行号会漂，漂了白名单就变成通行证；
  // 而文案一改哈希即变 ⇒ 豁免当场失效、门重新红（同 check-stale-claims 的锚定纪律）。
  for (const c of findVariableCriteria(src)) {
    violations.push({ file, line: c.line, code: "PDG-6", key: `${file}#VAR:${sha16(c.raw)}`,
      detail: "验收判据形如「改 X → 结论跟着变」却**未声明前置**。A6 的漏就在这里：前置（那层归属关系）不存在时，此判据**无法失败**。补一句「X 要能影响结论，前置是 Y」，并给 Y 自己一条能红的判据。",
      sample: c.raw });
  }

  return { violations, undecided };
}

function listPrds(root) {
  const dir = join(root, DOCS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^PRD-/.test(f) && f.endsWith(".md")).sort();
}

export function scanAll(root) {
  const universe = buildUniverse(root);
  const files = listPrds(root);
  const violations = [];
  const undecided = [];
  for (const f of files) {
    const src = readFileSync(join(root, DOCS_DIR, f), "utf8");
    const r = judgePrd(f, src, universe);
    violations.push(...r.violations);
    undecided.push(...r.undecided);
  }
  return { universe, files, violations, undecided };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · 金丝雀 —— 门自己得先被咬一口
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 必咬样例。**喂给 `judgePrd` 本身**（不是另抄的正则）—— 主逻辑一改，金丝雀立刻跟着变，
 * 这正是 CLAUDE.md 铁律 0.6 要求的「金丝雀必须与主逻辑共用同一份实现」。
 */
const MUST_BITE = [
  {
    name: "A6 原型：表称业务线归属字段有值，实则 Line 无此字段",
    src: "## 3. 数据承载核对\n\n| 字段 | 今天有值吗 | 谁写的 | 覆盖率 |\n|---|---|---|---|\n| `Line.businessType` | ✅ | seed.ts:281 | 12/12 |\n",
    expect: "PDG-1",
  },
  {
    name: "过期声明：表称字段不存在，实则已有",
    src: "## 3. 数据承载核对\n\n| 字段 | 今天有值吗 | 谁写的 | 覆盖率 |\n|---|---|---|---|\n| `Line.utilization` | ❌ 字段不存在 | — | — |\n",
    expect: "PDG-2",
  },
  {
    name: "表引用未知对象类型",
    src: "## 3. 数据承载核对\n\n| 字段 | 今天有值吗 | 谁写的 | 覆盖率 |\n|---|---|---|---|\n| `Sasquatch.legLength` | ✅ | seed.ts:1 | 3/3 |\n",
    expect: "PDG-3",
  },
  {
    name: "正文断言字段已有，实则不存在",
    src: "## 2. 现状\n\n- 现有 `Line.businessType` 字段已正确落值，可直接用于过滤。\n",
    expect: "PDG-4",
  },
  {
    name: "A6 判据：改 X → 结论跟着变，未声明前置",
    src: "## 7. 验收\n\n- 改 `SEG_REGISTRY` 一个值 → 归因结论跟着变。\n",
    expect: "PDG-6",
  },
];

/** 必**不**咬样例。咬了就是噪声门 —— 噪声门会被白名单绕过，等于没有。 */
const MUST_NOT_BITE = [
  {
    name: "提案语境：PRD 正在建议新增该字段",
    src: "## 4. 设计\n\n- 建议给 `Line.businessType` 新增业务线归属字段（本 PRD 目标态）。\n",
  },
  {
    name: "字段真实存在",
    src: "## 2. 现状\n\n- 现有 `Line.utilization` 字段已正确落值。\n",
  },
  {
    name: "表格如实填「不存在」且标了拟新增",
    src: "## 3. 数据承载核对\n\n| 字段 | 今天有值吗 | 谁写的 | 覆盖率 |\n|---|---|---|---|\n| `Line.businessType` | ❌ **字段不存在** | — | — |\n",
  },
  {
    name: "变量判据已声明前置",
    src: "## 7. 验收\n\n- 改 `SEG_REGISTRY` 一个值 → 归因结论跟着变。**前置**：线→seg 归属关系存在（见 §3 承载表）。\n",
  },
  {
    name: "未知类型但标了绿地新建",
    src: "## 3. 数据承载核对\n\n| 字段 | 今天有值吗 | 谁写的 | 覆盖率 |\n|---|---|---|---|\n| `Sasquatch.legLength` | ❌ | 绿地新建 | — |\n",
  },
  // ↓ 以下三条是**生产原文**：初版门在全仓扫出的 3 条 PDG-4 全部是它们，而三条全是误报
  //   （句子都在说「它没有」）。把原文钉成必不咬样例 —— 语境判别若再放宽回去，这里立刻红。
  {
    name: "回归·生产原文：PRD 在讨论该属性缺失的波及面（ontology-7elements:557）",
    src: "## 2. 现状\n\n| **U-6** | ①-c 中 `Process.capacity` 等属性缺失的具体波及面 | `deriveSolverArgs` 作用于 plan 的 objectTypes，是否会撞上出厂本体的 `Process`，取决于 plan 是否复用同名 typeKey |\n",
  },
  {
    name: "回归·生产原文：PRD 点明该字段无对象承载（sandbox-a2:50）",
    src: "## 2. 现状\n\n静态口径为 4（多出的 C22=120 在运行期因 `Order.changeoverMin` 无对象承载而 UNRESOLVED，故实测只见 3）。\n",
  },
  {
    name: "回归·生产原文：PRD 点明今天该对象 0 条（stale-claims:82）",
    src: "## 2. 现状\n\n// 真接引擎后这个值应来自 `Cadence.kind` 实例；今天 `Cadence` 对象 0 条，所以它是 what-if 的一部分。\n",
  },
  // ↓ 四义词判别：②③④ 三义都**不许**被当成「本体属性不存在」报红（一视同仁 = 大量误报）
  {
    name: "判义②：仿真状态变量不许当本体属性报（Base.load 实为 targetStateVar loadIndex）",
    src: "## 2. 现状\n\n- 现有沙盘传导三条边全部指向 `Base.load` 状态变量，已正确落值。\n",
  },
  {
    name: "判义③：规则注入命名空间的 scope 键不许当本体属性报",
    src: "## 2. 现状\n\n- 现有规则 C28 作用域 `Batch.idleDays` 已正确落值。\n",
  },
  {
    name: "判义④：TS 契约类型/前端全局不属射程（有编译器兜底）",
    src: "## 2. 现状\n\n- 现有 `AgentTrace.reflection` 字段已正确落值，前端直接读。\n",
  },
];

/**
 * 判义回归样例（生产原文）：这两条**必须判成 `ontology`**，不许被弱语境词卷进仿真档。
 * 初版因「推演」二字把它们判成 ② 而整个逃出射程 —— 锁在这里，弱标记再被加回来就红。
 */
const SENSE_MUST_BE_ONTOLOGY = [
  {
    name: "Base.weeklyCap（同句含「推演」，但它是本体属性目标不是状态变量）",
    line: "- **活能力①·原子因子活推演**（WO-CAPLIVE-1 引擎）：`targetType/targetProp` 传产能目标（`Base.weeklyCap` 或 `Process.x`）",
    type: "Base",
    field: "weeklyCap",
  },
  {
    name: "Metric.gap（同句含「推演」，真名 delta/gapPct）",
    line: "- **链路**：**归因链**（§3）`Metric.gap → 结构反向分摊` ；**产能推演链** `capacity_forecast(per-base)`",
    type: "Metric",
    field: "gap",
  },
];

/** 已知必中的解析锚点 —— 解析器若瞎了，这两条会立刻不符。 */
const UNIVERSE_ANCHORS = [
  { type: "Line", field: "utilization", expect: true },
  { type: "Line", field: "businessType", expect: false },
  { type: "Order", field: "businessType", expect: true },
  { type: "Metric", field: "key", expect: true },
  { type: "Supplier", field: "transitDays", expect: true },
];

function selftest(universe, fileCount) {
  const blind = [];

  // ① 真值源规模下限：扫空 / 解析失配 ⇒ 报「工具坏了」，不报「代码干净」
  if (universe.stats.sourcesRead < TYPE_SOURCES.length) {
    blind.push(`真值源只读到 ${universe.stats.sourcesRead}/${TYPE_SOURCES.length} 个文件 —— ${TYPE_SOURCES.join(" / ")} 是不是不在？`);
  }
  if (universe.types.size < 60) blind.push(`只解析出 ${universe.types.size} 个对象类型（<60）—— 解析器或源码结构变了，不是本体缩水了`);
  if (universe.propCount < 500) blind.push(`只解析出 ${universe.propCount} 个属性（<500）—— 同上`);
  if (universe.stats.registrations < 50) blind.push(`只匹配到 ${universe.stats.registrations} 处类型登记（<50）—— 登记形态变了`);

  // ② 已知锚点对：解析没瞎的直接证据（也是「报否定结论必须给金丝雀命中证据」的那份证据）
  for (const a of UNIVERSE_ANCHORS) {
    const got = universe.types.get(a.type)?.has(a.field) ?? false;
    if (got !== a.expect) {
      blind.push(`锚点不符：${a.type}.${a.field} 期望 ${a.expect ? "存在" : "不存在"}，实得 ${got ? "存在" : "不存在"} —— 判**工具坏了**`);
    }
  }
  // Line 的属性数是个强锚点（源码里就 11 条）；膨胀 = 窗口越界吃了邻居的属性（开发时真踩过）
  const lineProps = universe.types.get("Line");
  if (lineProps && (lineProps.size < 8 || lineProps.size > 20)) {
    blind.push(`Line 属性数 ${lineProps.size} 不在 [8,20] —— 极可能是调用配对越界，把邻居类型的属性算进来了`);
  }

  // ③ PRD 扫描规模下限
  if (fileCount !== null && fileCount < 50) {
    blind.push(`只扫到 ${fileCount} 份 PRD（<50）—— docs/ 是不是没读到？`);
  }

  // ③.5 判义回归：生产原文必须判成 ontology，不许被弱语境词卷进仿真档
  const senseFacts = { types: universe.types, simStateVars: universe.simStateVars, ruleScopeKeys: universe.ruleScopeKeys };
  for (const c of SENSE_MUST_BE_ONTOLOGY) {
    const got = judgeSense(c.type, c.field, c.line, senseFacts);
    if (got !== "ontology") {
      blind.push(`判义回归「${c.name}」判成了 "${got}"，应为 "ontology" —— 弱语境词又被加回 SIM_CONTEXT_MARKERS 了？`);
    }
  }
  if (universe.simStateVars.size < 5) blind.push(`仿真状态变量真值源只读到 ${universe.simStateVars.size} 个（<5）—— 判义②这一档等于没开`);
  if (universe.ruleScopeKeys.size < 5) blind.push(`规则命名空间真值源只读到 ${universe.ruleScopeKeys.size} 个（<5）—— 判义③这一档等于没开`);

  // ④ 必咬 / 必不咬 —— 走 judgePrd 主逻辑
  for (const c of MUST_BITE) {
    const codes = judgePrd("canary.md", c.src, universe).violations.map((v) => v.code);
    if (!codes.includes(c.expect)) {
      blind.push(`必咬样例「${c.name}」没被咬（期望 ${c.expect}，实得 ${codes.join(",") || "无"}）`);
    }
  }
  for (const c of MUST_NOT_BITE) {
    const codes = judgePrd("canary.md", c.src, universe).violations.map((v) => v.code);
    if (codes.length > 0) blind.push(`必不咬样例「${c.name}」被误咬（${codes.join(",")}）`);
  }

  // ⑤ 双源交叉核对：dist 恰好存在时，两条独立路径必须一致
  //    （不一致 ⇒ 判工具坏，不判代码脏。dist 不在则跳过 —— 本门不强制 build。）
  return blind;
}

async function crossCheckWithDist(universe) {
  const distBattery = join(REPO_ROOT, "apps/datacore/dist/synthetic/battery.js");
  const distExt = join(REPO_ROOT, "apps/datacore/dist/synthetic/battery-extended.js");
  if (!existsSync(distBattery) || !existsSync(distExt)) return { ran: false, mismatches: [] };
  try {
    const { batteryObjectTypes } = await import(distBattery);
    const { extendedObjectTypes } = await import(distExt);
    const distTypes = new Map();
    for (const t of [...batteryObjectTypes(), ...extendedObjectTypes()]) {
      const s = distTypes.get(t.key) ?? new Set();
      for (const p of t.properties ?? []) s.add(p.propKey);
      for (const p of t.derivedProperties ?? []) s.add(p.propKey);
      distTypes.set(t.key, s);
    }
    const mismatches = [];
    for (const [k, s] of distTypes) {
      const mine = universe.types.get(k);
      if (!mine) { mismatches.push(`类型 ${k} 源码解析漏了（dist 有）`); continue; }
      for (const p of s) if (!mine.has(p)) mismatches.push(`${k}.${p} 源码解析漏了（dist 有）`);
    }
    return { ran: true, mismatches: mismatches.slice(0, 20), total: mismatches.length };
  } catch (err) {
    return { ran: false, mismatches: [], error: String(err?.message ?? err) };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// § 7 · 主流程
// ══════════════════════════════════════════════════════════════════════════════

/**
 * RC=2 的**唯一出口**。
 *
 * ⚠️ 这里刻意写**字面量 `2`** 而不是 `RC_TOOL_BROKEN`，原因不是风格：
 * `check-gate-exit-discipline.mjs`（守门的门）判「有没有 RC=2 出口」是**静态**看
 * `process.exit(2)` 这个字面形，它不解析 `const RC_TOOL_BROKEN = 2` 这层常量绑定 ——
 * 于是本门原版（全部写 `process.exit(RC_TOOL_BROKEN)`）被判成「① 无 RC=2 出口：
 * 全文件找不到 process.exit(2)」。**门确实有 RC=2 的能力，是守门的门看不见。**
 * 记在门账 provenRed.note_rc2_retrofit 里，并作为「守门的门」的已知盲点上报。
 */
function toolBroken(blind) {
  console.error("⛔ 门自己瞎了（金丝雀未被咬 / 真值源规模异常）—— **这不是「PRD 干净」**：");
  for (const b of Array.isArray(blind) ? blind : [String(blind)]) console.error(`   · ${b}`);
  console.error("   修门，别改结论。（退出码 2 = 工具坏了，不许据此报干净）");
  process.exit(2); // = RC_TOOL_BROKEN，字面量写法见上方注释
}

/* ── 顶层兜底：必须覆盖「后面任何一行崩了」──────────────────────────────────
 *
 * 本门原版有 `toolBroken()`、也把已知环境失败（基线缺失 / 参数打错 / 金丝雀不符）
 * 都走了它，**但没有顶层兜底** —— 收编时被 `check-gate-exit-discipline.mjs` 咬出。
 * node 对未捕获异常一律退 **1**，恰好撞上本门「真有新增违规」那个码 ⇒
 * 「门自己崩了」被读成「PRD 有数据承载问题」。
 * 照铁律 0.6 句式：**「我用『进程非 0 退出』当作『PRD 违规』的证据，而前者并不度量后者。」**
 * `main()` 是 async，故同时挂 unhandledRejection（await 里抛出走这条）。
 */
process.on("uncaughtException", (e) =>
  toolBroken([`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join(" / ")]),
);
process.on("unhandledRejection", (e) =>
  toolBroken([`未预期 Promise 拒绝（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join(" / ")]),
);

async function main() {
  const argv = process.argv.slice(2);

  const explainIdx = argv.indexOf("--explain");
  if (explainIdx !== -1) {
    const target = argv[explainIdx + 1];
    if (!target) { console.error("用法：--explain <PRD 文件名>"); process.exit(RC_TOOL_BROKEN); }
    const universe = buildUniverse(REPO_ROOT);
    const path = join(REPO_ROOT, DOCS_DIR, target);
    if (!existsSync(path)) { console.error(`找不到 ${path}`); process.exit(RC_TOOL_BROKEN); }
    const r = judgePrd(target, readFileSync(path, "utf8"), universe);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const universe = buildUniverse(REPO_ROOT);

  if (argv.includes("--selftest")) {
    const blind = selftest(universe, null);
    const cross = await crossCheckWithDist(universe);
    if (cross.ran && cross.total > 0) {
      blind.push(`双源交叉核对不一致 ${cross.total} 条（源码解析 vs dist），前 ${cross.mismatches.length} 条：${cross.mismatches.join("；")}`);
    }
    if (blind.length > 0) toolBroken(blind);
    console.log(
      `✅ 金丝雀：${MUST_BITE.length} 条必咬全中 · ${MUST_NOT_BITE.length} 条必不咬全放过 · ` +
        `${UNIVERSE_ANCHORS.length} 个锚点相符 · 真值源 ${universe.types.size} 类型 / ${universe.propCount} 属性 · ` +
        `双源交叉核对${cross.ran ? "已跑，一致" : "跳过（dist 未 build，不强制）"}`,
    );
    return;
  }

  const { files, violations, undecided } = scanAll(REPO_ROOT);

  const blind = selftest(universe, files.length);
  if (blind.length > 0) toolBroken(blind);

  if (argv.includes("--list")) {
    console.log(JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      universe: { types: universe.types.size, props: universe.propCount },
      files: files.length,
      violationCount: violations.length,
      undecidedCount: undecided.length,
      violations,
      undecided,
    }, null, 2));
    return;
  }

  // ── 棘轮 ──────────────────────────────────────────────────────────────────
  const baselinePath = join(REPO_ROOT, BASELINE_PATH);
  if (!existsSync(baselinePath)) {
    console.error(`⛔ 基线文件缺失：${BASELINE_PATH} —— 门无法判定棘轮，判工具坏。`);
    process.exit(RC_TOOL_BROKEN);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

  // ── 裁定（adjudicated）：把人已经判定过的「未判定」升为红 ────────────────────
  // 本门对语境判不准时落 PDG-5 未判定（判据 #5：不硬塞进红）。但「未判定」若永远只是
  // 一条提示，人工审计的结论就**没有任何机械约束力** —— WO-PRD-FIELD-AUDIT 逐条读过原文、
  // 判定它们是「现状口吻 + 字段真不存在」，这个判断必须能落到门上，否则下次照样漂回去。
  // 机制：基线里列出被裁定为真缺陷的 key ⇒ 本门把它从 undecided **升级为 violation**；
  // 随后它要么被修（key 消失 ⇒ 棘轮回弹提示删除），要么带 kind:"待修" 挂在豁免里当**可见的债**。
  const adjudicated = new Set(baseline.adjudicated ?? []);
  const promoted = [];
  const stillUndecided = [];
  for (const u of undecided) {
    if (adjudicated.has(u.key)) {
      promoted.push({ ...u, code: "PDG-4A", detail: `【已裁定为真缺陷】${u.detail}` });
    } else stillUndecided.push(u);
  }
  violations.push(...promoted);
  undecided.length = 0;
  undecided.push(...stillUndecided);
  // 裁定表里指向已不存在的 key ⇒ 也要报，否则裁定会变成一张烂账
  const usedAll = new Set([...violations, ...undecided].map((v) => v.key));
  const staleAdjudications = [...adjudicated].filter((k) => !usedAll.has(k));

  const allowed = new Map((baseline.exemptions ?? []).map((e) => [e.key, e]));
  const fresh = violations.filter((v) => !allowed.has(v.key));
  const usedKeys = new Set(violations.map((v) => v.key));
  const stale = (baseline.exemptions ?? []).filter((e) => !usedKeys.has(e.key));

  console.log(
    `扫描：${files.length} 份 PRD · 真值源 ${universe.types.size} 类型 / ${universe.propCount} 属性 · ` +
      `违规 ${violations.length} 条（豁免 ${baseline.exemptions.length} / 上限 ${baseline.maxExemptions}）· 未判定 ${undecided.length} 条`,
  );

  let bad = false;
  if (fresh.length > 0) {
    bad = true;
    console.error(`\n❌ 新增 PRD 数据承载违规 ${fresh.length} 条：`);
    for (const v of fresh) {
      console.error(`   docs/${v.file}:${v.line}  [${v.code}]`);
      console.error(`      ${v.detail}`);
      console.error(`      原文：${v.sample}`);
    }
    console.error("\n   修法：");
    console.error("     · PDG-1/4：字段真不存在 ⇒ 要么把 PRD 改成「本 PRD 新增该字段」，要么先补数据。**不要改判据措辞绕过**。");
    console.error("     · PDG-2  ：上游已经补齐了 ⇒ **把话改对**，不要加豁免。");
    console.error("     · PDG-3  ：未知对象类型 ⇒ 标明「绿地新建」，或改成真实类型键。");
    console.error("     · PDG-6  ：补一句「X 要能影响结论，前置是 Y」，并给 Y 自己一条能红的判据。");
  }
  if (stale.length > 0) {
    bad = true;
    console.error(`\n❌ 棘轮回弹：${stale.length} 条豁免已匹配不到任何违规（PRD 改过了？）—— 请从 ${BASELINE_PATH} 删掉，让上限跟着降：`);
    for (const e of stale) console.error(`   ${e.key}  —— ${e.why}`);
  }
  if (staleAdjudications.length > 0) {
    bad = true;
    console.error(`\n❌ 裁定表烂账：${staleAdjudications.length} 条 adjudicated key 已匹配不到任何命中（PRD 改过了？）—— 从 ${BASELINE_PATH} 的 adjudicated 里删掉：`);
    for (const k of staleAdjudications) console.error(`   ${k}`);
  }
  if ((baseline.exemptions?.length ?? 0) !== baseline.maxExemptions) {
    bad = true;
    console.error(
      `\n❌ 棘轮失守：maxExemptions=${baseline.maxExemptions} 与实际豁免数 ${baseline.exemptions.length} 不等。` +
        `\n   这个数必须**恒等于**豁免条数 —— 加一条豁免就得同时改这个数，让它在 diff 里躲不掉。`,
    );
  }
  if ((baseline.exemptions?.length ?? 0) > baseline.ratchetHigh) {
    bad = true;
    console.error(
      `\n❌ 棘轮回升：豁免数 ${baseline.exemptions.length} 超过历史最高水位 ratchetHigh=${baseline.ratchetHigh}。` +
        `\n   ratchetHigh **只降不升**。评审唯一必须拒绝的一行，就是把它调大。`,
    );
  }
  const noReason = (baseline.exemptions ?? []).filter((e) => typeof e.why !== "string" || e.why.trim().length < 10);
  if (noReason.length > 0) {
    bad = true;
    console.error(`\n❌ ${noReason.length} 条豁免没写理由（why < 10 字）—— 无理由白名单本身就是本门要治的病。`);
    for (const e of noReason) console.error(`   ${e.key}`);
  }
  const noOwner = (baseline.exemptions ?? []).filter((e) => typeof e.prd !== "string" || e.prd.trim().length === 0);
  if (noOwner.length > 0) {
    bad = true;
    console.error(`\n❌ ${noOwner.length} 条豁免没写归属 PRD（prd 字段）—— 无归属的豁免没人认领，等于永久通行证。`);
    for (const e of noOwner) console.error(`   ${e.key}`);
  }
  // 三分法强制：豁免必须自报是「债」还是「误报」还是「真值源覆盖不到」——三者修法完全不同（铁律 0.5）。
  // 不强制的话，一句「已知此坑」就能把真缺陷和假命中混成一锅，而这正是本门要治的病的元形态。
  const badKind = (baseline.exemptions ?? []).filter((e) => !EXEMPTION_KINDS.has(e.kind));
  if (badKind.length > 0) {
    bad = true;
    console.error(
      `\n❌ ${badKind.length} 条豁免的 kind 非法（只许 ${[...EXEMPTION_KINDS].join(" | ")}）——` +
        `\n   「待修」是债、「误报」该修门、「覆盖不到」是真值源边界，三者修法完全不同，不许混为一谈。`,
    );
    for (const e of badKind) console.error(`   ${e.key}  kind="${e.kind ?? ""}"`);
  }

  if (bad) {
    console.error("\n❌ prd-data-grounding:check 未通过");
    process.exit(RC_VIOLATION);
  }
  console.log(
    `✅ prd-data-grounding:check 通过（金丝雀 ${MUST_BITE.length}+${MUST_NOT_BITE.length} 条全中 · ` +
      `${UNIVERSE_ANCHORS.length} 锚点相符 · 无新增违规 · 棘轮 ${baseline.exemptions.length}/${baseline.maxExemptions}）`,
  );
  if (undecided.length > 0) {
    console.log(`   ℹ️ 另有 ${undecided.length} 条**未判定**（判不准是现状还是提案，按判据 #5 不进红）：\`--list\` 可看全表。`);
  }
}

/** 故障注入开关：只给自检用，**机械验证**「环境故障 ⇒ RC=2」这条路径真的成立。 */
if (process.env.PRD_GROUNDING_FORCE_TOOL_BROKEN === "1") {
  toolBroken(["（故障注入）模拟真值源塌陷", "这是自检在验「环境故障 ⇒ RC=2」这条路径。"]);
}

if (process.argv[1] && process.argv[1].endsWith("check-prd-data-grounding.mjs")) {
  // 顶层 `.catch()` 兜底（三种合法形态之一）：async main 的同步抛出与 reject 都归 RC=2。
  await main().catch((e) =>
    toolBroken([`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join(" / ")]),
  );
}

/**
 * ── 《本门做不到的部分》（诚实边界，不圆场）──────────────────────────────────
 *
 * 1. **只认反引号包裹的 `Type.field`**。PRD 里写「产线的业务线归属字段」这种纯中文表述，
 *    本门一个字都看不见。治的是**有形的字段引用**这一族，不是全部数据前置缺失。
 *    ——「我没找到」和「它不存在」是两个不同的命题，本门只承担前者。
 *
 * 2. **真值源只覆盖合成种子声明的对象类型**（`battery.ts` + `battery-extended.ts`）。
 *    连接器映射进来的外部字段、运行期动态建模（A3 半自动建模）产生的属性，本门看不见 ⇒
 *    可能把**真实存在**的字段误判成不存在。故 PDG-4 只在**断言语境**下红，且带棘轮；
 *    暧昧的一律落 PDG-5 未判定。误报的修法是加豁免并写明「真值源覆盖不到」。
 *
 * 2.5 **本门只核四义中的第 ①义（本体属性）**。②仿真状态变量 与 ③规则注入命名空间
 *    **今天零校验**，本门**明确做不到**核它们 —— 核 ② 要能把 `Base.load` 这样的写法解析到
 *    `targetStateVar` 注册表并验证 `readVar` 真读得到（那是运行态的活，且 `readVar` 名字写错
 *    **静默返 0**，静态扫描看不出后果）；核 ③ 要能把 scope 键映射到注入命名空间的真实结构。
 *    本门只把它们**与①区分开并标注可见**（`PDG-7`/`PDG-8`），**不假装核过**。
 *    判义本身也是启发式（状态变量名表 + 强语境词），判错时倾向于落未判定而非误判。
 *
 * 3. **`derivedProperties` 只解析静态数组字面量**。运行期计算出的派生属性不在册。
 *
 * 4. **语境判别是关键词启发式**，不是语义理解。一句同时含「已有」和「新增」的话会落
 *    未判定（保守），一句反讽或条件句可能判错。**故本门的红只在语境明确时给出**，
 *    且 PDG-4 全部可豁免；真正零启发式、可当硬判据用的只有层 ①（表格自校验）。
 *
 * 5. **PDG-6 只验「有没有声明前置」，验不了「声明的前置对不对」。**
 *    这是本门最弱的一层，必须讲清楚：它能逼出 A6 那句缺失的话，但**挡不住**有人写一句
 *    敷衍的「前置：数据齐备」来过门。要挡住后者，需要把前置 Y 也写成 `Type.field` 形态
 *    再交给层 ① 核对 —— 那需要模板层面的强约束（《数据承载核对》表就是为此存在），
 *    本门只能鼓励、不能强制。**声明「做得到」的部分到此为止，再往前是人的判断，不是机器的。**
 *
 * 6. **不验「覆盖率」列的数字**。表里写 `12/12` 而实际 3/12，本门看不出来 ——
 *    要验它得真跑一次种子并计数，那是运行态的活，不是静态门的活。
 *    本门只验**存在性**这一层（三态里的「字段不存在」与「字段已有」），
 *    「字段在但恒空」那一态本门**判不了**，需靠人填表时如实写 `谁写的` 列。
 */
