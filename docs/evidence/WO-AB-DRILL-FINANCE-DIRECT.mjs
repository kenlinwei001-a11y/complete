const DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch("http://127.0.0.1:4052"+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
// 1) UI 同会话（sims_demo_seed_world），targetObjectId 用 UI 的 select 值（对象 id）
for (const mag of [300, 300, 3]) {
  const t0=Date.now();
  const r=await api("POST","/a/v1/sim/sessions/sims_demo_seed_world/drill",{events:[{kind:"MATERIAL_REPRICE",targetObjectId:"obj_material_cell_case",payload:{pctChange:mag},effectiveDay:0}],horizonDays:30});
  const D=r.j?.data??r.j;
  const f=D?.finance;
  const cost=(f?.lines??[]).find(l=>l.role==="COST");
  console.log(`mag=${String(mag).padEnd(4)} HTTP=${r.s} 耗时=${((Date.now()-t0)/1000).toFixed(1)}s finance=${f?"有":"❌无"} available=${f?.available} COST.delta=${cost?.delta ?? "—"} raw=${cost?JSON.stringify(cost):"—"}`);
  if (r.s>=400) console.log("  body:", r.t.slice(0,300));
}
