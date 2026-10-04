// WO-3ROOT · 三条硬证据：① 派生支结构下界 ② P1 后果（零扰动臂） ③ min 侧被收回的格
// ⚠ 本探针的所有读数都是**运行时真读**，不是 grep 源码。
import fs from "node:fs";
const EV = new URL(".", import.meta.url).pathname;
const J = (n) => JSON.parse(fs.readFileSync(EV + n, "utf8"));
const sess = J("WO-SEED-DOMAIN-AUDIT-runtime-session.json");
const world = J("WO-SEED-DOMAIN-AUDIT-runtime-world-tick0.json");
const vc = J("WO-SEED-DOMAIN-AUDIT-runtime-view-config.json");
const ticks = J("WO-SEED-DOMAIN-AUDIT-runtime-ticks.json");
const base = sess.baseSnapshot, prov = sess.baseSnapshotProvenance;
const idsByType = vc.nodeObjectIds;

// ① 派生支（hash 占位）全域下界
let dMin = Infinity, dMax = -Infinity, dN = 0, neg = 0;
for (const [oid, row] of Object.entries(base))
  for (const [v, val] of Object.entries(row))
    if ((prov[oid] ?? {})[v] === "derived") { dN++; if (val < 0) neg++; dMin = Math.min(dMin, val); dMax = Math.max(dMax, val); }
console.log(`① 派生支（hash 占位）全域：n=${dN}  实测 min=${dMin} max=${dMax}  负值格=${neg}`);
console.log(`   结构判据：seedHash01(s)=((FNV1a(s)>>>0)%1000)/1000 ∈ [0,0.999] ⇒ round(×100) ∈ [0,100] ⇒ 恒 ≥ 0`);
if (neg !== 0 || dMin < 0) { console.log("❌ 与结构判据矛盾，工具或代码有变"); process.exit(2); }

// ② forecastBias：出处构成 + 负值格数
const fbIds = Object.keys(base).filter((o) => base[o] && "forecastBias" in base[o]);
const fbProv = {}; let fbNeg = 0; const fbVals = [];
for (const o of fbIds) { const g = (prov[o] ?? {}).forecastBias; fbProv[g] = (fbProv[g] ?? 0) + 1; fbVals.push(base[o].forecastBias); if (base[o].forecastBias < 0) fbNeg++; }
console.log(`\n② forecastBias（声明 [-100,100] rest 0）：${fbIds.length} 格；出处 ${JSON.stringify(fbProv)}；实测值 ${JSON.stringify(fbVals.sort((a, b) => a - b))}；负值格数 = ${fbNeg}`);
console.log(`   ⇒ 声明域的一半 [-100, 0) 上**一格都没有**`);

// ③ P1 后果：零扰动臂 6 拍，越基值格次
const orderIds = idsByType["Order"];
const b0 = {}; for (const o of orderIds) b0[o] = base[o].demandPressure;
let above = 0, total = 0; const per = [];
for (let t = 1; t <= 6; t++) {
  const arr = ticks.ticks["tick" + t]["Order.demandPressure"];
  let a = 0;
  orderIds.forEach((o, i) => { const x = arr[i]; if (typeof x === "number") { total++; if (x > b0[o] + 1e-12) { a++; above++; } } });
  per.push(`t${t}=${a}`);
}
console.log(`\n③ P1 后果（**零扰动臂** = 没播任何扰动，6 拍）：订单 ${orderIds.length} 张，越基值格次 = ${above}/${total}  逐拍 [${per.join(" ")}]`);
const last = ticks.ticks.tick6["Order.demandPressure"];
const del = orderIds.map((o, i) => last[i] - b0[o]);
console.log(`   终拍相对各自基值：Δmax=${Math.max(...del).toFixed(6)}  Δmin=${Math.min(...del).toFixed(6)}  越基值张数=${del.filter((x) => x > 1e-12).length}/${del.length}`);

// ④ min 侧被收回的格
const mins = world.baseStateVarReport.saturations.filter((x) => x.bound === "min");
console.log(`\n④ tick0 入口投影 min 侧被收回的格 = ${mins.length}（原值为负 ⇒ 被声明下界 0 硬夹）：`);
for (const s of mins) console.log(`   ${s.objectId}.${s.stateVar}: raw=${s.raw} → ${s.value}`);
const byVar = {}; for (const s of mins) byVar[s.stateVar] = (byVar[s.stateVar] ?? 0) + 1;
console.log(`   涉及量：${JSON.stringify(byVar)}`);

// ⑤ 反向金丝雀：model.supplyRisk 由 0 起步后能否抬起（判「哑格」是否**永久**）
console.log("\n⑤ Model.supplyRisk 逐拍区间（judge ⑥「首拍哑火」是否永久）：");
console.log(`   tick0 = ${JSON.stringify(rng(base, idsByType["Model"], "supplyRisk"))}`);
for (let t = 1; t <= 6; t++) {
  const arr = ticks.ticks["tick" + t]["Model.supplyRisk"].filter((x) => typeof x === "number");
  console.log(`   tick${t} = [${Math.min(...arr).toFixed(4)}, ${Math.max(...arr).toFixed(4)}]`);
}
function rng(b, ids, v) { const a = ids.map((o) => b[o]?.[v]).filter((x) => typeof x === "number"); return [Math.min(...a), Math.max(...a)]; }
