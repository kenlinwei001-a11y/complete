import fs from "node:fs";
const TOKEN = fs.readFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/token.txt","utf8").trim();
const DC = "http://127.0.0.1:4025", AC = "http://127.0.0.1:4125";
const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const jj = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// 1. demo features (from datacore) — is sim.sandbox / sandbox_render on?
const feats = await jj(await fetch(`${DC}/a/v1/features`, { headers: H }));
const flist = Array.isArray(feats) ? feats : (feats.items ?? feats.features ?? []);
const fkeys = flist.map(f => (typeof f === "string" ? f : f.key)).filter(Boolean);
const on = (k) => { const f = flist.find(x => (x.key ?? x) === k); return typeof f === "object" ? (f.enabled ?? f.on ?? f.defaultOn) : "?"; };
console.log("features endpoint keys count:", fkeys.length);
console.log("sim.sandbox present:", fkeys.includes("sim.sandbox"), " enabled:", on("sim.sandbox"));
console.log("sim.sandbox_render present:", fkeys.includes("sim.sandbox_render"), " enabled:", on("sim.sandbox_render"));

// 2. fire a shock sim question at QOS
const q = "常州基地负荷指数未来6周上升20%会怎样？请推演传导影响";
console.log("\n=== submitting chat sim question:", q);
const sub = await jj(await fetch(`${AC}/api/v1/queries`, { method:"POST", headers: H, body: JSON.stringify({ query: q }) }));
console.log("submit resp:", JSON.stringify(sub).slice(0,300));
const taskId = sub.taskId;
if (!taskId) { console.log("NO taskId — cannot poll"); process.exit(0); }

// 3. poll for terminal + inspect answer blocks
const TERM = new Set(["COMPLETED","FAILED","CANCELLED"]);
let task = null;
for (let i=0;i<30;i++){
  await new Promise(r=>setTimeout(r,1000));
  task = await jj(await fetch(`${AC}/api/v1/queries/${taskId}`, { headers: H }));
  if (task && TERM.has(task.status)) break;
  if (i%5===0) console.log(`  poll ${i}s: status=${task?.status} path=${task?.path}`);
}
console.log("\n=== final status:", task?.status, " path:", task?.path, " classification:", JSON.stringify(task?.classification)?.slice(0,150));
const blocks = task?.answer?.blocks ?? [];
console.log("answer block types:", JSON.stringify(blocks.map(b=>b.type)));
const sr = blocks.find(b=>b.type==="sandbox_render");
if (sr) {
  console.log("\n=== sandbox_render BLOCK FOUND ===");
  console.log("headline:", sr.headline);
  console.log("request.source:", sr.request?.source, " horizonTicks:", sr.request?.horizonTicks);
  console.log("request.scenario:", JSON.stringify(sr.request?.scenario)?.slice(0,400));
} else {
  console.log("\n=== NO sandbox_render block. Other answer summary: ===");
  console.log(JSON.stringify(task?.answer)?.slice(0,500));
}
