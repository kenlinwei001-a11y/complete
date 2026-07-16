const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
async function auto(){const r=await fetch('http://127.0.0.1:4061/a/v1/solvers/risk_timeline/invoke',{method:'POST',headers:H,body:JSON.stringify({args:{}})});return (await r.json()).data;}
async function setFeat(v){const r=await fetch('http://127.0.0.1:4061/a/v1/tenants/demo/features',{method:'PUT',headers:H,body:JSON.stringify({overrides:{'qos.risk_realdemand':v}})});return r.status;}
function summ(d,label){
  const th=d.threshold; const topLive=!(d.dataMode!=null&&d.dataMode!=='LIVE');
  const cdm=c=>{if(c.hasData===false)return'MUTED';if(c.dataMode==='LIVE')return'LIVE';if(c.dataMode==null)return topLive?'LIVE':'MUTED';return'MUTED';};
  const live=d.cards.filter(c=>cdm(c)==='LIVE');
  const red=live.filter(c=>c.peak!=null&&c.peak>=th).length;
  console.log(`\n[${label}] top dataMode=${d.dataMode} cards=${d.cards.length} LIVE=${live.length} DECISION-RED(LIVE&peak>=${th})=${red}`);
  for(const c of d.cards)console.log(`   ${c.base.padEnd(6)} ${c.factor.padEnd(8)} dm=${String(c.dataMode).padEnd(9)} decMode=${cdm(c).padEnd(5)} curT=${c.currentTightness&&c.currentTightness.value} peak=${c.peak} ${cdm(c)==='LIVE'&&c.peak>=th?'*RED*':''}`);
  return red;
}
// state 1: current (ON)
const onRed=summ(await auto(),'CURRENT DEFAULT (realDemand ON)');
// R6 determinism: two identical calls
const a=JSON.stringify((await auto()).cards), b=JSON.stringify((await auto()).cards);
console.log('\n[R6] two identical ON calls byte-identical:',a===b);
// state 2: OFF (rollback)
console.log('\n--- PUT qos.risk_realdemand=false ---',await setFeat(false));
const offRed=summ(await auto(),'ROLLBACK (realDemand OFF = 现行)');
// restore
console.log('\n--- restore qos.risk_realdemand=true ---',await setFeat(true));
const backRed=summ(await auto(),'RESTORED (realDemand ON again)');
console.log('\n########## ROLLBACK VERDICT ##########');
console.log('ON decision-red:',onRed,'  OFF decision-red:',offRed,'  RESTORED:',backRed);
console.log('=> feature toggle changes red:',onRed!==offRed,' | restore returns to ON state:',onRed===backRed);
