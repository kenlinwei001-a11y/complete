const BASES=[['常州','changzhou',0.83],['成都','chengdu',0.72],['邯郸','handan',0.89],['合肥','hefei',0.62],['江门','jiangmen',0.8],['洛阳','luoyang',0.9],['眉山','meishan',0.79],['武汉','wuhan',0.88],['厦门','xiamen',0.85],['信阳','xinyang',0.64],['枣庄','zaozhuang',0.71],['自贡','zigong',0.68]];
const FACTORS=['设备OEE','良率波动','瓶颈工序','物料齐套','人力工时'];
const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
async function inv(args){
  const r=await fetch('http://127.0.0.1:4061/a/v1/solvers/risk_timeline/invoke',{method:'POST',headers:H,body:JSON.stringify({args})});
  const j=await r.json(); return (j.data&&j.data.cards)?j.data.cards[0]:null;
}
const THRESH=85;
const rows=[];
let decisionRed=0, greenBases=0;
for(const [zh,id,util] of BASES){
  const per={};
  for(const f of FACTORS){
    const c=await inv({base:zh,factor:f});
    if(c) per[f]={dm:c.dataMode,t:c.currentTightness&&c.currentTightness.value,cross:c.crossDay,gap:c.demandGap?c.demandGap.gapWan:null};
    else per[f]={dm:'ERR',t:null};
  }
  // representative = highest LIVE-source tightness (dataMode==LIVE & hasData)
  let best=null;
  for(const f of FACTORS){const p=per[f]; if(p.dm==='LIVE'&&p.t!=null){if(best===null||p.t>best.t)best={f,t:p.t,dm:p.dm};}}
  const isRed=best&&best.t>=THRESH;
  if(isRed)decisionRed++; else greenBases++;
  rows.push({zh,util,per,best,isRed});
  console.log(`\n=== ${zh}(${id}) util=${util} ===`);
  for(const f of FACTORS){const p=per[f];console.log(`  ${f.padEnd(8)} dm=${String(p.dm).padEnd(9)} tight=${String(p.t).padEnd(5)} cross=${p.cross} gap=${p.gap}`);}
  console.log(`  => REP: ${best?best.f+' t='+best.t+' ('+best.dm+')':'none-LIVE'}  ${isRed?'*** DECISION-RED':'green/no-red'}`);
}
console.log('\n########## SUMMARY ##########');
console.log('DECISION-RED bases (rep LIVE tightness>=85):',decisionRed,'/ 12');
console.log('non-red bases:',greenBases,'/ 12');
// OEE/yield differentiation check
const oeeVals=rows.map(r=>r.per['设备OEE'].t);
const yldVals=rows.map(r=>r.per['良率波动'].t);
const oeeModes=[...new Set(rows.map(r=>r.per['设备OEE'].dm))];
const yldModes=[...new Set(rows.map(r=>r.per['良率波动'].dm))];
console.log('\n设备OEE tightness across 12 bases:',oeeVals.join(','),' distinct:',[...new Set(oeeVals)].length,' dataMode(s):',oeeModes.join(','));
console.log('良率波动 tightness across 12 bases:',yldVals.join(','),' distinct:',[...new Set(yldVals)].length,' dataMode(s):',yldModes.join(','));
import('fs').then(fs=>fs.writeFileSync('/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/sweep_on.json',JSON.stringify(rows,null,1)));
