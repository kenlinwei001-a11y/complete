#!/usr/bin/env node
/**
 * 门 `lever-landing-exists:check` · **杠杆落点→本体属性存在性门**（WO-GATE4 ①）
 *
 * ══ 治什么（以及它与 `lever-binding-drift:check` 的分工，别搞混）════════════════
 * 拨杆这条链有**两段**，两段各自可断，断法与修法完全不同：
 *
 *     瓶颈因子层  ──①──▶  `Type.prop` 落点  ──②──▶  本体里那个属性真的存在吗
 *     （LEVER_FACTOR_PROPS）              （LEVER_PROP_META / 绑定表）
 *
 *   ① 由 `lever-binding-drift:check` 守 —— 它只验「因子层有没有落点、落点标没标可拨动」。
 *      那道门自己的诚实边界注释写得很清楚：它**不验落点指向的属性是否真实存在**。
 *   ② 就是本门。**没有任何一道门在守它** —— 于是一个指向不存在属性的落点可以长期存活：
 *      拨杆下发了名字与单位（`LEVER_PROP_META` 给了 label/unit/kind，前端照常渲染一个滑杆），
 *      而后端去对象上读/写那个属性时**读到 undefined、写进一个没人认识的键**，
 *      敏感度恒 0 —— 拨了没反应，**全程 200、无报错**。
 *
 * **实测存量**（2026-08-13，本门首次运行现算）：`MaterialBalance.coverage`。
 * `MaterialBalance` 的真实属性是 `matBalId/material/unit/netDemandTon/ltaPct/gapTon/etaDate`，
 * **没有 `coverage`**。追一层确认这不是误报：`coverage` 是求解器 `lta_gap` 的**输出字段**
 * （`apps/datacore/src/solvers/extended.ts:260` 现算 `ltaAvailable / netDemand`），
 * 也在 `SOLVER_OUTPUT_SHAPES.lta_gap` 里（`solvers/service.ts:340`），
 * 且 `ontology-signature.ts:187` 声明 `mrp_netting` 读的是 `etaDate/gapTon/ltaPct/material/netDemandTon`
 * —— **求解器算得出的中间量 ≠ 对象上存得住的属性**，把前者写进拨杆落点表就是这条链的断点。
 *
 * ══ 判据 ════════════════════════════════════════════════════════════════════════
 *   L1（硬·棘轮）  `LEVER_PROP_META` 的每个键形如 `Type.prop`，其 `Type` 必须在已发布本体
 *                  类型集里存在，且 `prop` 必须落在该类型的 `properties ∪ derivedProperties` 里。
 *   L2（棘轮反向）  基线里挂着的存量违规，一旦被修好就必须从基线删除（豁免只降不升，
 *                  否则基线会变成永久居留权，下一个同名缺陷藏进去没人知道）。
 *
 * **类型集现读、不 grep**：`batteryObjectTypes() ∪ extendedObjectTypes()` 两个都要（实测 94 个类型）。
 * 审核方在这条上被骗过两次 —— `propKey: "leadTime"` 报 0 命中实际存在；
 * `Material`/`ChangeoverMatrix` 在 `battery.ts` 查无、实际在 `battery-extended.ts`。
 * **只读一个文件 = 必然得出「类型不存在」这个相反结论。**
 *
 * ══ 诚实边界（本门**不**保证什么）════════════════════════════════════════════════
 *  · 只证「属性在类型声明里」，**不证「实例上真有值」** —— 一个声明了但恒为 undefined 的属性
 *    照样拨不动，本门看不见。那一维要靠真跑种子的测试。
 *  · 只扫 `LEVER_PROP_META` 这一张表。`LEVER_FACTOR_PROPS`（`solvers/service.ts`）里
 *    多出来的落点不在本门射程（它们由 `lever-binding-drift:check` 的 A2 孤儿判据管）。
 *    ⚠ 实测二者并不同集：`MaterialBalance.coverage` **两张表都有**，所以本门咬得到它；
 *    但若某天有个落点只写进 `LEVER_FACTOR_PROPS` 而没进 `LEVER_PROP_META`，本门看不见。
 *  · 不验单位/值类对不对（`kind: "ratio"` 而属性其实存的是绝对量，本门一样绿）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）。
 * 用法：node scripts/check-lever-landing-exists.mjs   ·   pnpm lever-landing-exists:check
 *      node scripts/check-lever-landing-exists.mjs --list     # 逐条落点判定表
 *      node scripts/check-lever-landing-exists.mjs --update   # 棘轮基线只许收缩式回写
 */
/* ── 退出码纪律 · 顶层兜底（同 WO-GATE-RC2-DISCIPLINE）─────────────────────────
 * 0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * node 对未捕获异常一律退 1 —— 恰好撞上「真有问题」，方向正好相反，故必须顶层兜底。 */
