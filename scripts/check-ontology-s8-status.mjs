#!/usr/bin/env node
/**
 * 门 `onto-s8-status:check` · **§8 断点状态标记门 + §8 状态只许前进门**
 *（WO-ONTO-STATUS-BACKFILL 建 · WO-ONTO-S8-MERGE-GUARD 2026-08-19 并入第二判据）
 *
 * ══ 判据一 · 每行必带标记（原 WO-ONTO-STATUS-BACKFILL）══════════════════════════
 * `docs/SYSTEM-ONTOLOGY.md` §8「已知断点登记」是 `scripts/dispatch-deficit.sh`
 * 「待写WO」队列的**唯一来源**，而那个队列**按行内状态标记抽取**
 * （`🔴 未修` / `◑ 部分闭合`）。2026-08-18 实测：§8 共 193 个编号行，
 * 其中 **27 行连一个状态标记（🔴/◑/✅）都没有** —— 这些断点是开是闭没人知道，
 * 且**永远进不了派单队列**（工单转述的历史数是 190 行 / 104 行无标记 / 95 个唯一编号，
 * 收编日复核以现算为准：文档在持续演进，数已对不上，按现算顶回）。
 * 当单已把 27 行逐条复核补标；本判据守的是「不许再长回来」：
 *
 *   > **§8 每个编号行都必须带至少一个状态标记（🔴 / ◑ / ✅）。**
 *   > 新增断点不带标记 ⇒ 红。没标记不等于已闭 —— 它只等于「没人判过」。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『行里没有状态标记』当作『断点已闭』的证据，而前者并不度量后者。」**
 *
 * ══ 判据二 · 状态只许前进（WO-ONTO-S8-MERGE-GUARD 并入）══════════════════════════
 * 已发生两例同形态事故：**✅ 回写是 HEAD 的祖先，却被后续收编 merge 解冲突时回滚成 🔴**
 * —— 首例 `G-OEE-DUAL-TRUTH`（回写随空 blob 事故丢失），第二例 `G-STEP-VOCAB-SPLIT-TWO-HOMES`
 * （回写 `a81062e29` 在祖先链上，合并 `3ddd98dff` 取旧行把状态列改回 🔴；
 * `git diff c08657446 3ddd98dff` 对该行 -✅ / +🔴 实证）。形态（铁律 0.6 句式）：
 *   > **「我用『提交信息里写了已回写』当作『本体真被回写了』的证据，而前者并不度量后者。」**
 * `file-truncation:check` 只防空 blob/行数腰斩，**不防状态回滚**；本判据补这个洞：
 *
 *   > **区间 `merge-base(HEAD, 集成线)..HEAD` 逐提交审（合并按第一父）：任一编号在父提交里
 *   > 有任一行带 ✅，而本提交里该编号的行一个 ✅ 都不剩、且带着 🔴/◑ ⇒ 红（状态回退）。**
 *   > 判据落**行内容 diff**，不落提交信息说了什么。
 *
 * 唯一放行路：`scripts/ontology-s8-status-exemptions.json` 里同 (commit, 编号) 的
 * **≥20 字理由**豁免（照 `file-truncation-exemptions.json` 先例）——真要把 ✅ 打回 🔴
 * （例如原闭合判错了、真回归），当场写清理由让下一个 dev 不用猜。
 *
 * 判据二的**诚实边界**（如实写明，不许当成「状态永不退」）：
 *  ① 行内标记按**字符出现**抽取（与判据一同口径；抽取前先剥掉 `~~…~~` 删除线区段——
 *     删掉的标记是明示作废，不算数）。**叙述性提及标记字符**（如「仍按实际写 ◑」）
 *     会被数进去 ⇒ 理论上存在「旧行恰好叙述过 ✅」的漏报通道；双向金丝雀用真史
 *     （`3ddd98dff` 必咬 · `a81062e29` 必不咬）钉住主路径。
 *  ② 编号在子提交里**整行消失**（而非被改回 🔴/◑）不归本判据——那是断点登记的存废决策，
 *     diff 里人看得见；本判据守的是「行还在、状态被偷换」这个已真发生两次的形态。
 *  ③ 在集成线本体上跑时 merge-base == HEAD、区间为空 ⇒ 如实打印「区间为空」：
 *     **它是收编前的拦门，不是考古工具**；考古用 `--range A..B`。
 *
 * ══ 两个实测坑（都真栽过，写在这里防复发）══════════════════════════════════════
 *  ① **§8 单元格内嵌 `|`**，一行实测列数 2/3/4/6/13 不等 ⇒ **按「最后一列」
 *     切分判状态会把列切碎**。本门**按整行抽标记序列**，不做列切分。
 *  ② **订正文字里写状态短语会被抽取器数进去** —— 在本体文档其它章节写
 *     「🔴 未修」这类字面序列会 inflate `dispatch-deficit.sh` 的队列计数。
 *     本门的 §7 条目与本文件头注在写进本体时都刻意不带这些序列。
 *
 * ══ 编号口径 ═══════════════════════════════════════════════════════════════════
 * 编号行 = 行首 `| <ID> |`，ID 匹配 `/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/`
 * （覆盖 `G-*` / `BP-*` / `GAP-*` / `SUPPLY-DEMAND` 等现有形态；表头「编号」
 * 是 CJK 不匹配、分隔行 `|---` 不匹配）。
 *
 * ══ 金丝雀（与主逻辑共用同一份实现，不另抄正则）═══════════════════════════════
 * 每次运行先过全部金丝雀，任一不中 ⇒ RC=2（门坏了），**不许**读作「§8 干净」：
 *  判据一（4 条）：① 必咬无标记行样例；② 必不咬带标记样例（三态各一）；
 *    ③ 必不咬表头/分隔行；④ 扫描面下界自证（真文档 §8 编号行 < 100 ⇒ 报工具坏了）。
 *  判据二（7 条，全部走同一份 `judgeRegressions()`/`scanCommitGuard()`）：
 *    ⑤ 必咬：合成样例 ✅→🔴 回退；⑥ 必咬：✅ 被删线作废只剩 🔴 也咬；
 *    ⑦ 必不咬：✅→✅ 正常演进；⑧ 必不咬：🔴→✅ 前进；
 *    ⑨ 必不咬：去重删行（父提交同编号两行其一 ✅，子提交留 ✅ 行）——dedupe 合法形态；
 *    ⑩ 真史必咬：合并 `3ddd98dff` 必须咬在 `G-STEP-VOCAB-SPLIT-TWO-HOMES`；
 *    ⑪ 真史必不咬：回写提交 `a81062e29` 不得咬该编号（那是前进，不是回退）。
 *
 * ══ 退出码三分 ═════════════════════════════════════════════════════════════════
 *  0 = 两判据都干净 · 1 = 真违规（无标记行 / 状态回退，逐条列出）· 2 = 门自己坏了。
 *
 * 用法：
 *   node scripts/check-ontology-s8-status.mjs              # 门（判据二默认 merge-base..HEAD）
 *   node scripts/check-ontology-s8-status.mjs --selftest   # 只跑金丝雀
 *   node scripts/check-ontology-s8-status.mjs --range A..B # 判据二审指定区间（考古/复验用）
 *   node scripts/check-ontology-s8-status.mjs --base <ref> # 换集成线参考系
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONTO = join(ROOT, "docs", "SYSTEM-ONTOLOGY.md");
const ONTO_REL = "docs/SYSTEM-ONTOLOGY.md";
const EXEMPTIONS_PATH = join(ROOT, "scripts", "ontology-s8-status-exemptions.json");
const DEFAULT_BASE = "origin/claude/verify-reclaim-6";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const ID_ROW_RE = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*\|/;
const MARK_RE = /[🔴◑✅]/;
const STRIKE_RE = /~~.*?~~/g;
const ROW_FLOOR = 100;

/** §8 区间定位 + 编号行抽取（判据一、判据二、金丝雀共用的唯一一份）。 */
function scanSectionRows(lines) {
  const start = lines.findIndex((l) => l.startsWith("## 8."));
  if (start === -1) return { error: "找不到 §8（## 8. 已知断点登记）——章节被改名/移动时**不许**读作「零违规」" };
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  const rows = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(ID_ROW_RE);
    if (m) rows.push({ ln: i + 1, id: m[1], text: lines[i] });
  }
  return { rows };
}

