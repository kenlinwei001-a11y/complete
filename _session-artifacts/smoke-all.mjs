const A = "http://127.0.0.1:4001", B = "http://127.0.0.1:4002";
async function j(base, path, headers) { try { const r = await fetch(base + path, { headers }); const t = await r.text(); return { status: r.status, body: t.slice(0, 160) }; } catch (e) { return { status: 0, body: "FETCH_FAIL " + String(e).slice(0, 60) }; } }
const login = await j(A, "/a/v1/auth/login", null); // will 405; do POST properly:
const lg = await fetch(A + "/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const TOK = (await lg.json()).accessToken;
const H = { authorization: "Bearer " + TOK };
const HB = { authorization: "Bearer " + TOK, "x-debug-user": "demo:admin:admin" };

const DC = ["action-drafts","action-types","boundary/impact?registry=BASE_REGISTRY","boundary/version","business-domains","calibration/history","calibration/proposals","calibration/report","capability-inventory","catalog","connections","connector-categories","connector-types","data-builders","data-builders/jobs/list","data-categories","data-health","data-templates","databuilder/generate-scripts","databuilder/reconcile-candidates","databuilder/runs","databuilder/workflow-runs","entity-catalog","epoch/current","exec-locks","external-signals","features/registry","field-coverage","history/watermark","industry-templates","ksf","llm-budgets","me/workspace","meta/access-policy","meta/ontology","metrics","modeling/drafts","notifications","objects","objects/merge-candidates","objects/merges","ontology/domains","ontology/graph","ontology/mapping","ontology/mapping/registries","ontology/object-types","ontology/object-types/stats","ontology/publish-requests","ontology/references","ontology/slices","ontology/versions","ops/personas","ops/playbook","ops/pools","ops/schedule","ops/tick-reports","opt/templates","outbox","outbox/dead","plan-versions/current","plan/aop","plan/quarterly","policies","principals","prompt-templates","quarantine","raw-datasets","rule-docs","rules","scheduler/jobs","sim/propagation-rules","sim/sessions","sim/view-config","slices/index","slices/library","solvers/artifacts","solvers/registry","sop/versions","synthetic/clock","synthetic/clock/ticks","timeseries/agg-specs","validation/runs","views/pull-targets","webhooks"];
const AC = ["growth/ledger","growth/tickets","ops/fallback-stats","perception/metrics","queries"].map(p=>["/api/v1/"+p,HB]).concat(["agents","evals","evals/runs","event-subscriptions","llm/bindings","llm/providers","mcp-configs","mcp/servers/solvers","outbox","scenarios","scenarios/manage","scene-entries","scenes","skills","solvers","workflows"].map(p=>["/b/v1/"+p,HB]));

const bugs = [], warn = [], ok = [];
for (const p of DC) { const r = await j(A, "/a/v1/" + p, H); if (r.status >= 500 || r.status === 0) bugs.push(`DC GET /${p} → ${r.status} ${r.body}`); else if (r.status >= 400) warn.push(`DC /${p} → ${r.status}`); else ok.push(p); }
for (const [path, h] of AC) { const r = await j(B, path, h); if (r.status >= 500 || r.status === 0) bugs.push(`AC GET ${path} → ${r.status} ${r.body}`); else if (r.status >= 400) warn.push(`AC ${path} → ${r.status}`); else ok.push(path); }

console.log("=== API 冒烟结果 ===");
console.log(`OK(2xx): ${ok.length} | 4xx(需查): ${warn.length} | 5xx/失败(真BUG): ${bugs.length}`);
console.log("\n🔴 5xx/失败(真 BUG):");
bugs.forEach(b => console.log("  " + b));
console.log("\n🟡 4xx(需查·部分是需参数/feature-off 预期):");
warn.forEach(w => console.log("  " + w));
