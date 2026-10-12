/**
 * C2 × WO-HOLD-PERTURBATION 合并对照实验（收编门 · 铁律 1.5 判据一）。
 *
 * ── 预言（写于取数之前，⛔ 不许事后改）────────────────────────────────────────────
 * 被合并进来的 canonical 提交 `b1c8e1297` 让「生效期内的扰动每拍按声明重施」：
 * 衰减前把变换从累加器撤掉、跑完衰减与入流后再按声明加回。
 * C2（`makeRestoreSpecBase`）在核之外合成 `state = 派生基值 + 传导量`，加的是一项
 * **常量** λ·(base − rest)。
 *
 * 对 `SO-3391.demandPressure`：base = 60、唯一入边 −0.222×forecastBias(50) ⇒ c = −11.1、λ = 0.37
 * ⇒ 递推 x' = (1−λ)x + λ·base + c + A（A = 当拍扰动幅度）
 * ⇒ 不动点 x* = base + c/λ + A = **30.00291 + A**
 *
 *   臂 0（零扰动，A=0）：应收敛到 **30.00291**（C2 单跑已实测，本条是对照臂）
 *   臂 A（永久 delta +30，A=30）：应收敛到 **60.00291**
 *
 * 判据：`臂A − 臂0` 必须**恰好等于声明的幅度 30**。
 *   · 读回 ≈30（差值 0） ⇒ 扰动被 C2 吃掉了（两者互相抵消）—— 合并不可收
 *   · 读回 ≈90（差值 60）⇒ hold 与 C2 双重计数 —— 合并不可收
 *   · 读回 ≈60（差值 30）⇒ 相容，可收
 * ⛔ 零扰动对照臂是必须的：「数变了」不度量「扰动生效」——那个数可能只是天然衰减。
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:4029";
const H = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };
const r6 = (x) => (typeof x === "number" ? Math.round(x * 1e6) / 1e6 : x);

// ⛔ 状态码必须查：400 的错误信封也是合法 JSON，不查就会被静默当成成功（本仓踩过）
const J = async (r) => {
  const t = await r.text();
  let body;
  try { body = JSON.parse(t); } catch { throw new Error(`HTTP ${r.status} 非 JSON: ${t.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};
const post = (p, b) => fetch(`${BASE}${p}`, { method: "POST", headers: H, body: JSON.stringify(b ?? {}) }).then(J);
const get = (p) => fetch(`${BASE}${p}`, { headers: H }).then(J);

const OID = "obj_order_SO-3391";
const SV = "demandPressure";
const N = 20;

async function arm(label, withPerturbation) {
  const s = await post("/a/v1/sim/sessions", {});
  const base = s.baseSnapshot?.[OID]?.[SV];
  // 金丝雀：拿不到基值 ⇒ 读数无从解释，直接作废（不许把 undefined 当 0 用）
  if (typeof base !== "number") throw new Error(`金丝雀失败：baseSnapshot[${OID}].${SV} = ${base}`);

  let pertId = null;
  if (withPerturbation) {
    const created = await post(`/a/v1/sim/sessions/${s.id}/perturbations`, {
      kind: "demand_shift",
      label: "对照实验：永久 +30（合并判据）",
      targetObjectId: OID,
      targetStateVar: SV,
      startTick: 0,
      durationTicks: null, // 契约：null = 永久
      magnitude: 30,
      mode: "delta",
    });
    pertId = created?.id ?? created?.perturbation?.id ?? null;
    // 回读校验：⛔ 「调用没抛异常」不度量「资源建上了」
    const list = await get(`/a/v1/sim/sessions/${s.id}/perturbations`);
    const items = list?.items ?? [];
    if (items.length !== 1) throw new Error(`扰动没建上：GET 回 ${items.length} 条`);
  }

  const series = [];
  for (let i = 0; i < N; i++) {
    const t = await post(`/a/v1/sim/sessions/${s.id}/tick`, { n: 1 });
    series.push(t.state?.[OID]?.[SV]);
  }
  return { label, sessionId: s.id, pertId, base, series, final: series[series.length - 1] };
}

console.log(`目标 ${OID}.${SV}   BASE=${BASE}   推 ${N} 拍\n`);
const arm0 = await arm("臂0·零扰动", false);
const armA = await arm("臂A·永久 +30", true);

const show = (a) => {
  console.log(`【${a.label}】会话 ${a.sessionId}`);
  console.log(`  基值=${r6(a.base)}  扰动=${a.pertId ?? "无"}`);
  console.log(`  逐拍：${a.series.map(r6).join(" → ")}`);
  console.log(`  末拍 = ${r6(a.final)}\n`);
};
show(arm0);
show(armA);

const diff = armA.final - arm0.final;
const PRED0 = 30.00291, PREDA = 60.00291;
console.log("── 判定 ──────────────────────────────────────────");
console.log(`  臂0 实测 ${r6(arm0.final)} · 预言 ${PRED0} · 差 ${r6(arm0.final - PRED0)}`);
console.log(`  臂A 实测 ${r6(armA.final)} · 预言 ${PREDA} · 差 ${r6(armA.final - PREDA)}`);
console.log(`  ★ 幅度保真：臂A − 臂0 = ${r6(diff)} · 声明幅度 = 30 · 误差 ${r6(diff - 30)}`);

const ok0 = Math.abs(arm0.final - PRED0) < 0.5;
const okA = Math.abs(armA.final - PREDA) < 0.5;
const okDiff = Math.abs(diff - 30) < 0.5;
console.log("");
if (ok0 && okA && okDiff) {
  console.log("✅ 相容：C2 锚基值与 HOLD 每拍重施互不吃，扰动幅度**恰好**按声明保留 30。");
} else if (Math.abs(diff) < 0.5) {
  console.log("❌ 扰动被 C2 吃掉（差值 ≈0）⇒ 合并不可收，须先解决语义冲突。");
} else if (Math.abs(diff - 60) < 0.5) {
  console.log("❌ 双重计数（差值 ≈60）⇒ 合并不可收。");
} else {
  console.log(`❌ 未达判据：臂0 ${ok0 ? "✓" : "✗"} · 臂A ${okA ? "✓" : "✗"} · 幅度 ${okDiff ? "✓" : "✗"}`);
}
process.exit(ok0 && okA && okDiff ? 0 : 1);
