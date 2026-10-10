#!/usr/bin/env node
/**
 * 门 `lever-prop-resolvable:check` · **杠杆落点必须在已发布本体里解析得到**
 * （WO-V4-INSPECT · 闭 `docs/SYSTEM-ONTOLOGY.md` §8 `G-LEVER-DEAD-LANDING`）
 *
 * ══ 治什么 · 为什么既有的门看不见 ═══════════════════════════════════════════════
 * `LEVER_PROP_META`（`apps/datacore/src/solvers/lever-meta.ts`）是杠杆
 * `Type.prop → {中文名, 单位, 值类}` 的**单一真值**。它被两处消费：
 *   · `solvers/service.ts:418` `leverPropMeta()` → `leverPropLabel()` / `leverUnitFields()`
 *     给 `discoverLevers` / `discoverCapacityLevers` 发现出来的杠杆贴标签与单位；
 *   · `solvers/impediment-options.ts:684` 给 S3 候选方案贴标签与单位。
 * 两处都是 `meta?.label ?? 裸键` 的**兜底读法** —— 表里多一条指向并不存在的属性，
 * 全链**一个字都不会报错**：属性不存在 ⇒ 那条杠杆从来不会被发现 ⇒ 那条 meta 从来不会被查 ⇒
 * 静默死在表里。
 *
 * 已有的 `lever-binding-drift:check` **抓不到**这一形态，它自己的诚实边界段落白纸黑字写着：
 *   > 「本门只证『落点在表里且标可拨动』，**不证『拨了真有用』**」
 * 它验的是**因子层 → 有没有落点**（覆盖方向，`LEVER_FACTOR_PROPS` × `CAPACITY_FACTOR_BINDINGS`），
 * 而本门验的是**反方向**：**落点 → 那个属性在本体里到底存不存在**。
 * 两个方向的判据集合互不包含 —— 实测：2026-08-13 `lever-binding-drift:check` 全绿，
 * 而 `MaterialBalance.coverage` 的落点属性在 **94 个对象类型里一个都找不到**（现读 dist 复验）。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『杠杆登记在表里』当作『它拨得动一个真属性』的证据，而前者并不度量后者。」**
 *
 * ══ 判据（一条·硬·无豁免表）═══════════════════════════════════════════════════
 *   **`LEVER_PROP_META` 的每一个键 `Type.prop`，都必须在已发布本体里解析得到。**
 *   「解析得到」= 该 `Type` 存在，且 `prop` 出现在它的
 *   `properties` ∪ `derivedProperties` ∪ `stateVariables` 之一里。
 *
 *   为什么三者都算数（而不是只认 `properties`）：
 *     · `derivedProperties` —— 派生值经 `ontology.ts` 的派生管线**真物化到对象 props 上**
 *       （真后端实测：`MaterialBalance.coverage` 落到对象上是 0.920021 这样的真数），
 *       杠杆面板读的就是 `o.props[prop]`，所以派生键是合法落点。
 *     · `stateVariables` —— 事件折叠产物，同样落在 props 上。今日全库实测为空，
 *       但把它排除在外会在有数据的那天变成假红，故一并认。
 *
 *   ⛔ **本门刻意没有豁免表**。落点属性不存在 = 这条杠杆百分之百是死的，没有「暂时够不着
 *   但保留」这种中间态（那是 `lever-binding-drift:check` 的 A2 才有的情形：属性真实存在、
 *   只是没进 20 原子因子表）。给它开豁免口就是把本门变成装饰品。
 *
 * ══ 诚实边界（本门**不**保证什么 · 别把绿读成「杠杆都能用」）═══════════════════
 *  · 只证「落点属性在本体里存在」，**不证「那个属性拨得动」**：
 *    派生属性（如本次修复后的 `MaterialBalance.coverage`）在 `discoverLevers` 的反向 walk 里
 *    **永远不会成为叶**（有 spec 的节点是根不是叶），故它虽然解析得到、却仍然发现不出杠杆。
 *    「解析得到」与「拨得动」是两件事，本门只咬前者。
 *  · 也不证「拨了有效果」（敏感度恒 0）——那一维由
 *    `apps/datacore/test/lever-binding-drift.test.ts` 的逐层普查棘轮咬（它真跑求解器）。
 *  · 真值集 = **demo 出厂本体**（`batteryObjectTypes()` ∪ `extendedObjectTypes()`），
 *    与 `ontology-descriptions:check` / `ontology-slice-coverage:check` 同一集合。
 *    租户运行期自建的类型不在射程内。
 *
 * ══ 金丝雀（保命判据 · 与主逻辑共用同一份 `resolveLanding()`，不另抄一份查法）═════
 *  ① `Equipment.oee_current` —— 我确定它存在（`battery.ts` equipmentProps 真属性），抽不到 ⇒ 门坏了
 *  ② `Metric.gapPct`         —— 我确定它是**派生**属性，抽不到 ⇒ 「含 derivedProperties」这一半瞎了
 *  ③ `__NoSuchType__.__nope__` / `Equipment.__no_such_prop__` —— 我确定它们**不存在**，
 *     若也报「解析得到」⇒ 判据恒真，是哑门（反向金丝雀，防「怎么写都绿」）
 *  ④ 类型总数 > 0 且 `LEVER_PROP_META` 键数 > 0 —— 载入本身失败时不许报「代码干净」
 *  任一不中 ⇒ 打印「门自己坏了」并 **RC=2**，**不许**报「无违规 / 落点都在」。
 *
 * ══ 变异反证开关（机器可复跑；真变异见门账 provenRed）═════════════════════════
 *   LEVER_PROP_RESOLVABLE_INJECT="Foo.bar"   往被检表里注入一条不存在的落点 ⇒ 必须 RC=1 且点名
 *   LEVER_PROP_RESOLVABLE_BREAK_CANARY=1     假装 `resolveLanding` 坏掉 ⇒ 必须 RC=2（不是 1）
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-LEVER-DEAD-LANDING`（本门所闭断点）。
 * 门账：scripts/gate-ledger.json（同批登账，否则新门天然免疫 gate-ledger:check 治理）。
 * 用法：node scripts/check-lever-prop-resolvable.mjs   ·   pnpm lever-prop-resolvable:check
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-lever-prop-resolvable.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDistFresh } from "./dist-freshness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "apps/datacore/dist");

/** RC=2 统一出口：任何「我没能完成判定」的情形都走这里。 */
function toolBroken(lines) {
  console.error("⛔ lever-prop-resolvable:check **门自己坏了，不是代码坏了**：");
  for (const l of lines) console.error(`  - ${l}`);
  console.error("   本次结论作废：**不许**读作「落点都在 / 无违规 / 通过」——本门这次什么都没证明。");
  process.exit(2);
}

