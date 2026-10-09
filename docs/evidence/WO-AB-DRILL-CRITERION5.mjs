const DU="demo:admin:admin|planner|catalog_admin";
const api=async(m,p,b)=>{const r=await fetch("http://127.0.0.1:4052"+p,{method:m,headers:{"content-type":"application/json","x-debug-user":DU},...(b===undefined?{}:{body:JSON.stringify(b)})});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{s:r.status,j,t}};
const must=(r,w)=>{if(r.s>=400)throw new Error(w+":"+r.s);return r.j};
console.log("## 判据5：同事件三幅度 ⇒ 结论互不相同");
const fps=[], vals=[];
for (const v of [3,30,300]) {
  const s=must(await api("POST","/a/v1/sim/sessions",{}),"s"); const sid=s?.session?.id??s?.id;
  const r=await api("POST",`/a/v1/sim/sessions/${sid}/drill`,{events:[{kind:"MATERIAL_REPRICE",targetObjectId:"cell_case",payload:{pctChange:v},effectiveDay:0}],horizonDays:30});
  const D=r.j?.data??r.j;
  const f=D?.findings??[];
  const fp=JSON.stringify(f.map(x=>[x.key,x.when,Math.round((x.severity??0)*1e6)/1e6]));
  fps.push(fp);
  const E=D?.drillWorldId;
  const w=must(await api("GET",`/a/v1/sim/sessions/${E}/world`),"w");
  const ps=(w.state?.["obj_material_cell_case"]||{}).priceShock;
  vals.push(ps);
  console.log(`  pctChange=${String(v).padStart(3)} ⇒ 演习世界 priceShock=${ps} · findings=${f.length} · 指纹${fp.length}`);
}
console.log("");
console.log(`  priceShock 比：${vals[0]} : ${vals[1]} : ${vals[2]}  （预期 2+0.24 : 2+2.4 : 2+24）`);
console.log(`  3 vs 30  findings 同? ${fps[0]===fps[1]}`);
console.log(`  30 vs 300 findings 同? ${fps[1]===fps[2]}`);
console.log(`  ⇒ ${new Set(fps).size===3?"✅ 三者互不相同":"⚠ "+new Set(fps).size+" 种"}`);
