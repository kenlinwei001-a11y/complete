#!/usr/bin/env node
/** 换扰动因素：Material.priceShock（料价）。R1/R2 同数据 · R3 调整数据。
 *  逐环节记 公式 · 数据来源 · 输入→计算→输出。 */
const B=process.env.BASE||"http://127.0.0.1:4052";
const DU="demo:admin:admin|planner|catalog_admin";
const TICKS=Number(process.env.TICKS||10);
const OID=process.env.OID||"obj_material_al_foil";
const SV=process.env.SV||"priceShock";
const MID="obj_model_4680-NCM", OOID="obj_order_SO-3391", CID="obj_customer_cust_14";
const api=async(m,p,b)=>{const r=await fetch(`${B}${p}`,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(`${w}: ${r.s} ${(r.t||"").slice(0,200)}`);return r.j};
const f=(v,d=9)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));

async function run(mag){
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const id=s?.session?.id??s?.id;
  const r0=await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"supply_disruption",targetObjectId:OID,targetStateVar:SV,mode:"delta",magnitude:mag,startTick:0,durationTicks:null,label:`${SV} ${mag}`});
  if(r0.s>=400) return {err:`${r0.s} ${(r0.t||"").slice(0,120)}`};
  for(let t=1;t<=TICKS;t++) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
  const w=must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"w");
  const p=must(await api("POST",`/a/v1/solvers/finance_world_projection/invoke`,{args:{worldId:id}}),"proj");
  const D=p?.data??p; const st=w?.state??{};
  const cp=(D?.pressures??[]).find(x=>x?.stateVar==="costPressure");
  return {id,
    src:st?.[OID]?.[SV], mid:st?.[MID]?.costPressure, oid:st?.[OOID]?.costPressure,
    cid:st?.[CID]?.receivablePressure, agg:cp?.value,
    lines:Object.fromEntries((D?.lines??[]).map(l=>[l.role,l.delta]))};
}

const R1=await run(3), R2=await run(3), R3=await run(30);
console.log(`## 扰动因素【${OID}.${SV}】3 次 · R1/R2=+3 · R3=+30 · TICKS=${TICKS}`);
console.log("");
if(R1.err){ console.log("⛔ R1 失败:", R1.err); process.exit(0); }
console.log("环节 | 公式/来源 | R1 | R2 | R3 | R1==R2 | R3≠R1");
console.log("---|---|---|---|---|---|---");
const rows=[
 ["① 扰动落点 "+SV,"本体属性 +Δ（域夹：Material 族 min0/max100）",(r)=>r.src],
 ["② Model.costPressure","demo_material_price_to_model_cost（价 → 型号成本）",(r)=>r.mid],
 ["③ Order.costPressure","demo_model_cost_to_order_cost（× 0.2775）",(r)=>r.oid],
 ["④ Customer.receivablePressure","demo_order_cost_to_customer_receivable（× 0.03144963）",(r)=>r.cid],
 ["⑤ 聚合 costPressure.value","Σ(偏离×金额)÷Σ金额（登记集合）",(r)=>r.agg],
 ["⑥ COST.delta","基线×(偏离÷100)（divisor=100）",(r)=>r.lines?.COST],
];
for(const [nm,fm,g] of rows){
  const a=f(g(R1)), b=f(g(R2)), c=f(g(R3));
  console.log(`${nm} | ${fm} | ${a} | ${b} | ${c} | ${a===b?"✅同":"❌异"} | ${c!==a?"✅异":"❌同"} |`);
}
console.log("");
console.log("### 幅度比（R3/R1，应 ≈ 10 倍）");
for(const [nm,g] of [["①",(r)=>r.src],["②",(r)=>r.mid],["③",(r)=>r.oid],["④",(r)=>r.cid],["⑤",(r)=>r.agg],["⑥",(r)=>r.lines?.COST]]){
  const a=g(R1),c=g(R3);
  console.log(`  ${nm} ${f(a)} → ${f(c)}  比 = ${(typeof a==="number"&&typeof c==="number"&&a!==0)?(c/a).toFixed(6):"—"}`);
}
console.log("");
console.log(`MARGIN  R1=${f(R1.lines?.MARGIN)} R2=${f(R2.lines?.MARGIN)} R3=${f(R3.lines?.MARGIN)}`);
console.log(`REVENUE R1=${f(R1.lines?.REVENUE)} R2=${f(R2.lines?.REVENUE)} R3=${f(R3.lines?.REVENUE)}`);
console.log(`ids: ${R1.id} / ${R2.id} / ${R3.id}`);
console.log(`DONE ${new Date().toISOString()}`);