/* ⛔ 守卫必须在 import dist **之前**：本门读 dist 的类型表、下的却是**源码**结论。
 *   dist 落后 ⇒ 刚补的属性不在产物里 ⇒ 门报「落点不存在」，与源码恰好相反（欠账 #161 同族）。 */
assertDistFresh(["apps/datacore/dist"], { gate: "lever-prop-resolvable:check" });

const { batteryObjectTypes } = await import(`file://${join(DIST, "synthetic/battery.js")}`);
const { extendedObjectTypes } = await import(`file://${join(DIST, "synthetic/battery-extended.js")}`);
const { LEVER_PROP_META } = await import(`file://${join(DIST, "solvers/lever-meta.js")}`);

const types = [...batteryObjectTypes(), ...extendedObjectTypes()];
const typeByKey = new Map(types.map((t) => [t.key, t]));

/* ═══════════════════════════════════════════════════════════════════════════
 * 判定本体 —— 金丝雀与主判据**共用这一份**，不另抄一份查法
 * （CLAUDE.md 铁律 0.6 已落地的机制：抄一份的金丝雀是装饰品，
 *   改主逻辑时它拿旧的去测、照样绿。本仓 2026-08-08 实测过。）
 * ═══════════════════════════════════════════════════════════════════════════ */
/**
 * 把 `Type.prop` 解析到已发布本体上。
 * @returns {{ ok: boolean, typeKey: string, propKey: string, where: string|null, typeExists: boolean }}
 */
