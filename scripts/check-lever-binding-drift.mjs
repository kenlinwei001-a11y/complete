#!/usr/bin/env node
/**
 * 门 `lever-binding-drift:check` · 瓶颈因子→杠杆落点漂移门（WO-LEVER-BINDING-DRIFT·闭 `G-LEVER-BINDING-DRIFT`）
 *
 * ─── 治什么 ────────────────────────────────────────────────────────────────────
 * 产能拨杆的候选反推是**两张表 join** 出来的，而这两张表分别住在两个包里、谁都不认识谁：
 *
 *   `apps/datacore/src/solvers/service.ts`   `LEVER_FACTOR_PROPS`        瓶颈因子名 → `Type.prop` 集
 *   `packages/contracts/src/capacity-factors.ts` `CAPACITY_FACTOR_BINDINGS`  20 原子因子 → `Type.prop` 落点
 *
 * `discoverCapacityLevers`（生产 `grain='process-model'` 那条分支）取二者**交集**作候选：
 *
 *     wantProps = ⋃ LEVER_FACTOR_PROPS[factor]
 *     cands     = CAPACITY_FACTOR_BINDINGS.filter(writable && grain匹配 && wantProps.has(`${objectType}.${prop}`))
 *
 * 交集空 ⇒ 候选 0 ⇒ 该瓶颈层**永远拨不出杠杆**，而且**没有任何报错**：前端拿到 `levers: []`
 * 只会渲染一个空面板，后端 200。真实发生过：`设备OEE` 指向 `Equipment.oee_current`，
 * 而绑定表把 OEE 建模成 `oeeA/oeeP/oeeQ` 三原子、没有 `oee_current` —— 设备层拨杆自上线起从未出过候选。
 *
 * 为什么单元测试抓不到：这是**两个包各自都对、合起来才错**的接缝缺陷（SEAM-GATE 的典型形态），
 * 且当时唯一相关的测试走的是**另一条分支**（不传 grain → ontology-core derivationSpecs 反向 walk），
 * 与生产实参交集为空（CLAUDE.md 铁律 0.5 判据⑥「路径开关类假绿」）。
 *
 * ─── 两条判据 ──────────────────────────────────────────────────────────────────
 *   A1 层可反推（硬·无豁免）  每个 `LEVER_FACTOR_PROPS` 因子键，**至少**有一个落点在绑定表里
 *                             且 `writable` + grain 兼容 `'process-model'`（= 逐字复刻生产谓词）。
 *                             违反 = 该层拨杆面板恒空。这是本门的牙。
 *   A2 落点无孤儿（棘轮）      `LEVER_FACTOR_PROPS` 出现的每个 `Type.prop` 都应能在绑定表落点全集
 *                             （`factorPropKeys()`）里找到。存量 5 条孤儿具名豁免、**只降不升**；
 *                             豁免按 `因子→Type.prop` 精确匹配（非计数），故新孤儿藏不进去。
 *
 * A1 与 A2 刻意分开——修法完全不同（铁律 0.5 判据①）：A1 红 = 整层断了，必须补落点；
 * A2 红 = 多写了一个够不着的落点，通常是笔误或跨包改名，删掉或补登记皆可。
 *
 * ─── 诚实边界（这门**不**保证什么）─────────────────────────────────────────────
 * 本门是**静态**的：只证「落点在表里且标着可拨动」，**不证「拨了真有用」**。
 * 落点登记齐全但敏感度恒 0（产能链根本不读它 / `patchCapacityContext` 不认该对象类型）
 * 照样拨不出杠杆，本门一律看不见。交付时实测存量两例：
 *   ⑩ 瓶颈工序 → `Line.utilization`（`capacity.ts:112` 读的是 `Process.utilization`，落点挂错对象类型）
 *   ⑤ 换型损失 → `ChangeoverMatrix.changeoverMin`（`patchCapacityContext` 的 switch 不认该类型，override 被静默丢弃）
 * 那一维由 `apps/datacore/test/lever-binding-drift.test.ts` 的逐层普查棘轮咬（它真跑求解器）。
 * **别把本门的绿读成「拨杆都能用」** —— 绿测试≠能用，本门只封死其中一种断法。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-LEVER-BINDING-DRIFT`（本门所闭断点）。
 * 用法：node scripts/check-lever-binding-drift.mjs   ·   pnpm lever-binding-drift:check
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SERVICE = join(ROOT, "apps/datacore/src/solvers/service.ts");
const CONTRACT_SRC = join(ROOT, "packages/contracts/src/capacity-factors.ts");
const CONTRACT_DIST = join(ROOT, "packages/contracts/dist/capacity-factors.js");
/** 生产实参：`RiskBoardView.tsx` 给 `DynamicLeverPanel` 传的 grain（拨杆发现唯一走这条）。 */
const PROD_GRAIN = "process-model";

const fail = [];
const note = [];

