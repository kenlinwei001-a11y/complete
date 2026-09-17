#!/usr/bin/env node
// WO-SIM-CALIBRATION · 标定诊断与方案对比的**可复跑证据**（纯静态：不起服务、不跑 vitest、不读库）
//
//   node docs/evidence/wo-sim-calibration/calibration-analysis.mjs
//
// ── 它算什么 ────────────────────────────────────────────────────────────────────
// 把 `sim/propagation.ts` 每拍的三步语义逐条照抄成一个**均场**迭代，解零扰动稳态：
//   ① 衰减  x ← rest + (1−λ)(x − rest)   仅「该 stateVar 被某条规则写入 && 已声明取值域」
//   ② 入流  x += Σ_e c_e · N_e · max(0, x_src − tol_e)  （combine:"sum" ⇒ 每个源实例各加满额）
//   ③ 软饱和 x ← saturateToDomain(x)      仅已声明取值域者
//
// ⚠⚠ **节点键必须是 `对象类型.状态量`，不是裸状态量** —— 这是本脚本第一版踩的坑，
//    留在这里当判据：本仓 41 个量纲里有 **3 个同名挂在多个对象类型上**
//    （`shortageRisk`→Material/Order · `costPressure`→Model/Order · `procurementDelay`→PO/Batch/Supplier）。
//    按裸名合并，`demo_model_cost_to_order_cost`（Model.costPressure→Order.costPressure, c=0.9）
//    会**退化成一条自环**，凭空造出一个增益 0.9·N/λ 的正反馈 ⇒ costPressure 被算得恒顶上界。
//    形态：「我用『两个格的状态量叫同一个名字』当作『它们是同一个格』的证据，而前者并不度量后者。」
//    ⇒ 下面一律用 `typeKey.stateVar` 作键；而**衰减与域查表仍按裸名**，因为引擎就是这么做的
//    （`propagation.ts` 的 `writtenVars` 收的是 `r.targetStateVar`，域表也按裸名）。
//
// 均场近似 = 每个格用一个标量（该量纲在该类型全部实例上的均值），扇入用**实测** N_e。
// `delayTicks` 只移时不移稳态，故不建模。
//
// ── N_e（扇入）的出处：`fanin-N.json` ──────────────────────────────────────────
// 不是本单量的，是 `origin/claude/handoff-desat3` 的实测产物（`docs/evidence/wo-sim-desat3/fanin-N.json`）。
// 独立复核过一条：`demo_process_queue_to_line_blocked = 5`，与 650 条 `lnk_pbl_*`
// （Process→Line，`synthetic/service.ts:1067` 每个 Process 一条）÷ 130 条 Line 吻合。
//
// ── W_e（该边落到目标格的权重之和）由**归一方向**决定（`contracts/src/sim.ts` 的 registry）──
//   bom_cost_share          → IN_EDGES             (Σ=1)         ⇒ W = 1
//   source_qty_relative     → IN_EDGES_MEAN        (均值=1⇒Σ=N)  ⇒ W = N
//   source_value_relative   → IN_EDGES_GLOBAL_MEAN               ⇒ W ≈ N
//   actor_exposure_relative → SOURCE_POOL_MEAN                   ⇒ W ≈ N
//   weightRef: null         → 每源各加一份满额                    ⇒ W = N
//
// ── ⚠ 三条已知边界（先说清楚，免得被当成它没说的话）──────────────────────────────
//  ① **均场 ≠ 逐实例**：答「这个格整体落在哪」，答不了「130 条产线里有几条越界」。后者要真起服务。
//  ② 外生根一律 held=50（tick0 生成式 `round(hash01(objectId|stateVar)×100)` 的均值）。
//  ③ 未声明取值域者是**纯积分器**，没有稳态 —— 值随拍数线性增长，输出打 `*`，⛔ 不许读成稳态。
//
// 金丝雀（铁律 0.6：报结论前先自证量法）：
//   ① 扇入 —— demo_process_queue_to_line_blocked 必须 N=5 且 c=0.55
//   ② 无自环 —— 节点键化之后，不许有任何 src===dst 的边
//   ③ 闭式对拍 —— blockedPressure 补域后稳态必须 ≈ 97.669（审核方独立复核过的闭式值）

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const LAM = 0.37, BAND = 0.25, SEED = 50;

