// Dark-launch byte-identical test: same query to OFF(4199) and ON(4200), compare normalized task + answer.
const DBG = "demo:u_admin:admin|planner|catalog_admin";
const H = { "Content-Type": "application/json", "X-Debug-User": DBG };
const QUERY = "常州基地PACK02产线未来30天停机20%，影响哪些订单和交付？";
const body = { packageId: "pkg_battery_manufacturing", query: QUERY, context: { view: "risk-board", selectedObjects: [], filters: {} } };

async function run(port) {
  const base = `http://127.0.0.1:${port}`;
  const sub = await (await fetch(`${base}/api/v1/queries`, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
  const taskId = sub.taskId;
  let task;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    task = await (await fetch(`${base}/api/v1/queries/${taskId}`, { headers: H })).json();
    if (["COMPLETED","FAILED","CANCELLED","AWAITING_CLARIFICATION"].includes(task.status)) break;
  }
  // events (SSE stored)
  let events = [];
  try { events = await (await fetch(`${base}/api/v1/queries/${taskId}/events`, { headers: H })).json(); } catch {}
  const stepIds = Array.isArray(events) ? events.filter(e => e.type === "step.started" || e.type === "step.completed").map(e => (e.data?.stepId ?? e.stepId)) : [];
  return { taskId, task, stepIds };
}

// Normalize volatile fields for byte-identity comparison.
function normalize(task) {
  const s = JSON.stringify(task);
  return JSON.parse(s.replace(/task_[0-9A-Z]+/g, "TASK").replace(/"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, '"TS"').replace(/req_[0-9a-z]+/gi, "REQ").replace(/conv_[0-9A-Za-z]+/g, "CONV").replace(/rg_TASK/g, "RG"));
}

const off = await run(4199);
const on = await run(4200);

console.log("=== OFF (4199, gate unset) ===");
console.log("  status:", off.task.status, "| path:", off.task.path);
console.log("  step frames:", JSON.stringify([...new Set(off.stepIds)]));
console.log("=== ON (4200, QOS_REQUIREMENT_GRAPH=1) ===");
console.log("  status:", on.task.status, "| path:", on.task.path);
console.log("  step frames:", JSON.stringify([...new Set(on.stepIds)]));

const offN = JSON.stringify(normalize(off.task));
const onN = JSON.stringify(normalize(on.task));
console.log("\n=== TASK BYTE-IDENTITY (normalized volatile IDs/timestamps) ===");
console.log("  OFF task === ON task :", offN === onN ? "IDENTICAL" : "DIFFER");
if (offN !== onN) {
  // find first diff
  for (let i = 0; i < Math.max(offN.length, onN.length); i++) {
    if (offN[i] !== onN[i]) { console.log("  first diff @", i, "\n   OFF:", offN.slice(Math.max(0,i-60), i+60), "\n   ON :", onN.slice(Math.max(0,i-60), i+60)); break; }
  }
}
const rgFrameOff = off.stepIds.includes("requirement-graph");
const rgFrameOn = on.stepIds.includes("requirement-graph");
console.log("\n=== RG STEP FRAME PRESENCE ===");
console.log("  OFF has requirement-graph frame:", rgFrameOff, "(expect false)");
console.log("  ON  has requirement-graph frame:", rgFrameOn, "(expect true)");
console.log(`\nDARK-LAUNCH VERDICT: ${offN === onN && !rgFrameOff && rgFrameOn ? "PASS (task identical, OFF no RG frame, ON has RG frame — observability without answer change)" : "CHECK"}`);
