/**
 * P1 负边单向传导 · 第2阶段【配对 A/B 第二臂】—— 同一起点，边开 vs 边关，一次回包给两态。
 *
 * 为什么还要这一臂：k× 臂证明了「已触地板的单读数与 |c| 无关」，但没证明**它们处在饱和区**。
 * 另一种同样能造出「读数不动」的机制是**这一格根本没被写**（死格/冻结）——
 * 两者的修法完全不同，必须分开。边关掉（c=0）后：
 *  · 若读数**跳回基值** ⇒ 这一格一直被这条边写着，之前贴地是被地板吃掉的 ⇒ 支持根因。
 *  · 若读数**纹丝不动** ⇒ 这一格根本没被这条边碰过 ⇒ 根因链第 1 环就是假的。
 *
 * 附带的两道诚实位（本仓踩过的坑）：
 *  ① `suppressedRulesFiredInBaseline` —— 路由自带：屏蔽的边在基线臂里**真的动过吗**。
 *     为空 ⇒ 差值为空是「它本来就没在跑」，不是「关掉它没影响」。
 *  ② 零扰动对照只取**受测的那一格**（Order.demandPressure），不用全世界 6375 格当判据 ——
 *     世界别处还在动，拿它当「有漂移」会把受测格自身的不动读成假象。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const EKEY = "demo_forecast_bias_to_order_demand";
const g = async (p, o = {}) => {
  const r = await fetch(B + p, { headers: H, ...o });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null } catch { j = { _raw: t.slice(0, 200) } }
  return { status: r.status, ok: r.ok, json: j };
};
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);

const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 20 });
const w20 = (await g(`/sim/sessions/${s.id}/world`)).json;
await post(`/sim/sessions/${s.id}/tick`, { n: 10 });
const w30 = (await g(`/sim/sessions/${s.id}/world`)).json;
const vc = (await g("/sim/view-config")).json;
const typeOf = new Map();
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);
const oids = [...typeOf.entries()].filter(([, tk]) => tk === "Order").map(([i]) => i).sort();
log(`会话 ${s.id}  tick=${w30.tick}  Order 对象 ${oids.length}`);

// ── ① 零扰动对照：只取受测格 ────────────────────────────────────────────────
const dp = (w, id) => w.state?.[id]?.demandPressure;
let ctlDiff = 0, ctlCmp = 0;
for (const id of oids) { const a = dp(w20, id), b = dp(w30, id); if (typeof a !== "number" || typeof b !== "number") continue; ctlCmp++; if (a !== b) ctlDiff++; }
log(`① 零扰动对照【只取 Order.demandPressure】(20 拍 vs 30 拍)：比较 ${ctlCmp} 单，逐字节不同 ${ctlDiff} 单 ${ctlDiff === 0 ? "✅ 受测格不动点稳定" : "⚠ 受测格自身有漂移"}`);

const base = (id) => det.baseSnapshot?.[id]?.demandPressure;
const rows = oids.map((id) => ({ id, base: base(id), x: dp(w30, id) })).filter((r) => typeof r.base === "number" && typeof r.x === "number");
const lam = Math.round(Math.min(...rows.filter((r) => r.base > 1e-9).map((r) => r.x / r.base)) * 1e9) / 1e9;
const isC = (r) => Math.abs(r.x / r.base - lam) < 1e-9 && r.base > 1e-9;
const clamped = rows.filter(isC), free = rows.filter((r) => !isC(r));
log(`② λ=${lam}；触地板 ${clamped.length}/${rows.length}（phase-1 报 100/150，本轮 ${clamped.length}，差异属收敛拍数不同）`);

// ── ③ 配对 A/B：同一起点，边开 vs 边关 ──────────────────────────────────────
const cf = await post(`/sim/sessions/${s.id}/counterfactual`, { n: 10, disabledRuleKeys: [EKEY] });
log(`③ counterfactual HTTP=${cf.status}  ticks=${cf.json?.ticks}  disabledRuleKeys=${JSON.stringify(cf.json?.disabledRuleKeys)}`);
log(`   诚实位 suppressedRulesFiredInBaseline = ${JSON.stringify(cf.json?.suppressedRulesFiredInBaseline)}  ${(cf.json?.suppressedRulesFiredInBaseline ?? []).includes(EKEY) ? "✅ 基线臂里这条边真的动过" : "❌ 它本来就没在跑 ⇒ 差值不可归因于它"}`);
const bs = cf.json?.baselineState, cs = cf.json?.counterfactualState;
const bv = (st, id) => st?.[id]?.demandPressure;
// 自查：基线臂（persist:false 影子线）读数必须与本会话落盘读数一致，否则两条路不同源
let sameAsDisk = 0; for (const r of rows) if (bv(bs, r.id) === r.x) sameAsDisk++;
log(`   影子基线 vs 落盘世界一致的单 ${sameAsDisk}/${rows.length} ${sameAsDisk === rows.length ? "✅ 同源" : "（差异需解释）"}`);

const d = (r) => { const y = bv(cs, r.id); return typeof y === "number" ? y - r.x : NaN; };
const cMoved = clamped.filter((r) => Math.abs(d(r)) > 1e-9), fMoved = free.filter((r) => Math.abs(d(r)) > 1e-9);
log(`   已触地板档：关边后读数变化 ${cMoved.length}/${clamped.length}   未触地板档：变化 ${fMoved.length}/${free.length}`);
log(`   已触地板档 关边后读数 / 基值 的比值：${[...new Set(clamped.map((r) => (bv(cs, r.id) / r.base).toFixed(6)))].slice(0, 5).join(", ")}（趋近 1 = 跳回基值）`);
log(`\n=== 已触地板档 关边前后（按 |Δ| 升序前 10）===`);
log("单号                    基值     边开(基准)   边关        Δ");
for (const r of [...clamped].sort((a, b) => Math.abs(d(a)) - Math.abs(d(b))).slice(0, 10))
  log(`${r.id.padEnd(22)} ${r.base.toFixed(2).padStart(8)} ${r.x.toFixed(6).padStart(12)} ${(bv(cs, r.id) ?? NaN).toFixed(6).padStart(11)} ${d(r).toFixed(4)}`);
log(`\n=== 未触地板档 关边前后（按 |Δ| 降序前 5）===`);
log("单号                    基值     边开(基准)   边关        Δ");
for (const r of [...free].sort((a, b) => Math.abs(d(b)) - Math.abs(d(a))).slice(0, 5))
  log(`${r.id.padEnd(22)} ${r.base.toFixed(2).padStart(8)} ${r.x.toFixed(6).padStart(12)} ${(bv(cs, r.id) ?? NaN).toFixed(6).padStart(11)} ${d(r).toFixed(4)}`);
