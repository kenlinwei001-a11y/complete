/**
 * 评审员#2 · 追问：那 1214 个越域格是**种子本来就越域**，还是 **C2 合成把它推出域**？
 *   （若是种子本来就越域 ⇒ 是播种账；若是 C2 ⇒ 是同一条「合成在夹值之后」的顺序事实。）
 *
 * 判据三步（外生 ∧ 出边 ∧ 可达结论，本仓落点判据惯例）：
 *  ① tick0（播种态、未跑任何拍）就有多少格越域？—— 基线越域数
 *  ② 逐拍轨迹：同一格在 tick0 与 tickN 各是多少？越域是**从哪一拍开始**的？
 *  ③ 反事实：把 C2 效果从轨迹里扣掉（x − λ·base），看还原值是否回到域内。
 *     ⇒ 若还原值在域内而实测值在域外，则越域**由 C2 造成**。
 * ⛔ 只读，不改规则、不推扰动。
 */
import fs from "node:fs";
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4019/a/v1";
const g = async (p, o = {}) => { const r = await fetch(B + p, { headers: H, ...o }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { } return { status: r.status, ok: r.ok, json: j }; };
const post = (p, b) => g(p, { method: "POST", body: JSON.stringify(b ?? {}) });
const log = (...a) => console.log(...a);
const dom = (await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js")).STATE_VAR_DOMAINS;
const bat = await import("/Users/apple/deploy/wo-edge-wire/apps/datacore/dist/synthetic/battery.js");
const typeOf = new Map();
const vc = (await g("/sim/view-config")).json;
for (const [tk, ids] of Object.entries(vc.nodeObjectIds ?? {})) for (const id of ids) typeOf.set(id, tk);

const breach = (st) => {
  const out = [];
  for (const [id, bucket] of Object.entries(st ?? {})) for (const [sv, v] of Object.entries(bucket)) {
    if (typeof v !== "number") continue; const d = dom[sv]; if (!d) continue;
    if (v < d.min - 1e-9 || (d.max !== null && v > d.max + 1e-9)) out.push({ id, sv, v, min: d.min, max: d.max });
  }
  return out;
};

const s = (await post("/sim/sessions", {})).json;
const det = (await g(`/sim/sessions/${s.id}`)).json;
const w0 = (await g(`/sim/sessions/${s.id}/world`)).json;
const b0 = breach(w0.state);
log(`会话 ${s.id} · tick0 越域格 = ${b0.length}`);
const byv0 = b0.reduce((a, x) => { a[x.sv] = (a[x.sv] || 0) + 1; return a; }, {});
log(`  tick0 越域按量纲: ${JSON.stringify(byv0)}`);
log(`  tick0 越域格全是"归规格所有"? ${b0.filter((x) => bat.stateVarValueRef(typeOf.get(x.id) ?? "", x.sv) !== undefined).length}/${b0.length}`);

const snaps = [];
let prev = 0;
for (const n of [1, 5, 10, 20, 30]) {
  await post(`/sim/sessions/${s.id}/tick`, { n: n - prev }); prev = n;
  const w = (await g(`/sim/sessions/${s.id}/world`)).json;
  const b = breach(w.state);
  snaps.push({ n, w, b });
  log(`tick${n}: 越域格 = ${b.length}   按量纲 ${JSON.stringify(b.reduce((a, x) => { a[x.sv] = (a[x.sv] || 0) + 1; return a; }, {}))}`);
}

// ③ 反事实：拿 30 拍那一格，扣掉 C2 累积补的 λ·base 份额
const w30 = snaps[snaps.length - 1].w;
const bad30 = snaps[snaps.length - 1].b;
log(`\n③ 反事实逐格（取 tick30 越域且基值也越域的格，各量纲前 3）：`);
const seen = new Set();
for (const b of bad30) {
  if (seen.has(b.sv)) continue;
  seen.add(b.sv);
  const base = det.baseSnapshot?.[b.id]?.[b.sv];
  const x0 = w0.state?.[b.id]?.[b.sv];
  const d = dom[b.sv];
  log(`  ${typeOf.get(b.id)}.${b.sv} (${b.id})`);
  log(`     tick0=${x0}  基值=${base}  tick30=${b.v}  域[${d.min},${d.max}]  restPoint=${d.restPoint}`);
  log(`     基值本身越域? ${typeof base === "number" && (base > d.max + 1e-9 || base < d.min - 1e-9) ? "是 ⇒ 越域来自播种" : "否 ⇒ 越域不是基值带来的"}`);
  if (seen.size >= 5) break;
}
log(`\n[eof]`);
