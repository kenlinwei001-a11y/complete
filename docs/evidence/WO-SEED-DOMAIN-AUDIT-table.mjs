// WO-3ROOT · 播种基值 × 声明域 全表普查（只读取证 · 不改产品代码）
// 运行期输入（真后端 4321 抓取，本目录）：
//   WO-SEED-DOMAIN-AUDIT-runtime-session.json      POST /a/v1/sim/sessions       → baseSnapshot + provenance
//   WO-SEED-DOMAIN-AUDIT-runtime-world-tick0.json  GET  …/sessions/:id/world      → tick0 入口投影账 saturations
//   WO-SEED-DOMAIN-AUDIT-runtime-view-config.json  GET  /a/v1/sim/view-config    → nodeObjectIds（对象→类型）
// 声明侧输入：本树 dist 的 STATE_VAR_DOMAINS（min/max/restPoint 是**声明**，不是取值）
import fs from "node:fs";
import { STATE_VAR_DOMAINS } from "../../apps/datacore/dist/synthetic/battery.js";
const D = STATE_VAR_DOMAINS;
const EV = new URL(".", import.meta.url).pathname;
const J = (n) => JSON.parse(fs.readFileSync(EV + n, "utf8"));

// ── 金丝雀 A（工具活着：否定结论的天敌）───────────────────────────────
const nD = Object.keys(D).length;
console.log(`[金丝雀A·工具活着] 声明域条数 = ${nD}`);
if (nD !== 38) { console.log("❌ 工具坏了（期望 38）"); process.exit(2); }
const negMin = Object.entries(D).filter(([, d]) => d.min < 0);
console.log(`[金丝雀A2] declared min<0 的域 = ${negMin.length} 个：${negMin.map(([k]) => k).join(",")}`);
if (negMin.length !== 1 || negMin[0][0] !== "forecastBias") { console.log("❌ 工具坏了"); process.exit(2); }
// ── 金丝雀 B（正向必中：已知那一格）───────────────────────────────────
const fb = D["forecastBias"];
console.log(`[金丝雀B·正向必中] forecastBias 声明 min=${fb.min} max=${fb.max} rest=${fb.restPoint}（38 域里唯一 min<0）`);

const sess = J("WO-SEED-DOMAIN-AUDIT-runtime-session.json");
const world = J("WO-SEED-DOMAIN-AUDIT-runtime-world-tick0.json");
const vc = J("WO-SEED-DOMAIN-AUDIT-runtime-view-config.json");
const base = sess.baseSnapshot, prov = sess.baseSnapshotProvenance;
const sat = world.baseStateVarReport.saturations;
const satBy = {}; for (const s of sat) (satBy[s.stateVar] ??= []).push(s);

const all = new Map(), der = new Map(), mea = new Map();
for (const [t, ids] of Object.entries(vc.nodeObjectIds))
  for (const oid of ids)
    for (const [v, val] of Object.entries(base[oid] ?? {})) {
      const push = (m, x) => (m.get(v) ?? m.set(v, []).get(v)).push(x);
      push(all, val);
      const o = (prov[oid] ?? {})[v];
      push(o === "derived" ? der : o === "measured" ? mea : (() => { throw new Error("未知出处 " + o); })(), val);
    }
const rng = (a) => (a && a.length ? [Math.min(...a), Math.max(...a)] : null);
const F = (r) => (r === null ? "—" : `[${r[0].toFixed(3)}, ${r[1].toFixed(3)}]`);
console.log(`\n[规模] 对象 ${Object.keys(base).length} · 格 ${[...all.values()].reduce((s, a) => s + a.length, 0)} · 派生 ${[...der.values()].reduce((s, a) => s + a.length, 0)} · 实测 ${[...mea.values()].reduce((s, a) => s + a.length, 0)}`);
console.log(`[tick0 入口投影账] 越界被收回 = ${sat.length} 格（min 侧 ${sat.filter((s) => s.bound === "min").length} / max 侧 ${sat.filter((s) => s.bound === "max").length}）`);

console.log("\n════ 38 个声明域 × 实测播种基值（tick0 落盘态，投影后）════");
console.log("量".padEnd(24) + "声明[min,max]rest".padEnd(24) + "n(派/测)".padEnd(12) + "实测播种区间".padEnd(22) + "派生支".padEnd(22) + "实测支".padEnd(22) + "越界(投影前原值)");
for (const v of Object.keys(D)) {
  const d = D[v];
  const a = all.get(v) ?? [], dd = der.get(v) ?? [], mm = mea.get(v) ?? [];
  const s = satBy[v] ?? [];
  const rmin = s.filter((x) => x.bound === "min").map((x) => x.raw), rmax = s.filter((x) => x.bound === "max").map((x) => x.raw);
  console.log(v.padEnd(24) + `[${d.min},${d.max === null ? "∞" : d.max}]rest${d.restPoint}`.padEnd(24) + `${a.length}(${dd.length}/${mm.length})`.padEnd(12) + F(rng(a)).padEnd(22) + F(rng(dd)).padEnd(22) + F(rng(mm)).padEnd(22) + (rmin.length || rmax.length ? `min侧${rmin.length}${rmin.length ? "@" + Math.min(...rmin).toFixed(3) : ""} max侧${rmax.length}${rmax.length ? "@" + Math.max(...rmax).toFixed(3) : ""}` : "无"));
}
// ── 金丝雀 C（反向鉴别：确信合法的格不许被误报「越界」）─────────────────
console.log("\n[金丝雀C·反向鉴别] 挑确信合法的格，验判法不误报越界：");
for (const v of ["demandPressure", "costPressure", "loadPressure", "equipmentFailure"]) {
  const d = D[v], a = rng(all.get(v));
  const ok = a[0] >= d.min && (d.max === null || a[1] <= d.max);
  console.log(`   ${v}: 实测 ${F(a)} ⊆ 声明 [${d.min},${d.max}] ⇒ ${ok ? "✅ 判为域内（未误报）" : "🔴 误报/真越界"}`);
}
