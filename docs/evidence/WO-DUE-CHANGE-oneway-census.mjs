/**
 * 「一个格子只能被单向推动」在全图有多少格 —— 结构性普查（**双臂**）。
 *
 * 判据（不是"系数是正是负"，而是"贡献的可能符号集"）：
 *   一条边 e 的贡献 = coeff(e) × sourceVal。
 *   贡献可能符号集 = sign(coeff) × **源的可能符号集**。
 *   一格若有**唯一**符号的可能贡献 ⇒ 该格在这套规则表下**只能被单向推动**。
 *
 * ⚠ 双臂是本次的核心，缺一臂就只见其一：
 *   · **申报臂**：源的符号集取自 `STATE_VAR_DOMAINS[sv]`（引擎的取值域册子）——
 *     这是**平台自己相信的**那张模型。
 *   · **实况臂**：源的符号集取自**世界态里真实出现过的值**（真后端 tick0 世界态）——
 *     这是**世界真正能产出的**那张模型。
 *   两臂**不一致**的格，就是「平台相信自己双向可达、而世界只给得起单向」的格。
 *   ⛔ 只跑申报臂会把这类格判成"健康"（本次实测：`Order.demandPressure` 申报臂读 `-+`）。
 *
 * 双向金丝雀（缺一个就不许信本次输出）：
 *   · 正：实况臂下 `Order.demandPressure` 必须判「单向·负」（已知事实：唯一入边 −0.222 × forecastBias）
 *   · 反：把该边系数在内存里取反 ⇒ 实况臂必须翻成双侧 —— 证明判据咬的是符号，不是"有没有边"
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/apple/deploy/wo-edge-wire/apps/datacore/");
const { STATE_VAR_DOMAINS } = require("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");

const BASE = process.env.BASE ?? "http://127.0.0.1:4019";
const H = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };
const rr = await fetch(`${BASE}/a/v1/sim/propagation-rules?published=true`, { headers: H });
if (rr.status !== 200) throw new Error(`rules HTTP ${rr.status}`);
const rules = (await rr.json()).items;
if (!Array.isArray(rules) || rules.length === 0) throw new Error("规则表为空 ⇒ 工具坏了，不许读成'没有单向格'");

// ── 世界态（本会话自己的 tick0 行）为实况臂取符号 ──────────────────────────────
const sess0 = await (await fetch(`${BASE}/a/v1/sim/sessions`, { method: "POST", headers: H, body: "{}" })).json();
const sess = await (await fetch(`${BASE}/a/v1/sim/sessions/${sess0.id}`, { headers: H })).json();
if (sess?.curTick !== 0) throw new Error(`建会话后 curTick=${sess?.curTick} ≠ 0 ⇒ 取的不是 tick0`);
const world = sess.baseSnapshot;              // tick0 世界态（播种期物化，未受扰动）
const prov = sess.baseSnapshotProvenance;     // 逐格出处：measured（同名 prop）/ derived（哈希占位）
if (!world || Object.keys(world).length === 0) throw new Error("世界态为空 ⇒ 工具坏了");

/** 世界态的键就是对象 id（`obj_<type>_<key>`）⇒ 用传导图的 objects 反查类型，不猜串。 */
const rc = await fetch(`${BASE}/a/v1/sim/view-config`, { headers: H });
const vcfg = rc.status === 200 ? await rc.json() : null;
const typeOfObj = new Map();
for (const [tk, ids] of Object.entries(vcfg?.nodeObjectIds ?? {})) for (const oid of ids) typeOfObj.set(oid, tk);
if (typeOfObj.size === 0) throw new Error("view-config 取不到对象→类型映射 ⇒ 工具坏了（不许按 id 串猜类型）");

/** derived 格统计（哈希占位 = 与量纲无关的通用式，见 seed-world.ts）。 */
const derivedByVar = new Map(), totalByVar = new Map();
for (const [oid, row] of Object.entries(prov ?? {})) {
  for (const [sv, o] of Object.entries(row)) {
    totalByVar.set(sv, (totalByVar.get(sv) ?? 0) + 1);
    if (o === "derived") derivedByVar.set(sv, (derivedByVar.get(sv) ?? 0) + 1);
  }
}

/** (typeKey.stateVar) → 世界态里真实出现过的值集合。 */
const observed = new Map();
for (const [oid, bucket] of Object.entries(world)) {
  const t = typeOfObj.get(oid);
  if (t === undefined) continue;
  for (const [sv, v] of Object.entries(bucket)) {
    if (typeof v !== "number") continue;
    const k = `${t}.${sv}`;
    const a = observed.get(k) ?? [];
    a.push(v);
    observed.set(k, a);
  }
}
/**
 * 观测符号集 —— ⛔ **必须格级**（`typeKey.stateVar`），不许名级。
 * 名级会把跨类型同名量混在一起：`Material.shortageRisk` 世界态实测有负值（−59.72），
 * 名级一混就把 `Order.shortageRisk` 的入边符号读反（propagation.ts:846-849 已记过这个坑）。
 */
