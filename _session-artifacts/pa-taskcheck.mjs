const DC = "http://127.0.0.1:4001";
const AC = "http://127.0.0.1:4102";
async function login(t,u,p){const r=await fetch(`${DC}/a/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tenantId:t,username:u,password:p})});return (await r.json()).accessToken;}
async function submit(jwt,query){const r=await fetch(`${AC}/api/v1/queries`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${jwt}`},body:JSON.stringify({packageId:"pkg_battery_manufacturing",query,context:{view:"dash",selectedObjects:[],filters:{}}})});return await r.json();}
async function getTask(jwt,id){const r=await fetch(`${AC}/b/v1/queries/${id}`,{headers:{authorization:`Bearer ${jwt}`}});return {status:r.status, body: await r.json().catch(()=>null)};}
const jwt=await login("demo","admin","demo1234");
const q = process.argv[2];
const s = await submit(jwt,q);
console.log("taskId:", s.taskId, "status:", s.status);
// poll task to terminal
let t;
for(let i=0;i<60;i++){const g=await getTask(jwt,s.taskId);t=g.body;if(t && ["COMPLETED","FAILED","CANCELLED","NEEDS_CLARIFICATION","BLOCKED"].includes(t.status))break;await new Promise(r=>setTimeout(r,500));}
console.log("task.status:", t?.status);
console.log("task top keys:", t?Object.keys(t).join(","):"none");
// find answer blocks
const ans = t?.answer || t?.result?.answer || t?.result;
if(ans){console.log("answer keys:", Object.keys(ans).join(","));
  const blocks = ans.blocks || ans.answerBlocks || [];
  console.log("block kinds:", blocks.map(b=>b.kind).join(","));
  const gapBlock = blocks.find(b=>b.kind==="gap");
  if(gapBlock){console.log("GAP BLOCK present. report.taskId:", gapBlock.report?.taskId, "findings:", (gapBlock.report?.findings||[]).map(f=>f.gapCode).join(","));}
  else console.log("NO gap block -> GapCard will NOT render -> panorama not hosted");
}
// also dump trustLevel / gapReport at top level
console.log("task.gapReport?", !!t?.gapReport, "task.trustLevel:", t?.trustLevel);
console.log("RAW (first 1500):", JSON.stringify(t).slice(0,1500));
