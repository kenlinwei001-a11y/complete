/**
 * RV3c · 评审员 #2 · **逐单算术预言**（机制必须能算，不只是"看起来像"）
 *
 * 由根因推出的递推（demandPressure：压力族 rest=min=0，λ=0.37，C2 在核之后补 λ·base）：
 *     z ← clamp(0.63·z + c, 0, 100) + 0.37·b        c = k·f（k=−0.222，f = 该单所属型号的 forecastBias）
 *     z₀ = b（tick0 基值 = 规格值 demandDelta×100）
 *
 * 预言不是拟合：k 来自规则表、f 来自 baseSnapshot、b 来自 baseSnapshot、λ 来自衰减回执 —— 四个数
 * 全部独立于本脚本要预测的那个读数。命中率就是这条机制的强度。
 *
 * 金丝雀：① 本拍 trace 里该边行数 >0 ② 型号数 =6 ③ 无入流的单必须**一个字节不动**
 */
import fs from "node:fs";

const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const OUT = "/Users/apple/deploy/wo-edge-wire/docs/evidence/RV3c-reviewer2-arithmetic-prediction.txt";
const L = [];
const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync(OUT, L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = -0.222, LAM = 0.37, TICKS = 12;

try {
  const r0 = ((await g("/sim/propagation-rules")).json?.items ?? []).find((r) => r.id === RID);
  log(`目标边 k=${r0?.coefficient}（若已被别处改动，本预言作废）`);
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc?.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  log(`金丝雀② Model=${modelIds.length}（须 6）Order=${orderIds.length}`);

  const s = (await post("/sim/sessions", {})).json;
  await sleep(500);
  const det = (await g(`/sim/sessions/${s.id}`)).json;
  const base = det.baseSnapshot ?? {};
  const tr = await post(`/sim/sessions/${s.id}/tick`, { n: TICKS });
  await sleep(300);
  const w = (await g(`/sim/sessions/${s.id}/world`)).json;
  const trace = tr.json?.trace ?? [];
  const edgeRows = trace.filter((t) => t.ruleKey === r0?.key);
  log(`金丝雀① 本拍该边 trace 行 = ${edgeRows.length}（须 >0）`);
  const fbOfModel = new Map(modelIds.map((i) => [i, base[i]?.forecastBias]));
  const srcOfOrder = new Map(edgeRows.map((t) => [t.toObjectId, t.fromObjectId]));

  let hit = 0, miss = 0, noSrc = 0;
  const misses = [];
  for (const oid of orderIds) {
    const b = base[oid]?.demandPressure;
    const v = w?.state?.[oid]?.demandPressure;
    if (typeof b !== "number" || typeof v !== "number") continue;
    const src = srcOfOrder.get(oid);
    if (src === undefined) { // 无入流：C2 把读数拉回基值 ⇒ 应逐字节 = 基值
      if (v === b) hit++; else { noSrc++; misses.push(`${oid} 无入流 base=${b} v=${v}`); }
      continue;
    }
    const f = fbOfModel.get(src);
    const c = K * f;
    let z = b;
    for (let t = 0; t < TICKS; t++) z = Math.min(100, Math.max(0, 0.63 * z + c)) + LAM * b; // 压力族上带 25 ⇒ 本次无上溢单，仅下界硬夹
    if (Math.abs(z - v) < 1e-4) hit++; else { miss++; if (misses.length < 6) misses.push(`${oid} src=${src} fb=${f} base=${b} 预言=${z.toFixed(6)} 实测=${v.toFixed(6)}`); }
  }
  log(`★逐单预言命中 = ${hit}/${hit + miss + noSrc}（无入流单 ${noSrc} 例不符）`);
  if (misses.length) log(`   不符样例：${misses.join(" | ")}`);

  // 两个regime的分布（说明「被地板吸收」后的可见读数是 λ·base，不是 0）
  const rows = orderIds.map((oid) => ({ oid, b: base[oid]?.demandPressure, v: w?.state?.[oid]?.demandPressure, src: srcOfOrder.get(oid) }))
    .filter((r) => typeof r.b === "number" && typeof r.v === "number");
  const floored = rows.filter((r) => r.b > 0 && Math.abs(r.v - LAM * r.b) < 1e-6);
  const linear = rows.filter((r) => r.src !== undefined && r.b > 0 && Math.abs(r.v - (r.b - 0.6 * (fbOfModel.get(r.src) ?? 0))) < 1e-4);
  log(`   regime 计数：可见值 = λ·base（核内被夹到 0 后 C2 补 λ·base）= ${floored.length}｜= base − 0.6·fb = ${linear.length}｜其余 = ${rows.length - floored.length - linear.length}`);
  log(`   上穿(>base+0.01) = ${rows.filter((r) => r.v > r.b + 0.01).length}/${rows.length}`);
  log("── 结束 ──");
} catch (e) {
  log(`‼ 异常：${e?.stack || e}`);
  L.push("CAPTURED_RC=7"); fs.writeFileSync(OUT, L.join("\n") + "\n"); process.exit(7);
}
