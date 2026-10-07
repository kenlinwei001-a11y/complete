#!/usr/bin/env node
/** 追 ③/② = 0.070617 vs 系数 0.2775 的 3.93 倍差：读逐拍 trace + 逐拍值。 */
const B=process.env.BASE||"http://127.0.0.1:4052";
const DU="demo:admin:admin|planner|catalog_admin";
const OID="obj_order_SO-3391", MID="obj_model_4680-NCM";
const api=async(m,p,b)=>{const r=await fetch(`${B}${p}`,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(`${w}: ${r.s}`);return r.j};
const f=(v,d=9)=>(typeof v==="number"&&Number.isFinite(v)?v.toFixed(d):String(v??"—"));

const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const id=s?.session?.id??s?.id;
await api("POST",`/a/v1/sim/sessions/${id}/perturbations`,{kind:"supply_disruption",targetObjectId:OID,targetStateVar:"leadDays",mode:"delta",magnitude:-3,startTick:0,durationTicks:null,label:"ratio"});
const rows=[];
for(let t=0;t<=10;t++){
  const w=must(await api("GET",`/a/v1/sim/sessions/${id}/world`),"w");
  const st=w?.state??{};
  rows.push({t, ld:st?.[OID]?.leadDays, mcp:st?.[MID]?.costPressure, ocp:st?.[OID]?.costPressure});
  if(t<10) must(await api("POST",`/a/v1/sim/sessions/${id}/tick`,{n:1}),"tick");
}
const g=must(await api("GET",`/a/v1/causal-graphs/sim/${id}`),"graph");
const sums={};
for(const e of (g?.edges??[])){
  const to=String(e?.toNodeId??"");
  const amt=e?.amount;
  if(typeof amt!=="number") continue;
  for(const [nm,pat] of [["→Model",MID+".costPressure"],["→Order",OID+".costPressure"]]){
    if(to.includes(pat)){ (sums[nm] ??= {n:0,sum:0,byTick:{}}); sums[nm].n++; sums[nm].sum+=amt;
      const tk=(to.match(/@t(\d+)/)||[])[1]; if(tk){ (sums[nm].byTick[tk] ??= 0); sums[nm].byTick[tk]+=amt; } }
  }
}
console.log("## 逐拍：②Model / ③Order 与逐拍搬运量");
console.log("t | leadDays | ②Model.costPressure | Δ② | ③Order.costPressure | Δ③ | trace→② | trace→③ | ③增量/②增量 | trace③/②");
for(let i=0;i<rows.length;i++){
  const r=rows[i], p=rows[i-1];
  const d2=p&&r.mcp!=null&&p.mcp!=null?r.mcp-p.mcp:null;
  const d3=p&&r.ocp!=null&&p.ocp!=null?r.ocp-p.ocp:null;
  const a2=sums["→Model"]?.byTick?.[String(r.t)];
  const a3=sums["→Order"]?.byTick?.[String(r.t)];
  console.log([r.t, f(r.ld,2), f(r.mcp), f(d2), f(r.ocp), f(d3), f(a2), f(a3),
    (d2&&d3)?f(d3/d2,6):"—", (a3!=null&&r.mcp)?f(a3/r.mcp,6):"—"].join(" | "));
}
console.log("");
console.log(`Σtrace→② = ${f(sums["→Model"]?.sum)}   Σtrace→③ = ${f(sums["→Order"]?.sum)}`);
console.log(`末拍 ②=${f(rows.at(-1).mcp)}  ③=${f(rows.at(-1).ocp)}   ③/② = ${f(rows.at(-1).ocp/rows.at(-1).mcp,6)}`);
console.log(`已知：该边系数 = 0.2775   ⇒ ③/② 实测 / 0.2775 = ${f((rows.at(-1).ocp/rows.at(-1).mcp)/0.2775,6)}`);
console.log(`DONE ${new Date().toISOString()}`);
