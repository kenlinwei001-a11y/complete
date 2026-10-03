/**
 * P1 负边 · 铸造层证据核（PRD W1 判据的取数脚本）
 * 目的：① 6 型号 forecastBias tick0 读值 + 负数个数（该格是哈希铸造、不在 props 里，只能读世界态）
 *      ② 每型号带单数（由 c 反解分组，不依赖链路 API）
 *      ③ 反解 c = x₁ − base（C2 下 x₁ = (1−λ)base + λ·base + c = base + c）⇒ fb = c / k
 *      ④ 零扰动对照：不 PATCH、不推扰动
 * ⛔ 只读；不 PATCH 规则、不改服务。
 */
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
// BASE 可覆盖（默认 4019 = 既有 dev 实例）；证据里回显实际打的是哪个实例。
const B = `${process.env.BASE ?? "http://127.0.0.1:4019"}/a/v1`;
console.log(`BASE=${B}`);
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { _raw: t.slice(0, 120) }; } return { status: r.status, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });

// 金丝雀⓪：必然命中的边 + 必然不存在的边名（防 0 命中被读成不存在）
const rr = (await g("/sim/propagation-rules")).json;
const rules = rr.items ?? rr;
const hit = rules.filter((r) => r.targetTypeKey === "Order" && r.targetStateVar === "demandPressure");
const miss = rules.filter((r) => r.targetStateVar === "___nope___");
console.log(`金丝雀⓪ 必然命中: Order.demandPressure 入边 ${hit.length} 条 ${hit.length ? "✅" : "❌工具坏了"}`);
console.log(`金丝雀⓪ 必然不命中: ${miss.length} 条 ${miss.length === 0 ? "✅" : "❌取法有问题"}`);
if (!hit.length || miss.length) process.exit(2);
for (const r of hit) console.log(`   入边 ${r.key} src=${r.sourceTypeKey}.${r.sourceStateVar} k=${r.coefficient} delay=${r.delayTicks} status=${r.status}`);

// 金丝雀①：UI 落点下拉里有没有 forecastBias（可达性不是结构性的，见评审①）
const vc = (await g("/sim/view-config")).json;
console.log(`金丝雀① cfg.stateVars n=${(vc.stateVars ?? []).length} 含forecastBias=${(vc.stateVars ?? []).includes("forecastBias")}`);

// 建会话 → tick0 基值
const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const bs = det.baseSnapshot ?? {};
const modelIds = Object.keys(bs).filter((i) => i.startsWith("obj_model_")).sort();
const orderIds = Object.keys(bs).filter((i) => i.startsWith("obj_order_SO-")).sort();
console.log(`\n会话 ${s.id} · Model ${modelIds.length} 个 · Order ${orderIds.length} 个`);
console.log("── ① Model.forecastBias @tick0（哈希铸造格，只存在于世界态）──");
let neg = 0, min = Infinity, max = -Infinity;
for (const m of modelIds) { const v = bs[m]?.forecastBias; if (typeof v !== "number") { console.log(`   ${m} forecastBias=undefined`); continue; }
  if (v < 0) neg++; if (v < min) min = v; if (v > max) max = v; console.log(`   ${m} forecastBias=${v}`); }
console.log(`   n=${modelIds.length} min=${min} max=${max} 负数=${neg}`);

// tick 1 → 反解 c
const tk = await post(`/sim/sessions/${s.id}/tick`, { n: 1, disclose: true });
const w = (await g(`/sim/sessions/${s.id}/world`)).json;
const st = w.state ?? {};
const lam = tk.json?.disclosure?.stateVarReport?.decayApplied?.demandPressure ?? null;
console.log(`\n引擎自报 λ(Order.demandPressure) = ${lam}`);
const k = -0.222;
const groups = new Map();
for (const o of orderIds) {
  const base = bs[o]?.demandPressure; const x1 = st[o]?.demandPressure;
  if (typeof base !== "number" || typeof x1 !== "number") continue;
  const c = +(x1 - base).toFixed(6);
  const key = c.toFixed(4);
  if (!groups.has(key)) groups.set(key, { c, n: 0, sampleBase: base });
  groups.get(key).n++;
}
console.log("── ② 由 c 反解的型号分组（每型号一个 c = k×fb）──");
let up = 0, total = 0;
for (const [key, gv] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const fb = +(gv.c / k).toFixed(4);
  const xstar = lam ? +(gv.sampleBase + gv.c / lam).toFixed(4) : null;
  console.log(`   c=${gv.c}  fb=${fb}  单数=${gv.n}  样例base=${gv.sampleBase}  预言x*=${xstar}`);
  total += gv.n; if (gv.c > 0) up += gv.n;
}
console.log(`   合计 ${total} 单；c>0（fb<0，上穿基值）的 ${up} 单`);

// ④ 对照：20 拍 vs 30 拍，只在零扰动下复读受测格
await post(`/sim/sessions/${s.id}/tick`, { n: 19, disclose: false });
const w20 = (await g(`/sim/sessions/${s.id}/world`)).json;
let over20 = 0;
for (const o of orderIds) { const base = bs[o]?.demandPressure; const x = w20.state?.[o]?.demandPressure;
  if (typeof base === "number" && typeof x === "number" && x > base + 0.01) over20++; }
console.log(`\n── ④ 零扰动 20 拍：上穿基值(+0.01) 单数 = ${over20}/${orderIds.length}（预期 0）`);
