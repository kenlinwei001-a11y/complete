const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
const B='http://127.0.0.1:4061';
async function j(url,opt){const r=await fetch(B+url,opt);let d;try{d=await r.json()}catch(e){d={__raw:await r.text()}}return{status:r.status,d};}
async function autoRed(label){
  const {d}=await j('/a/v1/solvers/risk_timeline/invoke',{method:'POST',headers:H,body:JSON.stringify({args:{}})});
  const data=d.data; const th=data.threshold; const topLive=!(data.dataMode!=null&&data.dataMode!=='LIVE');
  const cdm=c=>{if(c.hasData===false)return'MUTED';if(c.dataMode==='LIVE')return'LIVE';if(c.dataMode==null)return topLive?'LIVE':'MUTED';return'MUTED';};
  const live=data.cards.filter(c=>cdm(c)==='LIVE');
  const red=live.filter(c=>c.peak>=th);
  console.log(`[${label}] red=${red.length}/${data.cards.length}  reps:`,data.cards.map(c=>`${c.base}:${c.currentTightness&&c.currentTightness.value}/pk${c.peak}${cdm(c)==='LIVE'&&c.peak>=th?'R':''}`).join(' '));
  return red.length;
}
// current DemandSegments
const {d:segs}=await j('/a/v1/objects/query',{method:'POST',headers:H,body:JSON.stringify({objectType:'DemandSegment',limit:10})});
const segList=segs.data||[];
console.log('DemandSegments:',segList.map(s=>s.id+' p50='+s.props.p50).join(' | '));
const before=await autoRed('BEFORE inject');
// Inject: raise each DemandSegment p50/p90 hugely via Action "对象数据变更"
for(const s of segList){
  const {status,d:draft}=await j('/a/v1/action-drafts',{method:'POST',headers:H,body:JSON.stringify({actionTypeKey:'对象数据变更',payload:{objectId:s.id,patch:{p50:(s.props.p50||0)*6,p90:(s.props.p50||0)*6},reason:"审核方敏感性测试:抬高真需求预测"},submit:true})});
  if(status!==201){console.log('  draft create FAILED',status,JSON.stringify(draft).slice(0,200));continue;}
  const id=draft.draftId||draft.draft&&draft.draft.id;
  const {status:as,d:ap}=await j(`/a/v1/action-drafts/${id}/approve`,{method:'POST',headers:H,body:JSON.stringify({comment:'sensitivity test'})});
  console.log(`  ${s.id}: draft=${id} approve=${as} status=${ap.status||JSON.stringify(ap).slice(0,80)}`);
}
const after=await autoRed('AFTER inject (demand x6)');
console.log(`\n########## SENSITIVITY VERDICT ##########`);
console.log(`decision-red BEFORE=${before}  AFTER demand injection=${after}  => red responds to real demand: ${after>before}`);