function resolveLanding(leverKey) {
  // 故障注入：只给金丝雀的反向自检用 —— 证「金丝雀真的会因为主逻辑坏掉而叫」，
  // 而不是一句写在注释里的承诺（写在注释里的纪律不是机制）。
  if (process.env.LEVER_PROP_RESOLVABLE_BREAK_CANARY === "1") {
    return { ok: false, typeKey: "", propKey: "", where: null, typeExists: false };
  }
  const i = leverKey.lastIndexOf(".");
  if (i <= 0) return { ok: false, typeKey: leverKey, propKey: "", where: null, typeExists: false };
  const typeKey = leverKey.slice(0, i);
  const propKey = leverKey.slice(i + 1);
  const t = typeByKey.get(typeKey);
  if (!t) return { ok: false, typeKey, propKey, where: null, typeExists: false };
  // 三个承载位都算数（理由见文件头「判据」段）。顺序即报告里显示的 where。
  if ((t.properties ?? []).some((p) => p.propKey === propKey)) return { ok: true, typeKey, propKey, where: "properties", typeExists: true };
  if ((t.derivedProperties ?? []).some((p) => p.propKey === propKey)) return { ok: true, typeKey, propKey, where: "derivedProperties", typeExists: true };
  if ((t.stateVariables ?? []).some((p) => p.propKey === propKey)) return { ok: true, typeKey, propKey, where: "stateVariables", typeExists: true };
  return { ok: false, typeKey, propKey, where: null, typeExists: true };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀：先自证工具是好的，再谈结论
 * ═══════════════════════════════════════════════════════════════════════════ */
const CANARY_PRESENT = [
  { key: "Equipment.oee_current", why: "battery.ts equipmentProps 的真属性（`lever-binding-drift:check` 也拿它当过判据）" },
  { key: "Metric.gapPct", why: "metricDerived 的**派生**属性 —— 专钉「含 derivedProperties」这一半" },
];
const CANARY_ABSENT = [
  { key: "__NoSuchType__.__nope__", why: "类型不存在" },
  { key: "Equipment.__no_such_prop__", why: "类型存在但属性不存在" },
];
const canaryErrs = [];
if (types.length === 0) canaryErrs.push("batteryObjectTypes() ∪ extendedObjectTypes() 载入出 0 个类型（构建产物异常）");
if (Object.keys(LEVER_PROP_META).length === 0) canaryErrs.push("LEVER_PROP_META 载入出 0 个键（构建产物异常）");
for (const c of CANARY_PRESENT) {
  const r = resolveLanding(c.key);
  if (!r.ok) canaryErrs.push(`金丝雀（正向）「${c.key}」应当解析得到却没有 —— ${c.why}`);
}
for (const c of CANARY_ABSENT) {
  const r = resolveLanding(c.key);
  if (r.ok) canaryErrs.push(`金丝雀（反向）「${c.key}」不该解析得到却通过了 —— ${c.why}；判据恒真 = 哑门`);
}
if (canaryErrs.length) toolBroken(canaryErrs);

/* ═══════════════════════════════════════════════════════════════════════════
 * 主判据
 * ═══════════════════════════════════════════════════════════════════════════ */
const leverKeys = Object.keys(LEVER_PROP_META).sort();
// 变异反证开关：注入一条**不存在**的落点，证明本门真的会红（而不是怎么写都绿）。
const inject = process.env.LEVER_PROP_RESOLVABLE_INJECT;
if (inject) leverKeys.push(inject);

const fail = [];
const okRows = [];
for (const k of leverKeys) {
  const r = resolveLanding(k);
  if (r.ok) {
    okRows.push(`  ✓ ${k.padEnd(30)} → ${r.where}`);
    continue;
  }
  const meta = LEVER_PROP_META[k];
  fail.push(
    `落点解析不到：LEVER_PROP_META['${k}']${meta ? `（标签「${meta.label}」·单位 ${meta.unit || "—"}·值类 ${meta.kind}）` : "（注入项）"}\n` +
      (r.typeExists
        ? `      对象类型 ${r.typeKey} 存在，但它的 properties / derivedProperties / stateVariables 里都没有 ${r.propKey}。\n`
        : `      对象类型 ${r.typeKey} 在已发布本体（${types.length} 个类型）里根本不存在。\n`) +
      `      ⇒ 这条杠杆**永远发现不出来**，而且全链不报错（消费方 solvers/service.ts:418 与\n` +
      `        solvers/impediment-options.ts:684 都是 meta?.label ?? 裸键 的兜底读法）。\n` +
      `      修法二选一，不许含糊：\n` +
      `        (a) 该量是**独立真值** ⇒ 给 ${r.typeKey} 补 PropertyDef（同批补：中文名表 PROP_DISPLAY_NAMES + description + 种子填值）；\n` +
      `        (b) 该量**由既有属性算得** ⇒ 登记为 derivedProperties（公式取业务定义式，别取「今天数值恰好相等」的巧合式）。\n` +
      `      ⛔ 不许直接从 LEVER_PROP_META 删掉了事 —— 先追一层看它有没有消费方、\n` +
      `        删了会不会让某个因子层失去唯一落点（跑 node scripts/check-lever-binding-drift.mjs 问它）。`,
  );
}

/* ---------- 报告 ---------- */
console.log(
  `· lever-prop-resolvable：LEVER_PROP_META ${Object.keys(LEVER_PROP_META).length} 条落点 × ` +
    `已发布本体 ${types.length} 个对象类型${inject ? `（含注入项 ${inject}）` : ""}`,
);
console.log(
  `· 🐤 金丝雀（与主判据共用 resolveLanding）：正向 ${CANARY_PRESENT.map((c) => c.key).join(" / ")} 均命中；` +
    `反向 ${CANARY_ABSENT.map((c) => c.key).join(" / ")} 均正确判负 ⇒ 工具已自证`,
);
console.log("· 逐条落点：");
for (const r of okRows) console.log(r);
console.log(
  "· ⚠ 诚实边界：本门只证「落点属性在本体里**存在**」，**不证「它拨得动」**——\n" +
    "     派生属性在 discoverLevers 的反向 walk 里永远不是叶（有 spec 的节点是根），解析得到 ≠ 发现得出杠杆；\n" +
    "     「拨了有没有效果」那一维由 apps/datacore/test/lever-binding-drift.test.ts 的逐层普查棘轮咬。",
);

if (fail.length) {
  console.error(`\n✗ lever-prop-resolvable:check 未通过（${fail.length} 条死落点）：`);
  for (const m of fail) console.error(`  - ${m}`);
  process.exit(1); // 1 = 真有违规（与 2「工具坏了」严格分开，处置方向相反）
}
console.log(`\n✓ lever-prop-resolvable:check 通过（${leverKeys.length} 条杠杆落点全部在已发布本体里解析得到）。`);
