// Dark-launch byte-identity: simpler in-catalog query that exercises the sideband.
const DBG = "demo:u_verify_" + Math.floor(Math.random()*1e6) + ":admin|planner|catalog_admin";
const H = { "Content-Type": "application/json", "X-Debug-User": DBG };
const QUERY = "常州基地影响哪些订单？";
const body = { packageId: "pkg_battery_manufacturing", query: QUERY, context: { view: "risk-board", selectedObjects: [], filters: {} } };

async function run(port) {
  const base = `http://127.0.0.1:${port}`;
  const sub = await (await fetch(`${base}/api/v1/queries`, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
  const taskId = sub.taskId;
  let task;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    task = await (await fetch(`${base}/api/v1/queries/${taskId}`, { headers: H })).json();
    if (["COMPLETED","FAILED","CANCELLED","AWAITING_CLARIFICATION"].includes(task.status)) break;
  }
  const rgRes = await fetch(`${base}/api/v1/queries/${taskId}/requirement-graph`, { headers: H });
  let rgBody = null; try { rgBody = await rgRes.json(); } catch {}
  return { taskId, task, rgStatus: rgRes.status, rgBuilt: !!rgBody?.requirementGraph, rgErr: rgBody?.error?.code };
}

function normalize(task) {
  return JSON.stringify(JSON.parse(JSON.stringify(task)
    .replace(/task_[0-9A-Z]+/g, "TASK")
    .replace(/"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, '"TS"')
    .replace(/req_[0-9a-z]+/gi, "REQ").replace(/conv_[0-9A-Za-z]+/g, "CONV")));
}

const off = await run(4199);
const on = await run(4200);

console.log("OFF(4199): status=" + off.task.status + " path=" + off.task.path + " | RG endpoint=" + off.rgStatus + " built=" + off.rgBuilt + " err=" + off.rgErr);
console.log("ON (4200): status=" + on.task.status + " path=" + on.task.path + " | RG endpoint=" + on.rgStatus + " built=" + on.rgBuilt + " err=" + on.rgErr);

const identical = normalize(off.task) === normalize(on.task);
console.log("\nTASK byte-identity (normalized volatile): " + (identical ? "IDENTICAL" : "DIFFER"));
if (!identical) {
  const a = normalize(off.task), b = normalize(on.task);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { console.log("  diff@" + i + "\n  OFF:" + a.slice(Math.max(0,i-70),i+70) + "\n  ON :" + b.slice(Math.max(0,i-70),i+70)); break; }
}
const pass = identical && !off.rgBuilt && off.rgStatus === 404 && on.rgBuilt && on.rgStatus === 200;
console.log("\nDARK-LAUNCH VERDICT: " + (pass
  ? "PASS — answer/verdict byte-identical OFF vs ON; RG built ONLY when gate ON (OFF endpoint 404 REQUIREMENT_GRAPH_NOT_FOUND, ON 200). Observation-only, no answer change."
  : "CHECK"));
