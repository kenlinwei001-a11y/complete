const AC = "http://127.0.0.1:4002";
const DEMO = "demo:admin:admin|planner|catalog_admin";
const t0 = Date.now(); const el = () => ((Date.now()-t0)/1000).toFixed(1);
const Q = "综合评估常州基地的运营韧性，结合设备、物料、订单三方面给出三条改进建议。";
const sub = await fetch(`${AC}/api/v1/queries`,{method:"POST",headers:{"content-type":"application/json","X-Debug-User":DEMO,"Idempotency-Key":"open-"+el()},body:JSON.stringify({packageId:"pkg_battery_manufacturing",query:Q,context:{view:"dashboard",filters:{},selectedObjects:[{objectType:"Base",objectId:"changzhou",label:"常州"}]}})});
const sj = await sub.json(); console.log(`[t+${el()}s] POST → ${sub.status} task=${sj.taskId}`);
const res = await fetch(`${AC}/api/v1/queries/${sj.taskId}/events`,{headers:{"X-Debug-User":DEMO}});
const rd = res.body.getReader(); const dec = new TextDecoder(); let buf="",first=null,n=0;
const dl = Date.now()+200000;
while(Date.now()<dl){ const {value,done}=await rd.read(); if(done){console.log(`[t+${el()}s] 流关闭`);break;} buf+=dec.decode(value,{stream:true}); const fr=buf.split("\n\n"); buf=fr.pop()??"";
 for(const f of fr){ const ev=(f.match(/event:\s*(.+)/)||[])[1]||""; const da=(f.match(/data:\s*([\s\S]+)/)||[])[1]||""; if(!ev)continue; n++; if(first==null){first=el();}
  if(/classif|route|answer\.final|task\.(completed|failed)|step\.(started|completed)|degrad|budget/i.test(ev)) console.log(`[t+${el()}s] ${ev} ${da.slice(0,110)}`);
  if(/task\.(completed|failed)|answer\.final/i.test(ev)){ console.log(`\n首帧:${first}s 总:${el()}s 事件:${n}`); try{const d=JSON.parse(da); console.log("trust:",d.trustLevel,"| 答案首句:",JSON.stringify((d.blocks||[]).find(b=>b.markdown)?.markdown||"").slice(0,200));}catch{} process.exit(0);} } }
console.log(`[t+${el()}s] 超时 事件=${n}`);
