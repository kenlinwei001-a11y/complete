const H = { 'X-Debug-User': 'demo:admin:admin|planner|catalog_admin' };
const A = 'sims_sf48jzjfav20a30w';   // main (advanced to 7 in browser)
const B = 'sims_4s66xh2hjgaryhy7';   // branch child
const base = 'http://127.0.0.1:4051';

function tickMean(state){
  let sum=0,cnt=0;
  for(const o of Object.keys(state)){ for(const v of Object.values(state[o]||{})){ sum+=v; cnt++; } }
  return cnt===0?0:sum/cnt;
}

(async()=>{
  // 1) backend session world (curTick oracle for CAP-04 real-backend)
  const w = await (await fetch(`${base}/a/v1/sim/sessions/${A}/world`,{headers:H})).json();
  console.log('ORACLE world(A).tick =', w.tick, '(expect 7 → proves backend advanced, not just FE state)');

  // 2) compare endpoint (CAP-05 value oracle)
  const cmp = await (await fetch(`${base}/a/v1/sim/compare?a=${A}&b=${B}`,{headers:H})).json();
  console.log('ORACLE A series ticks =', cmp.a.map(s=>s.tick).join(','));
  console.log('ORACLE B series ticks =', cmp.b.map(s=>s.tick).join(','));
  console.log('--- backend-computed tickMean (must equal DOM A/B) ---');
  for(const s of cmp.a){ console.log(`A tick${s.tick} mean = ${tickMean(s.state).toFixed(1)}`); }
  for(const s of cmp.b){ console.log(`B tick${s.tick} mean = ${tickMean(s.state).toFixed(1)}`); }
  const a0=tickMean(cmp.a.find(s=>s.tick===0).state);
  const a7=tickMean(cmp.a.find(s=>s.tick===7).state);
  const b0=tickMean(cmp.b.find(s=>s.tick===0).state);
  console.log('--- cross-check vs DOM ---');
  console.log(`DOM A tick0=3339.5 vs backend ${a0.toFixed(1)} → ${Math.abs(a0-3339.5)<0.1?'MATCH':'MISMATCH'}`);
  console.log(`DOM A tick7=47283.7 vs backend ${a7.toFixed(1)} → ${Math.abs(a7-47283.7)<0.1?'MATCH':'MISMATCH'}`);
  console.log(`DOM B tick0=47283.7 vs backend ${b0.toFixed(1)} → ${Math.abs(b0-47283.7)<0.1?'MATCH':'MISMATCH'}`);
  console.log(`DOM diff tick0=+43944.1 vs backend ${(b0-a0).toFixed(1)} → ${Math.abs((b0-a0)-43944.1)<0.2?'MATCH':'MISMATCH'}`);
  console.log(`Consistency: B.tick0 == A.tick7 (branch@tick7 checkpoint) → ${Math.abs(b0-a7)<0.1?'YES':'NO'}`);
})().catch(e=>console.error('ORA-ERR',e));
