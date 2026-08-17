#!/usr/bin/env node
/**
 * 门 `onto-s8-status:check` · **§8 断点状态标记门**（WO-ONTO-STATUS-BACKFILL 建）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * `docs/SYSTEM-ONTOLOGY.md` §8「已知断点登记」是 `scripts/dispatch-deficit.sh`
 * 「待写WO」队列的**唯一来源**，而那个队列**按行内状态标记抽取**
 * （`🔴 未修` / `◑ 部分闭合`）。2026-08-18 实测：§8 共 193 个编号行，
 * 其中 **27 行连一个状态标记（🔴/◑/✅）都没有** —— 这些断点是开是闭没人知道，
 * 且**永远进不了派单队列**（工单转述的历史数是 190 行 / 104 行无标记 / 95 个唯一编号，
 * 收编日复核以现算为准：文档在持续演进，数已对不上，按现算顶回）。
 * 当单已把 27 行逐条复核补标；**本门守的是「不许再长回来」**：
 *
 *   > **§8 每个编号行都必须带至少一个状态标记（🔴 / ◑ / ✅）。**
 *   > 新增断点不带标记 ⇒ 红。没标记不等于已闭 —— 它只等于「没人判过」。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『行里没有状态标记』当作『断点已闭』的证据，而前者并不度量后者。」**
 *
 * ══ 两个实测坑（都真栽过，写在这里防复发）══════════════════════════════════════
 *  ① **§8 单元格内嵌 `|`**，一行实测列数 2/3/4/6/13 不等 ⇒ **按「最后一列」
 *     切分判状态会把列切碎**。本门**按整行抽标记序列**，不做列切分。
 *  ② **订正文字里写状态短语会被抽取器数进去** —— 在本体文档其它章节写
 *     「🔴 未修」这类字面序列会 inflate `dispatch-deficit.sh` 的队列计数。
 *     本门的 §7 条目与本文件头注都刻意不把这些序列写进本体文档。
 *
 * ══ 编号口径 ═══════════════════════════════════════════════════════════════════
 * 编号行 = 行首 `| <ID> |`，ID 匹配 `/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/`
 * （覆盖 `G-*` / `BP-*` / `GAP-*` / `SUPPLY-DEMAND` 等现有形态；表头「编号」
 * 是 CJK 不匹配、分隔行 `|---` 不匹配）。同日实测 §8 内 198 个编号行
 * （193 个 `G-*` + 5 个非 `G-*`），全部已带标记。
 *
 * ══ 金丝雀（与主逻辑共用同一份实现，不另抄正则）═══════════════════════════════
 * 每次运行先过四条金丝雀，任一不中 ⇒ RC=2（门坏了），**不许**读作「§8 全带标记」：
 *  ① 必咬：无标记的编号行样例必须被 `scanLines()` 报出；
 *  ② 必不咬：带标记的编号行样例必须干净（恒真判据同样是坏的）；
 *  ③ 必不咬：表头/分隔行不得被当成编号行（口径过宽会诬告）；
 *  ④ 扫描面下界自证：真文档 §8 编号行 < 100 ⇒ 报工具坏了
 *     （§8 被改名/移动时抽取会安静地归 0，那是假绿不是干净）。
 *
 * ══ 退出码三分 ═════════════════════════════════════════════════════════════════
 *  0 = §8 全部编号行带标记 · 1 = 真有无标记编号行（逐行列出）· 2 = 门自己坏了。
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONTO = join(ROOT, "docs", "SYSTEM-ONTOLOGY.md");

const ID_ROW_RE = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*\|/;
const MARK_RE = /[🔴◑✅]/;
const ROW_FLOOR = 100;

/** 主抽取：给一段文本的行，返回 { rows, unmarked }。金丝雀与主判据共用这一份。 */
function scanLines(lines) {
  const start = lines.findIndex((l) => l.startsWith("## 8."));
  if (start === -1) return { error: "找不到 §8（## 8. 已知断点登记）——章节被改名/移动时**不许**读作「零违规」" };
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  const rows = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(ID_ROW_RE);
    if (m) rows.push({ ln: i + 1, id: m[1], marked: MARK_RE.test(lines[i]) });
  }
  return { rows, unmarked: rows.filter((r) => !r.marked) };
}

/** 金丝雀：四条全过才许信主判据。返回 null = 通过，否则为失败原因串。 */
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

function main() {
  const c = canary();
  if (c) {
    console.error(`⛔ 金丝雀不中 ⇒ 门自己坏了：${c}\n   本次结论作废——不许读作「§8 全部带标记」。`);
    return 2;
  }
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
    return 1;
  }
  console.log(`✓ onto-s8-status:check 通过 —— §8 编号行 ${r.rows.length} 条全部带状态标记（金丝雀 3/3 在位）。`);
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error(`⛔ onto-s8-status:check 未预期异常 ⇒ 工具坏了（RC=2，不许读作「代码有问题」）：${e?.stack || e}`);
  process.exit(2);
}
