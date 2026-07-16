const BASE='http://127.0.0.1:4104';
const HDR={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
const query=process.argv[2]||'4680-NCM 加 20% 六周插进来能不能接·会挤占哪些单·有哪些方案？';
const body={query};
if(process.argv[3]) body.selectedObjects=JSON.parse(process.argv[3]);
const r=await fetch(BASE+'/api/v1/queries',{method:'POST',headers:HDR,body:JSON.stringify(body)});
const j=await r.json();
console.log('submit status',r.status,'taskId',j.taskId,'streamUrl',j.streamUrl);
const tid=j.taskId;
// poll terminal
const TERM=new Set(['COMPLETED','FAILED','CANCELLED','CLARIFYING','AWAITING_INPUT','NEEDS_CLARIFICATION']);
let task;
for(let i=0;i<120;i++){
  await new Promise(r=>setTimeout(r,500));
  const tr=await fetch(BASE+'/api/v1/queries/'+tid,{headers:HDR});
  task=await tr.json();
  if(task && TERM.has(task.status)) break;
  if(i%10===0) console.log('  poll',i,'status',task&&task.status,'path',task&&task.path);
}
console.log('FINAL status',task.status,'path',task.path,'classification',JSON.stringify(task.classification||task.intent||{}).slice(0,200));
console.log('---slots/args---', JSON.stringify(task.slots||task.slotValues||{}).slice(0,300));
// dump answer / result
const ans=task.answer||task.result||task.finalAnswer;
console.log('---ANSWER keys---', ans?Object.keys(ans):'NONE');
console.log(JSON.stringify(ans,null,1)?.slice(0,3000));
