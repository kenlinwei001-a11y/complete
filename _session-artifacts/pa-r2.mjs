const DC="http://127.0.0.1:4001", AC="http://127.0.0.1:4102", PKG="pkg_battery_manufacturing";
async function login(t,u,p){const r=await fetch(`${DC}/a/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenantId:t,username:u,password:p})});return (await r.json()).accessToken;}
async function submit(jwt,query){const r=await fetch(`${AC}/api/v1/queries`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify({packageId:PKG,query,context:{view:"dash",selectedObjects:[],filters:{}}})});return await r.json();}
async function clarNone(jwt,id){const r=await fetch(`${AC}/api/v1/queries/${id}/clarification`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify({kind:"INTENT_CHOICE",none:true})});return r.status;}
async function preRaw(headers,id){const r=await fetch(`${AC}/b/v1/growth/pre-analysis/${id}`,{headers});return {status:r.status, body: await r.json().catch(()=>null)};}
async function pollPre(jwt,id){for(let i=0;i<40;i++){const {status,body}=await preRaw({authorization:`Bearer ${jwt}`},id);if(status===200&&body&&body.status==="DONE")return body;await new Promise(r=>setTimeout(r,400));}return null;}
const jwt=await login("demo","admin","demo1234");
const sub=await submit(jwt,"常州基地的瓶颈根因是什么");
const id=sub.taskId;
console.log("submit:",JSON.stringify(sub).slice(0,120));
if(!id){console.log("NO TASKID - still rate limited; wait & retry");process.exit(0);}
await new Promise(r=>setTimeout(r,1500)); await clarNone(jwt,id); // push task terminal
const rep=await pollPre(jwt,id);
console.log("pre-analysis DONE?", !!rep, "totalGaps:", rep?.summary?.totalGaps);
const owner=await preRaw({authorization:`Bearer ${jwt}`},id);
const cross=await preRaw({"x-debug-user":"tenantB:userx:admin"},id);
const ownerDbg=await preRaw({"x-debug-user":"demo:usr_demo_admin:admin"},id);
console.log("\ntaskId:",id);
console.log("owner (JWT demo)        ->", owner.status, owner.body?.status);
console.log("owner (X-Debug demo)    ->", ownerDbg.status, ownerDbg.body?.status ?? JSON.stringify(ownerDbg.body));
console.log("cross (X-Debug tenantB) ->", cross.status, JSON.stringify(cross.body));
console.log("\nR2 PASS (owner 200 & cross 404):", owner.status===200 && cross.status===404);
