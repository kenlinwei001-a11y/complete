#!/usr/bin/env node
/**
 * 门 `md-section-dup`（**无 pnpm 别名**，只经 `pnpm gates` 链跑；门账 `alias:null`）
 * · **受治理 Markdown 的同名小节门**（WO-DOCTRINE-WRITEBACK · 开 `G-MD-SECTION-DUP`）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 本仓有一批 md 文件是**门的输入**（判据表、明账、棘轮快照都写在里面），门用
 * `section(md, "### 4.3")` 这类**按标题取小节**的方式读它们。而全仓四处 `section()` 实现
 * （`check-harness-ux-splitaccount.mjs` / `check-sim-ux-criteria.mjs` / `check-prd-ontology.mjs` /
 * `check-ontology-anchors.mjs`）用的都是 `lines.findIndex(l => l.trim().startsWith(heading))`
 * —— **`findIndex` 只取第一个**。
 *
 * **2026-08-16 实测的现场**：合并时 `docs/PRD-harness-ux-adoption.md` 的 `### 4.3` 被并集
 * **复制成了两个**，第一个恰好是空的那版。读它的门取到第一个 ⇒ 看不见第二节里的 8 行登记 ⇒
 * 判据当场红。红得还算幸运 —— 若两节内容颠倒（第一个有内容、第二个才是新写的），
 * 门会**静默读旧账并报绿**，那才是真正的假绿。
 *
 * **JSON 那边早有重复键检查**（`gate-ledger:check` 抓过 `package.json` 里两个 `"gates"` 键，
 * `JSON.parse` 只取最后一个、文件却完全合法），**Markdown 同名小节这边一道门都没有**。本门补这一道。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『按标题取到的那一节』当作『文档里那一节』的证据，而前者并不度量后者 ——
 *     标题重复时，它只度量了排在最前面的那一个。」**
 *
 * ══ 两条判据（任一成立即 RC=1）══════════════════════════════════════════════════
 *  ① **DUP 同名重复**：同一文件内，同一标题层级下，**同一个小节标识**出现 ≥2 次。
 *     标识的取法**刻意跟着读者走**（读者按 `startsWith(heading)` 匹配）：
 *       · 标题以章节号开头（`4.3` / `7.` / `3b` / `1)`）⇒ 标识 = (层级, 章节号)
 *         —— 因为门锚的就是 `### 4.3`，标题后面那几个字它根本不看。
 *       · 否则 ⇒ 标识 = (层级, 归一化后的标题全文)。
 *     `## 3` 与 `## 3b` 是**两个不同的号**，不算重复（章节号必须整段匹配到边界，
 *     否则 `3b` 会被读成 `3` —— 首版原型就在 `docs/AUDIT-name-consistency.md` 上误报过这一条）。
 *  ② **AMB 前缀歧义**：同层级下，某标题的归一化全文是另一标题的**严格前缀**
 *     （`### 4.3` 与 `### 4.3 登记表`）。这不是重复，但 `startsWith` 一样会撞：
 *     门锚 `### 4.3` 时两行都匹配，取到哪个纯看谁在前面。**建门当日全仓实测 0 条**，
 *     故从干净基线起零容忍 —— 零容忍只有在基线干净时装得上，往后再装就得先还债。
 *
 * ══ 受检文件集：**现算，一个文件名都不写死** ═══════════════════════════════════
 * 本仓断点 `G-GATE-ROSTER-HANDCOPIED` 正是治「把受检对象集合手抄进门源码」：不在名单里的
 * 对象永远绿。故本门的受检集从**「有门在读它」这个事实**现算：
 *   `listGateScripts()`（门名册本身也是现算的）→ 每个门源码过 `lex()` →
 *   **只取字符串字面量里**的 `docs/….md`（注释/散文里提一嘴的不算）→ 过滤成磁盘上真存在的文件。
 * 建门当日现算 **15 个文件**（`docs/SYSTEM-ONTOLOGY.md` 被 11 道门读，最热）。
 * 新加一道门去读一份新 md ⇒ 它**自动**进受检集，不需要任何人记得来改这里。
 *
 * ══ 金丝雀的三层（照 CLAUDE.md 铁律 0.7 逐层各配一件，缺一层就是缺一层）═══════════
 *  **① 扫描面**：金丝雀证明的是工具没瞎，**不是扫描面选对了**。故另有 `proveScanSurface()`：
 *     受检集必须含两个**已知必在**的锚（`docs/SYSTEM-ONTOLOGY.md` 与本门来历所在的
 *     `docs/PRD-harness-ux-adoption.md`），且文件数 / 标题总数不得低于下界。不满足 ⇒ RC=2。
 *     没有这一层，抽取器把 `docs/` 写成 `doc/` 也能报「全仓干净」。
 *  **② 覆盖率**：金丝雀全中不保证抽取器抽全了。故用**独立口径对总数**：
 *     裸行计数（`^#{1,6}\s`，与围栏解析器完全无关的另一条代码路径）必须逐文件满足
 *     **裸 = 留下 + 围栏内被抑制**。差额必须被**解释干净**，剩一条都算解析器在我不知道的地方
 *     丢了标题 ⇒ RC=2。建门当日实测：裸 485 = 留 477 + 围栏内 8，恒等成立。
 *     ⚠ **这条对账在今天的生产语料上是半瞎的，必须说清楚**：语料里 6 级标题 **0 条**、
 *     `~~~` 围栏 **0 处**，两个口径唯一会分歧的地方生产上一次都走不到。实测反证：把解析正则
 *     从 `#{1,6}` 改窄成 `#{1,5}`（= 静默丢掉所有 6 级标题），**15 份文档守恒照样成立、门照样绿**。
 *     所以真正让这条判据活着的不是生产数字，是金丝雀里那条「6 级标题」——它把分歧路径在样例里走一遍。
 *     **拿 485=477+8 当「覆盖全了」的证据，本身就是本门要治的那个病。**
 *  **③ 样例形状**：手写样例可能与生产形状**交集为空**（factlock 门 13 条金丝雀全是单行无尾逗号的
 *     手写样例，与 prettier 格式化后的生产形状一个都对不上，站点被静默跳过而门照绿）。
 *     故金丝雀里有 `real:` 一档：直接拿仓里**真文件**跑主逻辑并断言已知为真的事实。
 *     另打印「围栏抑制是否被生产文档真正触发过」——若全仓无一处触发，围栏逻辑就只有手写样例在验它。
 *
 * ══ 诚实边界（不许读成「全仓 md 无重复小节」）════════════════════════════════════
 *  · 本门只看**有门在读**的那 15 个 md。`docs/` 下另外几百份 PRD/WO/AUDIT **不在扫描面内**，
 *    它们重复了本门看不见 —— 但也没有门会因此误读，所以这个边界是刻意的，不是漏。
 *  · 本门只看 **ATX 标题**（`#` 开头）。Setext 标题（下一行 `===` / `---`）看不见；
 *    本仓 15 个受检文件里 Setext 用量为 0，故不实现，写在这里以免读者以为覆盖了。
 *  · 本门只看**标题**。§8 那张断点表里的**同名表行**（实测 `G-BE-FE-SEAM-DEAD` 出现 3 次）
 *    是同一族病的**行粒度**形态，本门量不到 —— 那要按「表的主键列」判，属另一道门。
 *  · 围栏未闭合的文件**不报绿，报 RC=2**：围栏一旦没闭，其后所有标题都被当成代码块内容抑制掉，
 *    「我没找到」会被读成「它不存在」。
 *
 * ══ 退出码三分（`docs/SOP-reviewer-claim-discipline.md` §3）════════════════════
 *   0 = 干净 · 1 = **真有重复/歧义**（改文档） · 2 = **工具自己坏了**（只许说「我没查出来」）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-MD-SECTION-DUP`（本门所治断点）。
 * 用法：
 *   node scripts/check-md-section-dup.mjs             # 门（0 干净 / 1 有违规 / 2 工具坏了）
 *   node scripts/check-md-section-dup.mjs --census    # 现算受检集全表（含每份的标题计数）
 *   node scripts/check-md-section-dup.mjs --selftest  # 只跑金丝雀（含 real: 生产形状档）
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "./lib/source-lex.mjs";
import { listGateScripts } from "./gate-census.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* 扫描面下界（判据①的保命线）。枚举器一坏集合就变空 ⇒ 差集恒空 ⇒ 门恒绿且一声不吭。
 * 建门当日实测：受检文件 15 · 裸标题 485。下界取实测的六成，留出正常增删的余量。 */
