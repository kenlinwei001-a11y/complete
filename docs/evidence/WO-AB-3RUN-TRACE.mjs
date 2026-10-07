#!/usr/bin/env node
/** 同订单 3 次：R1/R2 = 提前交付 3 天（应逐环节全同）· R3 = 提前交付 30 天（应有差异）。
 *  逐环节记：公式 · 数据来源 · 输入 → 计算 → 输出。 */
const B = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const TICKS = Number(process.env.TICKS || 10);
const OID = "obj_order_SO-3391";
const api = async (m,p,b)=>{const r=await fetch(`${B}${p}`,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(`${w}: ${r.s} ${(r.t||"").slice(0,200)}`);return r.j};
const f=(v,d=6)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));

async function run(days){
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"session"); const id=s?.session?.id??s?.id;
  await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"supply_disruption",targetObjectId:OID,targetStateVar:"leadDays",mode:"delta",magnitude:-days,startTick:0,durationTicks:null,label:`提前${days}天`});
  const sd=must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"w0");
  const ld0=sd?.state?.[OID]?.leadDays;
  for(let t=1;t<=TICKS;t++) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
  const w=must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"w1");
  const p=must(await api("POST",`/a/v1/solvers/finance_world_projection/invoke`,{args:{worldId:id}}),"proj");
  const D=p?.data??p;
  const cp=(D?.pressures??[]).find(x=>x?.stateVar==="costPressure");
  const st=w?.state??{};
  return {id, days, ld0, ld:st?.[OID]?.leadDays,
    modelCP:st?.["obj_model_4680-NCM"]?.costPressure, orderCP:st?.[OID]?.costPressure,
    custRP:st?.["obj_customer_cust_14"]?.receivablePressure,
    agg:cp?.value, wsum:cp?.denominator?.weightSum, dn:cp?.denominator?.n,
    lines:Object.fromEntries((D?.lines??[]).map(l=>[l.role,l.delta])) };
}

const R1=await run(3), R2=await run(3), R3=await run(30);
console.log("## 同订单 3 次：R1/R2=提前3天 · R3=提前30天（TICKS=%d）", TICKS);
console.log("");
const rows=[
 ["① 扰动落点  Order.leadDays","输入=本体 leadDays 14","14 + (−N)  → 域夹","st.leadDays"],
 ["② Model.costPressure","src=Order.leadDays 偏离","demo_order_leaddays_to_model_horizon","st[4680-NCM].costPressure"],
 ["③ Order.costPressure","src=Model.costPressure 偏离 ×0.2775","demo_model_cost_to_order_cost","st[SO-3391].costPressure"],
 ["④ Customer.receivablePressure","src=Order.costPressure 偏离 ×0.5","demo_order_cost_to_customer_ar","st[cust_14].receivablePressure"],
 ["⑤ 聚合 costPressure.value","Σ(偏离×金额)/Σ金额","aggregatePressure(登记集合)","回包 pressures[].value"],
 ["⑥ COST.delta","基线×(偏离÷100)","finance_world_projection","回包 lines[COST].delta"],
];
console.log("环节 | R1(3天) | R2(3天) | R3(30天) | R1==R2? | R3≠R1?");
console.log("---|---|---|---|---|---");
const vals=[
 (r)=>r.ld, (r)=>r.modelCP, (r)=>r.orderCP, (r)=>r.custRP, (r)=>r.agg, (r)=>r.lines.COST
];
rows.forEach((row,i)=>{
  const a=f(vals[i](R1)), b=f(vals[i](R2)), c=f(vals[i](R3));
  console.log(`${row[0]} | ${a} | ${b} | ${c} | ${a===b?"✅同":"❌异"} | ${c!==a?"✅异":"❌同"} |`);
});
console.log("");
console.log("### MARGIN / REVENUE delta");
console.log(`  MARGIN  R1=${f(R1.lines.MARGIN)}  R2=${f(R2.lines.MARGIN)}  R3=${f(R3.lines.MARGIN)}`);
console.log(`  REVENUE R1=${f(R1.lines.REVENUE)} R2=${f(R2.lines.REVENUE)} R3=${f(R3.lines.REVENUE)}`);
console.log("");
console.log("### 幅度比（R3/R1 的偏离量之比，应 ≈ 10 倍）");
for(const [nm,i] of [["②Model",1],["③Order",2],["④Customer",3],["⑤聚合",4],["⑥COST",5]]){
  const a=vals[i](R1), c=vals[i](R3);
  console.log(`  ${nm.padEnd(10)} ${f(a)} → ${f(c)}   比 = ${(a&&typeof a==="number"&&typeof c==="number"&&a!==0)?(c/a).toFixed(6):"—"}`);
}
console.log("");
console.log(`ids: R1=${R1.id} R2=${R2.id} R3=${R3.id}`);
console.log(`DONE ${new Date().toISOString()}`);
