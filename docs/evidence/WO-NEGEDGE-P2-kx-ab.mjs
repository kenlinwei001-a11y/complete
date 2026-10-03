/**
 * P1 负边单向传导 · 第2阶段【直接 A/B】—— 把 |c| 放大 3 倍，看饱和区读数动不动。
 *
 * 待验根因（候选）：`Order.demandPressure` 在饱和区读数 = λ·base，**与入流 c 的量级无关**
 *   （因 saturateToDomain 硬夹发生在核内 propagation.ts:1145，而 C2 基值合成在核后 app.ts:2642）。
 *
 * 本脚本必须证的三件事（缺一条结论就不成立）：
 *  ① 零扰动对照臂：不动任何东西、再推 10 拍，读数必须**逐字节不变**（否则「变了」不可归因于扰动）。
 *  ② 扰动**生效**的正对照：把 demo_forecast_bias_to_order_demand 的系数 −0.222 → −0.666（×3），
 *     未触地板的单（读数 ≠ λ·base）读数**必须**变 —— 不变就说明扰动没落地，一律判「工具/扰动坏了」，
 *     ⛔ 不许读成「读数与 c 无关」。
 *  ③ 主判据：**基准臂已触地板**（读数 ≈ λ·base）的单，在 ×3 臂读数是否逐字节不变。
 *     不变 ⇒ 支持根因；只要有一张变 ⇒ 根因被推翻（报 supports=false）。
 *  ④ 回退臂：把系数改回 −0.222 后再推 10 拍，必须逐字节回到基准读数（证明差异确由系数引起、且可逆）。
 *
 * ⛔ 规则改动用官方 PATCH 路由（数据面，非产品代码），跑完当场改回并回读校验。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const RID = "simpr_demo_forecast_bias_to_order_demand";
const COEF0 = -0.222, REF0 = { ruleKey: "C36", paramKey: "demo_forecast_bias_to_order_demand" };

const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null } catch { j = { _raw: t.slice(0, 200) } }
  return { status: r.status, ok: r.ok, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const patch = (p, b) => g(p, { method: "PATCH", body: JSON.stringify(b) });
const log = (...a) => console.log(...a);

// ── 0) 前置金丝雀：这条边必须真实存在且是 PUBLISHED ───────────────────────────
const r0 = await g(`/sim/propagation-rules`);
if (!r0.ok) { log(`❌ 金丝雀坏：GET propagation-rules HTTP ${r0.status}`); process.exit(2); }
const rules = r0.json.items ?? r0.json;
const rule0 = rules.find((r) => r.id === RID);
log(`金丝雀⓪：规则 ${RID} 存在=${!!rule0} status=${rule0?.status} coefficient=${rule0?.coefficient} ref=${JSON.stringify(rule0?.coefficientRef)}`);
if (!rule0) { log("❌ 工具坏了：目标边查不到"); process.exit(2); }
const RULE0_SNAPSHOT = JSON.stringify(rule0);

// ── 1) 建会话，推到不动点 ────────────────────────────────────────────────────
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const t20 = await post(`/sim/sessions/${s.id}/tick`, { n: 20 });
const w20 = (await g(`/sim/sessions/${s.id}/world`)).json;
log(`会话 ${s.id} tick=${w20.tick}（tick rsp HTTP=${t20.status}）`);
const vc = (await g(`/sim/view-config`)).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);

const rad = (st, ids, v) => ids.map((i) => st?.[i]?.[v]).filter((x) => typeof x === "number");
const orderIds = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
const baseOf = (ids, v) => ids.map((i) => det.baseSnapshot?.[i]?.[v]);
log(`对象：Order ${orderIds.length} 个（view-config 覆盖 ${new Set(typeOf.keys()).size} / baseSnapshot ${Object.keys(det.baseSnapshot).length}，映射须≈全）`);

// ── 2) 零扰动对照臂：再推 10 拍，必须逐字节不变 ────────────────────────────────
await post(`/sim/sessions/${s.id}/tick`, { n: 10 });
const w30 = (await g(`/sim/sessions/${s.id}/world`)).json;
const frozen = (a, b) => {
  const ids = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  let diff = 0, cmp = 0;
  for (const id of ids) for (const v of new Set([...Object.keys(a?.[id] ?? {}), ...Object.keys(b?.[id] ?? {})])) {
    const x = a?.[id]?.[v], y = b?.[id]?.[v]; if (typeof x !== "number" || typeof y !== "number") continue;
    cmp++; if (x !== y) diff++;
  }
  return { diff, cmp };
};
const ctl = frozen(w20.state, w30.state);
log(`\n① 零扰动对照（20 拍 vs 30 拍）：比较 ${ctl.cmp} 格，逐字节不同 ${ctl.diff} 格  ${ctl.diff === 0 ? "✅ 不动点稳定" : "⚠ 有漂移"}`);

// ── 3) 基准读数 & 触地板分类 ─────────────────────────────────────────────────
const xA = orderIds.map((id) => ({ id, base: baseOf([id], "demandPressure")[0], x: w30.state?.[id]?.demandPressure }));
const good = xA.filter((r) => typeof r.base === "number" && typeof r.x === "number");
const ratios = good.filter((r) => r.base > 1e-9).map((r) => r.x / r.base);
const lam = Math.round(Math.min(...ratios) * 1e9) / 1e9;
const isClamped = (r) => Math.abs(r.x / r.base - lam) < 1e-9 && r.base > 1e-9;
const clampedA = good.filter(isClamped), freeA = good.filter((r) => !isClamped(r));
const over = good.filter((r) => r.x > r.base + 0.01);
log(`② 基准臂：n=${good.length}  λ=min(x/base)=${lam}`);
log(`   触地板（x==λ·base）: ${clampedA.length}/${good.length}   未触地板: ${freeA.length}`);
log(`   上穿基值(+0.01)的单: ${over.length}  ${over.length === 0 ? "✅ 上界=基值成立" : "❌ 上界被击穿"}`);
log(`   基值域 [${Math.min(...good.map(r=>r.base)).toFixed(4)}, ${Math.max(...good.map(r=>r.base)).toFixed(4)}]  终态域 [${Math.min(...good.map(r=>r.x)).toFixed(6)}, ${Math.max(...good.map(r=>r.x)).toFixed(6)}]`);

// ── 4) 扰动臂：系数 ×3（同时置空 coefficientRef，否则 ref 优先，inline 改了也不生效）──
const pr = await patch(`/sim/propagation-rules/${RID}`, { coefficient: COEF0 * 3, coefficientRef: null });
const rb = await g(`/sim/propagation-rules`);
const rule1 = (rb.json.items ?? rb.json).find((r) => r.id === RID);
log(`\n③ 扰动 PATCH HTTP=${pr.status}；回读 coefficient=${rule1?.coefficient} ref=${JSON.stringify(rule1?.coefficientRef)}（须 =${COEF0 * 3} / null 才算落地）`);
if (pr.status !== 200 || rule1?.coefficient !== COEF0 * 3 || rule1?.coefficientRef !== null) {
  log("❌ 扰动未落地 ⇒ 后面的读数一个都不许用"); process.exit(3);
}

await post(`/sim/sessions/${s.id}/tick`, { n: 10 });
const w40 = (await g(`/sim/sessions/${s.id}/world`)).json;
const xB = new Map(orderIds.map((id) => [id, w40.state?.[id]?.demandPressure]));
const d = (r) => { const y = xB.get(r.id); return typeof y === "number" ? y - r.x : NaN };
const moved = (r) => Math.abs(d(r)) > 1e-12;
const fMoved = freeA.filter(moved), cMoved = clampedA.filter(moved);
log(`   ×3 臂：未触地板单读数变化 ${fMoved.length}/${freeA.length}（正对照：须 >0）`);
log(`          已触地板单读数变化 ${cMoved.length}/${clampedA.length}  ← 主判据（支持根因须 =0）`);
if (fMoved.length === 0) { log("❌ 扰动没生效（没有任何未触地板的单动过）⇒ 本次实验对 c 无鉴别力，全部作废"); }

// ── 5) 回退臂 ────────────────────────────────────────────────────────────────
const pr2 = await patch(`/sim/propagation-rules/${RID}`, { coefficient: COEF0, coefficientRef: REF0 });
const rb2 = await g(`/sim/propagation-rules`);
const rule2 = (rb2.json.items ?? rb2.json).find((r) => r.id === RID);
// ⚠ version 每次 PATCH 自增，不参与「是否复原」判定（那是路由的设计，不是差异）
const strip = (r) => { const c = { ...r }; delete c.version; return JSON.stringify(c); };
const restored = strip(rule2) === strip(JSON.parse(RULE0_SNAPSHOT));
log(`\n④ 回退 PATCH HTTP=${pr2.status}；回读与原始逐字节相同=${restored}`);
await post(`/sim/sessions/${s.id}/tick`, { n: 10 });
const w50 = (await g(`/sim/sessions/${s.id}/world`)).json;
const back = frozen(w50.state, w30.state);
log(`   回退臂（40 拍 vs 30 拍基准）：比较 ${back.cmp} 格，不同 ${back.diff} 格  ${back.diff === 0 ? "✅ 可逆" : "⚠ 不可逆/漂移"}`);

// ── 6) 逐单明细（只打有代表性的行，防上下文爆）────────────────────────────────
log(`\n=== 逐单明细（已触地板档按 |Δ| 降序前 12）===`);
log("单号                    基值        基准读数      ×3臂读数      Δ          ");
for (const r of [...clampedA].sort((a, b) => Math.abs(d(b)) - Math.abs(d(a))).slice(0, 12))
  log(`${r.id.padEnd(22)} ${r.base.toFixed(4).padStart(10)} ${r.x.toFixed(6).padStart(12)} ${(xB.get(r.id) ?? NaN).toFixed(6).padStart(12)} ${d(r).toExponential(2)}`);
log(`\n=== 未触地板档（正对照）按 |Δ| 降序前 8 ===`);
log("单号                    基值        基准读数      ×3臂读数      Δ");
for (const r of [...freeA].sort((a, b) => Math.abs(d(b)) - Math.abs(d(a))).slice(0, 8))
  log(`${r.id.padEnd(22)} ${r.base.toFixed(4).padStart(10)} ${r.x.toFixed(6).padStart(12)} ${(xB.get(r.id) ?? NaN).toFixed(6).padStart(12)} ${d(r).toExponential(2)}`);

fs.writeFileSync("/tmp/wo-3root/p1p2-kx-ab.json", JSON.stringify({
  sid: s.id, lam, rule0, rule1, rule2, restored, ctl, back,
  clamped: clampedA.map((r) => ({ ...r, x3: xB.get(r.id), delta: d(r) })),
  free: freeA.map((r) => ({ ...r, x3: xB.get(r.id), delta: d(r) })),
}, null, 1));
log(`\n落盘 /tmp/wo-3root/p1p2-kx-ab.json`);
