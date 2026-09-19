#!/usr/bin/env node
/**
 * 门 `ontology-s8-dedupe:check` · **§8 断点编号唯一门**（WO-ONTO-DEDUPE 建）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * `docs/SYSTEM-ONTOLOGY.md` §8「已知断点登记」是断点开/闭的**唯一权威清单**。
 * 2026-08-17 WO-BREAKPOINT-TRIAGE 实测：§8 有 **13 个编号各占 2 行以上**
 * （`G-GATE-ROSTER-HANDCOPIED` 一个编号占 4 行最多）。同一编号几行各写各的状态，
 * 最老一行还留着早已被证伪的判负理由 —— 「这条断点到底闭没闭」要靠人脑并集，
 * 而先读到旧行的人会拿到**已证伪**的答案。
 * 当单已把 13 个重复编号逐组判「同一笔账 / 多个子缺口」后收口（每组只留一行，
 * 旧行独有内容并入）；**本门守的是「不许再长回来」**：
 *
 *   > **§8 每个编号只允许占一行：编号行数必须 == 唯一编号数。**
 *   > 同一编号要记第二笔 ⇒ 要么并进既有行，要么拆成 `编号-1`/`编号-2` 显式子项
 *   > （子项编号天然唯一，本门照过）；不许再出现同编号的两行。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『某一行写着已闭』当作『这条断点闭了』的证据，而同编号的另一行写着相反的话。」**
 *
 * ══ 两个实测坑（P2 已趟过，照抄结论）══════════════════════════════════════════
 *  ① **§8 单元格内嵌 `|`**，一行实测列数 2/3/4/6/13 不等 ⇒ **按列切会把行切碎**。
 *     本门**按整行行首抽编号**，不做列切分。
 *  ② **行文里写字面状态标记会被状态抽取器数进去** —— 本文件头注与 §7 条目
 *     刻意不把这些序列写进本体文档（见 onto-s8-status:check 头注坑②）。
 *
 * ══ 编号口径（与 onto-s8-status:check 同一份，刻意保持一致）════════════════════
 * 编号行 = 行首 `| <ID> |`，ID 匹配 `/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/`
 * （覆盖 `G-*` / `BP-*` / `GAP-*` / `SUPPLY-DEMAND-BIDIR` 等现有形态；表头「编号」
 * 是 CJK 不匹配、分隔行 `|---` 不匹配）。**诚实边界**：`C1` / `Ch63` 这类无连字符
 * 的编号不在此口径内（现行各一行、无重复）；若以后它们出现重复，先扩口径再判。
 *
 * ══ 金丝雀（与主逻辑共用同一份实现，不另抄正则）═══════════════════════════════
 * 每次运行先过四条金丝雀，任一不中 ⇒ RC=2（门坏了），**不许**读作「§8 编号全唯一」：
 *  ① 必咬：同编号占两行的样例必须被 `scanIds()` 报出；
 *  ② 必不咬：一编号一行的样例必须干净（恒真判据同样是坏的）；
 *  ③ 必不咬：表头/分隔行不得被当成编号行（口径过宽会诬告）；
 *  ④ 扫描面下界自证：真文档 §8 编号行 < 100 ⇒ 报工具坏了
 *     （§8 被改名/移动时抽取会安静地归 0，那是假绿不是干净）。
 *
 * ══ 退出码三分 ═════════════════════════════════════════════════════════════════
 *  0 = §8 编号行数 == 唯一编号数 · 1 = 真有重复编号（逐组列出行号）· 2 = 门自己坏了。
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONTO = join(ROOT, "docs", "SYSTEM-ONTOLOGY.md");

const ID_ROW_RE = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*\|/;
const ROW_FLOOR = 100;

/** 主抽取：给一段文本的行，返回 { rows, dupGroups }。金丝雀与主判据共用这一份。 */
function scanIds(lines) {
  const start = lines.findIndex((l) => l.startsWith("## 8."));
  if (start === -1) return { error: "找不到 §8（## 8. 已知断点登记）——章节被改名/移动时**不许**读作「零重复」" };
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  const rows = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(ID_ROW_RE);
    if (m) rows.push({ ln: i + 1, id: m[1] });
  }
  const byId = new Map();
  for (const r of rows) {
    const arr = byId.get(r.id) ?? [];
    arr.push(r.ln);
    byId.set(r.id, arr);
  }
  const dupGroups = [...byId.entries()].filter(([, lns]) => lns.length > 1).map(([id, lns]) => ({ id, lns }));
  return { rows, dupGroups };
}

