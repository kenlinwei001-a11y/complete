#!/usr/bin/env node
/**
 * **直流增益账本** —— 每一格「在最大合理输入下的稳态」是多少倍量纲上界。
 *
 * 这是本单的**定标依据**，不是又一张漂亮表：
 *
 *   一格的动力学 = `v ← v(1−λ) + Σ_e (c_e · Σ_i w_ei · s_ei)`
 *   源恒定时稳态 `v* = inflow/λ`。令全部源顶到量纲上界 `S`（压力族 S=100），
 *   则 **DC 增益 `G ≡ Σ_e c_e · W_e / λ`**（`W_e` = 该规则落到这一格的权重之和；
 *   `weightRef: null` ⇒ `W_e = N_e` = 扇入条数，**这就是量级失配的第二个来源**），
 *   而 `v*_max = G · S`。要让稳态落在拐点 `kneeHi = 0.75·max` 以下，判据就是
 *
 *        **G ≤ 0.75 · max/S**（同量纲 ⇒ **G ≤ 0.75**）
 *
 * ⚠ 本脚本**不假设** `W_e`，而是从 tick 回执的 `trace[]` 里**按目标实测**：
 * `W_e(target) = Σ_i amount / (c_e · s_ei)`。这样 `weightRef` 有没有、归一成什么样，
 * 都由真实回执说话，不由我读源码猜。
 *
 * ══ 2026-09-16 实测（`SEED_DEMO=1` · 第 24 拍 · 23 个「目标类型.状态量」组）════════════
 *
 *   **23 组里 22 组 G > 0.75，最小的非零 G = 1.08**（第 23 组 G=0 是 `forecastBias` 的负系数边）。
 *   ⇒ 不是"某几条边标歪了"，是**整张表的量纲标定就没有把 λ 算进去**：
 *     单源边的 `G = c/λ`，而 `c ∈ [0.3, 0.9]`、`λ = 0.37` ⇒ **每一条边都 G > 1**，
 *     最弱的一条（c=0.4）也给 `0.4/0.37 = 1.08`。**源顶到量纲上界，目标必然冲出量纲上界。**
 *
 *   规则自己的 description 原文就是稳态口径（"价格冲击 × 0.65 = 型号成本压力"、
 *   "型号成本 × 0.9 = 订单成本压力"）—— 那是 `target = source × c`，
 *   而引擎每拍做的是 `target += source × c` ⇒ 真实稳态是 `source × c/λ`，**比描述承诺的大 2.7 倍**。
 *
 *   前 6 名（G = 源顶到 100 时稳态 ÷ 100）：
 *     Customer.receivablePressure  68.14   ← `source_value_relative`（Σw ∝ 金额敞口 ≈ 50×），**口径本身与 0–100 不相容**
 *     Model.demandLoad             50.00   ← `source_qty_relative`（Σw = N = 37 张单），同上
 *     Material.shortageRisk        15.95   ← 未归一扇入（4 条入边 · N 合计 ~10.6）
 *     Model.supplyRisk             13.24   ← 未归一扇入（7 个物料）＋ 43.3 个工单（延迟边，见 `inflow.mjs`）
 *     Process.queuePressure         5.14
 *     Base.loadIndex                4.86
 *
 *   实测越界：**2697 / 4807 格（56.11%）反算 raw 越上界，平均超 4.7×**；
 *   `Model.costPressure(方形-LFP)` 读数 99.823958604877 ⇒ 反算 raw **3600.301**。
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { STATE_VAR_DOMAINS, PRESSURE_DECAY_PER_TICK } from "../../../apps/datacore/dist/synthetic/battery.js";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

const BAND = 0.25;
function unsaturate(v, min, max, rest) {
  const bandHi = (max - rest) * BAND, kneeHi = max - bandHi;
  if (bandHi > 0 && v > kneeHi && v < max) return kneeHi + bandHi * (bandHi / (max - v) - 1);
  const bandLo = (rest - min) * BAND, kneeLo = min + bandLo;
  if (bandLo > 0 && v < kneeLo && v > min) return kneeLo - bandLo * (bandLo / (v - min) - 1);
  return v;
}

const λ = PRESSURE_DECAY_PER_TICK;
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
  env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat2", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let up = false;
  for (let i = 0; i < 180; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
  if (!up) throw new Error("no service");
  const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`port owned by ${lp}, not ${child.pid}`);
  console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = 本进程 spawn 的 ${child.pid} ✓ · λ=${λ}`);

  const rules = ((await jget(base, "/a/v1/sim/propagation-rules")).items ?? []);
  const ruleOf = new Map(rules.map((r) => [r.key, r]));
  // 🐤 金丝雀：规则表必须非空且含本单病灶那两条
  if (!ruleOf.has("demo_material_price_to_model_cost") || !ruleOf.has("demo_wo_release_to_model_cost")) {
    throw new Error(`规则表取数坏了（${rules.length} 条，缺病灶边）`);
  }
  console.log(`# 🐤 金丝雀：规则表 ${rules.length} 条，两条病灶边都在 ✓`);

  const t0 = (await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world")).baseSnapshot;
  const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
  const K = Number(process.argv[2] ?? 24);
  if (K > 1) await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: K - 1 });
  const prevWorld = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
  const last = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
  const trace = (last.trace ?? []).filter((t) => !String(t.ruleKey ?? "").startsWith("perturbation"));
  if (trace.length === 0) throw new Error("trace 为空 ⇒ 取数坏了（不是「没有入流」）");

  // W_e(target) = Σ_i amount /(c_e · s_ei)  —— 逐条从回执反算，不猜
  const cellIn = new Map(); // `${toId}|${tv}` -> Map<ruleKey,{W, inflow, n}>
  for (const t of trace) {
    const r = ruleOf.get(t.ruleKey); if (!r) continue;
    const c = r.coefficient; if (!(Math.abs(c) > 0)) continue;
    const src = prevWorld[t.fromObjectId]?.[r.sourceStateVar];
    if (typeof src !== "number" || src === 0) continue;
    const w = t.amount / (c * src);
    const k = `${t.toObjectId}|${r.targetStateVar}`;
    const m = cellIn.get(k) ?? new Map(); cellIn.set(k, m);
    const e = m.get(r.key) ?? { W: 0, inflow: 0, n: 0 }; m.set(r.key, e);
    e.W += w; e.inflow += t.amount; e.n += 1;
  }

  // 按 (目标类型.状态量) 汇总 G = Σ_e c_e·W_e/λ
  const objType = new Map();
  for (const ty of ["Material","Model","Order","Base","Line","Supplier","Customer","DemandSegment","OrderPromise","WorkOrder","ARInvoice","ProcessStep","Equipment","PurchaseOrder","Batch","InventoryLot","QualityException","Location","MaintenanceWindow","Certification","Shipment","CustomsDeclaration"]) {
    try { for (const it of (await jget(base, `/a/v1/objects?type=${ty}&pageSize=1000`)).items ?? []) objType.set(it.id, ty); } catch { /* 该类型不存在 */ }
  }

  const byGroup = new Map(); // `${type}.${sv}` -> {cells, Gmax, Gsum, worstCell, rules:Map<key,{Wmax,Wsum,n}>}
  for (const [k, m] of cellIn) {
    const [oid, sv] = k.split("|");
    const d = STATE_VAR_DOMAINS[sv];
    if (d === undefined) continue; // 未声明量纲的（天数/件数/真值族）不在本单
    const ty = objType.get(oid) ?? "?";
    let G = 0;
    for (const [rk, e] of m) G += (ruleOf.get(rk)?.coefficient ?? 0) * e.W;
    G /= λ;
    const g = `${ty}.${sv}`;
    const e = byGroup.get(g) ?? { cells: 0, Gmax: 0, Gsum: 0, worst: null, rules: new Map(), max: d.max };
    e.cells += 1; e.Gsum += G;
    if (G > e.Gmax) { e.Gmax = G; e.worst = oid; }
    for (const [rk, x] of m) {
      const r = e.rules.get(rk) ?? { Wmax: 0, n: 0 };
      if (x.W > r.Wmax) r.Wmax = x.W;
      r.n += 1; e.rules.set(rk, r);
    }
    byGroup.set(g, e);
  }

  console.log(`\n══ 每格 DC 增益 G = Σ_e c_e·W_e / λ（源顶到 100 时的稳态 = G×100）· 第 ${K} 拍 ══`);
  console.log(`   判据：G ≤ 0.75 ⇒ 稳态落在拐点 75 以下，不进饱和段\n`);
  console.log("  目标类型.状态量              格数   G(最大)   稳态=G×100   超拐点   主要入边（c × W）");
  const rows = [...byGroup.entries()].sort((a, b) => b[1].Gmax - a[1].Gmax);
  for (const [g, e] of rows) {
    const contrib = [...e.rules.entries()]
      .map(([rk, x]) => ({ rk, c: ruleOf.get(rk)?.coefficient ?? 0, W: x.Wmax }))
      .sort((a, b) => b.c * b.W - a.c * a.W)
      .slice(0, 2)
      .map((x) => `${x.rk.replace(/^demo_/, "")}(${x.c}×${x.W.toFixed(1)})`)
      .join(" + ");
    console.log(
      `  ${g.padEnd(30)} ${String(e.cells).padStart(4)}  ${e.Gmax.toFixed(2).padStart(8)}  ${(e.Gmax * 100).toFixed(0).padStart(10)}   ${(e.Gmax / 0.75).toFixed(1).padStart(6)}×  ${contrib}`,
    );
  }

  // 实测越界格统计（只数已声明量纲的）
  const world = (await jget(base, `/a/v1/sim/sessions/${s.id}/world`)).state;
  let declared = 0, over = 0, sumRatio = 0, maxRaw = 0, maxCell = "";
  for (const [oid, row] of Object.entries(world)) {
    for (const [sv, v] of Object.entries(row)) {
      const d = STATE_VAR_DOMAINS[sv]; if (d === undefined || typeof v !== "number") continue;
      declared += 1;
      const raw = unsaturate(v, d.min, d.max, d.restPoint);
      if (raw > d.max) { over += 1; sumRatio += raw / d.max; if (raw > maxRaw) { maxRaw = raw; maxCell = `${oid}.${sv}`; } }
    }
  }
  console.log(`\n══ 实测（第 ${K} 拍）══`);
  console.log(`  已声明量纲的格   : ${declared}`);
  console.log(`  反算 raw 越上界  : ${over}（${(over / declared * 100).toFixed(2)}%），平均超 ${(sumRatio / Math.max(1, over)).toFixed(1)}×`);
  console.log(`  最热的一格       : ${maxCell} raw=${maxRaw.toFixed(1)}（超 ${(maxRaw / 100).toFixed(1)}×）`);
  const mc = world["obj_model_方形-LFP"]?.costPressure;
  if (typeof mc === "number") console.log(`  Model.costPressure(方形-LFP) 读数 ${mc.toFixed(12)} ⇒ 反算 raw ${unsaturate(mc, 0, 100, 0).toFixed(3)}`);
} finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
