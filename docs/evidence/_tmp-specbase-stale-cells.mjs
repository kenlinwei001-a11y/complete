/**
 * 只读探针 · **自然实验**：播种世界（`sims_demo_seed_world`）的 base 值，与「此刻 props 按规格式算的值」
 * 还相等吗？—— 4019 真后端，**零写操作**（只 GET）。
 *
 * 为什么要它：C2 把规格基值锚在 `s.baseSnapshot` 上，这条锚定唯一的安全依据是
 * 「props 在会话生命期内不变」。若本实例上**已经有** props 被改过（另一个 agent 的 E2E、采纳杠杆、
 * 对象数据变更……），那这些格的 base 已经过期 —— 而这个过期是**现成躺在数据里的**，
 * 不需要我去改任何东西就能观测到。
 *
 * 三件事：
 *   ① 金丝雀：必须先证明「我取得到对象、取得到 base」，否则 0 条不一致读不成「等价完好」。
 *   ② 逐单比 3 条 Order 规格（costPressure/demandPressure/shortageRisk）。
 *   ③ 报出「非 0 不一致」时同时报**是哪几单**，便于定性（自然实验 vs 取法问题）。
 *
 * ⛔ 零 POST。会话 id 由参数给。
 */
const BASE = "http://127.0.0.1:4019";
const H = { "X-Debug-User": "demo:admin:admin" };
const SID = process.argv[2] ?? "sims_demo_seed_world";

const j = async (p) => {
  const r = await fetch(BASE + p, { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);
  return r.json();
};
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// 3 条 Order 规格（与 seed-derivation-specs.ts 逐字对齐；只取单属性式那三条）
const SPECS = [
  { sv: "costPressure", of: (p) => (typeof p.creditUsedRatio === "number" ? r6(p.creditUsedRatio * 100) : 0) },
  { sv: "demandPressure", of: (p) => (typeof p.demandDelta === "number" ? r6(p.demandDelta * 100) : 0) },
  { sv: "shortageRisk", of: (p) => (typeof p.outsourceRatio === "number" ? r6(p.outsourceRatio * 100) : 0) },
];

const s = await j(`/a/v1/sim/sessions/${SID}`);
const base = s.baseSnapshot ?? {};
const baseOrderCells = Object.keys(base).filter((k) => k.startsWith("obj_order_")).length;
console.log(`[0] 会话 ${SID} baseSnapshot 对象数=${Object.keys(base).length}，其中 order 前缀=${baseOrderCells}`);

let page = 1, rows = [], total = null;
for (;;) {
  const q = await j(`/a/v1/objects?type=Order&page=${page}&pageSize=500`);
  const items = q.items ?? q.data ?? [];
  rows = rows.concat(items);
  total = q.total ?? null;
  if (!q.hasMore || items.length === 0) break;
  page += 1;
}
console.log(`[0b] GET /objects 取回 Order ${rows.length} 行（total=${total}，翻页 ${page} 次）`);

// ── 金丝雀（缺一个，本份的「0 条不一致」就不许读成「等价完好」）──────────────
let bad = 0;
const canary = rows.filter((o) => base[o.id] !== undefined);
console.log(`[金丝雀1] 与 baseSnapshot 交集对象数 = ${canary.length}（必须 >0）`);
if (canary.length === 0) { console.log("  ❌ 交集为空 ⇒ 取法坏了（id 命名对不上）"); bad++; }
const oneWithDelta = canary.find((o) => typeof o.props?.demandDelta === "number");
console.log(`[金丝雀2] 至少一单能读到 props.demandDelta：${oneWithDelta ? oneWithDelta.id + "=" + oneWithDelta.props.demandDelta : "❌ 一个都没有"}`);
if (!oneWithDelta) bad++;
const anyCell = typeof base[oneWithDelta?.id ?? ""]?.demandPressure === "number";
console.log(`[金丝雀3] 该单 base 里有 demandPressure 数格：${anyCell ? "是" : "❌ 否"}`);
if (!anyCell) bad++;

// ── 逐单比对 ────────────────────────────────────────────────────────────────
const diffs = [];
let compared = 0;
for (const o of canary) {
  for (const sp of SPECS) {
    const b = base[o.id]?.[sp.sv];
    if (typeof b !== "number") continue;
    const now = sp.of(o.props ?? {});
    compared += 1;
    if (Math.abs(b - now) > 1e-9) diffs.push({ id: o.id, sv: sp.sv, base: b, now });
  }
}
console.log(`[1] 比对格数 = ${compared}`);
console.log(`[2] 不一致格数 = ${diffs.length}`);
for (const d of diffs.slice(0, 20)) console.log(`    · ${d.id}.${d.sv}  base=${d.base}  此刻按 props 算=${d.now}`);
if (diffs.length > 20) console.log(`    …另有 ${diffs.length - 20} 格`);

// 反向标定：把 base 人为偏移一格，判据必须报红（证明比较式有鉴别力）
const probeId = canary.find((o) => typeof base[o.id]?.demandPressure === "number")?.id;
if (probeId !== undefined) {
  const b = base[probeId].demandPressure;
  const injected = Math.abs(r6(b + 0.000001) - b) > 1e-9;
  console.log(`[金丝雀4] 比较式有鉴别力（+1e-6 必须算不一致）：${injected ? "是" : "❌ 否"}`);
  if (!injected) bad++;
}

console.log(bad === 0
  ? (diffs.length === 0
      ? "VERDICT: 金丝雀全中；此刻 0 条不一致 = 这台实例上 props 自播种以来没被改过（等价靠『没人动』维持）"
      : "VERDICT: 金丝雀全中；存在不一致 = 自然实验命中：base 已过期，而会话记录里没有任何东西表达这件事")
  : `VERDICT: 金丝雀未中 ${bad} 处，本份读数作废`);
process.exit(bad === 0 ? 0 : 2);