const MIN_GOVERNED_DOCS = 9;
const MIN_TOTAL_HEADINGS = 250;

function toolBroken(what, detail = "") {
  console.error(`⛔ md-section-dup:check **工具坏了**：${what}`);
  console.error("   本次结论作废：**不许**读作「受治理文档没有重复小节 / 通过」——本门这次什么都没证明。");
  if (detail) console.error("   " + String(detail).split("\n").slice(0, 6).join("\n   "));
  process.exit(2);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 判据本体 —— 金丝雀与主扫描调的是**下面这几个函数**，不许各抄一份
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 一行长得像 ATX 标题吗（裸口径：与围栏解析器无关的独立代码路径，用于②的守恒对账）。 */
export const looksLikeHeading = (line) => /^#{1,6}\s/.test(line);

/** 围栏起止行（``` 或 ~~~，最多缩进 3 空格；info string 随意）。 */
const fenceCharOf = (line) => {
  const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  return m ? m[1][0] : null;
};

/**
 * 抽 ATX 标题，**跳过代码围栏内的行**。
 * @returns {{headings:Array<{line:number,level:number,text:string}>, naive:number, suppressed:number, unclosedFence:boolean}}
 */
export function mdHeadings(md) {
  const lines = md.split("\n");
  const headings = [];
  let fence = null, naive = 0, suppressed = 0;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const isH = looksLikeHeading(L);
    if (isH) naive++;
    const fc = fenceCharOf(L);
    if (fc) {
      if (!fence) fence = fc;
      else if (fc === fence) fence = null;
      continue; // 围栏行本身既不是标题也不计抑制（它匹配不上 `^#`）
    }
    if (fence) { if (isH) suppressed++; continue; }
    if (!isH) continue;
    const m = L.match(/^(#{1,6})\s+(.*)$/);
    if (!m) continue; // `###` 后面只有空白 —— 无标题文本，不当小节
    headings.push({ line: i + 1, level: m[1].length, text: m[2] });
  }
  return { headings, naive, suppressed, unclosedFence: fence !== null };
}

/** 标题文本归一：去尾部 `#`、去强调/反引号、压空白。**大小写不动**（本仓标题以中文为主）。 */
export const normHeading = (t) => t.replace(/#+\s*$/, "").replace(/[*`~_]/g, "").replace(/\s+/g, " ").trim();

/**
 * 章节号：必须**整段匹配到边界**，否则 `3b` 会被读成 `3`、`4.30` 会被读成 `4.3`。
 * 允许 `4.3` / `7.` / `3b` / `1)` 这几种本仓真实出现过的写法。
 */
const SECTION_NO_RE = /^(\d+(?:\.\d+)*[a-zA-Z]?)(?=[\s·.、,:：)）]|$)/;

/** 小节标识 —— **跟着读者的匹配方式走**（读者按 `startsWith("### 4.3")` 取节）。 */
export function headingKey(h) {
  const n = normHeading(h.text);
  const m = n.match(SECTION_NO_RE);
  return `${"#".repeat(h.level)} ${m ? m[1] : n}`;
}

/** 归一化后的整行标题（判据②前缀歧义用的口径，与读者传给 `section()` 的实参同形）。 */
const fullKey = (h) => `${"#".repeat(h.level)} ${normHeading(h.text)}`;

/**
 * 主判据：一份 md 里的重复小节与前缀歧义。
 * @returns {{dup:Array, amb:Array, stat:{naive:number,kept:number,suppressed:number,unclosedFence:boolean}}}
 */
export function findSectionDupes(md) {
  const { headings, naive, suppressed, unclosedFence } = mdHeadings(md);

  const byKey = new Map();
  for (const h of headings) {
    const k = headingKey(h);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(h);
  }
  const dup = [];
  for (const [key, hs] of byKey) if (hs.length > 1) dup.push({ key, hits: hs });

  // 前缀歧义：同层级，A 的全文是 B 全文的**严格**前缀 ⇒ 锚 A 时两行都匹配
  const amb = [];
  for (let i = 0; i < headings.length; i++) {
    for (let j = 0; j < headings.length; j++) {
      if (i === j || headings[i].level !== headings[j].level) continue;
      const a = fullKey(headings[i]), b = fullKey(headings[j]);
      if (b.length > a.length && b.startsWith(a)) amb.push({ anchor: a, shadowed: b, at: headings[i].line, by: headings[j].line });
    }
  }
  return { dup, amb, stat: { naive, kept: headings.length, suppressed, unclosedFence } };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 受检文件集 —— 现算（**一个文件名都不写死**，见文件头「受检文件集」一节）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 后置断言挡住**前缀截断**：`.mdx` 结尾的路径不许被截成 `.md` 读进来
 *  （首版原型没有这个断言，`check-wo-anchors.mjs` 里那个 `mdx` 金丝雀样例当场被误抽成一份不存在的 md）。 */
const DOC_PATH_RE = /docs\/[A-Za-z0-9._/-]+\.md(?![A-Za-z0-9])/g;

/**
 * 现算：哪些 md 有门在读。
 * @returns {{docs:Array<{path:string,readers:string[]}>, rawOnly:string[], gateCount:number}}
 *  - `docs`：字符串字面量里出现 **且** 磁盘上存在的（= 真受治理）
 *  - `rawOnly`：只在注释/散文里被提到、代码里没出现的（②覆盖率对账用，不受检）
 */
export function governedDocs() {
  const gates = listGateScripts();
  const inCode = new Map();   // path -> Set<gate file>
  const inRaw = new Set();    // 不分代码/注释的裸口径（独立于 lex 的另一条路径）
  for (const f of gates) {
    const p = join(ROOT, "scripts", f);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(DOC_PATH_RE)) inRaw.add(m[0]);
    for (const s of lex(src).strings) {
      for (const m of s.value.matchAll(DOC_PATH_RE)) {
        if (!inCode.has(m[0])) inCode.set(m[0], new Set());
        inCode.get(m[0]).add(f);
      }
    }
  }
  const docs = [...inCode.keys()]
    .filter((rel) => existsSync(join(ROOT, rel)))
    .sort()
    .map((rel) => ({ path: rel, readers: [...inCode.get(rel)].sort() }));
  const rawOnly = [...inRaw].filter((r) => !inCode.has(r)).sort();
  return { docs, rawOnly, gateCount: gates.length, codeSet: new Set(inCode.keys()) , rawSet: inRaw };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 · 三层（层①扫描面 / 层②覆盖率 / 层③样例形状）—— 全部复用上面的函数
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 手写样例（放在函数体内是刻意的：门源码**顶层**的写死集合归 `gate-roster:check` 管，
 *  金丝雀夹具属「判据本体」，但没必要为它去占一条定性账）。 */
function canarySamples() {
  return [
    {
      name: "必咬·同一个 `### 4.3` 复制成两节（本门来历那个现场）",
      md: "# T\n\n### 4.3 登记\n\n内容甲\n\n### 4.3 登记\n\n内容乙\n",
      expect: (r) => r.dup.length === 1 && r.dup[0].key === "### 4.3" && r.dup[0].hits.length === 2,
    },
    {
      name: "必咬·章节号相同标题不同（`startsWith` 一样撞，只看全文会漏）",
      md: "# T\n\n### 4.3 登记\n\n甲\n\n### 4.3 登记与复核\n\n乙\n",
      expect: (r) => r.dup.length === 1 && r.dup[0].key === "### 4.3",
    },
    {
      name: "必咬·无章节号的同名小节（退到全文口径也要咬住）",
      md: "# T\n\n## 诚实边界\n\n甲\n\n## 诚实边界\n\n乙\n",
      expect: (r) => r.dup.length === 1 && r.dup[0].key === "## 诚实边界",
    },
    {
      name: "必咬·前缀歧义（`### 4.3` 是 `### 4.3 登记表` 的严格前缀）",
      md: "# T\n\n### 4.3\n\n甲\n\n### 4.4 别的\n\n### 4.3 登记表\n\n乙\n",
      // 注：两行章节号 4.3 相同 ⇒ dup 也会咬；这里断言的是 amb 这一路确实点了名
      expect: (r) => r.amb.length === 1 && r.amb[0].anchor === "### 4.3",
    },
    {
      name: "必不咬·`## 3` 与 `## 3b` 是两个号（章节号必须匹配到边界）",
      md: "# T\n\n## 3 · 全量取证\n\n甲\n\n## 3b · 覆盖边界\n\n乙\n",
      expect: (r) => r.dup.length === 0 && r.amb.length === 0,
    },
    {
      name: "必不咬·同名标题分处两个层级（`#### 4.3` 匹不上 `### 4.3`）",
      md: "# T\n\n### 4.3 甲\n\n#### 4.3 乙\n",
      expect: (r) => r.dup.length === 0 && r.amb.length === 0,
    },
    {
      name: "必不咬·重复标题在代码围栏里（围栏感知；不剥围栏则误报）",
      md: "# T\n\n### 4.3 登记\n\n```md\n### 4.3 登记\n### 4.3 登记\n```\n\n收尾\n",
      expect: (r) => r.dup.length === 0 && r.stat.suppressed === 2 && r.stat.naive === r.stat.kept + r.stat.suppressed,
    },
    {
      name: "必不咬·`~~~` 围栏同样识别（只认 ``` 会把 ~~~ 里的标题当真标题而误报）",
      md: "# T\n\n## 甲\n\n~~~text\n## 甲\n~~~\n",
      expect: (r) => r.dup.length === 0 && r.stat.suppressed === 1,
    },
    {
      name: "必咬·围栏未闭合要报出来（否则其后标题全被静默抑制 = 假绿）",
      md: "# T\n\n```md\n### 4.3\n### 4.3\n",
      expect: (r) => r.stat.unclosedFence === true,
    },
    {
      name: "必不咬·加粗与反引号只是排版差异，归一后同名要认出来",
      md: "# T\n\n## **7.** `门禁`\n\n甲\n\n## 7. 门禁\n\n乙\n",
      expect: (r) => r.dup.length === 1 && r.dup[0].key === "## 7",
    },
    {
      name: "必不咬·`#标题`（无空格）不是 ATX 标题，`####### x`（7 级）也不是",
      md: "# T\n\n#紧贴\n\n####### 七级\n\n#紧贴\n",
      expect: (r) => r.dup.length === 0 && r.stat.naive === 1 && r.stat.kept === 1,
    },
    {
      // ⚠ 这一条是**守恒对账（层②）的活口**。生产语料里 6 级标题为 **0 条**（建门当日实测），
      // 所以「裸口径认得、解析口径不认」这条分歧路径**在生产上永远走不到** ——
      // 实测过：把解析正则从 `#{1,6}` 改窄成 `#{1,5}`，全仓 15 份文档守恒照样成立、门照样 RC=0。
      // 于是守恒式在生产语料上退化成恒等式，看着在守、其实什么都没守。
      // 本条金丝雀把那条路径**在样例里走一遍**，让它重新变成机器会说话的判据。
      name: "必咬·6 级标题：裸口径与解析口径必须同时认得（守恒式的活口，生产语料 0 条走不到）",
      md: "# T\n\n###### 六级甲\n\n###### 六级甲\n",
      expect: (r) => r.stat.naive === 3 && r.stat.kept === 3 && r.stat.suppressed === 0 &&
        r.dup.length === 1 && r.dup[0].key === "###### 六级甲",
    },
  ];
}

/** 层③：**样例形状取自生产实物** —— 拿仓里真文件跑主逻辑，断言已知为真的事实。 */
function realSamples() {
  return [
    {
      name: "real·docs/SYSTEM-ONTOLOGY.md 解析得动（章节号口径认得出 §7 / §8）",
      file: "docs/SYSTEM-ONTOLOGY.md",
      expect: (r) => {
        const keys = new Set(mdHeadings(readFileSync(join(ROOT, "docs/SYSTEM-ONTOLOGY.md"), "utf8")).headings.map(headingKey));
        return r.stat.kept >= 20 && keys.has("## 7") && keys.has("## 8");
      },
    },
    {
      name: "real·docs/PRD-harness-ux-adoption.md（本门来历所在的那份）围栏抑制真被触发",
      file: "docs/PRD-harness-ux-adoption.md",
      expect: (r) => r.stat.kept >= 20 && r.stat.suppressed > 0 && r.stat.naive === r.stat.kept + r.stat.suppressed,
    },
  ];
}

/** 跑金丝雀。@returns {string[]} 失败描述（空数组 = 全中） */
export function runCanaries() {
  const fails = [];
  for (const c of canarySamples()) {
    let r;
    try { r = findSectionDupes(c.md); } catch (e) { fails.push(`${c.name} —— 抛异常 ${e?.message || e}`); continue; }
    if (!c.expect(r)) {
      fails.push(`${c.name} —— 实得 dup=${JSON.stringify(r.dup.map((d) => `${d.key}×${d.hits.length}`))} amb=${r.amb.length} stat=${JSON.stringify(r.stat)}`);
    }
  }
  for (const c of realSamples()) {
    const p = join(ROOT, c.file);
    if (!existsSync(p)) { fails.push(`${c.name} —— 生产样例文件不存在：${c.file}`); continue; }
    let r;
    try { r = findSectionDupes(readFileSync(p, "utf8")); } catch (e) { fails.push(`${c.name} —— 抛异常 ${e?.message || e}`); continue; }
    if (!c.expect(r)) fails.push(`${c.name} —— 实得 stat=${JSON.stringify(r.stat)}`);
  }
  return fails;
}

/**
 * 层①：**扫描面自证**。金丝雀全中只说明工具没瞎，说明不了扫的地方对。
 * 两个锚是「已知必在受检集里」的：本体被 11 道门读；来历那份 PRD 被 2 道门读。
 */
function proveScanSurface(g) {
  const have = new Set(g.docs.map((d) => d.path));
  const missing = ["docs/SYSTEM-ONTOLOGY.md", "docs/PRD-harness-ux-adoption.md"].filter((a) => !have.has(a));
  if (missing.length) {
    toolBroken(
      `扫描面锚点缺失（${missing.join("、")}）—— 抽取器没抽到本该必中的文件`,
      `现算受检集 ${g.docs.length} 个 · 扫了 ${g.gateCount} 道门。锚点必中是「扫描面选对了」的最低证据，它不中就一定不是「仓库很干净」。`,
    );
  }
  if (g.gateCount < 60 || g.docs.length < MIN_GOVERNED_DOCS) {
    toolBroken(
      `扫描面塌了：门 ${g.gateCount} 道（下界 60）· 受检 md ${g.docs.length} 份（下界 ${MIN_GOVERNED_DOCS}）`,
      "枚举器一坏集合就变空，差集恒空 ⇒ 门恒绿。这种情况只许报「我没查出来」。",
    );
  }
  // 覆盖率对账的方向性自证：代码口径必须是裸口径的子集（超出 = lex 在凭空造路径）
  const bogus = [...g.codeSet].filter((p) => !g.rawSet.has(p));
  if (bogus.length) toolBroken(`代码口径抽出了裸口径里没有的路径：${bogus.slice(0, 3).join("、")}`, "两条口径的包含关系反了 ⇒ 抽取器不可信。");
}

/* ═══════════════════════════════════════════════════════════════════════════ */

function main() {
  const argv = process.argv.slice(2);
  const selftestOnly = argv.includes("--selftest");
  const census = argv.includes("--census");

  // ── 金丝雀先跑：不中一律「工具坏了」，绝不报「文档干净」──────────────────────
  const canaryFails = runCanaries();
  const canaryTotal = canarySamples().length + realSamples().length;
  if (canaryFails.length) {
    toolBroken(`金丝雀 ${canaryFails.length}/${canaryTotal} 条不中`, canaryFails.join("\n"));
  }
  console.log(`· 金丝雀 ${canaryTotal}/${canaryTotal} 全中（含 ${realSamples().length} 条取自生产实物的形状档）`);
  if (selftestOnly) { console.log("✓ md-section-dup --selftest：判据本体自证通过。"); return 0; }

  // ── 层①：扫描面自证 ────────────────────────────────────────────────────────
  const g = governedDocs();
  proveScanSurface(g);

  // ── 逐份扫 + 层②：独立口径守恒对账 ────────────────────────────────────────
  const dupFail = [], ambFail = [];
  let naiveT = 0, keptT = 0, supT = 0;
  const rows = [];
  for (const d of g.docs) {
    const md = readFileSync(join(ROOT, d.path), "utf8");
    const r = findSectionDupes(md);
    if (r.stat.unclosedFence) {
      toolBroken(
        `${d.path} 代码围栏未闭合`,
        "围栏没闭 ⇒ 其后所有标题被当成代码块内容抑制掉，本门对这份文件的「没找到重复」不成立。先修围栏再跑。",
      );
    }
    if (r.stat.naive !== r.stat.kept + r.stat.suppressed) {
      toolBroken(
        `${d.path} 标题守恒被破：裸 ${r.stat.naive} ≠ 留 ${r.stat.kept} + 围栏内 ${r.stat.suppressed}`,
        "裸行计数与围栏解析器是两条独立代码路径；对不上说明解析器在我不知道的地方丢了标题（= 覆盖率漏洞），不是文档干净。",
      );
    }
    naiveT += r.stat.naive; keptT += r.stat.kept; supT += r.stat.suppressed;
    rows.push({ path: d.path, readers: d.readers.length, ...r.stat });
    for (const x of r.dup) dupFail.push(`${d.path}  重复小节 \`${x.key}\` ×${x.hits.length} @ 行 ${x.hits.map((h) => h.line).join("/")} —— ${x.hits.map((h) => JSON.stringify(h.text.slice(0, 44))).join(" | ")}`);
    for (const x of r.amb) ambFail.push(`${d.path}  前缀歧义：行 ${x.at} \`${x.anchor}\` 是行 ${x.by} \`${x.shadowed.slice(0, 60)}\` 的严格前缀`);
  }
  if (naiveT < MIN_TOTAL_HEADINGS) {
    toolBroken(`受检集标题总数 ${naiveT} < 下界 ${MIN_TOTAL_HEADINGS}`, "标题抽取塌了，本次不许读作「没有重复」。");
  }

  if (census) {
    console.log(`\n受检 md 现算全表（${g.docs.length} 份 · 从「有门在读它」推出，无任何写死文件名）：`);
    for (const r of rows) console.log(`  ${String(r.readers).padStart(2)} 道门读 · 标题 ${String(r.kept).padStart(3)}（围栏内 ${r.suppressed}） · ${r.path}`);
    if (g.rawOnly.length) console.log(`\n只在注释/散文里被提到（不受检，${g.rawOnly.length} 条）：${g.rawOnly.join("、")}`);
  }

  console.log(
    `· 受检 md ${g.docs.length} 份（现算自 ${g.gateCount} 道门的字符串字面量）· ` +
    `标题守恒 裸 ${naiveT} = 留 ${keptT} + 围栏内 ${supT} ✓` +
    (supT === 0 ? "  ⚠ 生产文档里零处围栏抑制 ⇒ 围栏逻辑今天只有手写金丝雀在验它" : ""),
  );

  if (dupFail.length || ambFail.length) {
    if (dupFail.length) {
      console.error(`\n✗ md-section-dup:check 判据①：受治理 md 里有 ${dupFail.length} 处**同名小节**`);
      for (const f of dupFail) console.error("  " + f);
    }
    if (ambFail.length) {
      console.error(`\n✗ md-section-dup:check 判据②：有 ${ambFail.length} 处**前缀歧义标题**`);
      for (const f of ambFail) console.error("  " + f);
    }
    console.error(
      "\n  → 为什么这是红的：全仓 `section(md, heading)` 一律 `lines.findIndex(l => l.trim().startsWith(heading))`，" +
      "**只取第一个**。同名/前缀撞上时，门读到的是排在最前面的那一节，而不是你以为的那一节 —— " +
      "运气好当场红（本门来历那次），运气不好静默读旧账报绿。",
    );
    console.error("  → 修法：把重复的小节合并成一节（并集合并时最常见的成因），或给其中一节换一个不同的章节号/标题。");
    return 1;
  }
  console.log("✓ md-section-dup:check：受治理 md 无同名小节、无前缀歧义标题（按标题取节的门读到的就是它以为的那一节）。");
  return 0;
}

/* 顶层兜底 —— 必须是 Program 的**直接子语句**（`check-gate-exit-discipline.mjs` 只认这一形态：
 * 嵌在函数里的 try 不覆盖全流程）。node 对未捕获异常一律退 1，恰好撞上「真有违规」这个码，
 * 方向正好相反，故一切未预期异常收敛到 RC=2。 */
/* `isMain` 判据放在 try **里面**是刻意的：`check-gate-exit-discipline.mjs` 只认
 * 「try 是 Program 的直接子语句」这一形态，用 `if (isMain) { try {…} }` 包一层就不算数了。
 * 需要这个判据是因为本文件 `export` 了判据本体（findSectionDupes / mdHeadings / headingKey …）——
 * 不加守卫，任何 `import` 它的人都会在导入时被 `process.exit` 打死，
 * 那几个 `export` 就成了一句**兑现不了的承诺**（本仓最不缺的正是这种）。 */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
try {
  if (isMain) process.exit(main());
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || ""));
}
