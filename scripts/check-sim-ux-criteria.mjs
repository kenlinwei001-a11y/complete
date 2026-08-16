#!/usr/bin/env node
/**
 * 门 `sim-ux-criteria:check` · 推演页 UX 判据表**可核对性**门（WO-HARNESS-UX-ADOPTION 建）
 *
 * ── 它守什么（先说清它**不**守什么，免得被读成「UX 已机械化」）──────────────────
 * 仓主原话：「所有推演的功能，包括『推演沙盘』就需要借鉴这个设计UX」。
 * 这条要求此前在台账里只有三个字：**「已融入」** —— 那不是判据，是形容词。
 * `docs/PRD-harness-ux-adoption.md` 把它拆成 **九条可判断的判据 × 一张逐页三态表**。
 *
 * **本门不判 UX 好不好，本门判「那张判据表还算不算数」。**
 * 理由写在 PRD §6.1：九条里今天只有 U4（反事实开关）真能机检，且**已有门**
 * （`check-edge-active-mounts.mjs`）。再造一道去机检 U1/U3/U6/U9 只会得到**代理指标** ——
 * 「文件里有没有『运行』二字」度量的是**写法**不是**行为**，正是铁律 0.6 点名的那种病
 * （「我用 X 当作 Y 的证据，而 X 并不度量 Y」）。守判据表本身，是今天唯一能机械化且不失真的一层。
 *
 * ── 五条判据（同时成立才算过）────────────────────────────────────────────────
 *  ① **枚举一致**：**现算**的推演页名册与 PRD §4 表的行逐个对齐。多一页少一页都红。
 *     拦的是「手抄漏页」—— 本仓已发生过两次：
 *       · `WO-ACTIVE-EDGE-UX.md §1` 的表漏了 `risk-board`（复核时补的，注释里写着）；
 *       · `check-edge-active-mounts.mjs` 的 `PAGES` 曾漏 `cleanroom-attr` / `disruption-radius` /
 *         `order-chain` 三个页 —— **它们从未被那道门问过**，于是永远绿。
 *     形态：**「我用『门是绿的』当作『这些页都合格』的证据，而门的名单里根本没有它们。」**
 *     ⚠ **WO-INFER-PAGE-SSOT 订正了本判据自己的一个洞**：它此前的「现算全集」里有一个源 E，
 *     读的正是 `check-edge-active-mounts.mjs` 那个**手抄的 `PAGES` 数组** —— 也就是
 *     **拿一份手抄名单去校验另一份手抄名单**。两份名单都没有的页，两道门一起看不见、一起绿。
 *     形态（铁律 0.6 句式）：**「我用『另一道门的名单里有它』当作『它在受检面里』的证据。」**
 *     现在名册由 `scripts/lib/sim-page-roster.mjs` 从**注册册**现算（五条纳入判据 + 一条排除判据
 *     + 三条交叉断言，每页带依据链），两道门共用同一支实现，本文件里一个页面键都不存。
 *  ② **三态合法**：§4 表每一格必须是 `符合` / `不符合` / `判不了` 三者之一。
 *     拦的是把「判不了」写成「部分」「基本满足」「已融入」这类含糊词 —— **本单存在的全部理由**。
 *  ③ **判不了必须有理由**：凡某判据列出现过 `判不了`，该判据编号必须在 §4.2 的理由表里出现。
 *     拦的是「判不了」变成免死金牌。
 *  ④ **棘轮 + 反向松弛检测**：`符合` 只许升不许降。
 *     · 正向：基线记 `符合`、实测不是 ⇒ **倒退**，红。
 *     · **反向遍历基线**：基线记非 `符合`、实测是 `符合` ⇒ **免检名额**（基线比实测松，
 *       于是这一格可以一路退回旧值而门不吭声）⇒ 红，要求 `--tighten` 收紧。
 *     · 基线里有、现表里没有的页/判据 ⇒ **死账**（同名一建回来就继承旧额度）⇒ 红。
 *  ⑤ **指代冲突登记不许丢**：PRD §0.1 那张「甲/乙/丙」三方分歧表必须仍在且三行俱全。
 *     仓主那句「借鉴**这个**设计 UX」里的「这个」，仓内有三份互相冲突的记录且从未对账；
 *     删掉这张表 = 下一个人再把它当成已经定案的东西，然后基于错的指代物开工。
 *
 * ── 金丝雀（铁律 0.6：报否定结论前先自证工具，且**与主判据共用同一份实现**）──────────
 * 内嵌样例全部喂给**同一个** `parsePrdTable()` / `ratchet()`，源头枚举那一层则跑
 * `sim-page-roster.rosterCanary()`（十向，与 `edge-active-mounts:check` 同一支实现），
 * 不另抄一份正则（抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。
 * 任一不符预期 ⇒ 打印「⛔ 工具坏了」并 **RC=2**，**不许**打印「表是合规的」。
 *
 * ── 退出码三分（不许合并）──────────────────────────────────────────────────
 *   0 = 干净 · 1 = 真违规（漏页 / 非法三态 / 缺理由 / 倒退 / 松弛 / 冲突表被删） · 2 = **门自己坏了**
 * 2 与 1 处置完全相反：前者只许说「我没查出来」，后者才是「去修」。
 *
 * ── 诚实边界（不许读成「规范已全部机械化」）────────────────────────────────────
 *  · 本门**看不见页面长什么样**。九条判据里 U1/U2/U3/U4b/U5/U7/U8/U9 全部需要渲染后的行为或几何，
 *    源码里不存在那些量。硬编代理指标 = 度量写法不度量行为，本门刻意不做。
 *  · 本门**不判 §4 表里每一格填得对不对** —— 它判「格子合法、覆盖齐全、只许变好」。
 *    填错一格本门抓不到；那由 PRD §4.1 逐格依据 + 人工复审接住。
 *  · 判据① 的「现算名册」只认注册册里的**字面量**写法。改成循环/拼接生成 ⇒ 提取变空 ⇒
 *    名册下界断言当场报「工具坏了」（失败安全那一侧），不会静悄悄变绿。
 *
 * 用法：
 *   node scripts/check-sim-ux-criteria.mjs            # 门
 *   node scripts/check-sim-ux-criteria.mjs --selftest # 只跑金丝雀
 *   node scripts/check-sim-ux-criteria.mjs --census    # 打印现算名册 + 逐判据贡献 + 排除项
 *   node scripts/check-sim-ux-criteria.mjs --seed      # 首次建账
 *   node scripts/check-sim-ux-criteria.mjs --tighten   # 只收紧不放松（收掉免检名额）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
import { canon, computeRoster, rosterCanary, SIM_SOURCE_FILES } from "./lib/sim-page-roster.mjs";

const PRD = "docs/PRD-harness-ux-adoption.md";
const BASELINE = "scripts/sim-ux-criteria-baseline.json";
/**
 * ⚠ WO-INFER-PAGE-SSOT：本门此前自己抄了一份「四源枚举 + 既有门名单」的实现，
 * 其中**源 E 读的是 `check-edge-active-mounts.mjs` 里那个手抄的 `PAGES` 数组** ——
 * 即「用一份手抄名单去校验另一份手抄名单」。名单里没有的页两边都看不见，于是两道门一起绿。
 * 现在两道门共用同一份判据实现 `scripts/lib/sim-page-roster.mjs`（名单一律现算，
 * 每页带依据链），本文件里**一个页面键、一条源头正则都不存**。
 */