/* ---------------------------------------------------------------------------
 * 存量孤儿豁免（A2）· 只降不升 · 精确匹配 `因子||Type.prop`
 * 这 5 条都是**真实存在的本体属性**，只是不在 20 原子因子（marks ①–⑳）这张表里——
 * 它们是 LEVER_FACTOR_PROPS 给某层补的额外落点，各自所属的层都另有 ≥1 个真落点（故 A1 不红）。
 * 要清掉它们得扩 20 因子表或改分层，属另一张 WO。
 * ------------------------------------------------------------------------- */
const ORPHAN_ALLOW = new Map([
  ["物料齐套||MaterialBalance.coverage", "MaterialBalance 是齐套缺口对象（C06/C16 规则域），不在 20 原子因子表内；该层真落点为 ⑬ Material.onHand / ⑮ Material.leadTime"],
  ["物料齐套||Order.outsourceRatio", "外协比例是订单侧调节量（C08 红线），20 因子表只登记 ⑲ Order.qty"],
  ["人力工时||Process.shiftHours", "⑯ 把「班次时长×班次」合并登记为 Process.shifts 一个落点，shiftHours 未单列"],
  ["换型损失||Order.outsourceRatio", "同上（外协比例）；该层真落点为 ⑤ ChangeoverMatrix.changeoverMin"],
  ["物流时长||Shipment.etaDay", "Shipment 是在途运力对象，不在 20 原子因子表内；该层真落点为 ⑮ Material.leadTime"],
]);

/* ---------- 读绑定表：import 构建产物，真接线 factorPropKeys（本门存在的另一半意义） ---------- */
if (!existsSync(CONTRACT_DIST)) {
  console.error(
    `✗ lever-binding-drift:check：找不到 ${CONTRACT_DIST}\n` +
      `  本门 import 契约包**构建产物**以复用 factorPropKeys()/matchesGrain() 真实现（不抄一份进门里，否则门与被守对象各存一份定义 = 它要治的病本身）。\n` +
      `  → 先 \`pnpm --filter @platform/contracts build\`（scripts/gate.sh 与 CI 均在 pnpm gates 之前跑 pnpm -r build，故正常链路上必然已存在）。`,
  );
  process.exit(1);
}
const { CAPACITY_FACTOR_BINDINGS, factorPropKeys, matchesGrain } = await import(`file://${CONTRACT_DIST}`);

