#!/usr/bin/env node
/** 精确求和：所有进入 obj_order_SO-3391.costPressure 的 amount，与实测读数变化对照 */
const BASE = process.env.BASE || "http://127.0.0.1:4051";
const MAG = Number(process.env.MAG ?? -3), TICKS = Number(process.env.TICKS || 12);
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m,p,b)=>{const r=await fetch(`${BASE}${p}`,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(`${w}: ${r.s} ${(r.t||"").slice(0,300)}`);return r.j};
const TARGET="obj_order_SO-3391.costPressure";
const s = must(await api("POST","/a/v1/sim/sessions",{}),"session"); const id=s?.session?.id??s?.id;
await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"supply_disruption",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:MAG,startTick:0,durationTicks:null,label:`sum mag=${MAG}`});
for(let t=0;t<TICKS;t++) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
const w = must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"world");
const g = must(await api("GET",`/a/v1/causal-graphs/sim/${id}`),"graph");
const readv = w?.state?.["obj_order_SO-3391"]?.costPressure;
console.log(`## 进入 ${TARGET} 的全部 amount（精确求和） · session=${id} mag=${MAG} ticks=${TICKS}`);
console.log(`实测终态读数 = ${readv}`);
const edges = (g?.edges ?? []).filter((e)=>String(e?.toNodeId ?? "").includes(TARGET));
console.log(`\n命中边 ${edges.length} 条（causal graph edges 总数 ${(g?.edges??[]).length}）`);
const byRule = new Map();
let sum = 0;
for (const e of edges) {
  const amt = e?.amount; if (typeof amt !== "number") continue;
  sum += amt;
  const k = e?.provenance?.producedBy ?? e?.edgeId ?? "?";
  if (!byRule.has(k)) byRule.set(k, { n: 0, sum: 0 });
  const b = byRule.get(k); b.n++; b.sum += amt;
}
console.log("\n### 按写入方分解");
for (const [k, b] of [...byRule.entries()].sort((a,b)=>Math.abs(b[1].sum)-Math.abs(a[1].sum)))
  console.log(`  ${k.padEnd(46)} n=${String(b.n).padEnd(5)} Σamount=${b.sum.toFixed(9)}`);
console.log(`\nΣamount 合计 = ${sum.toFixed(9)}`);
console.log(`实测读数 90.384615 + Σamount = ${(90.384615 + sum).toFixed(6)}   （对照 mag 臂实测 ${readv}）`);
console.log(`读数实际变化 = ${(readv - 90.384615).toFixed(6)}  ⇒ 未被 amount 解释的余量 = ${((readv - 90.384615) - sum).toFixed(6)}`);
console.log(`\n判读：Σamount 若 << 读数变化 ⇒ 该格变化的主项不来自任何传导边 ⇒ 来自派生规格/其他写入方。`);
console.log(`DONE ${new Date().toISOString()}`);
