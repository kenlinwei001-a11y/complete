// Rigorous entitlement gate test with real JWT.
const DC = "http://127.0.0.1:4099";
const AC = "http://127.0.0.1:4200"; // ON instance (QOS_REQUIREMENT_GRAPH=1)

const login = await (await fetch(`${DC}/a/v1/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
})).json();
const JWT = login.accessToken;
if (!JWT) { console.log("LOGIN FAILED", login); process.exit(1); }
const AH = { Authorization: `Bearer ${JWT}` };
const AHJ = { ...AH, "Content-Type": "application/json" };

const sub = await (await fetch(`${AC}/api/v1/queries`, {
  method: "POST", headers: AHJ,
  body: JSON.stringify({ packageId: "pkg_battery_manufacturing", query: "常州基地影响哪些订单？", context: { view: "risk-board", selectedObjects: [], filters: {} } }),
})).json();
const taskId = sub.taskId;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const t = await (await fetch(`${AC}/api/v1/queries/${taskId}`, { headers: AH })).json();
  if (["COMPLETED","FAILED","CANCELLED","AWAITING_CLARIFICATION"].includes(t.status)) break;
}

const r1 = await fetch(`${AC}/api/v1/queries/${taskId}/requirement-graph`, { headers: AH });
const b1 = await r1.json();
console.log(`[A] entitlement ON  + JWT -> HTTP ${r1.status} | ${b1.requirementGraph ? "RG returned (graphId="+b1.requirementGraph.graphId+", nodes="+b1.requirementGraph.nodes.length+")" : JSON.stringify(b1.error)}`);

const put = await fetch(`${DC}/a/v1/tenants/demo/features`, {
  method: "PUT", headers: AHJ, body: JSON.stringify({ overrides: { "growth.requirement_graph": false } }),
});
const putj = await put.json();
console.log(`[flip OFF] PUT features -> HTTP ${put.status} | resolved has growth.requirement_graph: ${(putj.features||[]).includes("growth.requirement_graph")}`);

await fetch(`${AC}/b/v1/internal/invalidate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "feature", tenantId: "demo" }) });

const r2 = await fetch(`${AC}/api/v1/queries/${taskId}/requirement-graph`, { headers: AH });
const b2 = await r2.json();
console.log(`[B] entitlement OFF + JWT -> HTTP ${r2.status} | code=${b2.error?.code}`);

const put2 = await fetch(`${DC}/a/v1/tenants/demo/features`, {
  method: "PUT", headers: AHJ, body: JSON.stringify({ overrides: { "growth.requirement_graph": true } }),
});
const put2j = await put2.json();
await fetch(`${AC}/b/v1/internal/invalidate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "feature", tenantId: "demo" }) });
const r3 = await fetch(`${AC}/api/v1/queries/${taskId}/requirement-graph`, { headers: AH });
console.log(`[C] restored ON     + JWT -> HTTP ${r3.status} (resolved ${put2j.features?.includes("growth.requirement_graph") ? "ON" : "OFF"})`);

const pass = r1.status === 200 && b1.requirementGraph && r2.status === 404 && b2.error?.code === "FEATURE_NOT_FOUND" && r3.status === 200;
console.log(`\nENTITLEMENT-GATE VERDICT: ${pass ? "PASS (ON->200, OFF->404 FEATURE_NOT_FOUND, restore->200)" : "CHECK-FAILED"}`);