/** 金丝雀：四条全过才许信主判据。返回 null = 通过，否则为失败原因串。 */
function canary() {
  // ① 必咬：同编号占两行（其中一行带「已闭」样状态、另一行写着相反的话——正是本病的现场）
  const bad = scanIds([
    "## 8. 已知断点登记",
    "",
    "| G-CANARY-DUP | 某断点描述 | 某链路 | 已闭 |",
    "| G-CANARY-DUP | 同一断点的旧登记 | 某链路 | 仍未修 |",
    "",
    "## 9. 后续章节",
  ]);
  if (bad.error || bad.dupGroups.length !== 1 || bad.dupGroups[0].id !== "G-CANARY-DUP" || bad.dupGroups[0].lns.length !== 2)
    return `① 必咬不中：同编号两行样例未被报出（dupGroups=${bad.dupGroups?.length ?? "?"}）`;
  // ② 必不咬：一编号一行 + 显式子项（编号-1/编号-2 天然唯一，照样过）
  const good = scanIds([
    "## 8. 已知断点登记",
    "| G-CANARY-SOLO | 描述 | 链路 | 已闭 |",
    "| G-CANARY-SPLIT-1 | 子缺口一 | 链路 | 已闭 |",
    "| G-CANARY-SPLIT-2 | 子缺口二 | 链路 | 未修 |",
    "## 9. x",
  ]);
  if (good.error || good.dupGroups.length !== 0 || good.rows.length !== 3)
    return `② 必不咬不中：唯一编号/显式子项样例被诬告（dupGroups=${good.dupGroups?.length ?? "?"}·rows=${good.rows?.length ?? "?"}）`;
  // ③ 必不咬：表头与分隔行不是编号行
  const hdr = scanIds([
    "## 8. 已知断点登记",
    "| 编号 | 断点 | 链路位置 | 性质 |",
    "|---|---|---|---|",
    "| G-CANARY-ONLY | 描述 | 链路 | 已闭 |",
    "## 9. x",
  ]);
  if (hdr.error || hdr.rows.length !== 1 || hdr.rows[0].id !== "G-CANARY-ONLY")
    return `③ 口径过宽：表头/分隔行被当成编号行（rows=${hdr.rows?.length ?? "?"}）`;
  return null;
}

function main() {
  const c = canary();
  if (c) {
    console.error(`⛔ 金丝雀不中 ⇒ 门自己坏了：${c}\n   本次结论作废——不许读作「§8 编号全唯一」。`);
    return 2;
  }
  let text;
  try {
    text = readFileSync(ONTO, "utf8");
  } catch (e) {
    console.error(`⛔ 读不出 ${ONTO}（${e.message}）⇒ 工具坏了，不许读作「§8 干净」`);
    return 2;
  }
  const r = scanIds(text.split("\n"));
  if (r.error) {
    console.error(`⛔ ${r.error}`);
    return 2;
  }
  if (r.rows.length < ROW_FLOOR) {
    console.error(`⛔ 扫描面塌陷：§8 编号行仅 ${r.rows.length}（下界 ${ROW_FLOOR}）——抽取口径或章节结构变了，不许读作「零重复」`);
    return 2;
  }
  if (r.dupGroups.length > 0) {
    console.error(`✗ §8 有 ${r.dupGroups.length} 个编号各占多行（编号行 ${r.rows.length} · 唯一编号 ${r.rows.length - r.dupGroups.reduce((a, g) => a + g.lns.length - 1, 0)}）：`);
    for (const g of r.dupGroups) console.error(`   ${g.id} → 行 ${g.lns.join(" / ")}`);
    console.error("   同一编号几行各写各的状态 ⇒「这条断点到底闭没闭」要靠人脑并集，先读到旧行的人拿到已证伪的答案。");
    console.error("   修法：逐行判「同一笔账还是多个子缺口」——同一笔账：只留信息最全的一行，旧行独有内容并进去；");
    console.error("        子缺口：拆成 `编号-1`/`编号-2` 显式子项（不许丢内容）。参照 WO-ONTO-DEDUPE 的合并口径。");
    return 1;
  }
  console.log(`✓ ontology-s8-dedupe:check 通过 —— §8 编号行 ${r.rows.length} 条 == 唯一编号 ${r.rows.length} 个（金丝雀 3/3 在位）。`);
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error(`⛔ ontology-s8-dedupe:check 未预期异常 ⇒ 工具坏了（RC=2，不许读作「代码有问题」）：${e?.stack || e}`);
  process.exit(2);
}