const SRC = SIM_SOURCE_FILES;

/** 三态 —— 只有这三个词合法。「部分」「基本满足」「已融入」一律判非法（判据②）。 */
export const STATES = ["符合", "不符合", "判不了"];

/* ═══════════════════ 唯一实现 · PRD 判据表解析 ═════════════════════════════════ */

/** 取某个标题下的正文（到下一个同级或更高级标题为止）。 */
function section(md, heading) {
  const lines = md.split("\n");
    const i = lines.findIndex((l) => l.trim().startsWith(heading));
  if (i < 0) return null;
  const level = (heading.match(/^#+/) ?? ["#"])[0].length;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(lines[j]);
  }
  return out.join("\n");
}

function cells(row) {
  return row.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.replace(/\*/g, "").trim());
}

/**
 * 解析 PRD：§4 三态表 · §4.2 理由覆盖 · §0.1 指代冲突表。**唯一实现**（金丝雀跑的就是它）。
 * @returns {{criteria:string[],rows:Array<{key:string,cells:object}>,reasons:Set<string>,conflict:string[],illegal:Array}}
 */
export function parsePrdTable(md) {
  const illegal = [];
  const sec4 = section(md, "## 4 ·") ?? "";
  const body4 = sec4.split("### 4.1")[0];
  const tableLines = body4.split("\n").filter((l) => l.trim().startsWith("|"));
  let criteria = [];
  const rows = [];
  for (const line of tableLines) {
    const cs = cells(line);
    if (cs.length < 2) continue;
    if (/^-+$/.test(cs[1].replace(/[:\s]/g, "").replace(/-+/, "-"))) continue; // 分隔行
    if (cs[0] === "页") { criteria = cs.slice(1).map((h) => (h.match(/^(U\d+b?)/) ?? [])[1] ?? h); continue; }
    const key = (cs[0].match(/`([a-z0-9-]+)`/) ?? [])[1];
    if (!key) continue;
    const cellMap = {};
    cs.slice(1).forEach((v, i) => {
      const name = criteria[i] ?? `#${i}`;
      cellMap[name] = v;
      if (!STATES.includes(v)) illegal.push({ key, criterion: name, value: v });
    });
    rows.push({ key, cells: cellMap });
  }

  // §4.2 理由表：第一列里出现过的判据编号
  const reasons = new Set();
  for (const m of (section(md, "### 4.2") ?? "").matchAll(/U\d+b?/g)) reasons.add(m[0]);

  // §0.1 指代冲突表：甲 / 乙 / 丙 三行
  const s01 = section(md, "### 0.1") ?? "";
  const conflict = ["甲", "乙", "丙"].filter((t) => new RegExp(`\\|\\s*\\*{0,2}${t}\\*{0,2}\\s*\\|`).test(s01));

  return { criteria, rows, reasons, conflict, illegal };
}

