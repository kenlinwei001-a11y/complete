const B="http://127.0.0.1:4052", DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(w+":"+r.s);return r.j};
const f=(v,d=1)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));
const TARGET=1434.3;

async function run(mag,start,total){
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const id=s?.session?.id??s?.id;
  await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"demand_shift",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:mag,startTick:start,durationTicks:null,label:"5x"});
  for(let t=0;t<total;t++) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
  const p=must(await api("POST","/a/v1/solvers/finance_world_projection/invoke",{args:{worldId:id}}),"p");
  const D=p?.data??p; const L=Object.fromEntries((D?.lines??[]).map(l=>[l.role,l.delta]));
  const w=must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"w");
  return { costWan: L.COST*1e4, tick: w.tick, agg: (D?.pressures??[]).find(x=>x?.stateVar==="costPressure")?.value };
}
console.log(`## 追 5 倍：真机屏上 = ${TARGET} 万元`);
console.log("");
for (const [tag,mag,st,tot] of [["startTick=12 · 132拍",-3,12,132],["startTick=0 · 132拍",-3,0,132],["startTick=12 · 162拍",-3,12,162],["startTick=0 · 162拍",-3,0,162]]) {
  const r=await run(mag,st,tot);
  const ratio=(r.costWan/TARGET);
  console.log(`  ${tag.padEnd(24)} → 新增成本 = ${f(r.costWan)} 万元（curTick=${r.tick}）  比 = ${ratio.toFixed(4)}  ${Math.abs(ratio-1)<0.01?"✅ 命中":"❌"}`);
}