const obsSigns = new Map(); // cellKey -> Set
for (const [k, vs] of observed) {
  const s = obsSigns.get(k) ?? new Set();
  for (const v of vs) { if (v > 0) s.add(1); else if (v < 0) s.add(-1); else s.add(0); }
  obsSigns.set(k, s);
}
const cellSigns = (type, sv) => obsSigns.get(`${type}.${sv}`) ?? null;

const declaredSigns = (sv) => {
  const d = STATE_VAR_DOMAINS[sv];
  if (d === undefined) return null;
  const s = new Set();
  if (d.min < 0) s.add(-1);
  if (d.max === null || d.max > 0) s.add(1);
  if (d.min === 0 && d.max === 0) s.add(0);
  return s;
};
function shape(d) {
  if (d === undefined) return "未声明";
  const lo = d.restPoint <= d.min ? "硬地板" : "带";
  const hi = d.max !== null && d.restPoint >= d.max ? "硬顶" : d.max === null ? "无上界" : "带";
  return `下:${lo} 上:${hi}`;
}
const fmt = (s) => s === null ? "未声明" : ([...s].map((x) => (x > 0 ? "+" : x < 0 ? "-" : "0")).sort().join("") || "(空)");

const cells = new Map();
const touch = (type, sv) => {
  const key = `${type}.${sv}`;
  let c = cells.get(key);
  if (c === undefined) { c = { type, sv, in: [] }; cells.set(key, c); }
  return c;
};
for (const r of rules) {
  touch(r.sourceTypeKey, r.sourceStateVar); // 出度侧也要建格（入度 0 的外生根在这里现形）
  touch(r.targetTypeKey, r.targetStateVar);
}

function census(signOf) {
  const out = new Map();
  for (const [key, c] of cells) {
    const signs = new Set(); let unknown = 0; const edges = [];
    for (const r of rules) {
      if (r.targetTypeKey !== c.type || r.targetStateVar !== c.sv) continue;
      const cs = Math.sign(r.coefficient);
      const ss = signOf(r.sourceStateVar);
      const e = { rule: r.key, coeff: r.coefficient, src: `${r.sourceTypeKey}.${r.sourceStateVar}` };
      if (cs === 0) { e.contrib = "0"; edges.push(e); continue; }
      if (ss === null) { unknown += 1; e.contrib = "?"; edges.push(e); continue; }
      const contrib = new Set([...ss].map((s) => s * cs));
      e.contrib = fmt(contrib);
      for (const x of contrib) signs.add(x);
      edges.push(e);
    }
    out.set(key, { key, inDeg: edges.length, signs: new Set([...signs].filter((x) => x !== 0)), unknown, edges });
  }
  return out;
}

const A = census(declaredSigns);              // 申报臂
const B = census((sv) => obsSigns.get(sv) ?? null); // 实况臂

// ── 金丝雀 ────────────────────────────────────────────────────────────────
const bDP = B.get("Order.demandPressure");
const canaryA = bDP !== undefined && bDP.inDeg === 1 && bDP.signs.size === 1 && bDP.signs.has(-1);
{
  const flipped = census((sv) => obsSigns.get(sv) ?? null);
  // 重算一遍，但把那条边系数取反（内存改，不碰落盘）
  const rules2 = rules.map((r) => (r.key === "demo_forecast_bias_to_order_demand" ? { ...r, coefficient: -r.coefficient } : r));
  const sig = (sv) => obsSigns.get(sv) ?? null;
  const s2 = new Set();
  for (const r of rules2) {
    if (r.targetTypeKey !== "Order" || r.targetStateVar !== "demandPressure") continue;
    const cs = Math.sign(r.coefficient); const ss = sig(r.sourceStateVar);
    if (cs === 0 || ss === null) continue;
    for (const x of ss) s2.add(x * cs);
  }
  var canaryB = [...s2].filter((x) => x !== 0).length === 2;
}
// 反向金丝雀 C：申报臂必须**不**把该格判成单向（否则两臂同源 = 双臂白做）
const aDP = A.get("Order.demandPressure");
var canaryC = aDP !== undefined && aDP.signs.size === 2;

console.log(`# 单向可达普查（双臂）  rules=${rules.length}  cells=${cells.size}  session=${sess.id}  BASE=${BASE}`);
console.log(`# 值域册子条目=${Object.keys(STATE_VAR_DOMAINS).length}   世界态格数=${Object.values(world).reduce((n, b) => n + Object.keys(b).length, 0)}`);
console.log(`# 金丝雀A(正·实况臂) Order.demandPressure 判「单向·负」= ${canaryA ? "命中 ✓" : "未命中 ✗ 工具坏了"}`);
console.log(`# 金丝雀B(反·实况臂) 系数取反后必须翻成双侧 = ${canaryB ? "命中 ✓" : "未命中 ✗ 判据咬的不是符号"}`);
console.log(`# 金丝雀C(反·申报臂) 申报臂必须把该格判成双侧 = ${canaryC ? "命中 ✓" : "未命中 ✗ 两臂同源，双臂白做"}`);
console.log("");

