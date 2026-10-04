// WO-3ROOT · 边符号 × 源播种可达区间 × 目标域「边界是否吸收」 三者 join
// 判据（P1 形态的一般化）：目标格的全部入流贡献**同号**、且该方向指向 band=0 的**硬夹**边界
// ⇒ 该格只能朝那个边界走，反方向的分支数值上不可达。
// 边界吸收判据取自引擎实现 sim/propagation.ts saturateToDomain：
//   bandHi=(max-rest)*BAND / bandLo=(rest-min)*BAND；band=0 的一侧是 `else if (raw<min) return min` 硬夹。
import fs from "node:fs";
import { STATE_VAR_DOMAINS } from "../../apps/datacore/dist/synthetic/battery.js";
const D = STATE_VAR_DOMAINS, BAND = 0.25;
const EV = new URL(".", import.meta.url).pathname;
const J = (n) => JSON.parse(fs.readFileSync(EV + n, "utf8"));
const sess = J("WO-SEED-DOMAIN-AUDIT-runtime-session.json");
const vc = J("WO-SEED-DOMAIN-AUDIT-runtime-view-config.json");
const rules = J("WO-SEED-DOMAIN-AUDIT-runtime-rules.json").items.filter((r) => r.status === "PUBLISHED");
const base = sess.baseSnapshot;

// 金丝雀 A：规则表里已知那条负边必须在场（工具活着）
const fbEdge = rules.find((r) => r.key === "demo_forecast_bias_to_order_demand");
console.log(`[金丝雀A·工具活着] PUBLISHED 规则 = ${rules.length}；已知负边 demo_forecast_bias_to_order_demand coeff=${fbEdge?.coefficient}`);
if (!fbEdge || fbEdge.coefficient !== -0.222) { console.log("❌ 工具坏了（找不到已知负边或系数不符）"); process.exit(2); }

const valOf = new Map();
for (const [t, ids] of Object.entries(vc.nodeObjectIds))
  for (const oid of ids)
    for (const [v, val] of Object.entries(base[oid] ?? {})) (valOf.get(`${t}|${v}`) ?? valOf.set(`${t}|${v}`, []).get(`${t}|${v}`)).push(val);
const rng = (a) => (a && a.length ? [Math.min(...a), Math.max(...a)] : null);

const byTarget = new Map();
for (const r of rules) {
  const k = `${r.targetTypeKey}|${r.targetStateVar}`;
  const sr = rng(valOf.get(`${r.sourceTypeKey}|${r.sourceStateVar}`) ?? []);
  const c = r.coefficient;
  const contrib = sr === null ? null : c >= 0 ? [c * sr[0], c * sr[1]] : [c * sr[1], c * sr[0]];
  (byTarget.get(k) ?? byTarget.set(k, []).get(k)).push({ r, srcK: `${r.sourceTypeKey}|${r.sourceStateVar}`, sr, c, contrib });
}

const rows = [];
for (const [k, ins] of byTarget) {
  const d = D[k.split("|")[1]];
  const cs = ins.filter((i) => i.contrib);
  if (!cs.length) { rows.push({ k, d, ins, note: "源无实测值" }); continue; }
  const lo = Math.min(...cs.map((i) => i.contrib[0])), hi = Math.max(...cs.map((i) => i.contrib[1]));
  const oneSided = lo >= 0 || hi <= 0;
  const dir = lo >= 0 && hi > 0 ? +1 : hi <= 0 && lo < 0 ? -1 : 0;
  const floorAbsorb = d ? BAND * (d.restPoint - d.min) === 0 : null;
  const ceilAbsorb = d ? d.max !== null && BAND * (d.max - d.restPoint) === 0 : null;
  rows.push({ k, d, ins, lo, hi, oneSided, dir, floorAbsorb, ceilAbsorb, intoFloor: oneSided && dir < 0 && floorAbsorb === true, intoCeil: oneSided && dir > 0 && ceilAbsorb === true });
}
console.log(`\n目标格(类型·量) 总数 = ${rows.length}；已声明域的 = ${rows.filter((r) => r.d).length}；未声明 = ${rows.filter((r) => !r.d).length}`);
console.log(`净入流符号单一 = ${rows.filter((r) => r.oneSided).length}`);
console.log(`  ↑ 其中指向**吸收边界**（该侧 band=0 硬夹）= ${rows.filter((r) => r.intoFloor || r.intoCeil).length}  ← 这一项就是 P1 形态的一般化量`);
for (const r of rows.filter((x) => x.intoFloor || x.intoCeil)) {
  console.log(`\n  🔴 ${r.k}  域=[${r.d.min},${r.d.max}]rest${r.d.restPoint}  净方向=${r.dir}  入流贡献并集=[${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]  ${r.intoFloor ? "只能被压向硬地板 min=rest" : "只能被推向硬顶 max=rest"}`);
  for (const i of r.ins) console.log(`      ← ${i.r.key}  (${i.srcK}) coeff=${i.c}  源播种区间=${i.sr ? `[${i.sr[0].toFixed(4)}, ${i.sr[1].toFixed(4)}]` : "无"}`);
}
console.log("\n── 反向金丝雀：符号单一但边界**不**吸收的格，不许被上面那条判据误报 ──");
for (const k of ["Base|loadIndex", "Customer|receivablePressure", "WorkOrder|releasePressure"]) {
  const r = rows.find((x) => x.k === k);
  console.log(`   ${k}: oneSided=${r.oneSided} 方向=${r.dir} 上界带=${r.d.max === null ? "无界" : (r.d.max - r.d.restPoint) * BAND} ⇒ intoCeil=${r.intoCeil}（须为 false）`);
}
console.log("\n── 已声明目标格全表（* = 符号单一）──");
for (const r of rows.filter((x) => x.d).sort((a, b) => (a.k < b.k ? -1 : 1)))
  console.log(`${r.intoFloor || r.intoCeil ? "🔴" : r.oneSided ? "* " : "  "} ${r.k.padEnd(38)} 域=[${r.d.min},${r.d.max === null ? "∞" : r.d.max}]rest${r.d.restPoint} 入边=${r.ins.length} 入流并集=[${(r.lo ?? 0).toFixed(4)}, ${(r.hi ?? 0).toFixed(4)}]`);
