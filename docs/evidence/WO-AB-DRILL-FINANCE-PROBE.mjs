const DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch("http://127.0.0.1:4052"+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(w+":"+r.s);return r.j};
console.log("## 报告里的 finance 段 · 三幅度");
const deltas=[];
for (const v of [3,30,300]) {
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const sid=s?.session?.id??s?.id;
  const r=await api("POST",`/a/v1/sim/sessions/${sid}/drill`,{events:[{kind:"MATERIAL_REPRICE",targetObjectId:"cell_case",payload:{pctChange:v},effectiveDay:0}],horizonDays:30});
  const D=r.j?.data??r.j;
  const f=D?.finance;
  const cost=(f?.lines??[]).find(l=>l.role==="COST")?.delta;
  const margin=(f?.lines??[]).find(l=>l.role==="MARGIN")?.delta;
  deltas.push(cost);
  console.log(`  pctChange=${String(v).padStart(3)} ⇒ finance=${f?"有":"❌无"} available=${f?.available} · COST=${cost ?? "—"} · MARGIN=${margin ?? "—"}`);
  if(f?.unavailableReason) console.log(`     原因: ${String(f.unavailableReason).slice(0,110)}`);
}
console.log("");
console.log(`  COST delta：${deltas.join(" / ")}`);
if(deltas.every(x=>typeof x==="number"&&x!==0)){
  const r1=deltas[1]/deltas[0], r2=deltas[2]/deltas[1];
  console.log(`  比：30/3=${r1.toFixed(4)} · 300/30=${r2.toFixed(4)}  ${Math.abs(r1-10)<0.05&&Math.abs(r2-10)<0.05?"✅ 1:10:100":"⚠"}`);
}
