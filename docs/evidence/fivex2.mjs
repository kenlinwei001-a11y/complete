const B="http://127.0.0.1:4052", DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(w+":"+r.s);return r.j};
const f=(v,d=2)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));
const TARGET=1434.3;
async function run(mag,ticks=60){
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const id=s?.session?.id??s?.id;
  await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"demand_shift",targetObjectId:"obj_order_SO-3391",targetStateVar:"leadDays",mode:"delta",magnitude:mag,startTick:0,durationTicks:null,label:"m"});
  for(let t=0;t<ticks;t++) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
  const p=must(await api("POST","/a/v1/solvers/finance_world_projection/invoke",{args:{worldId:id}}),"p");
  const D=p?.data??p; const L=Object.fromEntries((D?.lines??[]).map(l=>[l.role,l.delta]));
  return L.COST*1e4;
}
console.log(`## 追 5 倍 · 真机屏上 = ${TARGET} 万元`);
console.log("");
for (const m of [-3,-6,-15,-30]) {
  const c=await run(m);
  console.log(`  幅度 ${String(m).padStart(4)} 天 → ${f(c).padStart(10)} 万元   比 = ${(c/TARGET).toFixed(4)}  ${Math.abs(c/TARGET-1)<0.02?"✅ 命中":"❌"}`);
}
console.log("");
console.log(`参考：−3 天 = 286.9 万元 ⇒ 1434.3 需要 ${(TARGET/286.9).toFixed(4)} 倍幅度 ⇒ 约 −${(3*TARGET/286.9).toFixed(1)} 天`);
