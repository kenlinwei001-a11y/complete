#!/usr/bin/env node
// WO-SIM-CALIBRATION · 阶段一诊断的**可复跑证据**（纯静态推导：不起服务、不跑 vitest、不读数据库）
//
//   node docs/evidence/wo-sim-calibration/calibration-analysis.mjs
//
// ── 它算什么 ────────────────────────────────────────────────────────────────────
// 把 `sim/propagation.ts` 每拍的三步语义逐条照抄成一个**均场**迭代，解零扰动稳态：
//   ① 衰减  x ← rest + (1−λ)(x − rest)      仅「被某条规则写入 && 已声明取值域」的量纲
//   ② 入流  x += Σ_e c_e · N_e · max(0, x_src − tol_e)   （combine:"sum" ⇒ 每个源实例各加满额）
//   ③ 软饱和 x ← saturateToDomain(x)         仅「已声明取值域」的量纲
// 均场近似 = 每个 stateVar 用一个标量（该量纲在所有实例上的均值），扇入用**实测** N_e。
// `delayTicks` 只移时不移稳态，故不建模。
//
// ── N_e（扇入）的出处：`fanin-N.json` ──────────────────────────────────────────
// 不是本单量的，是 `origin/claude/handoff-desat3` 的实测产物
// （`docs/evidence/wo-sim-desat3/fanin-N.json`，47 条），原样搬来。
// 独立复核过一条：`demo_process_queue_to_line_blocked = 5`，与 650 条 `lnk_pbl_*`（Process→Line，
// `synthetic/service.ts` 每个 Process 一条）÷ 130 条 Line 吻合。
//
// ── ⚠ 本脚本的三条已知边界（先说清楚，免得被当成它没说的话）────────────────────
//  ① **均场 ≠ 逐实例**：它答的是「这个量纲整体落在哪」，答不了「130 条产线里有几条越界」。
//     后者要真起服务（阶段三）。
//  ② 外生根一律 held=50（tick0 生成式 `round(hash01(objectId|stateVar)×100)` 的均值）。
//  ③ 未声明取值域的量纲是**纯积分器**，没有稳态 —— 它们的值随拍数线性增长，
//     脚本按固定拍数取样并在输出里打 `*` 标注，⛔ 不许读成稳态。
//
// 金丝雀（铁律 0.6：报结论前先自证量法）：
//   ① 扇入金丝雀 —— demo_process_queue_to_line_blocked 必须 N=5 且 c=0.55
//   ② 闭式对拍   —— blockedPressure 强行补域后稳态必须 ≈ 97.669（审核方独立复核过的闭式值）
//   任一不中 ⇒ 抛错退出，**不许**继续往下报任何数。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const SEED_TS = resolve(REPO, "apps/datacore/src/seed.ts");
const BATTERY_TS = resolve(REPO, "apps/datacore/src/synthetic/battery.ts");

const LAMBDA = 0.37;   // PRESSURE_DECAY_PER_TICK（battery.ts）= 1 − (1 − 3/4)^(1/3)
const BAND = 0.25;     // SATURATION_BAND_FRACTION（propagation.ts）
const SEED_VALUE = 50; // 外生根的均场值

