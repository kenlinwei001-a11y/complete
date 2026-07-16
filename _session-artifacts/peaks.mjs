const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
const BASES=['常州','成都','邯郸','合肥','江门','洛阳','眉山','武汉','厦门','信阳','枣庄','自贡'];
async function inv(base,factor){const r=await fetch('http://127.0.0.1:4061/a/v1/solvers/risk_timeline/invoke',{method:'POST',headers:H,body:JSON.stringify({args:{base,factor}})});return (await r.json()).data.cards[0];}
console.log('=== 瓶颈工序 (LIVE demand-driven) peak per base — does any cross 85? ===');
let maxPeak=0,redCount=0;
for(const b of BASES){const c=await inv(b,'瓶颈工序');const peak=c.peak;maxPeak=Math.max(maxPeak,peak);const red=peak>=85;if(red)redCount++;console.log(`  ${b.padEnd(6)} dm=${c.dataMode} curT=${c.currentTightness.value} peak=${peak} cross=${c.crossDay} ${red?'*** peak>=85':''}`);}
console.log('  => max peak across all 12:',maxPeak,' bases with LIVE peak>=85:',redCount);
