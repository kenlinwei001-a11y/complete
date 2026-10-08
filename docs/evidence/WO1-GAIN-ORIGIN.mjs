#!/usr/bin/env node
/**
 * WO-1 · 「业务增益」到底是谁的数 —— 三个独立读法并排
 *   ① 运行时实测（真后端 4052）：pos_ncm.priceShock +Δ ⇒ 4680-NCM 的 Model.costPressure 偏离
 *   ② 引擎口径预测：c × w × Δ / λ × (1−(1−λ)^T)   （c = C36 现值，w = BOM 成本占比，λ = 该格 decayRef）
 *   ③ 业务口径预测（会计恒等式）：w × Δ   （unitCost = Σ 行成本 ⇒ 单料涨价 Δ% ⇒ 单料成本贡献 +w·Δ）
 *   零扰动对照臂同拍读数 ⇒ 差值只记两臂之差（世界自身 churn 不计入）。
 *   金丝雀：两臂状态格差别数必须 > 0（不是「没动」）；w 必须能算出来（Σ行成本 > 0）。
 * 只读（扰动只在会话内，不落库）。
 */
const B = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const MID = "obj_model_4680-NCM";
const OID = "obj_material_pos_ncm";
const TICKS = Number(process.env.TICKS || 25);
const MAG = Number(process.env.MAG || 15);
const api = async (m, p, b) => {
  const r = await fetch(`${B}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 200)}`); return r.j; };
const get = async (p) => must(await api("GET", p), p);

// ── 规则现值（引擎真读的那张表）─────────────────────────────────────────────
const rules = (await get("/a/v1/sim/propagation-rules")).items;
const R = rules.find((r) => r.key === "demo_material_price_to_model_cost");
const REST = rules.filter((r) => r.targetTypeKey === "Model" && r.targetStateVar === "costPressure").map((r) => r.key);
const stated = [...String(R.description).matchAll(/[×x]\s*([-−]?[\d.]+)/g)].map((m) => Number(String(m[1]).replace("−", "-")));
console.log(`边 ${R.key}  c=${R.coefficient}  λ 由落点 decayRef 定  weightRef=${JSON.stringify(R.weightRef)}`);
console.log(`屏上描述: ${R.description}`);
console.log(`Model.costPressure 全部入边: ${REST.join(" · ")}`);

// ── 权重 w：独立从本体 BOM 现算（不调被测代码）─────────────────────────────
const heads = (await get("/a/v1/objects?type=BOMHeader&pageSize=600")).items || [];
const dets = (await get("/a/v1/objects?type=BOMDetail&pageSize=2000")).items || [];
const mats = (await get("/a/v1/objects?type=Material&pageSize=600")).items || [];
const price = Object.fromEntries(mats.map((m) => [m.props.matId, Number(m.props.unitPrice ?? 0)]));
const h = heads.find((x) => String(x.props.modelId) === "4680-NCM");
if (!h) throw new Error("金丝雀失败：找不到 4680-NCM 的 BOMHeader");
const rows = dets.filter((d) => String(d.props.bomId) === h.props.bomId);
const lineCost = (d) => Number(d.props.quantity) * (1 + Number(d.props.lossRate || 0)) * price[d.props.materialId];
const total = rows.reduce((s, d) => s + lineCost(d), 0);
if (!(total > 0)) throw new Error("金丝雀失败：BOM 行成本和为 0 ⇒ w 算不出来");
const w = lineCost(rows.find((d) => d.props.materialId === "pos_ncm")) / total;
console.log(`w(pos_ncm 在 4680-NCM 生效 BOM 的成本占比) = ${w.toFixed(9)}  （Σ行成本=${total.toFixed(2)}，现算）`);

// ── 两臂 ────────────────────────────────────────────────────────────────────
async function arm(mag) {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  if (mag !== 0) must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, { kind: "supply_disruption", targetObjectId: OID, targetStateVar: "priceShock", mode: "delta", magnitude: mag, startTick: 0, durationTicks: null, label: `priceShock ${mag}` }), "pert");
  for (let t = 0; t < TICKS; t++) must(await api("POST", `/a/v1/sim/sessions/${id}/tick`, { n: 1 }), "tick");
  const wld = must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world");
  return { id, st: wld?.state ?? {} };
}
const a0 = await arm(0);
const a1 = await arm(MAG);
const cp0 = a0.st[MID]?.costPressure, cp1 = a1.st[MID]?.costPressure;
const s0 = a0.st[OID]?.priceShock, s1 = a1.st[OID]?.priceShock;
let diff = 0; const keys = new Set([...Object.keys(a0.st), ...Object.keys(a1.st)]);
for (const k of keys) { const A = a0.st[k] || {}, Bs = a1.st[k] || {}; for (const v of new Set([...Object.keys(A), ...Object.keys(Bs)])) if (A[v] !== Bs[v]) diff++; }
console.log(`金丝雀：两臂状态格差别数 = ${diff}（必须 > 0；=0 表示脉冲没落地，本探针什么都没量到）`);
if (!(diff > 0)) throw new Error("金丝雀失败：两臂零差异");
console.log(`源格 ${OID}.priceShock  零臂=${s0}  扰动臂=${s1}   Δ源=${(s1 - s0).toFixed(6)}`);
console.log(`靶格 ${MID}.costPressure 零臂=${cp0}  扰动臂=${cp1}   Δ靶=${(cp1 - cp0).toFixed(9)}`);

// ── 三个预测 ────────────────────────────────────────────────────────────────
const LAM = Number(process.env.LAM || 0.37);
const conv = 1 - Math.pow(1 - LAM, TICKS);
const ds = s1 - s0;
const predEngine = R.coefficient * w * ds / LAM * conv;
const shownGain = stated[stated.length - 1];
const identity = w * ds;
console.log("");
console.log(`读数           = ${(cp1 - cp0).toFixed(9)}`);
console.log(`② 引擎口径预测 = c×w×Δ/λ×(1−0.63^T) = ${predEngine.toFixed(9)}   （T=${TICKS}，收敛因子=${conv.toFixed(9)}）`);
console.log(`③ 会计恒等式   = w×Δ = ${identity.toFixed(9)}`);
console.log(`比值 ③/读数    = ${(identity / (cp1 - cp0)).toFixed(4)}   ← 「业务上应付出去的」是「引擎给出的」几倍`);
console.log(`比值 ②/读数    = ${(predEngine / (cp1 - cp0)).toFixed(9)}   ← 应 ≈1（证明读数完全由 c 决定）`);
console.log(`屏上承诺的增益 = ${shownGain}（= c/λ 的显示投影，稳态口径：×w×Δ = ${(shownGain * w * ds).toFixed(9)}）`);
console.log(`DONE ${new Date().toISOString()}`);
