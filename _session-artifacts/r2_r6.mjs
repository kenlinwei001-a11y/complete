const AC = "http://127.0.0.1:4200"; // ON instance
const U = "u_r2_" + Math.floor(Math.random()*1e6);
const demoH = { "Content-Type": "application/json", "X-Debug-User": `demo:${U}:admin|planner|catalog_admin` };
const otherH = { "Content-Type": "application/json", "X-Debug-User": `acme:${U}:admin|planner|catalog_admin` };
const body = { packageId: "pkg_battery_manufacturing", query: "常州基地影响哪些订单？", context: { view: "risk-board", selectedObjects: [], filters: {} } };

async function submitAndWait(headers) {
  const sub = await (await fetch(`${AC}/api/v1/queries`, { method: "POST", headers, body: JSON.stringify(body) })).json();
  const taskId = sub.taskId;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const t = await (await fetch(`${AC}/api/v1/queries/${taskId}`, { headers })).json();
    if (["COMPLETED","FAILED","CANCELLED","AWAITING_CLARIFICATION"].includes(t.status)) break;
  }
  return taskId;
}
async function readRG(taskId, headers) {
  const r = await fetch(`${AC}/api/v1/queries/${taskId}/requirement-graph`, { headers });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, rg: b?.requirementGraph, err: b?.error?.code };
}

// ---- R2 cross-tenant ----
const demoTask = await submitAndWait(demoH);
const own = await readRG(demoTask, demoH);
const cross = await readRG(demoTask, otherH);
console.log("=== R2 cross-tenant isolation (V7) ===");
console.log(`  owner(demo) read demo task -> HTTP ${own.status} built=${!!own.rg}`);
console.log(`  other(acme) read demo task -> HTTP ${cross.status} code=${cross.err} built=${!!cross.rg}`);
const r2pass = own.status === 200 && own.rg && cross.status === 404 && !cross.rg;
console.log(`  R2 VERDICT: ${r2pass ? "PASS (owner 200, cross-tenant 404, no leak)" : "CHECK"}`);

// ---- R6 runtime double-run byte-identity ----
const t1 = await submitAndWait(demoH);
const t2 = await submitAndWait(demoH);
const rg1 = (await readRG(t1, demoH)).rg;
const rg2 = (await readRG(t2, demoH)).rg;
function normRG(rg) {
  return JSON.stringify(rg)
    .replace(/task_[0-9A-Z]+/g, "TASK").replace(/rg_TASK/g, "RG").replace(/ast_TASK/g, "AST")
    .replace(/"generatedAt":"[^"]+"/g, '"generatedAt":"TS"');
}
console.log("\n=== R6 runtime double-run byte-identity (V4) ===");
if (rg1 && rg2) {
  const identical = normRG(rg1) === normRG(rg2);
  console.log(`  same query, 2 separate tasks -> RG normalized(taskId/generatedAt) identical: ${identical ? "IDENTICAL" : "DIFFER"}`);
  console.log(`  nodes: t1=${rg1.nodes.length} t2=${rg2.nodes.length} | solverCandidates: ${JSON.stringify(rg1.solverCandidates)} vs ${JSON.stringify(rg2.solverCandidates)} | coverageScore: ${rg1.coverageScore} vs ${rg2.coverageScore}`);
  if (!identical) { const a=normRG(rg1), b=normRG(rg2); for(let i=0;i<Math.max(a.length,b.length);i++) if(a[i]!==b[i]){console.log("  diff@"+i+"\n  1:"+a.slice(Math.max(0,i-70),i+70)+"\n  2:"+b.slice(Math.max(0,i-70),i+70));break;} }
  console.log(`  R6 VERDICT: ${identical ? "PASS (deterministic·byte-identical modulo injected generatedAt/taskId)" : "CHECK"}`);
} else {
  console.log("  RG not built (t1 or t2 missing) — check", !!rg1, !!rg2);
}
