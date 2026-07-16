const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
async function q(objectType){const r=await fetch('http://127.0.0.1:4061/a/v1/objects/query',{method:'POST',headers:H,body:JSON.stringify({objectType,limit:1000})});return (await r.json()).data||[];}
const eq=await q('Equipment'), pr=await q('Process');
// group oee_current by base (avg)
function byBase(arr,prop){const m={};for(const o of arr){const b=o.props.baseId;const v=o.props[prop];if(typeof v!=='number')continue;(m[b]=m[b]||[]).push(v);}const out={};for(const b in m)out[b]=(m[b].reduce((a,x)=>a+x,0)/m[b].length);return out;}
const oee=byBase(eq,'oee_current'), yld=byBase(pr,'yield_baseline');
console.log('Equipment count:',eq.length,' Process count:',pr.length);
console.log('\n=== Equipment.oee_current avg by base (source of 设备OEE) ===');
const ob=Object.entries(oee).sort((a,b)=>a[1]-b[1]);
for(const [b,v] of ob)console.log('  '+b.padEnd(12),v.toFixed(5));
console.log('  distinct oee bases:',new Set(ob.map(x=>x[1].toFixed(5))).size,'/',ob.length,' min',ob[0][1].toFixed(4),'max',ob[ob.length-1][1].toFixed(4));
console.log('\n=== Process.yield_baseline avg by base (source of 良率波动) ===');
const yb=Object.entries(yld).sort((a,b)=>a[1]-b[1]);
for(const [b,v] of yb)console.log('  '+b.padEnd(12),v.toFixed(5));
console.log('  distinct yld bases:',new Set(yb.map(x=>x[1].toFixed(5))).size,'/',yb.length,' min',yb[0][1].toFixed(4),'max',yb[yb.length-1][1].toFixed(4));