// ══ 1) 从 seed.ts 抽 47 条传导边 ═══════════════════════════════════════════════
function extractRules() {
  const src = readFileSync(SEED_TS, "utf8");
  const si = src.indexOf("const DEMO_PROPAGATION_RULES: ReadonlyArray<");
  const bodyStart = src.indexOf("> = [", si);
  if (si < 0 || bodyStart < 0) throw new Error("CANARY-FAIL 找不到 DEMO_PROPAGATION_RULES ⇒ 量法坏了");
  const rest = src.slice(bodyStart + 4);
  const body = rest.slice(0, rest.search(/\n\];/));
  const field = (c, name) => {
    const m = c.match(new RegExp(`(^|\\n)\\s*${name}:\\s*([^\\n]+?),\\s*(//.*)?$`, "m"));
    return m ? m[2].trim() : null;
  };
  const unq = (v) => (v == null ? null : v.replace(/^["'`]|["'`]$/g, ""));
  const out = [];
  for (const c of body.split(/\n  \{\n/).slice(1)) {
    const id = unq(field(c, "id"));
    if (!id) continue;
    out.push({
      key: unq(field(c, "key")),
      src: unq(field(c, "sourceStateVar")),
      dst: unq(field(c, "targetStateVar")),
      viaLinkKey: unq(field(c, "viaLinkKey")),
      targetTypeKey: unq(field(c, "targetTypeKey")),
      c: Number(field(c, "coefficient")),
    });
  }
  return out;
}

// ══ 2) 从 battery.ts 抽已声明取值域的量纲 ═════════════════════════════════════
function extractDeclared() {
  const bat = readFileSync(BATTERY_TS, "utf8");
  const blk = bat.slice(bat.indexOf("export const STATE_VAR_DOMAINS"), bat.indexOf("export function stateVarDomains"));
  const d = new Set([...blk.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]));
  if (blk.includes("STATE_VAR_DOMAINS.forecastBias")) d.add("forecastBias");
  if (!d.has("queuePressure")) throw new Error("CANARY-FAIL 域表抽取没命中 queuePressure ⇒ 量法坏了");
  return d;
}

const rules = extractRules();
const declared = extractDeclared();
const fanin = JSON.parse(readFileSync(resolve(HERE, "fanin-N.json"), "utf8"));

// desat-3 的扇入表按 (viaLinkKey → targetType) 度量，与 stateVar 无关 ⇒ 兄弟边可借。
// 3 条借自兄弟边/结构，逐条写明出处。⛔ 不许默认 1 —— 默认会把「没量到」读成「扇入为 1」。
const FANIN_PATCH = {
  demo_order_demand_pressure: 24.833333333333332,      // 同 order_for_model→Model，借 demo_order_churn_to_model_demand_load
  demo_order_demand_to_line_split: 1,                   // 同 order_has_line→OrderLine，借 demo_order_churn_to_line_split
  demo_customer_reaction_cut_order: 1,                  // customer_places_order→Order：一张订单恰有 1 个下单客户
};
const TOL = { demo_customer_reaction_cut_order: 12 };   // seed.ts reaction.tolerance（还手边的 hinge）

const edges = rules.map((r) => {
  const N = fanin[r.key] ?? FANIN_PATCH[r.key];
  if (N === undefined) throw new Error(`CANARY-FAIL 扇入表缺 ${r.key} ⇒ 量法坏了`);
  return { ...r, N, tol: TOL[r.key] ?? 0 };
});

const vars = new Set(); const written = new Set();
for (const r of rules) { vars.add(r.src); vars.add(r.dst); written.add(r.dst); }

// ══ 3) 引擎语义 ═══════════════════════════════════════════════════════════════
const dom = (v) => (v === "forecastBias" ? { min: -100, max: 100, rest: 0 } : { min: 0, max: 100, rest: 0 });

function saturate(raw, d, band) {
  const r = Math.min(d.max, Math.max(d.min, d.rest));
  const bHi = (d.max - r) * band;
  if (bHi > 0) { const k = d.max - bHi; if (raw > k) return d.max - bHi / (1 + (raw - k) / bHi); }
  else if (raw > d.max) return d.max;
  const bLo = (r - d.min) * band;
  if (bLo > 0) { const k = d.min + bLo; if (raw < k) return d.min + bLo / (1 + (k - raw) / bLo); }
  else if (raw < d.min) return d.min;
  return raw;
}
/** 软饱和在工作点处的导数 dOut/dRaw：带内 = 1；上溢段 = 1/(1+u)²。扰动过这一个节点被衰减 1/deriv 倍。 */
function deriv(raw, d, band) {
  const r = Math.min(d.max, Math.max(d.min, d.rest));
  const bHi = (d.max - r) * band;
  if (bHi <= 0) return raw > d.max ? 0 : 1;
  const k = d.max - bHi;
  if (raw <= k) return 1;
  const u = (raw - k) / bHi;
  return 1 / ((1 + u) * (1 + u));
}

function run({ edges, lambda = LAMBDA, band = BAND, ticks, inject = null, extraDeclared = new Set() }) {
  const isDecl = (v) => declared.has(v) || extraDeclared.has(v);
  const x = {}; for (const v of vars) x[v] = SEED_VALUE;
  if (inject) x[inject.v] += inject.d;
  let raws = {};
  for (let t = 0; t < ticks; t++) {
    const nx = { ...x };
    for (const v of vars) if (written.has(v) && isDecl(v)) { const d = dom(v); nx[v] = d.rest + (1 - lambda) * (x[v] - d.rest); }
    for (const e of edges) nx[e.dst] += e.c * e.N * Math.max(0, x[e.src] - e.tol);
    if (inject && !written.has(inject.v)) nx[inject.v] = SEED_VALUE + inject.d; // 持续扰动 = 按住在新值
    raws = { ...nx };
    for (const v of vars) if (isDecl(v)) nx[v] = saturate(nx[v], dom(v), band);
    for (const v of vars) x[v] = nx[v];
  }
  return { x, raws };
}

/** 注入点 → costPressure 的总衰减倍数（= 注入量 ÷ 下游读数变化量）。 */
function attenuation(opts, root = "equipmentFailure") {
  const a = run(opts);
  const b = run({ ...opts, inject: { v: root, d: 10 } });
  const d = Math.abs(b.x.costPressure - a.x.costPressure);
  return { delta: d, atten: d === 0 ? Infinity : 10 / d, base: a };
}

/** 方案 B：把每格 DC 增益 Σ_e c_e·N_e/λ 压到 cap 以下（desat-3 ②③ 的口径）。 */
function budgetEdges(edges, lambda = LAMBDA, cap = 0.75) {
  const S = {};
  for (const e of edges) S[e.dst] = (S[e.dst] ?? 0) + Math.abs(e.c) * e.N / lambda;
  return edges.map((e) => ({ ...e, c: e.c * Math.min(1, cap / (S[e.dst] || 1)) }));
}

// ══ 4) 金丝雀 ═════════════════════════════════════════════════════════════════
const cy = edges.find((e) => e.key === "demo_process_queue_to_line_blocked");
if (!cy || cy.N !== 5 || cy.c !== 0.55) throw new Error(`CANARY-FAIL 扇入金丝雀 N=${cy?.N} c=${cy?.c} ⇒ 量法坏了`);
console.log(`CANARY-OK ① demo_process_queue_to_line_blocked N=${cy.N} c=${cy.c}（= 650 Process ÷ 130 Line）`);

const probe = run({ edges, ticks: 4000, extraDeclared: new Set(["blockedPressure"]) });
console.log(`CANARY-OK ② blockedPressure 补域后稳态 = ${probe.x.blockedPressure.toFixed(6)}（闭式 97.669316，差 ${(probe.x.blockedPressure - 97.669316).toFixed(6)}）`);
console.log(`          其上游 queuePressure = ${probe.x.queuePressure.toFixed(4)}（闭式里代入的实测值 93.32）`);
// 阈值 0.2：均场把 queuePressure 也算成内生量，与「代入实测 93.32」必然有零点几的差；差过 0.2 说明的就不是这个了。
if (Math.abs(probe.x.blockedPressure - 97.669316) > 0.2) throw new Error("CANARY-FAIL 闭式对不上 ⇒ 模型坏了");

// ══ 5) 结论一：canonical 现状的饱和分布 ═══════════════════════════════════════
console.log(`\n══ 结论一 · canonical 语义下 41 个状态量的零扰动稳态（λ=${LAMBDA} BAND=${BAND}）══`);
const st = run({ edges, ticks: 4000 });
const bandOf = (v) => (v < 50 ? "<50" : v < 75 ? "50–75" : v < 90 ? "75–90" : "≥90");
const dist = {};
const rows = [...vars].sort().map((v) => {
  const dec = declared.has(v);
  const b = dec ? bandOf(st.x[v]) : "未声明(纯积分器·发散)";
  dist[b] = (dist[b] ?? 0) + 1;
  return { v, dec, val: st.x[v], b, d: dec ? deriv(st.raws[v], dom(v), BAND) : null };
});
console.log("分布：", JSON.stringify(dist));
console.log("\nstateVar                     声明  稳态值        区间                   工作点导数");
for (const r of rows) {
  console.log(r.v.padEnd(28) + (r.dec ? " ✓  " : " ✗  ") + r.val.toExponential(4).padEnd(14) +
    r.b.padEnd(23) + (r.d === null ? "—（无饱和可言）" : r.d.toExponential(3)));
}

// ══ 6) 结论二：三个方案的可预言后果 ═══════════════════════════════════════════
const SHOW = ["queuePressure", "blockedPressure", "releasePressure", "costPressure", "supplyRisk", "receivablePressure"];
function report(name, opts) {
  const { atten, delta, base } = attenuation({ ticks: 24, ...opts });
  console.log(`\n── ${name} ──`);
  for (const v of SHOW) {
    const dec = declared.has(v) || (opts.extraDeclared ?? new Set()).has(v);
    console.log("  " + v.padEnd(20) + (base.x[v].toExponential(4) + (dec ? "" : "*")).padEnd(16) +
      (dec ? deriv(base.raws[v], dom(v), opts.band ?? BAND).toExponential(3) : "—"));
  }
  console.log(`  注入 equipmentFailure+10 ⇒ ΔcostPressure=${delta.toExponential(4)}  总衰减=${atten === Infinity ? "∞" : atten.toExponential(3) + "×"}`);
}
console.log("\n\n══ 结论二 · 三个方案（取样第 24 拍；* = 纯积分器，不是稳态）══");
report("修前 canonical", { edges });
for (const lam of [0.5, 0.9, 0.99]) report(`方案A λ=${lam}`, { edges, lambda: lam });
report("方案B 每格增益预算 ≤0.75", { edges: budgetEdges(edges) });
report("方案B+补域（blockedPressure 声明取值域）", { edges: budgetEdges(edges), extraDeclared: new Set(["blockedPressure"]) });
for (const b of [0.5, 0.75]) report(`方案C BAND=${b}（⚠ 引擎侧，超出本单范围边界）`, { edges, band: b });

// ══ 7) 结论三：方案 B 单用不耐久（blockedPressure 仍是纯积分器） ═══════════════
console.log("\n\n══ 结论三 · 耐久性：B 单用 vs B+补域，随拍数变化 ══");
console.log("  预言：B 单用时 blockedPressure 无上界，拍数一多必把下游重新推进饱和带。");
for (const T of [24, 60, 120, 240]) {
  const eB = budgetEdges(edges);
  const a1 = attenuation({ edges: eB, ticks: T });
  const a2 = attenuation({ edges: eB, ticks: T, extraDeclared: new Set(["blockedPressure"]) });
  console.log(`  t=${String(T).padStart(3)}  B单用: blocked=${a1.base.x.blockedPressure.toExponential(3)} release=${a1.base.x.releasePressure.toFixed(2)} 衰减=${a1.atten.toExponential(3)}×` +
    `  |  B+补域: blocked=${a2.base.x.blockedPressure.toFixed(2)} release=${a2.base.x.releasePressure.toFixed(2)} 衰减=${a2.atten.toExponential(3)}×`);
}
