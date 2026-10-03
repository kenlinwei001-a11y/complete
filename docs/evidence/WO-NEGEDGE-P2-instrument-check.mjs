/**
 * P1 负边单向传导 · 第2阶段【仪器校验 + 反向 k 臂】
 *
 * 上一支探针出了矛盾：边关掉（counterfactual disabledRuleKeys）后 150 单读数**一个都没动**，
 * 而同一批单在 k× 臂里动过 −9.51。两者不可能同时为真 ⇒ 先判**是仪器坏了还是结论错了**。
 *
 * A) 仪器校验：把**全部 55 条边**都屏蔽，看 counterfactual 的两态是否仍然逐字节相同。
 *    相同 ⇒ 这条路由的「屏蔽」根本没作用（两臂同一对象/同一规则集）⇒ 该仪器作废，
 *    ⛔ 不许拿它当「关掉这条边没影响」的证据。
 *    不同 ⇒ 仪器是好的 ⇒ 上一支的 0 差异是真的，矛盾要另找解释。
 *    （金丝雀：被屏蔽的边必须出现在 suppressedRulesFiredInBaseline 里，否则「没动过」三种可能分不开）
 *
 * B) 反向 k 臂：把同一条边系数 ×0.1（|c| 缩小到 1/10）。
 *    若那 98 张「读数 = λ·base」的单真是被**硬地板**吃掉的 ⇒ |c| 变小后它们必然**离开饱和区**、
 *    读数上行（判定边界 c ≤ −(1−λ)λ·base 随 |c| 变小而不再满足）。
 *    若它们**纹丝不动** ⇒ 「贴地板」这个机制对它们不成立，根因链第 1 环存疑。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const EKEY = "demo_forecast_bias_to_order_demand";
const COEF0 = -0.222, REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null } catch { j = { _raw: t.slice(0, 200) } }
  return { status: r.status, ok: r.ok, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });
const log = (...a) => console.log(...a);

const all = (await g("/sim/propagation-rules")).json;
const keys = (all.items ?? all).map((r) => r.key);
log(`规则总数 ${keys.length}`);

// ── A) 仪器校验 ──────────────────────────────────────────────────────────────
const s = (await post("/sim/sessions", {})).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 20 });
const cfAll = await post(`/sim/sessions/${s.id}/counterfactual`, { n: 5, disabledRuleKeys: keys });
const diffs = cfAll.json?.diffs ?? {};
const diffCells = Object.values(diffs).reduce((a, o) => a + Object.keys(o ?? {}).length, 0);
const bSel = cfAll.json?.suppressedRulesFiredInBaseline ?? [];
log(`A) 全屏蔽 counterfactual HTTP=${cfAll.status}  屏蔽 ${keys.length} 条  两态不同格数=${diffCells}`);
log(`   诚实位：基线臂里真的动过的被屏蔽边 = ${bSel.length} 条  ${bSel.length === 0 ? "❌ 一条都没动 ⇒ 两态相同毫无信息" : "✅ 至少一条在跑"}`);
log(`   ${diffCells === 0 ? "❌ 仪器作废：屏蔽 55 条边读数仍逐字节相同（两臂同源）" : "✅ 仪器是好的：屏蔽确实改变读数"}`);

// ── B) 反向 k 臂 ────────────────────────────────────────────────────────────
const s2 = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s2.id}`)).json;
await post(`/sim/sessions/${s2.id}/tick`, { n: 20 });
const vc = (await g("/sim/view-config")).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const oids = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
const dp = async () => (await g(`/sim/sessions/${s2.id}/world`)).json.state;
const wA = await dp();
const rows = oids.map((id) => ({ id, base: det.baseSnapshot?.[id]?.demandPressure, x: wA?.[id]?.demandPressure }))
  .filter((r) => typeof r.base === "number" && typeof r.x === "number");
const lam = Math.round(Math.min(...rows.filter((r) => r.base > 1e-9).map((r) => r.x / r.base)) * 1e9) / 1e9;
const isC = (r) => Math.abs(r.x / r.base - lam) < 1e-9 && r.base > 1e-9;
const clamped = rows.filter(isC);
log(`\nB) 会话 ${s2.id} λ=${lam} 触地板 ${clamped.length}/${rows.length}`);

const p1 = await patch(`/sim/propagation-rules/${RID}`, { coefficient: COEF0 * 0.1, coefficientRef: null });
const rb = (await g("/sim/propagation-rules")).json;
const r1 = (rb.items ?? rb).find((r) => r.id === RID);
log(`   ×0.1 PATCH HTTP=${p1.status} 回读 coefficient=${r1?.coefficient} ref=${JSON.stringify(r1?.coefficientRef)}`);
if (r1?.coefficient !== COEF0 * 0.1 || r1?.coefficientRef !== null) { log("❌ 扰动未落地"); process.exit(3); }
await post(`/sim/sessions/${s2.id}/tick`, { n: 10 });
const wB = await dp();
const dB = (r) => (wB?.[r.id]?.demandPressure ?? NaN) - r.x;
const cMoved = clamped.filter((r) => Math.abs(dB(r)) > 1e-9);
log(`   ×0.1 臂：已触地板单读数变化 ${cMoved.length}/${clamped.length}  ← 若这批真是被地板吃掉的，须 >0`);
const ratB = [...new Set(clamped.map((r) => (wB?.[r.id]?.demandPressure / r.base).toFixed(6)))];
log(`   已触地板档 读数/基值 在 ×0.1 臂的取值集合（前 6）：${ratB.slice(0, 6).join(", ")}`);
log(`\n=== 已触地板档 ×0.1 前后（按 |Δ| 降序前 10）===`);
log("单号                    基值     基准(λ·base)  ×0.1臂       Δ");
for (const r of [...clamped].sort((a, b) => Math.abs(dB(b)) - Math.abs(dB(a))).slice(0, 10))
  log(`${r.id.padEnd(22)} ${r.base.toFixed(2).padStart(8)} ${r.x.toFixed(6).padStart(12)} ${(wB?.[r.id]?.demandPressure ?? NaN).toFixed(6).padStart(11)} ${dB(r).toFixed(5)}`);

// 回退
const p2 = await patch(`/sim/propagation-rules/${RID}`, { coefficient: COEF0, coefficientRef: REF0 });
const r2 = (rb2 => (rb2.items ?? rb2).find((x) => x.id === RID))((await g("/sim/propagation-rules")).json);
log(`\n回退 HTTP=${p2.status} coefficient=${r2?.coefficient} ref=${JSON.stringify(r2?.coefficientRef)}`);
await post(`/sim/sessions/${s2.id}/tick`, { n: 10 });
const wC = await dp();
let same = 0; for (const r of rows) if (wC?.[r.id]?.demandPressure === wB?.[r.id]?.demandPressure) same++;
log(`回退臂 vs ×0.1 臂：读数相同的单 ${same}/${rows.length}`);