/* ═══════════════════ 金丝雀（与主判据共用上面那两个函数）══════════════════════ */

const CANARY_PRD_OK = [
  "### 0.1 冲突",
  "| # | 落款 | 记的 |",
  "|---|---|---|",
  "| **甲** | a | x |",
  "| **乙** | b | y |",
  "| **丙** | c | z |",
  "",
  "## 4 · 表",
  "| 页 | U1 改输入即重演 | U2 分步 |",
  "|---|---|---|",
  "| 沙盘 `sim-sandbox` | **符合** | 判不了 |",
  "| 假设 `what-if` | 不符合 | 判不了 |",
  "",
  "### 4.1 依据",
  "略",
  "",
  "### 4.2 判不了的理由",
  "| 判据 | 为什么 |",
  "|---|---|",
  "| U2（2 格） | 需渲染 |",
].join("\n");

/** 必不中样例：把一格写成「部分」（判据② 要抓的正是这种含糊词）+ 抽掉「丙」行。 */
const CANARY_PRD_BAD = CANARY_PRD_OK
  .replace("| 假设 `what-if` | 不符合 | 判不了 |", "| 假设 `what-if` | 部分 | 判不了 |")
  .replace("| **丙** | c | z |", "");

/** 金丝雀。任一不符预期 ⇒ 工具坏了（RC=2），**不许**报「表是合规的」。 */
export function canaries() {
  const bad = [];
  const ok = parsePrdTable(CANARY_PRD_OK);
  const notok = parsePrdTable(CANARY_PRD_BAD);

  // ①必中：合法表解析出 2 行 × 2 判据、零非法、三方冲突表齐、§4.2 覆盖 U2
  if (!(ok.rows.length === 2 && ok.criteria.join(",") === "U1,U2" && ok.illegal.length === 0 &&
        ok.conflict.length === 3 && ok.reasons.has("U2"))) {
    bad.push(`①必中样例：rows=${ok.rows.length} criteria=${ok.criteria.join(",")} illegal=${ok.illegal.length} conflict=${ok.conflict.length}（应为 2 / U1,U2 / 0 / 3）`);
  }
  // ②必不中：「部分」必须被判非法，且「丙」行缺失必须被发现
  if (!(notok.illegal.length === 1 && notok.illegal[0].value === "部分" && notok.conflict.length === 2)) {
    bad.push(`②必不中样例：illegal=${JSON.stringify(notok.illegal)} conflict=${notok.conflict.length}（应为 1 条「部分」 / 2）`);
  }
  // ③源头枚举：跑名册库自己的十向金丝雀（**与 edge-active-mounts:check 同一支实现**，
  //   不在本文件另抄一份源头正则 —— 抄了就是装饰品，改主正则时这里拿旧的去测、照样绿）。
  const rc = rosterCanary();
  for (const b of rc.bad) bad.push(`③名册库：${b}`);
  // ④棘轮方向：同一份比较逻辑，倒退与松弛各一例
  const r = ratchet({ base: { a: { U1: "符合", U2: "不符合" } }, now: { a: { U1: "判不了", U2: "符合" } } });
  if (!(r.regressed.length === 1 && r.slack.length === 1 && r.dead.length === 0)) {
    bad.push(`④棘轮：regressed=${r.regressed.length} slack=${r.slack.length} dead=${r.dead.length}（应为 1/1/0）`);
  }
  const bd = baselineDocCanary();
  if (!bd.ok) bad.push(`⑤基线写入器：${bd.got}`);
  return { ok: bad.length === 0, bad };
}

