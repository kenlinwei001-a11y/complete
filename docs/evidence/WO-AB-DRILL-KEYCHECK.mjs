const DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch("http://127.0.0.1:4052"+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
for (const tgt of ["2170 三元圆柱","2170-NCM"]) {
  const r=await api("POST","/a/v1/sim/sessions/sims_demo_seed_world/drill",{events:[{kind:"FORECAST_BIAS",targetObjectId:tgt,payload:{biasPct:20},effectiveDay:0}],horizonDays:30});
  const D=r.j?.data??r.j;
  const runs=(D?.solverRuns??[]).map(x=>`${x.solverKey}:${x.ok?"ok":"FAIL"}`).join(" ");
  const aes=D?.appliedStateEffects??[];
  const f=D?.finance;
  const cost=(f?.lines??[]).find(l=>l.role==="COST");
  console.log(`target="${tgt}"`);
  console.log(`  solverRuns = ${runs}`);
  console.log(`  appliedStateEffects = ${aes.length}${aes[0]?" ⇒ "+JSON.stringify({applied:aes[0].applied,var:aes[0].targetStateVar,downstream:aes[0].downstream}):""}`);
  console.log(`  finance: available=${f?.available} COST.delta=${cost?.delta ?? "—"}`);
  const miss=D?.stateEffectMisses; if (miss?.length) console.log(`  stateEffectMisses = ${JSON.stringify(miss).slice(0,300)}`);
  const failed=(D?.solverRuns??[]).filter(x=>!x.ok).map(x=>`${x.solverKey}: ${String(x.error??"").slice(0,140)}`);
  for (const f2 of failed) console.log(`  ✗ ${f2}`);
}