/** 行内状态标记集合：先剥删除线区段（明示作废不算数），再按字符出现抽取。 */
function rowMarks(lineText) {
  const stripped = lineText.replace(STRIKE_RE, "");
  const marks = new Set();
  for (const mk of ["🔴", "◑", "✅"]) if (stripped.includes(mk)) marks.add(mk);
  return marks;
}

/** 判据一主抽取：返回 { rows, unmarked }。 */
function scanLines(lines) {
  const r = scanSectionRows(lines);
  if (r.error) return r;
  const rows = r.rows.map((x) => ({ ln: x.ln, id: x.id, marked: MARK_RE.test(x.text) }));
  return { rows, unmarked: rows.filter((x) => !x.marked) };
}

/**
 * 判据二核心（金丝雀与主扫描共用的唯一一份）：
 * 给父/子两版全文，返回状态回退清单 [{ id, parentMarks, childMarks }]。
 * 回退 = 父版该编号有任一行带 ✅，子版该编号的行一个 ✅ 都不剩、且带 🔴/◑。
 * 子版里该编号整行消失 ⇒ 不归本判据（见头注诚实边界②）。
 */
function judgeRegressions(parentText, childText) {
  const P = scanSectionRows(parentText.split("\n"));
  const C = scanSectionRows(childText.split("\n"));
  if (P.error || C.error) return { error: P.error || C.error };
  const byId = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const arr = m.get(r.id) ?? [];
      arr.push({ ln: r.ln, marks: rowMarks(r.text) });
      m.set(r.id, arr);
    }
    return m;
  };
  const pm = byId(P.rows);
  const cm = byId(C.rows);
  const regressions = [];
  for (const [id, prows] of pm) {
    if (!prows.some((r) => r.marks.has("✅"))) continue;
    const crows = cm.get(id);
    if (!crows || crows.length === 0) continue; // 整行消失：不归本判据
    if (crows.some((r) => r.marks.has("✅"))) continue;
    if (!crows.some((r) => r.marks.has("🔴") || r.marks.has("◑"))) continue;
    regressions.push({
      id,
      parentMarks: [...new Set(prows.flatMap((r) => [...r.marks]))].join(""),
      childMarks: [...new Set(crows.flatMap((r) => [...r.marks]))].join(""),
    });
  }
  return { regressions };
}

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **门自己坏了，不是文档坏了**。`);
  console.error("   本次结论作废：**不许**读作「§8 干净 / 状态无回退」——本门这次根本没扫成。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

function git(args, allowFail = false) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    if (allowFail) return null;
    toolBroken(`git ${args.slice(0, 3).join(" ")} 失败`, String(e.stderr ?? e.message).slice(0, 400));
  }
}

/** 审单个提交（合并按第一父）。返回 { touched, hits }：touched=本提交动了本体文件，hits=引入的状态回退清单。 */
function scanCommitGuard(commit) {
  const parentsLine = git(["rev-list", "--parents", "-n", "1", commit]).trim();
  const parts = parentsLine.split(/\s+/);
  const base = parts.length >= 2 ? parts[1] : EMPTY_TREE;
  const touched = git(["diff", "--name-only", base, commit, "--", ONTO_REL]).trim();
  if (!touched) return { touched: false, hits: [] };
  const parentText = git(["show", `${base}:${ONTO_REL}`], true);
  const childText = git(["show", `${commit}:${ONTO_REL}`], true);
  if (parentText === null) return { touched: true, hits: [] }; // 本文件新建：无旧态可退
  if (childText === null) return { touched: true, hits: [] }; // 整删/清空由 file-truncation:check 守，如实不重复判
  const r = judgeRegressions(parentText, childText);
  if (r.error) toolBroken(`提交 ${commit.slice(0, 9)} 的 §8 抽取失败：${r.error}`);
  return { touched: true, hits: r.regressions.map((x) => ({ commit, ...x })) };
}

/** 豁免册：同 (commit 前缀, 编号) 且理由 ≥20 字才放行（照 file-truncation 先例）。 */
function loadExemptions() {
  if (!existsSync(EXEMPTIONS_PATH)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8"));
  } catch (e) {
    toolBroken(`豁免册 ${EXEMPTIONS_PATH} 不是合法 JSON`, String(e.message));
  }
  if (!Array.isArray(raw)) toolBroken("豁免册顶层必须是数组", `${EXEMPTIONS_PATH}`);
  for (const [i, e] of raw.entries()) {
    if (!e || typeof e.commit !== "string" || typeof e.id !== "string")
      toolBroken(`豁免册第 ${i + 1} 条缺 commit/id`, JSON.stringify(e));
    if (typeof e.reason !== "string" || e.reason.trim().length < 20)
      toolBroken(
        `豁免册第 ${i + 1} 条（${e.commit} ${e.id}）理由不足 20 字`,
        "「把已闭断点打回未修」这种动作的豁免理由必须让下一个 dev 不用猜。"
      );
  }
  return raw;
}
const findExemption = (exemptions, commit, id) =>
  exemptions.find((e) => commit.startsWith(e.commit) && e.id === id);

/** 判据一金丝雀（3 条；第 ④ 条 ROW_FLOOR 在 main 真文档路径上执行）。返回 null = 通过，否则为失败原因串。 */
function canary() {
  // ① 必咬：无标记编号行
  const bad = scanLines(["## 8. 已知断点登记", "", "| G-CANARY-MISSING | 某断点描述 | 某链路 | 无状态单元格 |", "", "## 9. 后续章节"]);
  if (bad.error || bad.unmarked.length !== 1 || bad.unmarked[0].id !== "G-CANARY-MISSING")
    return `① 必咬不中：无标记样例未被报出（unmarked=${bad.unmarked?.length ?? "?"}）`;
  // ② 必不咬：带标记编号行（三种标记各试一条，与主判据同一份 MARK_RE）
  const good = scanLines(["## 8. 已知断点登记", "| G-CANARY-OPEN | 描述 | 链路 | 🔴 未修 |", "| G-CANARY-PART | 描述 | 链路 | ◑ 部分闭合 |", "| BP-CANARY-DONE | 描述 | 链路 | ✅ 已闭 |", "## 9. x"]);
  if (good.error || good.unmarked.length !== 0 || good.rows.length !== 3)
    return `② 必不咬不中：带标记样例被诬告（unmarked=${good.unmarked?.length ?? "?"}·rows=${good.rows?.length ?? "?"}）`;
  // ③ 必不咬：表头与分隔行不是编号行
  const hdr = scanLines(["## 8. 已知断点登记", "| 编号 | 断点 | 链路位置 | 性质 |", "|---|---|---|---|", "| G-CANARY-ONLY | 描述 | 链路 | ✅ 已闭 |", "## 9. x"]);
  if (hdr.error || hdr.rows.length !== 1 || hdr.rows[0].id !== "G-CANARY-ONLY")
    return `③ 口径过宽：表头/分隔行被当成编号行（rows=${hdr.rows?.length ?? "?"}）`;
  return null;
}

/** 判据二金丝雀（7 条，全部走同一份 judgeRegressions/scanCommitGuard）。 */
function guardCanary() {
  const wrap = (rowLines) => ["## 8. 已知断点登记", "", "| 编号 | 断点 | 链路位置 | 性质 |", "|---|---|---|---|", ...rowLines, "", "## 9. 后续章节", ""].join("\n");
  // ⑤ 必咬：✅→🔴 回退
  const r5 = judgeRegressions(
    wrap(["| G-CANARY-REG | 描述 | 链路 | ✅ 已修（某单） |"]),
    wrap(["| G-CANARY-REG | 描述 | 链路 | 🔴 未修（旧行残留） |"])
  );
  if (r5.error || r5.regressions.length !== 1 || r5.regressions[0].id !== "G-CANARY-REG")
    return `⑤ 必咬不中：✅→🔴 合成样例未判回退（${JSON.stringify(r5.regressions ?? r5.error)}）`;
  // ⑥ 必咬：✅ 被删线作废、只剩 🔴（剥删除线后才算数）
  const r6 = judgeRegressions(
    wrap(["| G-CANARY-STRIKE | 描述 | 链路 | ✅ 已修 |"]),
    wrap(["| G-CANARY-STRIKE | 描述 | 链路 | ~~✅ 已修~~ 复核打回：🔴 未修 |"])
  );
  if (r6.error || r6.regressions.length !== 1 || r6.regressions[0].id !== "G-CANARY-STRIKE")
    return `⑥ 必咬不中：删除线作废样例未判回退（${JSON.stringify(r6.regressions ?? r6.error)}）`;
  // ⑦ 必不咬：✅→✅ 正常演进（内容改了，✅ 还在）
  const r7 = judgeRegressions(
    wrap(["| G-CANARY-EVOL | 描述 | 链路 | ✅ 已修（旧证据） |"]),
    wrap(["| G-CANARY-EVOL | 描述改 | 链路 | ✅ 已修（新证据·更全） |"])
  );
  if (r7.error || r7.regressions.length !== 0)
    return `⑦ 必不咬不中：✅→✅ 演进样例被诬告（${JSON.stringify(r7.regressions ?? r7.error)}）`;
  // ⑧ 必不咬：🔴→✅ 前进
  const r8 = judgeRegressions(
    wrap(["| G-CANARY-PROG | 描述 | 链路 | 🔴 未修 |"]),
    wrap(["| G-CANARY-PROG | 描述 | 链路 | ✅ 已修 |"])
  );
  if (r8.error || r8.regressions.length !== 0)
    return `⑧ 必不咬不中：🔴→✅ 前进样例被诬告（${JSON.stringify(r8.regressions ?? r8.error)}）`;
  // ⑨ 必不咬：去重删行（父同编号两行其一 ✅，子留 ✅ 行）——dedupe 的合法形态
  const r9 = judgeRegressions(
    wrap(["| G-CANARY-DEDUP | 旧副本 | 链路 | 🔴 未修 |", "| G-CANARY-DEDUP | 合并行 | 链路 | ✅ 已修 |"]),
    wrap(["| G-CANARY-DEDUP | 合并行 | 链路 | ✅ 已修 |"])
  );
  if (r9.error || r9.regressions.length !== 0)
    return `⑨ 必不咬不中：dedupe 删行样例被诬告（${JSON.stringify(r9.regressions ?? r9.error)}）`;
  // ⑩ 真史必咬：合并 3ddd98dff 把 G-STEP-VOCAB-SPLIT-TWO-HOMES 从 ✅ 解冲突回 🔴
  const incident = scanCommitGuard("3ddd98dffd36629a4a0f4364a8af44f3a6ceec42");
  if (!incident.hits.some((x) => x.id === "G-STEP-VOCAB-SPLIT-TWO-HOMES"))
    return `⑩ 真史必咬不中：3ddd98dff 未咬在 G-STEP-VOCAB-SPLIT-TWO-HOMES（命中 ${incident.hits.length} 条）`;
  // ⑪ 真史必不咬：a81062e29 是那次 ✅ 回写本身（前进，不是回退）
  const progress = scanCommitGuard("a81062e294ab8bdbfcf88917f0ce0775206028e6");
  if (progress.hits.some((x) => x.id === "G-STEP-VOCAB-SPLIT-TWO-HOMES"))
    return `⑪ 真史必不咬不中：a81062e29 的回写被诬告成回退`;
  return null;
}

function selftest() {
  const c1 = canary();
  if (c1) {
    console.error(`⛔ 判据一金丝雀不中：${c1}`);
    process.exit(2);
  }
  const c2 = guardCanary();
  if (c2) {
    console.error(`⛔ 判据二金丝雀不中：${c2}`);
    process.exit(2);
  }
  console.log("✓ 金丝雀全中（判据一 3 条 · 判据二 7 条含真史双向，均与主逻辑共用同一份实现）。");
}

function main() {
  const argv = process.argv.slice(2);
  const argVal = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes("--selftest")) {
    selftest();
    return 0;
  }

  // ── 金丝雀先行：任一不中 ⇒ RC=2，不许读作「§8 干净」─────────────────────
  const c1 = canary();
  if (c1) {
    console.error(`⛔ 金丝雀不中 ⇒ 门自己坏了：${c1}\n   本次结论作废——不许读作「§8 全部带标记」。`);
    return 2;
  }
  const c2 = guardCanary();
  if (c2) {
    console.error(`⛔ 状态回退金丝雀不中 ⇒ 门自己坏了：${c2}\n   本次结论作废——不许读作「§8 状态无回退」。`);
    return 2;
  }

  let rc = 0;

  // ── 判据一：每个编号行都必须带状态标记 ───────────────────────────────────
  let text;
  try {
    text = readFileSync(ONTO, "utf8");
  } catch (e) {
    console.error(`⛔ 读不出 ${ONTO}（${e.message}）⇒ 工具坏了，不许读作「§8 干净」`);
    return 2;
  }
  const r = scanLines(text.split("\n"));
  if (r.error) {
    console.error(`⛔ ${r.error}`);
    return 2;
  }
  if (r.rows.length < ROW_FLOOR) {
    console.error(`⛔ 扫描面塌陷：§8 编号行仅 ${r.rows.length}（下界 ${ROW_FLOOR}）——抽取口径或章节结构变了，不许读作「零违规」`);
    return 2;
  }
  if (r.unmarked.length > 0) {
    console.error(`🔴 §8 有 ${r.unmarked.length} 个编号行**没有状态标记**（🔴/◑/✅ 三态之一）：`);
    for (const u of r.unmarked) console.error(`   L${u.ln} ${u.id}`);
    console.error("   没标记 = 没人判过，不等于已闭；它永远进不了 dispatch-deficit 的待写WO 队列。");
    console.error("   修法：逐条复核今天还成不成立，在行内补 🔴/◑/✅（参照 WO-ONTO-STATUS-BACKFILL 的复核口径）。");
    rc = 1;
  } else {
    console.log(`✓ 判据一（行必带标记）通过 —— §8 编号行 ${r.rows.length} 条全部带状态标记。`);
  }

  // ── 判据二：区间逐提交审，状态只许前进 ───────────────────────────────────
  const exemptions = loadExemptions();
  let rangeSpec = argVal("--range");
  if (!rangeSpec) {
    const base = argVal("--base") ?? DEFAULT_BASE;
    if (!git(["rev-parse", "--verify", "-q", base], true))
      toolBroken(`基线 ref「${base}」不在本仓`, "先 git fetch 集成线，或用 --range/--base 显式给区间。");
    const mb = git(["merge-base", "HEAD", base], true)?.trim();
    if (!mb) toolBroken(`merge-base(HEAD, ${base}) 求不出来`, "基线参考系缺失 ⇒ 无法界定「本分支新引入的改动」。");
    if (mb === git(["rev-parse", "HEAD"]).trim()) {
      console.log(`· 判据二：区间为空（merge-base == HEAD）——本分支相对 ${base} 无新提交，无事可审（它是收编前的拦门，不是考古工具）。`);
    }
    rangeSpec = `${mb}..HEAD`;
  }
  const commits = git(["rev-list", rangeSpec]).split("\n").filter(Boolean);
  const violations = [];
  const exempted = [];
  let scanned = 0;
  for (const c of commits) {
    const { touched, hits } = scanCommitGuard(c);
    if (touched) scanned++;
    for (const h of hits) {
      const ex = findExemption(exemptions, h.commit, h.id);
      if (ex) exempted.push({ ...h, reason: ex.reason });
      else violations.push(h);
    }
  }
  for (const e of exempted)
    console.log(`· 豁免在案：${e.commit.slice(0, 9)} ${e.id} —— ${e.reason}`);
  if (violations.length > 0) {
    console.error(`\n⛔ §8 状态回退 ${violations.length} 处（✅ 被改回 🔴/◑，判据落行内容 diff，不看提交信息说了什么）：`);
    for (const v of violations)
      console.error(`   ${v.commit.slice(0, 9)} ${v.id} —— 父提交标记「${v.parentMarks}」→ 本提交「${v.childMarks}」`);
    console.error(
      `\n   形态：「我用『提交信息里写了已回写』当作『本体真被回写了』的证据。」（真史两例：G-OEE-DUAL-TRUTH · G-STEP-VOCAB 于合并 3ddd98dff）\n` +
        `   处置二选一：① 救回 ✅（按代码侧证据恢复行内容，附证据链）；\n` +
        `   ② 确属有意打回（原闭合判错/真回归）⇒ 在 scripts/ontology-s8-status-exemptions.json 加一条\n` +
        `      { "commit": "<短哈希>", "id": "<编号>", "reason": "<≥20 字，让下个 dev 不用猜>" }。`
    );
    rc = 1;
  } else {
    console.log(`✓ 判据二（状态只许前进）通过 —— 区间提交 ${commits.length} 个 · 触碰本体 ${scanned} 个 · 状态回退 0（豁免 ${exempted.length}）。`);
  }

  if (rc === 0)
    console.log(`✓ onto-s8-status:check 通过 —— 判据一+判据二均干净（金丝雀在位）。`);
  return rc;
}

try {
  process.exit(main());
} catch (e) {
  if (e && typeof e === "object" && "status" in e) process.exit(e.status);
  console.error(`⛔ onto-s8-status:check 未预期异常 ⇒ 工具坏了（RC=2，不许读作「代码有问题」）：${e?.stack || e}`);
  process.exit(2);
}
