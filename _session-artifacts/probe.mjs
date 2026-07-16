import fs from "node:fs";
const TOKEN = fs.readFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/token.txt","utf8").trim();
const BASE = "http://127.0.0.1:4025";
const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const get = async (p) => j(await fetch(BASE+p, { headers: H }));
const post = async (p, body) => j(await fetch(BASE+p, { method:"POST", headers: H, body: JSON.stringify(body??{}) }));

const out = {};

// 1. view-config (drives frontend baseSnapshot)
const vc = await get("/a/v1/sim/view-config");
out.viewConfig = {
  nodeTypes: vc.nodeTypes,
  stateVars: vc.stateVars,
  propagationCount: vc.propagationCount,
  heatThreshold: vc.heatThreshold,
  nodeObjectIds_counts: vc.nodeObjectIds ? Object.fromEntries(Object.entries(vc.nodeObjectIds).map(([k,v])=>[k,Array.isArray(v)?v.length:v])) : null,
  nodeObjectState_keyCount: vc.nodeObjectState ? Object.keys(vc.nodeObjectState).length : 0,
  nodeObjectState_sample: vc.nodeObjectState ? Object.fromEntries(Object.entries(vc.nodeObjectState).slice(0,5)) : null,
};

// 2. published propagation rules
const pr = await get("/a/v1/sim/propagation-rules");
out.propagationRules = { count: Array.isArray(pr?.items)?pr.items.length:(Array.isArray(pr)?pr.length:JSON.stringify(pr).slice(0,200)), items: (pr.items??pr) };

// 3. Build baseSnapshot like the frontend deriveBaseSnapshot
function deriveBaseSnapshot(cfg){
  const state={}; const vars = cfg.stateVars.length>0?cfg.stateVars:["v"];
  for(const t of cfg.nodeTypes){
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length>0?ids:[`${t}#0`];
    for(const oid of keys){
      const real = cfg.nodeObjectState?.[oid];
      const row={};
      for(const v of vars){ const rv=real?.[v]; row[v]= (typeof rv==="number"&&Number.isFinite(rv))?rv:0; }
      state[oid]=row;
    }
  }
  return state;
}
const baseSnapshot = deriveBaseSnapshot(vc);
out.baseSnapshot_stats = {
  objectCount: Object.keys(baseSnapshot).length,
  nonZeroObjects: Object.entries(baseSnapshot).filter(([,row])=>Object.values(row).some(x=>x!==0)).length,
  sample: Object.fromEntries(Object.entries(baseSnapshot).slice(0,6)),
};

// 4. Create session WITH baseSnapshot (as frontend does)
const sess = await post("/a/v1/sim/sessions", { baseSnapshot });
out.session = { id: sess.id, status: sess.status, curTick: sess.curTick, baseKeys: Object.keys(sess.baseSnapshot??{}).length };
const sid = sess.id;

// 5. Certification (GLOBAL) — full dump
const cert = await get(`/a/v1/sim/sessions/${sid}/certification`);
out.certification = cert;

// 6. World state at tick 0
const w0 = await get(`/a/v1/sim/sessions/${sid}/world`);
// pick some Base objects to track
const baseIds = Object.keys(w0.state||{}).filter(k=>k.toLowerCase().startsWith("base")).slice(0,3);
const sampleIds = Object.keys(w0.state||{}).slice(0,4);
const track = [...new Set([...baseIds, ...sampleIds])];
out.tick0 = { curTick: w0.tick, objectCount: Object.keys(w0.state||{}).length, tracked: Object.fromEntries(track.map(k=>[k,w0.state[k]])) };

// 7. Tick x3
const tickResults = [];
for(let i=0;i<3;i++){
  const tr = await post(`/a/v1/sim/sessions/${sid}/tick`, { n: 1 });
  tickResults.push({ curTick: tr.curTick, hasTrace: tr.trace!=null, traceLen: Array.isArray(tr.trace)?tr.trace.length:null });
}
out.ticks = tickResults;

// 8. World after 3 ticks
const w3 = await get(`/a/v1/sim/sessions/${sid}/world`);
out.tick3 = { curTick: w3.tick, tracked: Object.fromEntries(track.map(k=>[k,w3.state[k]])) };

// 9. diff tracked
out.diff = track.map(k=>{
  const a=w0.state[k]||{}, b=w3.state[k]||{};
  const vars=[...new Set([...Object.keys(a),...Object.keys(b)])];
  const changed = vars.filter(v=>(a[v]??0)!==(b[v]??0));
  return { id:k, changedVars: changed, before: a, after: b };
});

fs.writeFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/probe-out.json", JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
