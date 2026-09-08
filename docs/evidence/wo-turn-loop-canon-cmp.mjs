/* eslint-disable */
/**
 * WO-TURN-LOOP · 格2 反向对照的**真正判据**：与今天 canonical 逐字节比。
 *
 * 上游脚本 `docs/evidence/wo-turn-loop-exp.mjs` 的格2 只证明了「本分支上 tick×0 时
 * turnDynamics 是诚实缺席态」。那**不度量**「既有行为没被我改坏」——
 * 要证后者，必须真起 canonical 的 datacore 跑同一组请求再比。
 *   4001 = 本分支(28707e53)   4003 = canonical(75d9b222)
 *
 * ⚠ 判据落在**既有键**上：本分支多出的 `turnDynamics` 是新增可选字段，比之前先剥掉，
 *   否则「新增了字段」会被读成「改坏了既有行为」——两个不同的命题。
 * ⚠ `worldId`/`summary` 内嵌会话身份，每跑一次必不同，同样先剥（否则恒报不同）。
 */
import crypto from "node:crypto";

const MINE = "http://127.0.0.1:4001/a/v1";
const CANON = "http://127.0.0.1:4003/a/v1";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };

async function api(base, m, p, b) {
  const r = await fetch(base + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
/** 既有键指纹：剥会话身份 + 剥本分支新增的 turnDynamics。 */
const legacyFp = (o) => { const c = { ...o }; delete c.worldId; delete c.summary; delete c.turnDynamics; return h(c); };

const MAT = (mag) => ({ kind: "cost_shock", targetObjectId: "obj_material_pos_ncm", targetStateVar: "priceShock", magnitude: mag, mode: "set", label: `三元正极 ${mag}` });
const AL = (mag) => ({ kind: "cost_shock", targetObjectId: "obj_material_al_foil", targetStateVar: "priceShock", magnitude: mag, mode: "set", label: `铝箔 ${mag}` });

async function run(base, schedule, ticks) {
  const s = await api(base, "POST", "/sim/sessions", { scope: { mode: "GLOBAL" } });
  for (const [p, st] of schedule) await api(base, "POST", `/sim/sessions/${s.id}/perturbations`, { ...p, startTick: st, durationTicks: null });
  for (let i = 0; i < ticks; i++) await api(base, "POST", `/sim/sessions/${s.id}/tick`, { ticks: 1 });
  const sol = await api(base, "POST", "/solvers/finance_world_projection/invoke", { args: { worldId: s.id } });
  return sol.data ?? sol;
}

// ── 金丝雀先跑：证明这套比法**分得出不同** ────────────────────────────────────────
// 拿两个本就该不同的场景（tick×0 vs tick×3）在**同一台** canonical 上比。
// 若它俩指纹也相同 ⇒ legacyFp 把所有东西都剥没了，比法坏了，下面的「相同」一个都不许信。
console.log("══ 金丝雀 · 比法有没有鉴别力（同一台 canonical，两个本该不同的场景）══");
const cz = await run(CANON, [[MAT(20), 0]], 0);
const c3 = await run(CANON, [[MAT(20), 0]], 3);
console.log(`  canonical tick×0 既有键指纹 = ${legacyFp(cz)}`);
console.log(`  canonical tick×3 既有键指纹 = ${legacyFp(c3)}`);
const disc = legacyFp(cz) !== legacyFp(c3);
console.log(`  >>> 鉴别力? ${disc ? "YES" : "NO ⚠ 比法坏了（剥太多），停止报结论"}`);
if (!disc) process.exit(2);

const cases = [
  ["格2 · tick×0（不推进）", [[MAT(20), 0]], 0],
  ["tick×1", [[MAT(20), 0]], 1],
  ["tick×3", [[MAT(20), 0]], 3],
  ["tick×3 · 两扰动", [[MAT(20), 0], [AL(15), 1]], 3],
];
console.log("\n══ 本分支(4001) vs canonical(4003) · 既有键逐字节比 ══");
let allSame = true;
for (const [name, sched, ticks] of cases) {
  const [a, b] = [await run(MINE, sched, ticks), await run(CANON, sched, ticks)];
  const [fa, fb] = [legacyFp(a), legacyFp(b)];
  const same = fa === fb;
  if (!same) allSame = false;
  console.log(`  ${name}`);
  console.log(`     本分支   = ${fa}`);
  console.log(`     canonical= ${fb}   ${same ? "✅ 逐字节相同" : "❌ 不同 ⇒ 既有行为被改坏"}`);
  console.log(`     turnDynamics 存在? 本分支=${a.turnDynamics ? "有" : "无"} canonical=${b.turnDynamics ? "有" : "无"}`);
  if (!same) {
    for (const k of Object.keys(a)) {
      if (k === "worldId" || k === "summary" || k === "turnDynamics") continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`       ↳ 差在键 ${k}`);
    }
  }
}
console.log(`\n>>> 格2 判定：${allSame ? "PASS —— 既有键在 canonical 与本分支上逐字节相同，新增的只有 turnDynamics" : "FAIL"}`);
