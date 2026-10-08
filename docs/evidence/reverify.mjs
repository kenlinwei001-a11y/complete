const B="http://127.0.0.1:4052", DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(w+":"+r.s);return r.j};
const newS=async()=>{const s=must(await api("POST","/a/v1/sim/sessions",{}),"s");return s?.session?.id??s?.id};
const f=(v,d=9)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));

console.log("## 在新 PID 上重跑关键判据");
console.log("");
// ① 静息态归位（15 个已裁量名）
{
  const id=await newS();
  const st=(must(await api("GET","/a/v1/sim/sessions/"+id+"/world"),"w")).state||{};
  const NAMES=["costPressure","receivablePressure","overduePressure","loadIndex","utilPressure","demandPressure","shortageRisk","supplyRisk","demandLoad","defectPressure","gapPressure","queuePressure","expeditePressure","feedPressure","releasePressure","blockedPressure"];
  let n=0,nz=0;
  for(const oid of Object.keys(st)) for(const [k,v] of Object.entries(st[oid])) if(NAMES.includes(k)&&typeof v==="number"){n++;if(Math.abs(v)>0)nz++;}
  console.log(`① 静息态：16 个已裁量名 · 格数=${n} · 非0=${nz}  ${nz===0?"✅ 全归位":"❌"}`);
}
// ② 静息带（max 有限的量名里 |值|>75）
{
  const {createRequire}=await import("node:module");
  const req=createRequire("/tmp/wt-ab/apps/datacore/");
  const b=req("/tmp/wt-ab/apps/datacore/dist/synthetic/battery.js");
  const DOM=(b.stateVarDomains?b.stateVarDomains():b.STATE_VAR_DOMAINS)||{};
  const id=await newS();
  const st=(must(await api("GET","/a/v1/sim/sessions/"+id+"/world"),"w")).state||{};
  const band={};
  for(const oid of Object.keys(st)) for(const [k,v] of Object.entries(st[oid])){
    const d=DOM[k]; if(!d||typeof d.max!=="number"||!Number.isFinite(d.max))continue;
    if(typeof v!=="number")continue;
    (band[k]??=0); if(Math.abs(v)>75)band[k]++;
  }
  const bad=Object.entries(band).filter(([,n])=>n>0);
  console.log(`② 静息带：max有限量名中 |值|>75 的 = ${bad.length?bad.map(([k,n])=>k+"("+n+")").join(" ")+" ❌":"0 ✅"}`);
}
// ③ 三臂线性（Order.costPressure）
{
  const run=async(mag)=>{const id=await newS();
    await api("POST","/a/v1/sim/sessions/"+id+"/perturbations",{kind:"supply_disruption",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:mag,startTick:0,durationTicks:null,label:"rv"});
    for(let t=0;t<10;t++) must(await api("POST","/a/v1/sim/sessions/"+id+"/tick",{n:1}),"t");
    const st=(must(await api("GET","/a/v1/sim/sessions/"+id+"/world"),"w")).state||{};
    return st["obj_order_SO-3391"]?.costPressure;};
  const a=await run(-3), c=await run(-20);
  console.log(`③ 三臂线性：Δ-3=${f(a)} Δ-20=${f(c)} 比=${(c/a).toFixed(6)}（应 ≈6.6667）${Math.abs(c/a-20/3)<1e-4?"✅":"❌"}`);
}
// ④ 三行钱 + 金额聚合
{
  const id=await newS();
  await api("POST","/a/v1/sim/sessions/"+id+"/perturbations",{kind:"supply_disruption",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:-3,startTick:0,durationTicks:null,label:"rv"});
  for(let t=0;t<10;t++) must(await api("POST","/a/v1/sim/sessions/"+id+"/tick",{n:1}),"t");
  const p=must(await api("POST","/a/v1/solvers/finance_world_projection/invoke",{args:{worldId:id}}),"p");
  const D=p?.data??p; const cp=(D?.pressures??[]).find(x=>x?.stateVar==="costPressure");
  const L=Object.fromEntries((D?.lines??[]).map(l=>[l.role,l.delta]));
  console.log(`④ 金额：聚合=${f(cp?.value)} den.n=${cp?.denominator?.n} · COST=${f(L.COST)} MARGIN=${f(L.MARGIN)} REVENUE=${f(L.REVENUE)}`);
  console.log(`   对照（旧 dist 实测）：聚合=0.004602 den.n=150 · COST=0.026744 MARGIN=-0.026744`);
}
console.log("");
console.log(`DONE ${new Date().toISOString()}`);
