// Submit a query, poll to terminal, print status/path/answer + RG endpoint result.
const port = process.argv[2];
const label = process.argv[3] ?? port;
const DBG = "demo:u_admin:admin|planner|catalog_admin";
const base = `http://127.0.0.1:${port}`;
const H = { "Content-Type": "application/json", "X-Debug-User": DBG };
const query = "常州基地影响哪些订单？";
const body = {
  packageId: "pkg_battery_manufacturing",
  query,
  context: { view: "risk-board", selectedObjects: [], filters: {} },
};

const sub = await fetch(`${base}/api/v1/queries`, { method: "POST", headers: H, body: JSON.stringify(body) });
const subj = await sub.json();
if (!subj.taskId) { console.log(JSON.stringify({ label, error: "no taskId", subj })); process.exit(1); }
const taskId = subj.taskId;
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"]);
let task;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const t = await fetch(`${base}/api/v1/queries/${taskId}`, { headers: H });
  task = await t.json();
  if (task && TERMINAL.has(task.status)) break;
}
// Fetch RG endpoint (may 404 if entitlement off or gate off)
const rgRes = await fetch(`${base}/api/v1/queries/${taskId}/requirement-graph`, { headers: H });
let rg = null; let rgStatus = rgRes.status;
try { rg = await rgRes.json(); } catch {}
console.log(JSON.stringify({
  label, taskId, status: task?.status, path: task?.path,
  answer: task?.answer ?? null,
  rgStatus, rg,
}, null, 2));
