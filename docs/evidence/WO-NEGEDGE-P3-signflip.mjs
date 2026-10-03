/**
 * P3c · 符号闸门判决实验（修正版：置空 coefficientRef，否则 inline coefficient 不参与计算）
 *
 * 上一版 p3b 的教训（本仓老病，记进 falsification）：PATCH 返回 200 且**回读自己写的那个字段**
 *   算不出「扰动生效」—— 引擎按 coefficientRef 解析系数，ref 非空时 inline 被忽略。
 *   ⇒ 本版判据：PATCH 后必须回读 **两** 个字段（coefficient 与 coefficientRef），
 *     并必须有**同臂正对照**（扰动臂读数相对对照臂发生大范围变化）。
 *
 * H1（先声明）：k: −0.222 → +0.222 且 ref=null ⇒ 必须出现读数 > 基值+0.01 的单。
 *   0 张 ⇒ 候选根因（净入流符号被源非负性钉死）被推翻。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = []; const log = (...a) => { L.push(a.map(String).join(" ")); fs.writeFileSync("/tmp/wo-3root/p3c.out", L.join("\n") + "\nCAPTURED_RC=0\n"); console.log(...a); };
const K0 = -0.222, REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };
const getRule = async () => ((await g("/sim/propagation-rules")).json.items ?? []).find((r) => r.id === RID);
let done = false;
const restore = async () => { if (done) return; done = true; const p = await patch(`/sim/propagation-rules/${RID}`, { coefficient: K0, coefficientRef: REF0 }); const r = await getRule(); log(`回退 PATCH HTTP=${p.status} 回读 k=${r?.coefficient} ref=${JSON.stringify(r?.coefficientRef)}（须 ${K0} / ${JSON.stringify(REF0)}）`); };

try {
  const r0 = await getRule();
  log(`金丝雀⓪ k=${r0?.coefficient} ref=${JSON.stringify(r0?.coefficientRef)} status=${r0?.status}`);
  const vc = (await g("/sim/view-config")).json;
  const typeOf = new Map();
  for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
  const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
  const modelIds = [...typeOf.entries()].filter(([, tk]) => tk === "Model").map(([i]) => i).sort();
  const arm = async (tag) => {
    const s = (await post("/sim/sessions", {})).json; await sleep(500);
    const det = (await g(`/sim/sessions/${s.id}`)).json;
    await post(`/sim/sessions/${s.id}/tick`, { n: 12 }); await sleep(500);
    const w = (await g(`/sim/sessions/${s.id}/world`)).json;
    const bs = det.baseSnapshot ?? {}, st = w.state ?? {};
    const rows = orderIds.map((i) => ({ i, base: bs[i]?.demandPressure, v: st[i]?.demandPressure })).filter((p) => typeof p.base === "number" && typeof p.v === "number");
    const fb = modelIds.map((i) => bs[i]?.forecastBias).filter((x) => typeof x === "number");
    log(`${tag}: 会话=${s.id} Order=${rows.length} fb(n=${fb.length}) min=${Math.min(...fb)} max=${Math.max(...fb)} 负=${fb.filter((x) => x < 0).length}`);
    return { rows, fb };
  };
  const A = await arm("对照臂 k=-0.222");
  log(`  对照臂 读数>基值+0.01 = ${A.rows.filter((p) => p.v > p.base + 0.01).length}/150（须 0）`);

  const pr = await patch(`/sim/propagation-rules/${RID}`, { coefficient: 0.222, coefficientRef: null });
  const r1 = await getRule();
  log(`扰动 PATCH HTTP=${pr.status} 回读 coefficient=${r1?.coefficient} coefficientRef=${JSON.stringify(r1?.coefficientRef)}（须 0.222 / null）`);
  if (r1?.coefficient !== 0.222 || r1?.coefficientRef !== null) { log("‼ 扰动未落地 ⇒ 不作结论"); await restore(); }
  else {
    const C = await arm("翻转臂 k=+0.222 ref=null");
    const m = new Map(A.rows.map((p) => [p.i, p.v]));
    const cmp = C.rows.map((p) => ({ ...p, ctl: m.get(p.i) })).filter((p) => typeof p.ctl === "number");
    const changed = cmp.filter((p) => p.ctl !== p.v);
    const above = cmp.filter((p) => p.v > p.base + 0.01);
    log(`正对照（扰动必须落地）：读数变化 ${changed.length}/${cmp.length} 格`);
    log(`★H1：翻转臂 > 基值+0.01 的单 = ${above.length}/${cmp.length}`);
    const b0 = cmp.filter((p) => p.base > 0);
    log(`   基值>0 子集：${b0.filter((p) => p.v > p.base + 0.01).length}/${b0.length}`);
    for (const p of [...cmp].sort((a, b) => (b.v - b.ctl) - (a.v - a.ctl)).slice(0, 5)) log(`   ↑ ${p.i} base=${p.base} ctl=${p.ctl} flip=${p.v} Δ=${(p.v - p.ctl).toFixed(4)}`);
    const rset = new Set(A.fb.map((x) => +(0.222 * x / 0.37).toFixed(3)));
    const hit = cmp.filter((p) => p.base > 0).filter((p) => [...rset].some((x) => Math.abs(x - (p.v - 0.37 * p.base)) < 0.08));
    log(`H2 代数：预测 c/λ 集合 {${[...rset].join(", ")}}；命中 = ${hit.length}/${cmp.filter((p) => p.base > 0).length}`);
  }
} catch (e) { log(`‼ 异常：${e.message}（已落盘部分见上）`); } finally { await restore(); }
