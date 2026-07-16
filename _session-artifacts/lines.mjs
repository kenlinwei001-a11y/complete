const H={'Content-Type':'application/json','X-Debug-User':'demo:admin:admin|planner|catalog_admin'};
async function q(objectType){const r=await fetch('http://127.0.0.1:4061/a/v1/objects/query',{method:'POST',headers:H,body:JSON.stringify({objectType,limit:1000})});return (await r.json()).data||[];}
const lines=await q('Line'), procs=await q('Process');
function byBase(arr,prop,agg){const m={};for(const o of arr){const b=o.props.baseId;const v=o.props[prop];if(typeof v!=='number')continue;(m[b]=m[b]||[]).push(v);}const out={};for(const b in m){const a=m[b];out[b]=agg==='sum'?a.reduce((x,y)=>x+y,0):a.reduce((x,y)=>x+y,0)/a.length;}return out;}
const util=byBase(lines,'utilization');
console.log('=== Line.utilization avg by base (CAP-02 task expects differentiated) ===');
const u=Object.entries(util).sort((a,b)=>a[1]-b[1]);
for(const [b,v] of u)console.log('  '+b.padEnd(12),v.toFixed(4));
console.log('  distinct:',new Set(u.map(x=>x[1].toFixed(4))).size,'/',u.length,'  min',u[0][1].toFixed(3),'max',u[u.length-1][1].toFixed(3),' spread',(u[u.length-1][1]-u[0][1]).toFixed(3));
// formation capacity (channels) per base — CAP-02 changed this
const chan=byBase(procs.filter(p=>String(p.props.processId||'').includes('formation')),'channels','sum');
console.log('\n=== formation channels sum by base (CAP-02 CAPACITY_MULT_BY_BASE target) ===');
const ch=Object.entries(chan).sort((a,b)=>a[1]-b[1]);
for(const [b,v] of ch)console.log('  '+b.padEnd(12),v);
if(ch.length)console.log('  distinct:',new Set(ch.map(x=>x[1])).size,'/',ch.length,' min',ch[0][1],'max',ch[ch.length-1][1],' ratio',(ch[ch.length-1][1]/ch[0][1]).toFixed(2)+'x');
// list process props keys
console.log('\n sample Process props:',JSON.stringify(procs[0]&&procs[0].props).slice(0,300));
