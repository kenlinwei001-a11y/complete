import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const H = { "X-Debug-User": "demo:usr_demo_admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4001/a/v1";
const j = async (p, opt) => { const r = await fetch(B+p, opt); if(!r.ok) throw new Error(p+" "+r.status); return r.json(); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const EV = "/home/user/complete/docs/evidence/";
const baseObjids = JSON.parse(readFileSync(EV+"demo-provenance-baseline-objids.json","utf8"));
const baseNoi = JSON.parse(readFileSync(EV+"demo-provenance-baseline-noi.json","utf8"));

// sanity: baseline objids == flatten(baseline noi)?
const baseNoiFlat = [...new Set(Object.values(baseNoi).flat())].sort();
const baseObjidsSorted = [...new Set(baseObjids)].sort();
const noiIsAllIds = JSON.stringify(baseNoiFlat)===JSON.stringify(baseObjidsSorted);
console.log("SANITY: flatten(baseNoi)="+baseNoiFlat.length+" baseObjids="+baseObjidsSorted.length+" identical="+noiIsAllIds);
if(!noiIsAllIds){ console.log("  noi misses:", baseObjidsSorted.filter(x=>!baseNoiFlat.includes(x)).slice(0,10)); console.log("  noi extra:", baseNoiFlat.filter(x=>!baseObjidsSorted.includes(x)).slice(0,10)); }

// live
const types = await j("/ontology/object-types", { headers: H });
const liveKeys = types.map(t=>t.key).sort();
console.log("\nTYPEKEYS SHA="+sha(JSON.stringify(liveKeys))+" (base cc787b32) match="+(sha(JSON.stringify(liveKeys)).startsWith("cc787b32")));

const vc = await j("/sim/view-config", { headers: H });
const noi = vc.nodeObjectIds;
const liveNoiKeys = Object.keys(noi).sort();
// per-type set compare
let mism=[]; const allK=new Set([...liveNoiKeys,...Object.keys(baseNoi)]);
for(const k of allK){ const a=(noi[k]??[]).slice().sort(), b=(baseNoi[k]??[]).slice().sort(); if(JSON.stringify(a)!==JSON.stringify(b)) mism.push({k,live:a.length,base:b.length,addEx:a.filter(x=>!b.includes(x)).slice(0,3),rmEx:b.filter(x=>!a.includes(x)).slice(0,3)}); }
console.log("\nNOI per-type: liveKeys="+liveNoiKeys.length+" mismatchTypes="+mism.length);
for(const m of mism.slice(0,40)) console.log("  ✗ "+m.k+" live="+m.live+" base="+m.base+" +"+JSON.stringify(m.addEx)+" -"+JSON.stringify(m.rmEx));

// obj ids = flatten live noi
const liveFlat=[...new Set(Object.values(noi).flat())].sort();
const addedIds=liveFlat.filter(x=>!baseObjidsSorted.includes(x)), removedIds=baseObjidsSorted.filter(x=>!liveFlat.includes(x));
console.log("\nOBJIDS(flatten noi): live="+liveFlat.length+" base="+baseObjidsSorted.length+" added="+addedIds.length+" removed="+removedIds.length);
if(addedIds.length) console.log("  + "+JSON.stringify(addedIds.slice(0,15)));
if(removedIds.length) console.log("  - "+JSON.stringify(removedIds.slice(0,15)));
console.log("OBJIDS SHA="+sha(JSON.stringify(liveFlat))+" (base 8277a5a7) match="+sha(JSON.stringify(liveFlat)).startsWith("8277a5a7"));
const noiSorted={}; for(const k of liveNoiKeys) noiSorted[k]=noi[k];
console.log("NOI SHA(keys-sorted)="+sha(JSON.stringify(noiSorted))+" (base a958632a) match="+sha(JSON.stringify(noiSorted)).startsWith("a958632a"));