/* ═══════════════════ 棘轮（正向倒退 + 反向松弛，唯一实现）══════════════════════ */

/**
 * @param {{base:object, now:object}} o  base/now 均为 { pageKey: { criterion: state } }
 * @returns {{regressed:Array,slack:Array,dead:Array,conform:number}}
 */
export function ratchet({ base, now }) {
  const regressed = [], slack = [], dead = [];
  let conform = 0;
  for (const [page, cs] of Object.entries(now)) for (const v of Object.values(cs)) if (v === "符合") conform++;
  // **反向遍历基线** —— 正向遍历发现不了「基线比实测松」这一侧（免检名额）。
  for (const [page, cs] of Object.entries(base ?? {})) {
    if (!now[page]) { dead.push({ page, criterion: "*", reason: "基线里有、现表里没有这一页" }); continue; }
    for (const [crit, was] of Object.entries(cs)) {
      const is = now[page][crit];
      if (is === undefined) { dead.push({ page, criterion: crit, reason: "基线里有、现表里没有这一列" }); continue; }
      if (was === "符合" && is !== "符合") regressed.push({ page, criterion: crit, was, is });
      if (was !== "符合" && is === "符合") slack.push({ page, criterion: crit, was, is });
    }
  }
  return { regressed, slack, dead, conform };
}

/* ═══════════════════ 顶层兜底（形态 a：try 是 Program 的直接子语句）═════════════ */

