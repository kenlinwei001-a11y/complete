const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
async function auto(){const r=await fetch('http://127.0.0.1:4061/a/v1/solvers/risk_timeline/invoke',{method:'POST',headers:H,body:JSON.stringify({args:{}})});return (await r.json()).data;}
const d=await auto();
const threshold=d.threshold, bandWidth=8; // frontend default bandWidth (approx)
// exact frontend cardDecisionMode
const topLive = !(d.dataMode!=null&&d.dataMode!=='LIVE');
function cardDecisionMode(c){ if(c.hasData===false)return 'MUTED'; if(c.dataMode==='LIVE')return 'LIVE'; if(c.dataMode==null)return topLive?'LIVE':'MUTED'; return 'MUTED'; }
const liveCards=d.cards.filter(c=>cardDecisionMode(c)==='LIVE');
const summaryRed=liveCards.filter(c=>c.peak!=null&&c.peak>=threshold).length;
const summaryYellow=liveCards.filter(c=>c.peak!=null&&c.peak>=threshold-bandWidth&&c.peak<threshold).length;
console.log('top dataMode:',d.dataMode,' threshold:',threshold,' cards shown:',d.cards.length,' (maxCards limits)');
console.log('\n=== each shown card (browser renders these) ===');
for(const c of d.cards){
  const m=cardDecisionMode(c);
  const red=m==='LIVE'&&c.peak!=null&&c.peak>=threshold;
  const yellow=m==='LIVE'&&c.peak!=null&&c.peak>=threshold-bandWidth&&c.peak<threshold;
  console.log(`  ${c.base.padEnd(6)} ${c.factor.padEnd(8)} dm=${String(c.dataMode).padEnd(9)} decMode=${m.padEnd(5)} curT=${c.currentTightness&&c.currentTightness.value} peak=${c.peak} cross=${c.crossDay} ${red?'*** RED':yellow?'~ YELLOW':''}`);
}
console.log('\n=== FRONTEND SUMMARY (exact RiskBoardView logic) ===');
console.log('LIVE decision cards:',liveCards.length,'/',d.cards.length,' shown');
console.log('summaryRed (LIVE & peak>=85):',summaryRed);
console.log('summaryYellow (LIVE & 77<=peak<85):',summaryYellow);
console.log('MUTED cards (SYNTHETIC/no-data):',d.cards.length-liveCards.length);
