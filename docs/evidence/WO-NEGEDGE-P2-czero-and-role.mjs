/**
 * 判别之二：把「边关掉」与「边在但 c=0」分开 —— 两者在图上不是同一件事。
 *
 * 上一支探针的解释（本轮实测要证的假设）：
 *   关掉这条边 ⇒ `Order.demandPressure` 入度变 0 ⇒ `isExogenous` 成立
 *   ⇒ 衰减相豁免（propagation.ts:860/888）+ C2 合成跳过（spec-base-synthesis.ts:81）
 *   ⇒ 读数**冻在关边前那一刻**，所以「关边后一个字节没动」不度量「这条边没贡献」。
 *
 * 本探针：
 *  A) **c=0 但边仍在**：系数置 0（边仍在图里，入度仍为 1 ⇒ 不是外生）。
 *     根因预言：硬的不是「边」而是**地板** ⇒ |c|→0 后触地板的单必须**上行到基值**。
 *     若它们**纹丝不动** ⇒ 「读数 = λ·base 由地板造成」被推翻。
 *  B) **早拍反事实**：建会话立刻（tick=2）跑 counterfactual，比较
 *     start / baselineState / counterfactualState 三者的 demandPressure：
 *     关边臂若逐字节等于 start ⇒ 坐实「关边=冻住」而不是「关边没贡献」。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const EKEY = "demo_forecast_bias_to_order_demand";
const COEF0 = -0.222, REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null } catch { j = { _raw: t.slice(0, 120) } }
  return { status: r.status, ok: r.ok, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });
const log = (...a) => console.log(...a);

// ── B) 早拍反事实（先跑，代价小）────────────────────────────────────────────
const se = (await post("/sim/sessions", {})).json;
const t2 = await post(`/sim/sessions/${se.id}/tick`, { n: 2 });
const wE = (await g(`/sim/sessions/${se.id}/world`)).json;
const cfE = await post(`/sim/sessions/${se.id}/counterfactual`, { n: 5, disabledRuleKeys: [EKEY] });
const vc = (await g("/sim/view-config")).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const oids = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
const V = (st, id) => st?.[id]?.demandPressure;
const cnt = (f) => oids.filter((i) => f(i)).length;
const eq = (a, b) => Object.is(a, b);
log(`B) 早拍会话 ${se.id} tick=${wE.tick}（tick HTTP=${t2.status}）  对象 ${oids.length}`);
log(`   关边臂 == 起点（冻住）的单数 : ${cnt((i) => eq(V(cfE.json?.counterfactualState, i), V(wE.state, i)))}/${oids.length}`);
log(`   开边臂 == 起点（收住）的单数 : ${cnt((i) => eq(V(cfE.json?.baselineState, i), V(wE.state, i)))}/${oids.length}`);
log(`   关边臂 != 开边臂 的单数       : ${cnt((i) => !eq(V(cfE.json?.counterfactualState, i), V(cfE.json?.baselineState, i)))}/${oids.length}`);
const s0 = oids.slice(0, 6).map((i) => `${i.slice(-7)}: start=${V(wE.state, i)?.toFixed(4)} base=${V(cfE.json?.baselineState, i)?.toFixed(4)} off=${V(cfE.json?.counterfactualState, i)?.toFixed(4)}`);
log(`   样例（start / 开边 / 关边）：\n     ${s0.join("\n     ")}`);

// ── A) c=0 但边仍在 ────────────────────────────────────────────────────────
const sa = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${sa.id}`)).json;
await post(`/sim/sessions/${sa.id}/tick`, { n: 20 });
const wA = (await g(`/sim/sessions/${sa.id}/world`)).json;
const rows = oids.map((id) => ({ id, base: det.baseSnapshot?.[id]?.demandPressure, x: V(wA.state, id) }))
  .filter((r) => typeof r.base === "number" && typeof r.x === "number");
const lam = Math.round(Math.min(...rows.filter((r) => r.base > 1e-9).map((r) => r.x / r.base)) * 1e9) / 1e9;
const isC = (r) => Math.abs(r.x / r.base - lam) < 1e-9 && r.base > 1e-9;
const clamped = rows.filter(isC);
log(`\nA) 会话 ${sa.id} λ=${lam} 触地板 ${clamped.length}/${rows.length}`);

const p1 = await patch(`/sim/propagation-rules/${RID}`, { coefficient: 0, coefficientRef: null });
const r1 = ((await g("/sim/propagation-rules")).json.items ?? []).find((r) => r.id === RID);
log(`   系数置 0：HTTP=${p1.status} 回读 coefficient=${r1?.coefficient} ref=${JSON.stringify(r1?.coefficientRef)} status=${r1?.status}（边仍在图里 ⇒ 入度仍为 1）`);
await post(`/sim/sessions/${sa.id}/tick`, { n: 15 });
const wB = (await g(`/sim/sessions/${sa.id}/world`)).json;
const dA = (r) => (V(wB.state, r.id) ?? NaN) - r.x;
const moved = clamped.filter((r) => Math.abs(dA(r)) > 1e-9);
log(`   c=0 臂：已触地板单读数变化 ${moved.length}/${clamped.length}  ← 若这批是被地板吃掉的，须 ≈全部`);
const ratios = [...new Set(clamped.map((r) => (V(wB.state, r.id) / r.base).toFixed(6)))];
log(`   读数/基值 取值集合（前 6）：${ratios.slice(0, 6).join(", ")}（趋近 1 = 回到基值）`);
log(`\n=== 已触地板档 c=0 前后（按 |Δ| 降序前 8）===`);
log("单号                    基值     基准(λ·base)  c=0臂        Δ");
for (const r of [...clamped].sort((a, b) => Math.abs(dA(b)) - Math.abs(dA(a))).slice(0, 8))
  log(`${r.id.padEnd(22)} ${r.base.toFixed(2).padStart(8)} ${r.x.toFixed(6).padStart(12)} ${(V(wB.state, r.id) ?? NaN).toFixed(6).padStart(11)} ${dA(r).toFixed(5)}`);

const back = await patch(`/sim/propagation-rules/${RID}`, { coefficient: COEF0, coefficientRef: REF0 });
const r2 = ((await g("/sim/propagation-rules")).json.items ?? []).find((r) => r.id === RID);
log(`\n回退 HTTP=${back.status} coefficient=${r2?.coefficient} ref=${JSON.stringify(r2?.coefficientRef)}`);