/* ---------- 读 LEVER_FACTOR_PROPS：从生产源码现场解析（它未导出，且真值源就是那份源码） ---------- */
if (!existsSync(SERVICE)) {
  console.error(`✗ lever-binding-drift:check：找不到 ${SERVICE}`);
  process.exit(1);
}
const svc = readFileSync(SERVICE, "utf8");
const block = svc.match(/const LEVER_FACTOR_PROPS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/);
if (!block) {
  console.error(
    "✗ lever-binding-drift:check：在 apps/datacore/src/solvers/service.ts 里解析不到 `LEVER_FACTOR_PROPS` 声明。\n" +
      "  它可能被改名/改形（如挪进别的文件或换成 Map）——**这不是可以忽略的解析失败**：\n" +
      "  声明一旦变形，本门就再也守不住那条 join，必须同步改本门的解析式。",
  );
  process.exit(1);
}
const LEVER_FACTOR_PROPS = {};
for (const line of block[1].split("\n")) {
  const e = line.match(/^\s*([^\s:]+)\s*:\s*\[(.*?)\]\s*,/);
  if (!e) continue;
  LEVER_FACTOR_PROPS[e[1]] = [...e[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/* ---------------------------------------------------------------------------
 * 金丝雀：先自证工具是好的，再谈结论（CLAUDE.md 铁律 0.5 判据⑤——
 * 「报 0 命中前先拿一个你确定存在的符号跑一遍；它若也报 0，那是工具坏了不是代码死了」）。
 * ------------------------------------------------------------------------- */
const factorKeys = Object.keys(LEVER_FACTOR_PROPS);
const allProps = factorPropKeys(); // ← 交叉校验函数在此真接线（此前零调用方）
const CANARY = { factor: "良率波动", prop: "Process.yield_baseline" }; // 绑定 ⑥·我确定它存在
const canaryErrs = [];
if (factorKeys.length === 0) canaryErrs.push("LEVER_FACTOR_PROPS 解析出 0 个因子键（解析式失配）");
if (!Array.isArray(allProps) || allProps.length === 0) canaryErrs.push("factorPropKeys() 返回空（契约包构建产物异常）");
if (allProps.length !== CAPACITY_FACTOR_BINDINGS.length)
  canaryErrs.push(`factorPropKeys() 返回 ${allProps.length} 条 ≠ 绑定表 ${CAPACITY_FACTOR_BINDINGS.length} 条（落点全集不完整）`);
if (!(LEVER_FACTOR_PROPS[CANARY.factor] ?? []).includes(CANARY.prop))
  canaryErrs.push(`金丝雀因子「${CANARY.factor}」在 LEVER_FACTOR_PROPS 里查不到 ${CANARY.prop}`);
if (!allProps.includes(CANARY.prop)) canaryErrs.push(`金丝雀落点 ${CANARY.prop} 不在绑定表落点全集里`);
if (canaryErrs.length) {
  console.error("✗ lever-binding-drift:check 金丝雀失败 —— **是门坏了，不是代码坏了**，先修门再看结论：");
  for (const m of canaryErrs) console.error(`  - ${m}`);
  process.exit(1);
}

/* ---------- A1 层可反推（硬·逐字复刻生产谓词 service.ts discoverCapacityLevers 候选筛选） ---------- */
const dialable = new Map(); // `Type.prop` → binding（writable 且 grain 兼容生产实参）
for (const b of CAPACITY_FACTOR_BINDINGS) {
  if (b.writable && matchesGrain(b.grain, PROD_GRAIN)) dialable.set(`${b.objectType}.${b.prop}`, b);
}
for (const factor of factorKeys) {
  const props = LEVER_FACTOR_PROPS[factor] ?? [];
  const hit = props.filter((p) => dialable.has(p));
  if (hit.length === 0) {
    fail.push(
      `A1 层可反推：瓶颈因子「${factor}」的落点 [${props.join(", ") || "（空）"}] 在 CAPACITY_FACTOR_BINDINGS 里\n` +
        `      一个都不满足「writable 且 grain 兼容 '${PROD_GRAIN}'」⇒ discoverCapacityLevers 候选集为空\n` +
        `      ⇒ 该层拨杆面板**恒空且不报错**（后端 200 + levers:[]）。\n` +
        `      修法：给该层至少一个落点登记进 packages/contracts/src/capacity-factors.ts（writable:true·grain:'process'|'model-material'），\n` +
        `           或把 LEVER_FACTOR_PROPS['${factor}'] 改指一个已登记的可拨动落点。`,
    );
  } else {
    note.push(`  ✓ ${factor.padEnd(6)} → ${hit.join(", ")}`);
  }
}

/* ---------- A2 落点无孤儿（棘轮·精确豁免） ---------- */
const bound = new Set(allProps);
const usedAllow = new Set();
for (const factor of factorKeys) {
  for (const p of LEVER_FACTOR_PROPS[factor] ?? []) {
    if (bound.has(p)) continue;
    const key = `${factor}||${p}`;
    if (ORPHAN_ALLOW.has(key)) { usedAllow.add(key); continue; }
    fail.push(
      `A2 落点无孤儿：LEVER_FACTOR_PROPS['${factor}'] 里的 ${p} 在 CAPACITY_FACTOR_BINDINGS 找不到落点（未豁免）。\n` +
        `      要么它是笔误/跨包改名残留（删掉），要么该落点确应登记进 20 因子绑定表（补登记）。\n` +
        `      确认属"暂时够不着但保留"的，加进本门 ORPHAN_ALLOW 并写明理由——豁免只降不升，别默默加。`,
    );
  }
}
// 棘轮：豁免项一旦不再是孤儿（被补登记了），必须从豁免表删掉，否则豁免表只会越攒越长直到失去意义。
for (const key of ORPHAN_ALLOW.keys()) {
  if (usedAllow.has(key)) continue;
  const [factor, prop] = key.split("||");
  const why = bound.has(prop)
    ? `${prop} 已登记进绑定表 —— 豁免已过期`
    : `LEVER_FACTOR_PROPS['${factor}'] 里已不再出现 ${prop} —— 豁免已过期`;
  fail.push(`A2 豁免棘轮：豁免项「${key}」不再命中（${why}）。请从 scripts/check-lever-binding-drift.mjs 的 ORPHAN_ALLOW 删除该条（只降不升）。`);
}

/* ---------- 报告 ---------- */
console.log(
  `· lever-binding-drift：LEVER_FACTOR_PROPS ${factorKeys.length} 个瓶颈因子 · ` +
    `绑定表 ${CAPACITY_FACTOR_BINDINGS.length} 条（可拨动∩'${PROD_GRAIN}' ${dialable.size} 条）· ` +
    `孤儿豁免 ${ORPHAN_ALLOW.size} 条（命中 ${usedAllow.size}）`,
);
console.log("· A1 各层可拨动落点：");
for (const n of note) console.log(n);
console.log(`· ⚠ 诚实边界：本门只证「落点在表里且标可拨动」，**不证「拨了真有用」**（敏感度恒 0 的死杠杆本门看不见）。`);
console.log(`     那一维由 apps/datacore/test/lever-binding-drift.test.ts 的逐层普查棘轮咬（真跑求解器）。`);

if (fail.length) {
  console.error(`\n✗ lever-binding-drift:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`\n✓ lever-binding-drift:check 通过（每个瓶颈因子层都有可拨动落点 · 无未豁免孤儿 · 豁免表无过期项）。`);
