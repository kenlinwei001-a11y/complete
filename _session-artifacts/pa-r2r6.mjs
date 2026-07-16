const DC="http://127.0.0.1:4001", AC="http://127.0.0.1:4102", PKG="pkg_battery_manufacturing";
async function login(t,u,p){const r=await fetch(`${DC}/a/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenantId:t,username:u,password:p})});return (await r.json()).accessToken;}
async function submit(jwt,query){const r=await fetch(`${AC}/api/v1/queries`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify({packageId:PKG,query,context:{view:"dash",selectedObjects:[],filters:{}}})});return (await r.json()).taskId;}
async function preRaw(headers,id){const r=await fetch(`${AC}/b/v1/growth/pre-analysis/${id}`,{headers});return {status:r.status, body: await r.json().catch(()=>null)};}
async function pollPre(jwt,id){for(let i=0;i<40;i++){const {status,body}=await preRaw({authorization:`Bearer ${jwt}`},id);if(status===200&&body&&body.status==="DONE")return body;await new Promise(r=>setTimeout(r,400));}return null;}
const jwt=await login("demo","admin","demo1234");

// ---- R6: same query double-run, byte-identical (minus generatedAt) ----
console.log("=== R6: byte-identical double-run ===");
const q="常州基地的瓶颈根因是什么";
const idA=await submit(jwt,q); const repA=await pollPre(jwt,idA);
await new Promise(r=>setTimeout(r,600));
const idB=await submit(jwt,q); const repB=await pollPre(jwt,idB);
console.log("taskA:",idA,"taskB:",idB);
function normalize(rep){
  // strip volatile: taskId, createdAt, generatedAt (per-run injected clock)
  const ga=JSON.parse(JSON.stringify(rep.gapAnalysis));
  const strip=(o)=>{if(o&&typeof o==="object"){delete o.generatedAt;for(const k of Object.keys(o))strip(o[k]);}};
  strip(ga);
  return JSON.stringify({gapAnalysis:ga, summary:rep.summary, query:rep.query, status:rep.status});
}
const nA=normalize(repA), nB=normalize(repB);
console.log("R6 byte-identical (gapAnalysis[-generatedAt]+summary+query+status):", nA===nB);
if(nA!==nB){for(let i=0;i<Math.max(nA.length,nB.length);i++){if(nA[i]!==nB[i]){console.log("  first diff @",i,":",JSON.stringify(nA.slice(i-40,i+40)),"VS",JSON.stringify(nB.slice(i-40,i+40)));break;}}}
console.log("  A summary:",JSON.stringify(repA.summary));
console.log("  B summary:",JSON.stringify(repB.summary));

// ---- R2: cross-tenant isolation → 404 ----
console.log("\n=== R2: cross-tenant isolation ===");
const idC=await submit(jwt,q); await pollPre(jwt,idC);
const owner=await preRaw({authorization:`Bearer ${jwt}`},idC);
const ownerDbg=await preRaw({"x-debug-user":"demo:usr_demo_admin:admin"},idC);
const crossDbg=await preRaw({"x-debug-user":"tenantB:userx:admin"},idC);
console.log("owner(JWT demo) GET taskC:", owner.status, owner.body?.status);
console.log("owner(X-Debug demo) GET taskC:", ownerDbg.status, ownerDbg.body?.status ?? JSON.stringify(ownerDbg.body));
console.log("cross(X-Debug tenantB) GET taskC:", crossDbg.status, JSON.stringify(crossDbg.body));
console.log("R2 PASS (cross-tenant 404):", crossDbg.status===404);
