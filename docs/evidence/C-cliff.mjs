#!/usr/bin/env node
/**
 * C 自写普查（只读 / 只碰自己的 session）：
 * 同一拍、同一条上游扰动下，对**每一个 Order 的 costPressure** 测 Δ，
 * 与「C2 基值恢复 × 出口投影」联合不动点的预测对照：
 *     x*(base) = f(0.63·x* + 0.37·base)   （c=0 近似；有入流的格按 +0.73c 微调）
 *     f(raw)   = raw≤75 ? raw : 100 − 25/(1+(raw−75)/25)
 * 判据：Δ 由 base 相对膝点 75 的位置决定，与入流大小无关 ⇒ 膝下（base≤75）Δ≈0/微正，
 *       膝上（base>75）Δ 为大负值且随 base 增大而增大 ⇒ 与物理传导（Δ ∝ 入流）互斥。
 */
const BASEURL = process.env.BASE || "http://127.0.0.1:4051";
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m, p, b) => {
  const r = await fetch(`${BASEURL}${p}`, { method: m, headers: { "content-type": "application/json", "x-debug-user": DU }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
};
const must = (r, w) => { if (r.s >= 400) throw new Error(`${w}: ${r.s} ${(r.t || "").slice(0, 300)}`); return r.j; };
const round12 = (n) => { const r = Math.round(n * 1e12) / 1e12; return Object.is(r, -0) ? 0 : r; };
const sat = (raw, min, max, rest) => {
  const bandHi = (max - rest) * 0.25;
  if (bandHi > 0) { const knee = max - bandHi; if (raw > knee) return max - bandHi / (1 + (raw - knee) / bandHi); }
  else if (raw > max) return max;
  const bandLo = (rest - min) * 0.25;
  if (bandLo > 0) { const knee = min + bandLo; if (raw < knee) return min + bandLo / (1 + (knee - raw) / bandLo); }
  else if (raw < min) return min;
  return raw;
};
const fixedPoint = (base) => { let x = base; for (let i = 0; i < 20000; i++) { const raw = round12(0.63 * x + 0.37 * base); x = round12(sat(raw, 0, 100, 0)); } return x; };

const mk = async (pert) => {
  const s = must(await api("POST", "/a/v1/sim/sessions", {}), "session");
  const id = s?.session?.id ?? s?.id;
  if (pert) must(await api("POST", `/a/v1/sim/sessions/${id}/perturbations`, pert), "perturb");
  return id;
};
const world = async (id) => (must(await api("GET", `/a/v1/sim/sessions/${id}/world`), "world"))?.state ?? {};

const idZ = await mk(null);
const zeros = await world(idZ);       // 零扰动会话的 tick0 世界 = 各格基值
const idM = await mk({ kind: "supply_disruption", targetObjectId: "obj_order_SO-3391", targetStateVar: "leadDays", mode: "delta", magnitude: -3, startTick: 0, durationTicks: null, label: "C-cliff" });
const TICKS = Number(process.env.TICKS || 12);
for (let i = 0; i < TICKS; i++) must(await api("POST", `/a/v1/sim/sessions/${idM}/tick`, { n: 1, disclose: i === TICKS - 1 }), "tick");
const fin = await world(idM);
console.log(`零臂 session=${idZ} 扰动臂 session=${idM} ticks=${TICKS}`);
console.log(["订单", "base(零臂t0)", "末拍读数", "Δ", "f(base)−base(纯投影差)", "不动点预测Δ", "膝下?"].join(" | "));
const rows = [];
for (const id of Object.keys(fin).filter((k) => k.startsWith("obj_order_"))) {
  const b = zeros[id]?.costPressure, v = fin[id]?.costPressure;
  if (typeof b !== "number" || typeof v !== "number") continue;
  const fx = fixedPoint(b);
  rows.push({ id, b, v, d: round12(v - b), fx: round12(fx - b), knee: b <= 75 });
}
rows.sort((a, b) => a.b - b.b);
for (const r of rows) {
  console.log([r.id, r.b.toFixed(6), r.v.toFixed(9), r.d.toFixed(9), round12(sat(r.b, 0, 100, 0) - r.b).toFixed(9), r.fx.toFixed(9), r.knee ? "YES" : "no"].join(" | "));
}
const knee2 = rows.filter((r) => r.b > 75), under = rows.filter((r) => r.b <= 75);
console.log(`\n膝上(base>75) ${knee2.length} 格：Δ ∈ [${Math.min(...knee2.map((r) => r.d)).toFixed(6)}, ${Math.max(...knee2.map((r) => r.d)).toFixed(6)}]`);
console.log(`膝下(base≤75) ${under.length} 格：Δ ∈ [${Math.min(...under.map((r) => r.d)).toFixed(6)}, ${Math.max(...under.map((r) => r.d)).toFixed(6)}]`);
const errs = rows.map((r) => Math.abs(r.d - r.fx));
console.log(`|实测Δ − 不动点预测Δ| 最大 = ${Math.max(...errs).toExponential(3)}（c=0 近似，未扣各格自身入流）`);
console.log("DONE");
