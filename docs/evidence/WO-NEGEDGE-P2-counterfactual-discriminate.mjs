/**
 * 判别：counterfactual 单条屏蔽为何是 no-op（全屏蔽却有效）。
 * 三道金丝雀：
 *  ① 未知 key 必须被拒（400）—— 证明 disabledRuleKeys 这条通路是活的，不是被静默忽略。
 *  ② 屏蔽另一条边（Order.demandPressure → Model.demandLoad）看 Model.demandLoad 动不动。
 *  ③ 屏蔽我们这条边：counterfactualState 与 baselineState 是否逐字节相同。
 * 判据：若 ① 中而被拒、② 有效、③ 无差异 ⇒ 不是「这条边没影响」，而是**单条屏蔽没落地**，
 *      该路由对单条屏蔽的读数不可作证（记仪器缺陷，不记作根因的反证）。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const EKEY = "demo_forecast_bias_to_order_demand";
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null } catch { j = { _raw: t.slice(0, 120) } }
  return { status: r.status, ok: r.ok, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);
const cellsDiff = (a, b) => { let n = 0; for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]))
  for (const v of new Set([...Object.keys(a?.[id] ?? {}), ...Object.keys(b?.[id] ?? {})]))
    if (a?.[id]?.[v] !== b?.[id]?.[v]) n++; return n; };

const s = (await post("/sim/sessions", {})).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 20 });

// ① 未知 key 金丝雀
const bad = await post(`/sim/sessions/${s.id}/counterfactual`, { n: 2, disabledRuleKeys: ["__no_such_rule__"] });
log(`① 未知 key：HTTP=${bad.status} code=${bad.json?.error?.code ?? "-"}  ${bad.status === 400 ? "✅ 通路是活的（不静默忽略）" : "❌ 通路可疑"}`);

// ② 屏蔽另一条边
const r2 = await post(`/sim/sessions/${s.id}/counterfactual`, { n: 5, disabledRuleKeys: ["demo_order_demand_pressure"] });
const d2 = cellsDiff(r2.json?.baselineState, r2.json?.counterfactualState);
const dl = ["obj_model_", "Model"].length; // placeholder
let modelDiff = 0;
for (const id of Object.keys(r2.json?.baselineState ?? {})) {
  const a = r2.json.baselineState[id], b = r2.json.counterfactualState?.[id];
  if (a?.demandLoad !== b?.demandLoad) modelDiff++;
}
log(`② 屏蔽 demo_order_demand_pressure：HTTP=${r2.status} 全图不同格=${d2}  Model.demandLoad 不同对象=${modelDiff}  ${d2 > 0 ? "✅ 单条屏蔽确实改变读数" : "❌ 单条屏蔽也不动"}`);

// ③ 屏蔽目标边
const r3 = await post(`/sim/sessions/${s.id}/counterfactual`, { n: 5, disabledRuleKeys: [EKEY] });
const d3 = cellsDiff(r3.json?.baselineState, r3.json?.counterfactualState);
log(`③ 屏蔽 ${EKEY}：HTTP=${r3.status} 全图不同格=${d3}  suppressedFired=${JSON.stringify(r3.json?.suppressedRulesFiredInBaseline)}`);
log(`   判定：${d3 === 0 ? "🔴 两态逐字节相同 —— 与「关掉这条边读数不变」无法区分（仪器缺陷：单条屏蔽未落地或它本来就没贡献）" : "✅ 有差异"}`);

// ④ 同一会话、同一 n、空屏蔽 vs 该条屏蔽：counterfactualState 是否相同（相同 ⇒ 屏蔽没落地）
const r4 = await post(`/sim/sessions/${s.id}/counterfactual`, { n: 5, disabledRuleKeys: [] });
const same = cellsDiff(r4.json?.counterfactualState, r3.json?.counterfactualState);
log(`④ 空屏蔽 vs 单屏蔽 的 counterfactualState 不同格数 = ${same}  ${same === 0 ? "🔴 屏蔽没落地（空屏蔽与单屏蔽同态）" : "✅ 屏蔽确实改了反事实态"}`);
