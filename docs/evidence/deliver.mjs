const B="http://127.0.0.1:4052", DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(w+":"+r.s+" "+(r.t||"").slice(0,150));return r.j};
const f=(v,d=4)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));

const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const id=s?.session?.id??s?.id;
await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"supply_disruption",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:-3,startTick:0,durationTicks:null,label:"真机对照"});
const T=162;
for(let t=0;t<T;t++) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
const p=must(await api("POST","/a/v1/solvers/finance_world_projection/invoke",{args:{worldId:id}}),"p");
const D=p?.data??p;
const L=Object.fromEntries((D?.lines??[]).map(l=>[l.role,l.delta]));
const cp=(D?.pressures??[]).find(x=>x?.stateVar==="costPressure");
console.log(`## 独立复算（API，${T} 拍，−3 天）vs 真机屏上读数`);
console.log("");
console.log("项 | 真机屏上 | API 独立算 | 判");
const rows=[
  ["新增成本",  "1434.3万元",  f(L.COST*1e4,1)+"元"],
  ["毛利差额",  "-1434.3万元", f(L.MARGIN*1e4,1)+"元"],
  ["costPressure 聚合", "—",   f(cp?.value)],
  ["den.n（摊销总体）", "150 个", String(cp?.denominator?.n)],
];
for(const [a,b,c] of rows) console.log(`  ${a} | ${b} | ${c} |`);
console.log("");
console.log(`COST.delta = ${f(L.COST)} 亿 = ${f(L.COST*1e4,1)} 万元   （真机上屏 1434.3 万元）`);
console.log(`实际拍数 = ${(must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"w")).tick}`);
console.log(`DONE ${new Date().toISOString()}`);