const sum = (m) => {
  const rows = [...m.values()];
  const neg = rows.filter((r) => r.signs.size === 1 && r.signs.has(-1));
  const pos = rows.filter((r) => r.signs.size === 1 && r.signs.has(1));
  return { rows, neg, pos, two: rows.filter((r) => r.signs.size === 2), unk: rows.filter((r) => r.unknown > 0) };
};
const sa = sum(A), sb = sum(B);
console.log("## 汇总（申报臂 vs 实况臂）");
console.log(`                     申报臂(平台相信的)   实况臂(世界给得起的)`);
console.log(`  被写过的格           ${String(sa.rows.filter((r) => r.inDeg > 0).length).padEnd(20)} ${sb.rows.filter((r) => r.inDeg > 0).length}`);
console.log(`  单向·负             ${String(sa.neg.length).padEnd(20)} ${sb.neg.length}   ← 「只能被往下推」`);
console.log(`  单向·正             ${String(sa.pos.length).padEnd(20)} ${sb.pos.length}   ← 「只能被往上推」`);
console.log(`  两侧都有             ${String(sa.two.length).padEnd(20)} ${sb.two.length}`);
console.log("");

/** 源的申报符号集 ≠ 实况符号集 ⇒ 「声明了但世界产不出」 */
const mismatched = [];
for (const sv of new Set([...rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar])])) {
  const d = declaredSigns(sv), o = obsSigns.get(sv) ?? null;
  if (d === null) continue;
  const dm = fmt(d), om = o === null ? "世界态无此量" : fmt(o);
  if (dm !== om) mismatched.push({ sv, dm, om, deg: STATE_VAR_DOMAINS[sv] });
}
console.log(`## 申报符号集 ≠ 实况符号集 的量纲（${mismatched.length} 个）`);
for (const m of mismatched) {
  console.log(`  ${m.sv.padEnd(26)} 申报[${m.dm}]  实况[${m.om}]  值域=[${m.deg.min},${m.deg.max}] rest=${m.deg.restPoint}`);
}
console.log("");

const pin = (r) => {
  const sv = r.key.slice(r.key.indexOf(".") + 1);
  const d = STATE_VAR_DOMAINS[sv];
  if (d === undefined) return false;
  const hardFloor = d.restPoint <= d.min, hardCeil = d.max !== null && d.restPoint >= d.max;
  return (r.signs.size === 1 && r.signs.has(-1) && hardFloor) || (r.signs.size === 1 && r.signs.has(1) && hardCeil);
};
console.log(`## 实况臂：单向 ∧ 撞硬边界（推到边界再也回不来）`);
for (const r of [...sb.neg, ...sb.pos].filter(pin)) {
  const sv = r.key.slice(r.key.indexOf(".") + 1);
  console.log(`  ${r.key.padEnd(38)} 入度=${r.inDeg} 符号=${fmt(r.signs)} 值域[${shape(STATE_VAR_DOMAINS[sv])}]`);
}
console.log("");
console.log(`## 实况臂：单向（全部 ${sb.neg.length + sb.pos.length} 格）`);
for (const r of [...sb.neg, ...sb.pos].sort((a, b) => a.key.localeCompare(b.key))) {
  const sv = r.key.slice(r.key.indexOf(".") + 1);
  console.log(`  ${r.key.padEnd(38)} 入度=${r.inDeg} 符号=${fmt(r.signs)} 值域[${shape(STATE_VAR_DOMAINS[sv])}]  入边: ${r.edges.map((e) => `${e.src}×${e.coeff}(${e.contrib})`).join(" , ")}`);
}
console.log("");
console.log(`## 实况臂：两侧都有（${sb.two.length} 格）`);
for (const r of sb.two.sort((a, b) => a.key.localeCompare(b.key))) {
  const sv = r.key.slice(r.key.indexOf(".") + 1);
  console.log(`  ${r.key.padEnd(38)} 入度=${r.inDeg} 值域[${shape(STATE_VAR_DOMAINS[sv])}]  入边: ${r.edges.map((e) => `${e.src}×${e.coeff}(${e.contrib})`).join(" , ")}`);
}
console.log("");
console.log(`## 实况臂：入度 0（外生根，世界唯一的信息来源）`);
const svAll = new Set(rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]));
for (const r of [...sb.rows].filter((x) => x.inDeg === 0).sort((a, b) => a.key.localeCompare(b.key))) {
  const sv = r.key.slice(r.key.indexOf(".") + 1);
  const o = obsSigns.get(sv) ?? null;
  console.log(`  ${r.key.padEnd(38)} 值域[${shape(STATE_VAR_DOMAINS[sv])}] 世界态符号[${o === null ? "无" : fmt(o)}]`);
}
