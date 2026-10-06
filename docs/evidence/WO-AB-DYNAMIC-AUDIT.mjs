#!/usr/bin/env node
/** 动态数据审计：同扰动、逐环节比对；再插入一次外部操作，看哪一环会漂。 */
const B = process.env.BASE || "http://127.0.0.1:4052";
const DU = "demo:admin:admin|planner|catalog_admin";
const api = async (m,p,b)=>{const r=await fetch(`${B}${p}`,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(`${w}: ${r.s}`);return r.j};
const PERT={kind:"supply_disruption",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:-3,startTick:0,durationTicks:null,label:"dyn-audit"};

async function run(tag){
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"session"); const id=s?.session?.id??s?.id;
  await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{...PERT,label:`${tag}`});
  const stages={};
  for(let t=0;t<=10;t++){
    const w=must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"world");
    if(t===0||t===10){
      const st=w?.state??{};
      let n=0,nz=0,v=0;
      for(const oid of Object.keys(st)){ if(!oid.startsWith("obj_order_"))continue; n++;
        v+=(st[oid].qty||0)*(st[oid].unitPrice||0);
        if(Math.abs(st[oid].costPressure||0)>0)nz++; }
      stages[`t${t}.世界态`]=`订单=${n} Σ金额=${v.toFixed(0)} costPressure非0=${nz}`;
    }
    if(t<10) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
  }
  const p=must(await api("POST",`/a/v1/solvers/finance_world_projection/invoke`,{args:{worldId:id}}),"proj");
  const D=p?.data??p;
  const cp=(D?.pressures??[]).find(x=>x?.stateVar==="costPressure");
  stages["求解器.聚合"]=JSON.stringify({value:cp?.value,carriers:cp?.carriers,universe:cp?.universe,w:cp?.denominator?.weightSum,dn:cp?.denominator?.n});
  for(const l of (D?.lines??[])) stages[`求解器.${l.role}`]=`rolling=${l.rolling} projected=${l.projected} delta=${l.delta}`;
  if(D?.basis) stages["求解器.basis"]=JSON.stringify({divisor:D.basis.divisor,den:D.basis.denominator,pu:D.basis.pressureUnit});
  return {id, stages};
}

const A1=await run("A1");
console.log(`## 动态数据审计 · 同扰动（SO-3391.leadDays −3）逐环节`);
console.log(`A1 session=${A1.id}\n`);
console.log("=== 第一组：A1 vs A2（纯重复，中间无外部操作）===");
const A2=await run("A2");
for(const k of Object.keys(A1.stages)){
  const a=A1.stages[k], b=A2.stages[k];
  console.log(`  ${a===b?"✅同":"❌异"} ${k}\n      A1=${a}\n      A2=${b}`);
}
console.log("\n=== 第二组：A2 vs A3（A2 与 A3 之间【插入】一次外部操作：新建 3 个会话）===");
for(let i=0;i<3;i++) await api("POST","/a/v1/sim/sessions",{});
const A3=await run("A3");
for(const k of Object.keys(A2.stages)){
  const a=A2.stages[k], b=A3.stages[k];
  console.log(`  ${a===b?"✅同":"❌异"} ${k}\n      A2=${a}\n      A3=${b}`);
}
console.log(`\nDONE ${new Date().toISOString()}`);