process.on("uncaughtException", (e) => gateToolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
process.on("unhandledRejection", (e) => gateToolBroken(`未预期 rejection（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
function gateToolBroken(what, hint) {
  console.error(`⛔ check-lever-landing-exists.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「落点都存在 / 代码干净 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负，两者处置相反，不许合并）
}

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertDistFresh } from "./dist-freshness.mjs";

const ROOT = process.cwd();
const META_SRC = join(ROOT, "apps/datacore/src/solvers/lever-meta.ts");
const META_DIST = "apps/datacore/dist/solvers/lever-meta.js";
const BATTERY_DIST = "apps/datacore/dist/synthetic/battery.js";
const EXTENDED_DIST = "apps/datacore/dist/synthetic/battery-extended.js";
const BASELINE = join(ROOT, "scripts/lever-landing-baseline.json");

/* ─────────────────────────────────────────────────────────────────────────────
 * 判据本体 —— 金丝雀与主扫描调的是**这一个**函数，不许各抄一份
 * （铁律 0.6 已落地的机制：抄一份 = 装饰品，改主逻辑时金丝雀拿旧的去测照样绿）
 * ─────────────────────────────────────────────────────────────────────────── */

/** 类型集 → `Map<typeKey, Set<propKey>>`（properties ∪ derivedProperties，两者都是"对象上读得到的键"）。 */
export function indexTypeProps(typeDefs) {
  const idx = new Map();
  for (const t of typeDefs) {
    if (!t || typeof t.key !== "string") continue;
    const set = idx.get(t.key) ?? new Set();
    for (const p of t.properties ?? []) if (p?.propKey) set.add(p.propKey);
    for (const d of t.derivedProperties ?? []) if (d?.propKey) set.add(d.propKey);
    idx.set(t.key, set);
  }
  return idx;
}

/**
 * 单条落点判定。**这是本门的牙**，金丝雀喂它、主循环也喂它。
 * @returns {{key:string, type:string|null, prop:string|null, verdict:"OK"|"MALFORMED"|"TYPE_MISSING"|"PROP_MISSING", known?:string[]}}
 */
export function judgeLanding(key, typeIndex) {
  const i = String(key).indexOf(".");
  if (i <= 0 || i === String(key).length - 1) {
    return { key, type: null, prop: null, verdict: "MALFORMED" };
  }
  const type = String(key).slice(0, i);
  const prop = String(key).slice(i + 1);
  const props = typeIndex.get(type);
  if (!props) return { key, type, prop, verdict: "TYPE_MISSING" };
  if (!props.has(prop)) return { key, type, prop, verdict: "PROP_MISSING", known: [...props] };
  return { key, type, prop, verdict: "OK" };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 现读 dist（守卫必须在 import 之前：本门读 dist 却下**源码**结论，dist 旧了会说反话）
 * ─────────────────────────────────────────────────────────────────────────── */
assertDistFresh([META_DIST, BATTERY_DIST, EXTENDED_DIST], { gate: "lever-landing-exists:check" });

let LEVER_PROP_META, batteryObjectTypes, extendedObjectTypes;
try {
  ({ LEVER_PROP_META } = await import(`file://${join(ROOT, META_DIST)}`));
  ({ batteryObjectTypes } = await import(`file://${join(ROOT, BATTERY_DIST)}`));
  ({ extendedObjectTypes } = await import(`file://${join(ROOT, EXTENDED_DIST)}`));
} catch (e) {
  gateToolBroken(`载入 datacore 构建产物失败（${e?.message || e}）`, "先跑：pnpm --filter datacore build");
}
if (typeof batteryObjectTypes !== "function" || typeof extendedObjectTypes !== "function") {
  gateToolBroken("`batteryObjectTypes` / `extendedObjectTypes` 不是函数（构建产物形状变了？）");
}

let TYPES;
try {
  TYPES = [...batteryObjectTypes(), ...extendedObjectTypes()];
} catch (e) {
  gateToolBroken(`枚举本体类型时抛异常（${e?.message || e}）`);
}
const typeIndex = indexTypeProps(TYPES);
const metaKeys = Object.keys(LEVER_PROP_META ?? {});

/* ─────────────────────────────────────────────────────────────────────────────
 * 金丝雀 · **双向**，且与主逻辑共用 judgeLanding / indexTypeProps
 *   必中   —— 已知合规的样例，判据必须认出它（认不出 = 判据瞎了，全表会假绿）
 *   必不中 —— 不可能存在的样例，必须数到 0（数到 >0 = 判据恒真，全表也是假绿）
 * ⚠ 单向金丝雀测不出「恒真/恒假判定器」，这是本仓栽过的形态，故两向都要。
 * ─────────────────────────────────────────────────────────────────────────── */
const MIN_TYPES = 80;   // 实测 94；低于此下界多半是只读到一个文件（审核方栽过的那种）
const MIN_META = 8;     // 实测 12
const CANARIES = [
  { name: "必中·Line.utilization（真属性，产线利用率拨杆的落点）", key: "Line.utilization", want: "OK" },
  { name: "必中·Material.leadTime（曾被 grep 报 0 命中、实际存在的那一条）", key: "Material.leadTime", want: "OK" },
  { name: "必中·ChangeoverMatrix.minutes（类型住在 battery-extended.ts，只读 battery.ts 会误判类型不存在）", key: "ChangeoverMatrix.minutes", want: "OK" },
  { name: "必不中·__NoSuchType_G4__.whatever（类型不存在）", key: "__NoSuchType_G4__.whatever", want: "TYPE_MISSING" },
  { name: "必不中·Line.__no_such_prop_G4__（类型在、属性不在 ⇒ 证明判定不是只查到类型就收工）", key: "Line.__no_such_prop_G4__", want: "PROP_MISSING" },
  { name: "必不中·NoDotAtAll（形状不合法）", key: "NoDotAtAll", want: "MALFORMED" },
];
{
  const bad = [];
  if (TYPES.length < MIN_TYPES) bad.push(`本体类型只枚举到 ${TYPES.length} 个（下界 ${MIN_TYPES}）——多半是只读到一个来源`);
  if (metaKeys.length < MIN_META) bad.push(`LEVER_PROP_META 只读到 ${metaKeys.length} 个键（下界 ${MIN_META}）——构建产物异常`);
  for (const c of CANARIES) {
    const got = judgeLanding(c.key, typeIndex).verdict;
    if (got !== c.want) bad.push(`${c.name} —— 期望 ${c.want}，实得 ${got}`);
  }
  if (bad.length) {
    gateToolBroken("金丝雀不中 ⇒ **门自己瞎了**：\n   · " + bad.join("\n   · "));
  }
}

/* ── dist ↔ src 内容交叉核对（mtime 之外的第二道；worktree 继承旧 dist 时 mtime 常不可靠）──
 * 本门讲的是**源码**的话，读的却是 dist。两边键集不一致时任何结论都是假的。 */
{
  if (!existsSync(META_SRC)) gateToolBroken(`找不到源码 ${META_SRC}（本门要拿它与 dist 交叉核对）`);
  const src = readFileSync(META_SRC, "utf8");
  // 只取形如 `"Type.prop": {` 的键（与 dist 的 Object.keys 同一集合）
  const srcKeys = new Set([...src.matchAll(/"([A-Za-z_$][\w$]*\.[\w$]+)"\s*:\s*\{/g)].map((m) => m[1]));
  if (srcKeys.size === 0) {
    gateToolBroken(`从源码 ${META_SRC} 抽出 0 个 \`Type.prop\` 键 ⇒ 抽取式失配，不是「表是空的」`);
  }
  const onlySrc = [...srcKeys].filter((k) => !metaKeys.includes(k));
  const onlyDist = metaKeys.filter((k) => !srcKeys.has(k));
  if (onlySrc.length || onlyDist.length) {
    gateToolBroken(
      "dist 与源码的 LEVER_PROP_META 键集不一致 ⇒ **dist 过期**，此时本门的任何结论都是假的" +
        (onlySrc.length ? `\n   仅在源码：${onlySrc.join(" · ")}` : "") +
        (onlyDist.length ? `\n   仅在 dist：${onlyDist.join(" · ")}` : ""),
      "先跑：pnpm --filter datacore build（**不许**据此去改 lever-meta.ts）",
    );
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 主判据
 * ─────────────────────────────────────────────────────────────────────────── */
const rows = metaKeys.map((k) => judgeLanding(k, typeIndex));
const violations = rows.filter((r) => r.verdict !== "OK");

/* ── 棘轮基线（只降不升） ── */
function loadBaseline() {
  if (!existsSync(BASELINE)) {
    gateToolBroken(`基线文件不存在（${BASELINE}）`, "从 canonical 取回，或先跑 `--update` 生成。");
  }
  let j;
  try { j = JSON.parse(readFileSync(BASELINE, "utf8")); } catch (e) { gateToolBroken(`基线不是合法 JSON（${e?.message || e}）`); }
  if (!j || typeof j.exempt !== "object" || j.exempt === null) gateToolBroken("基线结构不对（缺 `exempt` 对象）");
  return j;
}

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  console.log(`· 本体类型 ${TYPES.length} 个 · LEVER_PROP_META ${metaKeys.length} 条落点`);
  for (const r of rows) console.log(`  ${r.verdict === "OK" ? "✓" : "✗"} ${r.key.padEnd(32)} ${r.verdict}`);
  process.exit(0);
}
if (argv.includes("--update")) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { exempt: {} };
  const exempt = {};
  for (const v of violations) {
    exempt[v.key] = prev.exempt?.[v.key] || { verdict: v.verdict, why: "TODO：写清楚为什么这条落点今天还指向一个不存在的属性（空 why 会被门判红）" };
  }
  writeFileSync(BASELINE, JSON.stringify({
    note: "lever-landing-exists 棘轮基线：存量「落点指向不存在属性」的具名豁免，只许降不许升。每条必须写 why。",
    generatedBy: "node scripts/check-lever-landing-exists.mjs --update",
    exempt,
  }, null, 2) + "\n");
  console.log(`已写基线：豁免 ${Object.keys(exempt).length} 条（${BASELINE}）`);
  process.exit(0);
}

const baseline = loadBaseline();
const exempt = baseline.exempt || {};
const fail = [];
const usedExempt = new Set();

for (const v of violations) {
  const e = exempt[v.key];
  if (!e) {
    fail.push(
      `L1 落点不存在：\`${v.key}\` —— ${describe(v)}\n` +
        `      后果：拨杆下发了名字与单位（LEVER_PROP_META 给了 label/unit/kind，前端照常渲染滑杆），\n` +
        `           而后端读/写的是一个对象上并不存在的键 ⇒ 敏感度恒 0、拨了没反应、**全程 200 无报错**。\n` +
        `      修法二选一：① 把落点改指该类型真有的属性；② 若这个量确实该存在，先在本体上补出这条属性再来登记。\n` +
        `           ⚠ 求解器**输出字段**不等于对象**属性** —— 这正是存量那条的成因，别把中间量当落点。`,
    );
  } else {
    usedExempt.add(v.key);
    if (!e.why || !String(e.why).trim() || /^TODO/.test(String(e.why))) {
      fail.push(`L1 豁免无理由：\`${v.key}\` 在基线里但没写 why —— 豁免必须说清理由，否则等于永久居留权`);
    }
  }
}
// L2 棘轮反向：修好了却还挂在基线上 ⇒ 红，逼名单单调收缩
for (const k of Object.keys(exempt)) {
  if (usedExempt.has(k)) continue;
  const cur = judgeLanding(k, typeIndex);
  const why = cur.verdict === "OK"
    ? `\`${k}\` 现在已经解析得到（类型 ${cur.type} 上真有 ${cur.prop}）—— 豁免已过期`
    : `\`${k}\` 已不在 LEVER_PROP_META 里 —— 豁免已过期`;
  fail.push(`L2 棘轮：${why}。请从 scripts/lever-landing-baseline.json 的 exempt 删掉该条（只降不升）。`);
}

function describe(v) {
  if (v.verdict === "MALFORMED") return "键的形状不是 `Type.prop`";
  if (v.verdict === "TYPE_MISSING") return `对象类型 \`${v.type}\` 在已发布本体（battery ∪ extended 共 ${TYPES.length} 类）里不存在`;
  return `类型 \`${v.type}\` 存在，但它的属性集里没有 \`${v.prop}\`；实有属性：${(v.known || []).join("/")}`;
}

/* ── 报告 ── */
console.log(
  `✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中` +
    `（必中 ${CANARIES.filter((c) => c.name.startsWith("必中")).length} + 必不中 ${CANARIES.filter((c) => c.name.startsWith("必不中")).length}）`,
);
console.log(
  `· lever-landing-exists：本体类型 ${TYPES.length} 个（battery ∪ extended，两个来源都读）· ` +
    `LEVER_PROP_META ${metaKeys.length} 条落点 · 落点存在 ${rows.length - violations.length} · 不存在 ${violations.length}（已豁免 ${usedExempt.size}）`,
);
for (const v of violations) console.log(`  ✗ ${v.key} → ${v.verdict}${exempt[v.key] ? "（基线豁免）" : ""}`);
console.log("· ⚠ 诚实边界：只证「属性在类型声明里」，**不证「实例上真有值」**；只扫 LEVER_PROP_META 这一张表。");

if (fail.length) {
  console.error(`\n✗ lever-landing-exists:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error("  - " + m);
  process.exit(1); // 1 = 真有违规（与上面所有 gateToolBroken 的 2 严格分开）
}
console.log("\n✓ lever-landing-exists:check 通过（每条杠杆落点都指向本体上真实存在的属性 · 豁免名单无冗余）。");
