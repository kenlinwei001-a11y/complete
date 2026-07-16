// Probe: submit queries to agentcore, poll pre-analysis, report gaps.
const DC = "http://127.0.0.1:4001";
const AC = "http://127.0.0.1:4102";

async function login(tenantId, username, password) {
  const r = await fetch(`${DC}/a/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, username, password }),
  });
  const j = await r.json();
  return j.accessToken;
}

async function submitQuery(jwt, query) {
  const r = await fetch(`${AC}/api/v1/queries`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      packageId: "pkg_battery_manufacturing",
      query,
      context: { view: "dash", selectedObjects: [], filters: {} },
    }),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

async function getPreAnalysis(jwt, taskId, prefix = "/b/v1") {
  const r = await fetch(`${AC}${prefix}/growth/pre-analysis/${taskId}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

function sevCounts(report) {
  const c = {};
  for (const e of report?.gapAnalysis?.entries ?? [])
    for (const it of e.items)
      if (it.severity && it.status !== "EXISTS") c[it.severity] = (c[it.severity] ?? 0) + 1;
  return c;
}

async function poll(jwt, taskId, prefix = "/b/v1") {
  for (let i = 0; i < 60; i++) {
    const { status, body } = await getPreAnalysis(jwt, taskId, prefix);
    if (status === 200 && body && (body.status === "DONE" || body.status === "FAILED")) return { status, body };
    await new Promise((r) => setTimeout(r, 500));
  }
  return await getPreAnalysis(jwt, taskId, prefix);
}

const queries = process.argv.slice(2);
const jwt = await login("demo", "admin", "demo1234");
console.log("JWT ok:", !!jwt);

for (const q of queries) {
  const sub = await submitQuery(jwt, q);
  const taskId = sub.body?.taskId;
  process.stdout.write(`\nQ="${q}"\n  submit=${sub.status} taskId=${taskId}\n`);
  if (!taskId) { console.log("  NO TASKID", JSON.stringify(sub.body)); continue; }
  const { status, body } = await poll(jwt, taskId);
  if (status !== 200) { console.log(`  pre-analysis HTTP ${status}`, JSON.stringify(body)); continue; }
  const total = body.summary?.totalGaps ?? 0;
  const score = body.summary?.coverageScore;
  console.log(`  status=${body.status} totalGaps=${total} coverageScore=${score} sevCounts=${JSON.stringify(sevCounts(body))}`);
  console.log(`  summary=${JSON.stringify(body.summary)}`);
  const brief = (body.gapAnalysis?.entries ?? []).map((e) => `${e.kind}[${e.side}]:` + e.items.map((i) => `${i.key}=${i.status}/${i.severity ?? "-"}`).join(",")).join(" | ");
  if (brief) console.log(`  entries: ${brief}`);
}