// ══ 抽 47 条边 ════════════════════════════════════════════════════════════════
const src = readFileSync(resolve(REPO, "apps/datacore/src/seed.ts"), "utf8");
const si = src.indexOf("const DEMO_PROPAGATION_RULES: ReadonlyArray<");
const bs = src.indexOf("> = [", si);
if (si < 0 || bs < 0) throw new Error("CANARY-FAIL 找不到 DEMO_PROPAGATION_RULES ⇒ 量法坏了");
const bodyRest = src.slice(bs + 4);
const body = bodyRest.slice(0, bodyRest.search(/\n\];/));
const fld = (c, n) => { const m = c.match(new RegExp(`(^|\\n)\\s*${n}:\\s*([^\\n]+?),\\s*(//.*)?$`, "m")); return m ? m[2].trim() : null; };
const unq = (v) => (v == null ? null : v.replace(/^["'`]|["'`]$/g, ""));
const rules = [];
for (const c of body.split(/\n  \{\n/).slice(1)) {
  if (!unq(fld(c, "id"))) continue;
  const wr = fld(c, "weightRef");
  rules.push({
    key: unq(fld(c, "key")),
    sT: unq(fld(c, "sourceTypeKey")), sV: unq(fld(c, "sourceStateVar")),
    tT: unq(fld(c, "targetTypeKey")), tV: unq(fld(c, "targetStateVar")),
    c: Number(fld(c, "coefficient")),
    basis: wr && wr !== "null" ? (wr.match(/basis:\s*"([^"]+)"/) || [])[1] : null,
  });
}

// ══ 域表 ══════════════════════════════════════════════════════════════════════
const bat = readFileSync(resolve(REPO, "apps/datacore/src/synthetic/battery.ts"), "utf8");
const dblk = bat.slice(bat.indexOf("export const STATE_VAR_DOMAINS"), bat.indexOf("export function stateVarDomains"));
const declared = new Set([...dblk.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]));
if (dblk.includes("STATE_VAR_DOMAINS.forecastBias")) declared.add("forecastBias");
if (!declared.has("queuePressure")) throw new Error("CANARY-FAIL 域表抽取没命中 queuePressure ⇒ 量法坏了");

const fanin = JSON.parse(readFileSync(resolve(HERE, "fanin-N.json"), "utf8"));
// 3 条借自兄弟边/结构（扇入按 viaLinkKey→targetType 度量，与 stateVar 无关）。⛔ 不许默认 1。
const PATCH = {
  demo_order_demand_pressure: 24.833333333333332,   // 同 order_for_model→Model，借 demo_order_churn_to_model_demand_load
  demo_order_demand_to_line_split: 1,                // 同 order_has_line→OrderLine，借 demo_order_churn_to_line_split
  demo_customer_reaction_cut_order: 1,               // customer_places_order→Order：一张订单恰有 1 个下单客户
};
const TOL = { demo_customer_reaction_cut_order: 12 }; // seed.ts reaction.tolerance

const nid = (t, v) => `${t}.${v}`;
const edges = rules.map((r) => {
  const N = fanin[r.key] ?? PATCH[r.key];
  if (N === undefined) throw new Error(`CANARY-FAIL 扇入表缺 ${r.key} ⇒ 量法坏了`);
  return { key: r.key, src: nid(r.sT, r.sV), dst: nid(r.tT, r.tV), v: r.tV, c: r.c, N, basis: r.basis, tol: TOL[r.key] ?? 0 };
});
const nodes = new Set(); const nodeVar = {};
for (const r of rules) { nodes.add(nid(r.sT, r.sV)); nodeVar[nid(r.sT, r.sV)] = r.sV; nodes.add(nid(r.tT, r.tV)); nodeVar[nid(r.tT, r.tV)] = r.tV; }
const writtenVar = new Set(rules.map((r) => r.tV)); // 引擎按**裸名**判「被写入」

// ══ 金丝雀 ════════════════════════════════════════════════════════════════════
const cy = edges.find((e) => e.key === "demo_process_queue_to_line_blocked");
if (!cy || cy.N !== 5 || cy.c !== 0.55) throw new Error(`CANARY-FAIL 扇入金丝雀 N=${cy?.N} c=${cy?.c} ⇒ 量法坏了`);
console.log(`CANARY-OK ① 扇入 demo_process_queue_to_line_blocked N=${cy.N} c=${cy.c}（= 650 Process ÷ 130 Line）`);
const loops = edges.filter((e) => e.src === e.dst);
if (loops.length) throw new Error(`CANARY-FAIL 键化后仍有 ${loops.length} 条自环 ⇒ 键错了`);
console.log(`CANARY-OK ② 节点按 typeKey.stateVar 键化后自环 0 条（${nodes.size} 个格 / ${edges.length} 条边）`);

// ══ 引擎语义 ══════════════════════════════════════════════════════════════════
const dom = (v) => (v === "forecastBias" ? { min: -100, max: 100, rest: 0 } : { min: 0, max: 100, rest: 0 });
function sat(raw, d) {
  const r = Math.min(d.max, Math.max(d.min, d.rest)), bHi = (d.max - r) * BAND;
  if (bHi > 0) { const k = d.max - bHi; if (raw > k) return d.max - bHi / (1 + (raw - k) / bHi); } else if (raw > d.max) return d.max;
  const bLo = (r - d.min) * BAND;
  if (bLo > 0) { const k = d.min + bLo; if (raw < k) return d.min + bLo / (1 + (k - raw) / bLo); } else if (raw < d.min) return d.min;
  return raw;
}
/** 软饱和在工作点的导数 dOut/dRaw：带内=1，上溢段=1/(1+u)²。扰动过这一格被衰减 1/deriv 倍。 */
function deriv(raw, d) {
  const r = Math.min(d.max, Math.max(d.min, d.rest)), bHi = (d.max - r) * BAND;
  if (bHi <= 0) return raw > d.max ? 0 : 1;
  const k = d.max - bHi; if (raw <= k) return 1;
  const u = (raw - k) / bHi; return 1 / ((1 + u) * (1 + u));
}
// ⚠⚠ **仿真与预算都必须用 W_e，不是裸扇入 N_e** —— 这是本脚本第二版踩的坑，留作判据：
//    `demo_material_price_to_model_cost` 走 `bom_cost_share`（Σw=1）⇒ 它对目标格的实际乘数是 **1**，
//    不是链路扇入 7。第二版在 `run()` 里对所有边一律乘 e.N，把这条边的入流放大了 7 倍。
//    形态：「我用『这条链路的扇入是 7』当作『这条边给目标加 7 份』的证据，而前者并不度量后者
//    —— 加几份由**归一方向**决定，不由链路条数决定。」
//    N_e 只在 `weightRef: null`（每源各加一份满额）时才等于 W_e。
const SIGMA1 = new Set(["bom_cost_share", "equal_share"]); // 这两条口径 Σw=1 ⇒ W=1
const Weff = (e) => (SIGMA1.has(e.basis) ? 1 : e.N);

function run({ edges, ticks, inject = null, extra = new Set() }) {
  const isD = (n) => declared.has(nodeVar[n]) || extra.has(nodeVar[n]);
  const x = {}; for (const n of nodes) x[n] = SEED;
  if (inject) x[inject.n] += inject.d;
  let raws = {};
  const hasIn = new Set(edges.map((e) => e.dst));
  for (let t = 0; t < ticks; t++) {
    const nx = { ...x };
    for (const n of nodes) if (writtenVar.has(nodeVar[n]) && isD(n)) { const d = dom(nodeVar[n]); nx[n] = d.rest + (1 - LAM) * (x[n] - d.rest); }
    for (const e of edges) nx[e.dst] += e.c * Weff(e) * Math.max(0, x[e.src] - e.tol);
    if (inject && !hasIn.has(inject.n)) nx[inject.n] = SEED + inject.d; // 持续扰动 = 按住在新值
    raws = { ...nx };
    for (const n of nodes) if (isD(n)) nx[n] = sat(nx[n], dom(nodeVar[n]));
    for (const n of nodes) x[n] = nx[n];
  }
  return { x, raws };
}
const OUT = "Order.costPressure", ROOT = "Equipment.equipmentFailure";
function atten(opts) {
  const a = run(opts), b = run({ ...opts, inject: { n: ROOT, d: 10 } });
  const d = Math.abs(b.x[OUT] - a.x[OUT]);
  return { atten: d === 0 ? Infinity : 10 / d, delta: d, base: a };
}
function cellGain(edges) { const S = {}; for (const e of edges) S[e.dst] = (S[e.dst] ?? 0) + Math.abs(e.c) * Weff(e) / LAM; return S; }
function budget(edges, cap = 0.75) { const S = cellGain(edges); return edges.map((e) => ({ ...e, c: e.c * Math.min(1, cap / (S[e.dst] || 1)) })); }
/** 移植 `equal_share`：把这 11 条边的 basis 改成 equal_share ⇒ W 由 N 降到 1（desat-3 ③）。 */
const EQUAL_SHARE_EDGES = new Set(["demo_batch_procurement_delay_to_material_shortage", "demo_equipment_failure_to_process_queue",
  "demo_material_shortage_to_model_supply_risk", "demo_model_demand_to_base_load", "demo_po_expedite_to_supplier_review",
  "demo_po_procurement_delay_to_material_shortage", "demo_process_queue_to_line_blocked", "demo_supplier_delay_to_material_shortage",
  "demo_supplier_procurement_delay_to_material_shortage", "demo_wo_release_to_model_cost", "demo_wo_release_to_model_supply_risk"]);
const withEqualShare = (edges) => edges.map((e) => (EQUAL_SHARE_EDGES.has(e.key) ? { ...e, basis: "equal_share" } : e));

// 金丝雀 ③
const probe = run({ edges, ticks: 4000, extra: new Set(["blockedPressure"]) });
const bp = probe.x["Line.blockedPressure"];
console.log(`CANARY-OK ③ blockedPressure 补域后稳态 = ${bp.toFixed(6)}（闭式 97.669316，差 ${(bp - 97.669316).toFixed(6)}）`);
if (Math.abs(bp - 97.669316) > 0.2) throw new Error("CANARY-FAIL 闭式对不上 ⇒ 模型坏了");

// ══ 结论一 · 现状饱和分布 ═════════════════════════════════════════════════════
console.log(`\n══ 结论一 · canonical 语义下 ${nodes.size} 个格的零扰动稳态（λ=${LAM} BAND=${BAND}）══`);
const st = run({ edges, ticks: 4000 });
const dist = {};
const rows = [...nodes].sort().map((n) => {
  const dec = declared.has(nodeVar[n]); const val = st.x[n];
  const b = !dec ? "未声明(纯积分器·发散)" : val < 50 ? "<50" : val < 75 ? "50–75" : val < 90 ? "75–90" : "≥90";
  dist[b] = (dist[b] ?? 0) + 1;
  return { n, dec, val, d: dec ? deriv(st.raws[n], dom(nodeVar[n])) : null };
});
console.log("分布：", JSON.stringify(dist));
console.log("\n格(类型.量纲)                        声明  稳态值        工作点导数");
for (const r of rows) console.log(r.n.padEnd(36) + (r.dec ? " ✓  " : " ✗  ") + r.val.toExponential(4).padEnd(14) + (r.d === null ? "—" : r.d.toExponential(3)));

// ══ 结论二 · 方案对比 ═════════════════════════════════════════════════════════
const show = (name, es, extra = new Set()) => {
  const S = cellGain(es), over = Object.entries(S).filter(([, g]) => g > 0.7501);
  const worst = over.sort((p, q) => q[1] - p[1])[0];
  const r24 = atten({ edges: es, ticks: 24, extra }), r240 = atten({ edges: es, ticks: 240, extra });
  console.log(`\n── ${name} ──`);
  console.log(`  超预算(>0.75)的格: ${over.length}/${Object.keys(S).length}` + (worst ? `   最差 ${worst[0]} G=${worst[1].toFixed(2)}` : ""));
  console.log(`  ${OUT} 稳态 t24=${r24.base.x[OUT].toFixed(3)}   总衰减 t24=${r24.atten.toExponential(3)}×  t240=${r240.atten.toExponential(3)}×`);
};
console.log(`\n\n══ 结论二 · 方案对比（注入 ${ROOT}+10，读 ${OUT}）══`);
show("修前 canonical", edges);
for (const L of [0.9, 0.99]) {
  const save = LAM; // 方案 A 只改 λ：就地改常量再跑
  globalThis.__lam = L;
  console.log(`\n── 方案A λ=${L}（下方数按 λ=${L} 重跑）──`);
  const es = edges;
  const oldLam = LAM;
  // 用闭包重算：简单起见直接内联一个 λ 可变的迭代
  const f = (ticks, inject) => {
    const isD = (n) => declared.has(nodeVar[n]);
    const x = {}; for (const n of nodes) x[n] = SEED; if (inject) x[inject.n] += inject.d;
    const hasIn = new Set(es.map((e) => e.dst));
    for (let t = 0; t < ticks; t++) {
      const nx = { ...x };
      for (const n of nodes) if (writtenVar.has(nodeVar[n]) && isD(n)) { const d = dom(nodeVar[n]); nx[n] = d.rest + (1 - L) * (x[n] - d.rest); }
      for (const e of es) nx[e.dst] += e.c * e.N * Math.max(0, x[e.src] - e.tol);
      if (inject && !hasIn.has(inject.n)) nx[inject.n] = SEED + inject.d;
      for (const n of nodes) if (isD(n)) nx[n] = sat(nx[n], dom(nodeVar[n]));
      for (const n of nodes) x[n] = nx[n];
    }
    return x;
  };
  const a = f(24, null), b = f(24, { n: ROOT, d: 10 });
  const d = Math.abs(b[OUT] - a[OUT]);
  console.log(`  ${OUT} 稳态 t24=${a[OUT].toFixed(3)}   总衰减 t24=${(10 / d).toExponential(3)}×`);
  void save; void oldLam;
}
const C = budget(edges);
show("方案B 每格增益预算 ≤0.75（只改 seed.ts 系数）", C);
show("方案B+补域（blockedPressure 声明取值域）", C, new Set(["blockedPressure"]));

// ── 仓主 2026-09-17 裁决：扩范围移植 equal_share。下面证明它**单独**够不够 ──────────
const ES = withEqualShare(edges);
show("①只移植 equal_share（不再缩系数）", ES);
show("①+补域", ES, new Set(["blockedPressure"]));
const ESB = budget(withEqualShare(edges));
show("②移植 equal_share + 每格预算 ★裁决方案★", ESB);
show("②+补域 ★裁决方案·完整★", ESB, new Set(["blockedPressure"]));

console.log("\n── 仓主指定的验证点：Model.demandLoad 的 G ──");
for (const [nm, es] of [["修前", edges], ["①只移植 equal_share", ES], ["②移植+预算", ESB]]) {
  const S = cellGain(es);
  const ins = es.filter((e) => e.dst === "Model.demandLoad");
  console.log(`  ${nm.padEnd(22)} G(Model.demandLoad) = ${S["Model.demandLoad"].toFixed(3)}` +
    `   入边: ${ins.map((e) => `${e.key}(basis=${e.basis ?? "null"},W=${Weff(e).toFixed(2)},c=${e.c.toFixed(4)})`).join(" + ")}`);
}
// ── 多注入点：equal_share 的「稀释」是打在所有链上，还是只打在带 equal_share 边的那条链上？──
console.log("\n── 多注入点总衰减（+10 持续扰动 → Order.costPressure）──");
console.log("  注入点                         修前        B+补域      ②+补域     该链上 equal_share 边数");
const BD = new Set(["blockedPressure"]);
for (const root of ["Equipment.equipmentFailure", "Material.priceShock", "Supplier.deliveryDelay", "Model.forecastBias"]) {
  const f = (es, extra) => { const a = run({ edges: es, ticks: 24, extra }), b = run({ edges: es, ticks: 24, inject: { n: root, d: 10 }, extra });
    const d = Math.abs(b.x[OUT] - a.x[OUT]); return d === 0 ? Infinity : 10 / d; };
  // 该链上有几条 equal_share 边：从 root 出发做一次可达 BFS，数命中
  const seen = new Set([root]); const q = [root];
  while (q.length) { const n = q.shift(); for (const e of edges) if (e.src === n && !seen.has(e.dst)) { seen.add(e.dst); q.push(e.dst); } }
  const nES = edges.filter((e) => EQUAL_SHARE_EDGES.has(e.key) && seen.has(e.src)).length;
  console.log("  " + root.padEnd(30) + f(edges, new Set()).toExponential(2).padEnd(12) +
    f(C, BD).toExponential(2).padEnd(12) + f(ESB, BD).toExponential(2).padEnd(11) + nES);
}

console.log("\n── BOM 那条边被缩多少（仓主否掉 83.7× 的那个数）──");
for (const [nm, es] of [["方案B(只缩系数)", C], ["②移植+预算", ESB]]) {
  const e = es.find((x) => x.key === "demo_material_price_to_model_cost");
  console.log(`  ${nm.padEnd(18)} 0.65 → ${e.c.toFixed(6)}  (缩 ${(0.65 / e.c).toFixed(2)}×)`);
}

// ══ 结论三 · 耐久性 ═══════════════════════════════════════════════════════════
console.log("\n\n══ 结论三 · 耐久性：B 单用 vs B+补域 ══");
console.log("  预言：B 单用时 blockedPressure 无上界，拍数一多必把下游重新推进饱和带。");
for (const T of [24, 60, 120, 240]) {
  const a1 = atten({ edges: C, ticks: T }), a2 = atten({ edges: C, ticks: T, extra: new Set(["blockedPressure"]) });
  console.log(`  t=${String(T).padStart(3)}  B单用 blocked=${a1.base.x["Line.blockedPressure"].toExponential(3)} 衰减=${a1.atten.toExponential(3)}×` +
    `  |  B+补域 blocked=${a2.base.x["Line.blockedPressure"].toFixed(2)} 衰减=${a2.atten.toExponential(3)}×`);
}

// ══ 结论四 · 本单不采纳「照搬 desat3 系数」的理由 ══════════════════════════════
console.log("\n\n══ 结论四 · desat3 的系数为什么不能照搬 ══");
console.log("  它那 11 条 `equal_share` 边靠一个**新归一口径**把 W 从 N 压到 1，");
console.log("  而该口径的实现在 `contracts/src/sim.ts` + `sim/pair-weights.ts` —— 两者都在本单 🚦范围边界之外。");
console.log("  只搬系数不搬口径时，这些边的真实增益（预算 0.75）：");
for (const e of edges.filter((e) => EQUAL_SHARE_EDGES.has(e.key)).sort((a, b) => b.N - a.N)) {
  console.log(`    ${e.key.padEnd(52)} N=${e.N.toFixed(2).padStart(6)}  ⇒ 若 W=N 则该边独占 ${(e.c * e.N / LAM).toFixed(2)} 的增益`);
}
