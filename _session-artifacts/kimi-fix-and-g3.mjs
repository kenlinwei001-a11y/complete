const A = "http://127.0.0.1:4001", B = "http://127.0.0.1:4002";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(base, path, opts) { const r = await fetch(base + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b, raw: t }; }
const login = await j(A, "/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };

// 0) 找到 Kimi provider
const list = await j(A, "/a/v1/llm-providers", { headers: H });
const kimi = (Array.isArray(list.b) ? list.b : []).find((p) => /kimi|月之暗面|moonshot/i.test(p.name));
if (!kimi) { console.log("✗ 未找到 Kimi provider"); process.exit(1); }
console.log("0) Kimi provider:", kimi.id, "| hasApiKey:", kimi.hasApiKey, "| 现模型:", kimi.models.map((m) => m.modelId).join(","));

// 1) PUT 切模型 → kimi-k2.6（不带 apiKey → 凭据保留）
const put = await j(A, "/a/v1/llm-providers/" + kimi.id, { method: "PUT", headers: H, body: JSON.stringify({
  models: [{ modelId: "kimi-k2.6", displayName: "Kimi K2.6", capabilities: { tools: true, structuredOutput: true, maxContext: 256000 } }],
}) });
console.log("1) PUT 切 kimi-k2.6:", put.status, "| hasApiKey(凭据保留?):", put.b.hasApiKey === true ? "true✓" : put.b.hasApiKey, "| R5·响应含明文:", put.raw.includes("sk-oj") ? "⚠️有!" : "无✓");

// 2) 重新绑定 classifier/agent/comprehend → kimi-k2.6
const bind = await j(A, "/a/v1/llm-bindings", { method: "PUT", headers: H, body: JSON.stringify({ bindings: [
  { purpose: "classifier", providerId: kimi.id, modelId: "kimi-k2.6" },
  { purpose: "agent", providerId: kimi.id, modelId: "kimi-k2.6" },
  { purpose: "comprehend", providerId: kimi.id, modelId: "kimi-k2.6" },
] }) });
console.log("2) 绑定→kimi-k2.6:", bind.status, bind.status >= 400 ? JSON.stringify(bind.b).slice(0, 200) : ("✓ warnings=" + JSON.stringify(bind.b.warnings || [])));

// 3) AgentCore 失效缓存（即时拿新绑定，不等 60s TTL）
const inv = await j(B, "/b/v1/internal/invalidate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "llm_binding.updated", tenantId: "demo" }) });
console.log("3) AgentCore invalidate:", inv.status, JSON.stringify(inv.b).slice(0, 120));

// 4) G-3 端到端：提一条自由问句 → 经 classifier(Kimi) → Path A/B → 终态
const HB = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json", "x-debug-user": "demo:admin:admin" };
const query = "综合评估一下我们当前供应链与产能方面最值得关注的风险点，并简要解释原因。";
const submit = await j(B, "/api/v1/queries", { method: "POST", headers: HB, body: JSON.stringify({
  packageId: "pkg_battery_manufacturing", query, context: { view: "dashboard", selectedObjects: [], filters: {} },
}) });
console.log("\n4) 提交问句:", submit.status, "taskId=" + (submit.b.taskId || JSON.stringify(submit.b).slice(0, 200)));
const taskId = submit.b.taskId;
if (!taskId) process.exit(1);

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
let task, t0 = Date.now();
for (let i = 0; i < 120; i++) {
  const g = await j(B, "/api/v1/queries/" + taskId, { headers: HB });
  task = g.b;
  if (task && TERMINAL.has(task.status)) break;
  await sleep(500);
}
const ms = Date.now() - t0;
console.log("5) 终态:", task?.status, "| 耗时:", ms + "ms", "| trust:", task?.trust ?? task?.trustLevel ?? "?", "| route/path:", task?.route ?? task?.path ?? task?.classification?.path ?? "?");
console.log("   answer/result 摘要:", JSON.stringify(task?.answer ?? task?.result ?? task?.summary ?? task?.message ?? "(无)").slice(0, 400));
// trace：看是否真用了 Kimi provider
const trace = await j(B, "/api/v1/queries/" + taskId + "/decision-trace", { headers: HB });
const traceStr = JSON.stringify(trace.b);
console.log("6) decision-trace 含 provider/model 线索:", /kimi|moonshot|llmp_/i.test(traceStr) ? "✓ 命中 Kimi" : "未见 provider 名", "| trace status:", trace.status);
console.log("   trace 片段:", traceStr.slice(0, 300));
