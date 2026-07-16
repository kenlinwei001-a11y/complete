import fs from "node:fs";
const TOKEN = fs.readFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/token.txt","utf8").trim();
const BASE = "http://127.0.0.1:4025";
const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const get = async (p) => j(await fetch(BASE+p, { headers: H }));
const post = async (p, body) => j(await fetch(BASE+p, { method:"POST", headers: H, body: JSON.stringify(body??{}) }));

const vc = await get("/a/v1/sim/view-config");
function deriveBaseSnapshot(cfg){
  const state={}; const vars = cfg.stateVars.length>0?cfg.stateVars:["v"];
  for(const t of cfg.nodeTypes){
    const ids = cfg.nodeObjectIds?.[t] ?? [];
    const keys = ids.length>0?ids:[`${t}#0`];
    for(const oid of keys){ const real=cfg.nodeObjectState?.[oid]; const row={};
      for(const v of vars){ const rv=real?.[v]; row[v]=(typeof rv==="number"&&Number.isFinite(rv))?rv:0; } state[oid]=row; }
  }
  return state;
}
const baseSnapshot = deriveBaseSnapshot(vc);
const nonZero = Object.entries(baseSnapshot).filter(([,r])=>Object.values(r).some(x=>x!==0));
const byVar = {};
for(const [id,row] of nonZero){ for(const [v,val] of Object.entries(row)){ if(val!==0){ (byVar[v]??=[]).push([id,val]); } } }
console.log("=== Non-zero INITIAL state by stateVar ===");
for(const [v,arr] of Object.entries(byVar)) console.log(`  ${v}: ${arr.length} carriers, sample:`, JSON.stringify(arr.slice(0,3)));

const baseIds = (vc.nodeObjectIds?.Base ?? []);
const modelIds = (vc.nodeObjectIds?.Model ?? []);

const sess = await post("/a/v1/sim/sessions", { baseSnapshot });
const sid = sess.id;
console.log("\n=== session", sid, "status", sess.status);

const w0 = await get(`/a/v1/sim/sessions/${sid}/world`);
console.log("\n=== TICK 0: Base loadIndex ===");
for(const b of baseIds) console.log(`  ${b}:`, JSON.stringify(w0.state[b]));
console.log("=== TICK 0: Model (demandLoad/totalDemand) ===");
for(const m of modelIds) console.log(`  ${m}:`, JSON.stringify(w0.state[m]));

let lastTrace=null;
for(let i=0;i<3;i++){ const tr=await post(`/a/v1/sim/sessions/${sid}/tick`,{n:1}); lastTrace=tr.trace;
  console.log(`--- after tick ${tr.curTick}: trace ${Array.isArray(tr.trace)?tr.trace.length:0} events ---`); }

const w3 = await get(`/a/v1/sim/sessions/${sid}/world`);
console.log("\n=== TICK 3: Base loadIndex ===");
for(const b of baseIds) console.log(`  ${b}:`, JSON.stringify(w3.state[b]));
console.log("=== TICK 3: Model (demandLoad/totalDemand) ===");
for(const m of modelIds) console.log(`  ${m}:`, JSON.stringify(w3.state[m]));

console.log("\n=== CHANGES Base loadIndex (t0 -> t3) ===");
let anyChange=false;
for(const b of baseIds){ const a=(w0.state[b]||{}).loadIndex??0, z=(w3.state[b]||{}).loadIndex??0; if(a!==z){ anyChange=true; console.log(`  ${b}.loadIndex: ${a} -> ${z}  (delta ${z-a})`);} }
console.log("=== CHANGES Model demandLoad (t0 -> t3) ===");
for(const m of modelIds){ const a=(w0.state[m]||{}).demandLoad??0, z=(w3.state[m]||{}).demandLoad??0; if(a!==z){ anyChange=true; console.log(`  ${m}.demandLoad: ${a} -> ${z}  (delta ${z-a})`);} }
console.log("\n=== ANY CHANGE AT ALL:", anyChange, "===");

console.log("\n=== Sample of last-tick trace (first 10) ===");
if(Array.isArray(lastTrace)) for(const t of lastTrace.slice(0,10)) console.log("  ", JSON.stringify(t));
