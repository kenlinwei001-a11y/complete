const DC = "http://127.0.0.1:4001", AC = "http://127.0.0.1:4102";
const PKG = "pkg_battery_manufacturing";
async function login(t,u,p){const r=await fetch(`${DC}/a/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenantId:t,username:u,password:p})});return (await r.json()).accessToken;}
async function submit(jwt,query){const r=await fetch(`${AC}/api/v1/queries`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify({packageId:PKG,query,context:{view:"dash",selectedObjects:[],filters:{}}})});return {status:r.status, body: await r.json().catch(()=>null)};}
async function getTask(jwt,id){const r=await fetch(`${AC}/b/v1/queries/${id}`,{headers:{authorization:`Bearer ${jwt}`}});return await r.json().catch(()=>null);}
async function clarify(jwt,id,body){const r=await fetch(`${AC}/api/v1/queries/${id}/clarification`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify(body)});return {status:r.status, body: await r.json().catch(()=>null)};}
async function preAnalysis(jwt,id){const r=await fetch(`${AC}/b/v1/growth/pre-analysis/${id}`,{headers:{authorization:`Bearer ${jwt}`}});return {status:r.status, body: await r.json().catch(()=>null)};}
function sevCounts(rep){const c={};for(const e of rep?.gapAnalysis?.entries??[])for(const it of e.items)if(it.severity&&it.status!=="EXISTS")c[it.severity]=(c[it.severity]??0)+1;return c;}
function gapBlock(task){const ans=task?.answer;const blocks=ans?.blocks??[];return blocks.find(b=>b.type==="gap"||b.kind==="gap");}
const TERMINAL=new Set(["COMPLETED","FAILED","CANCELLED"]);
async function pollTask(jwt,id,handleClar){
  for(let i=0;i<50;i++){
    const t=await getTask(jwt,id);
    if(!t){await new Promise(r=>setTimeout(r,400));continue;}
    if(TERMINAL.has(t.status))return t;
    if((t.status==="AWAITING_CLARIFICATION"||t.status==="NEEDS_CLARIFICATION")&&handleClar){await handleClar(id);handleClar=null;}
    await new Promise(r=>setTimeout(r,400));
  }
  return await getTask(jwt,id);
}
async function pollPre(jwt,id){for(let i=0;i<40;i++){const {status,body}=await preAnalysis(jwt,id);if(status===200&&body&&(body.status==="DONE"||body.status==="FAILED"))return {status,body};await new Promise(r=>setTimeout(r,400));}return await preAnalysis(jwt,id);}

const jwt=await login("demo","admin","demo1234");
const queries = [
  {q:"帮我写一首关于电池的诗", clar:null},
  {q:"今天中午吃什么比较好", clar:null},
  {q:"分析武汉基地2099年12月的瓶颈根因", clar:"none"},
  {q:"常州基地的瓶颈根因是什么", clar:"none"},
  {q:"常州基地的瓶颈根因是什么", clar:"slot"},
];
for(const {q,clar} of queries){
  const s=await submit(jwt,q);
  const id=s.body?.taskId;
  console.log(`\nQ="${q}" [clar=${clar}] submit=${s.status} taskId=${id}`);
  if(!id){console.log("  NO TASKID:",JSON.stringify(s.body));continue;}
  const handleClar = clar ? async(tid)=>{
    if(clar==="none"){const c=await clarify(jwt,tid,{kind:"SLOT_FILLING",none:true});console.log(`  clar(none) -> ${c.status}`);}
    else {const c=await clarify(jwt,tid,{kind:"SLOT_FILLING",slotValues:{base:"常州",baseId:"常州",time:"2026-06",month:"2026-06",timeWindow:"2026-06"}});console.log(`  clar(slot) -> ${c.status}`);}
  } : null;
  const t=await pollTask(jwt,id,handleClar);
  const gb=gapBlock(t);
  console.log(`  task.status=${t?.status} path=${t?.path} hasGapBlock=${!!gb}` + (gb?` gapBlock.taskId=${gb.report?.taskId} findings=${(gb.report?.findings||[]).map(f=>f.gapCode).join(",")}`:""));
  const pre=await pollPre(jwt,id);
  if(pre.status!==200){console.log(`  pre-analysis HTTP ${pre.status}`);}
  else console.log(`  pre-analysis: status=${pre.body.status} totalGaps=${pre.body.summary?.totalGaps} coverageScore=${pre.body.summary?.coverageScore} sevCounts=${JSON.stringify(sevCounts(pre.body))}`);
  console.log(`  >>> PANORAMA VISIBLE? ${!!gb} (needs gap block) | HAS BADGES? ${(pre.body?.summary?.totalGaps??0)>0}`);
  await new Promise(r=>setTimeout(r,800));
}