function toolBroken(what, hint) {
  console.error(`⛔ check-sim-ux-criteria.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「判据表合规 / 推演页都覆盖了 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2); // 2 = 门自己坏了（1 = 判据表真有问题），两者处置相反，不许合并
}

// ⚠ 刻意用顶层 try/catch，**不用** `process.on("uncaughtException")`：本文件导出的
// `parsePrdTable` / `canaries` / `ratchet` 可被测试 import（金丝雀与主逻辑共用同一份实现
// 那条纪律的落点）；顶层无条件注册全局 handler 会装进跑测试的那个进程，一旦别处抛未捕获异常
// 就会被本门抢走并 exit(2)，把整个测试进程带走。try 只包住「被直接执行时才跑的那一句」。
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
try {
  if (isMain) main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

function read(rel) {
  const p = resolve(process.cwd(), rel);
  if (!existsSync(p)) toolBroken(`读不到 ${rel}`, "扫描面缺失 ⇒ 集合会变空 ⇒ 差集恒空 ⇒ 门恒绿（失败危险方向），故一律判「工具坏了」。");
  return readFileSync(p, "utf8");
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(f);

  // ── 保命判据：金丝雀先跑（不过 ⇒ RC=2，不许报「表是合规的」）──────────────
  const cy = canaries();
  if (!cy.ok) {
    console.error("🛠️  **工具坏了**：金丝雀不符预期 ——");
    for (const b of cy.bad) console.error("   · " + b);
    console.error("   ⛔ 不许把本次结果读作「判据表合规」。");
    process.exit(2);
  }
  console.log(`✅ 金丝雀 14/14（必中表 · 必不中表「部分」被抓 · 名册库十向 · 棘轮双向 · 基线写入器四向）`);
  if (flag("--selftest")) { console.log("（--selftest：只跑金丝雀，未比对仓库内容）"); return; }

  // ── 现算推演页名册（判据的单一来源 · 与 edge-active-mounts:check 同一支实现）──────
  const srcTexts = Object.fromEntries(Object.entries(SRC).map(([k, p]) => [k, read(p)]));
  const roster = computeRoster(srcTexts);
  const s = { union: roster.pages.map((p) => p.key), alias: roster.alias, byRule: roster.sources.byRule };
  // 下界自证：任一判据提取为空 ⇒ 供给侧被重构成解析不了的写法 ⇒ 差集恒空 ⇒ 门恒绿（失败危险方向）
  for (const k of ["R1", "R3", "R4", "R5"]) {
    if (s.byRule[k].length === 0) toolBroken(`判据 ${k} 提取为 0 条`, "这几条判据的源头都不可能真的空；提取为空 = 解析器瞎了，不是仓库里没有推演页。");
  }
  if (Object.keys(s.alias).length === 0) toolBroken("VIEW_ALIAS 提取为 0 条", "别名表空 ⇒ 键无法归一 ⇒ 同一页会被算成两页。");

  if (flag("--census")) {
    console.log(`\n── 现算推演页名册（${roster.pages.length} 页 · scripts/lib/sim-page-roster.mjs）──`);
    for (const p of roster.pages) {
      console.log(`  ${p.key.padEnd(18)} ${p.file ?? "（解析不到源码文件）"}`);
      for (const w of p.why) console.log(`      ← ${w}`);
    }
    console.log(`\n── 逐判据贡献 ──`);
    for (const [k, v] of Object.entries(s.byRule)) console.log(`  ${k}: ${v.length} · ${v.join(" ") || "（空）"}`);
    console.log(`\n── 有理由地排除（不是漏掉）──`);
    for (const e of roster.excluded) console.log(`  ${e.key.padEnd(18)} ${e.why}`);
    console.log(`\n── 交叉断言 ──`);
    console.log(roster.violations.length ? roster.violations.map((v) => `  ${v.code} ${v.key}：${v.detail}`).join("\n") : "  （零违规）");
    return;
  }

  // ── 解析 PRD ────────────────────────────────────────────────────────────
  const prd = parsePrdTable(read(PRD));
  if (prd.rows.length === 0 || prd.criteria.length === 0) {
    toolBroken(`${PRD} §4 表解析出 ${prd.rows.length} 行 / ${prd.criteria.length} 列`, "表在文档里而解析不出 = 解析器瞎了；报「表是空的」会把一份真表读成不存在。");
  }

  const fail = [];

  // 判据① 枚举一致（名册合法性也归本判据 —— 名册非法时「一致」这句话本身就没意义）
  for (const v of roster.violations) {
    fail.push(`① 名册合法：${v.code} ${v.key} —— ${v.detail}`);
  }
  const tableKeys = [...new Set(prd.rows.map((r) => canon(r.key, s.alias)))].sort();
  const missing = s.union.filter((k) => !tableKeys.includes(k));
  const extra = tableKeys.filter((k) => !s.union.includes(k));
  if (missing.length) fail.push(`① 枚举一致：现算全集里有 ${missing.length} 页**不在** PRD §4 表里 → ${missing.join(" ")}（「所有推演的功能」是横向要求，漏一页就是漏一页）`);
  if (extra.length) fail.push(`① 枚举一致：PRD §4 表里有 ${extra.length} 页**不在**现算全集里 → ${extra.join(" ")}（要么页没了要么枚举源改了，两种都得先查清）`);

  // 判据② 三态合法
  for (const bad of prd.illegal) {
    fail.push(`② 三态合法：${bad.key} × ${bad.criterion} = 「${bad.value}」不是 ${STATES.join("/")} 之一 —— 含糊词正是本单要消灭的东西`);
  }

  // 判据③ 判不了必须有理由
  const undecidable = new Set();
  for (const r of prd.rows) for (const [c, v] of Object.entries(r.cells)) if (v === "判不了") undecidable.add(c);
  for (const c of [...undecidable].sort()) {
    if (!prd.reasons.has(c)) fail.push(`③ 判不了必须有理由：判据 ${c} 有「判不了」的格，但 §4.2 理由表里没有它 —— 「判不了」不许当免死金牌`);
  }

  // 判据⑤ 指代冲突登记
  if (prd.conflict.length < 3) {
    fail.push(`⑤ 指代冲突登记：§0.1 三方分歧表只剩 ${prd.conflict.length}/3 行（甲/乙/丙）—— 删了它，下一个人会把「这个」当成已定案的东西`);
  }

  // 判据④ 棘轮
  const now = {};
  for (const r of prd.rows) now[canon(r.key, s.alias)] = r.cells;
  const prev = existsSync(resolve(process.cwd(), BASELINE)) ? JSON.parse(read(BASELINE)) : null;
  const rr = ratchet({ base: prev?.cells ?? {}, now });

  if (flag("--seed") || flag("--tighten")) {
    const doc = buildBaselineDoc({
      prev,
      generatedBy: `node scripts/check-sim-ux-criteria.mjs ${flag("--seed") ? "--seed" : "--tighten"}`,
      prose: {
        note:
          "sim-ux-criteria 棘轮基线：`docs/PRD-harness-ux-adoption.md` §4 逐页 × 逐判据三态表的快照。" +
          "`符合` 只许升不许降；**反向遍历基线**检测「基线比实测松」（免检名额）—— 那一格改好了却没收紧基线，" +
          "它就能一路退回旧值而门不吭声。`cells`/`conform` 归机器算，本 note 与任何人手新增的顶层键归人手，" +
          "由 scripts/lib/baseline-doc.mjs 保证 `--tighten` 不吞人话。",
      },
      computed: { cells: now, conform: rr.conform, pages: Object.keys(now).length },
    });
    writeFileSync(resolve(process.cwd(), BASELINE), JSON.stringify(doc, null, 2) + "\n");
    console.log(`✍️  基线已写：${BASELINE}（${Object.keys(now).length} 页 · 符合 ${rr.conform} 格）`);
    return;
  }

  if (prev == null) {
    fail.push(`④ 棘轮：基线 ${BASELINE} 不存在 —— 先跑 \`node scripts/check-sim-ux-criteria.mjs --seed\` 建账（不建账 = 棘轮不生效，门是装饰品）`);
  } else {
    for (const r of rr.regressed) fail.push(`④ 棘轮倒退：${r.page} × ${r.criterion} 基线「${r.was}」→ 实测「${r.is}」—— 只许升不许降`);
    for (const r of rr.slack) fail.push(`④ 棘轮松弛（**免检名额**）：${r.page} × ${r.criterion} 基线「${r.was}」而实测已是「符合」—— 基线比实测松，跑 \`--tighten\` 收紧`);
    for (const r of rr.dead) fail.push(`④ 棘轮死账：${r.page} × ${r.criterion} —— ${r.reason}（同名一建回来就继承旧额度）`);
    if (typeof prev.conform === "number" && rr.conform < prev.conform) {
      fail.push(`④ 棘轮总量：符合 ${rr.conform} 格 < 基线 ${prev.conform} 格`);
    }
  }

  // ── 报告 ────────────────────────────────────────────────────────────────
  console.log(`· 现算推演页名册 ${s.union.length} 页（R1 ${s.byRule.R1.length} · R2 ${s.byRule.R2.length} · R3 ${s.byRule.R3.length} · R4 ${s.byRule.R4.length} · R5 ${s.byRule.R5.length}）· 有理由排除 ${roster.excluded.length} 个沙盘内部构件 · 交叉断言违规 ${roster.violations.length}`);
  console.log(`· PRD §4 表：${prd.rows.length} 页 × ${prd.criteria.length} 判据 = ${prd.rows.length * prd.criteria.length} 格 · 符合 ${rr.conform}${prev ? `（基线 ${prev.conform}）` : ""}`);
  console.log(`· 「判不了」出现在 ${undecidable.size} 个判据上，§4.2 理由覆盖 ${prd.reasons.size} 个`);

  if (fail.length) {
    console.error(`\n🔴 sim-ux-criteria:check 未通过（${fail.length} 条）：`);
    for (const m of fail) console.error("  - " + m);
    process.exit(1);
  }
  console.log("\n🟢 sim-ux-criteria:check 通过（枚举一致 · 三态合法 · 判不了有理由 · 棘轮无倒退无松弛 · 指代冲突登记在册）。");
}
