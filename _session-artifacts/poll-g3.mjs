const A = "http://127.0.0.1:4001", B = "http://127.0.0.1:4002";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(base, path, opts) { const r = await fetch(base + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const login = await j(A, "/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const HB = { authorization: "Bearer " + login.b.accessToken, "x-debug-user": "demo:admin:admin" };
const taskId = process.argv[2];
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
let task, t0 = Date.now();
for (let i = 0; i < 360; i++) { // up to 6 min
  const g = await j(B, "/api/v1/queries/" + taskId, { headers: HB });
  task = g.b;
  if (i % 20 === 0) console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] status=${task?.status}`);
  if (task && TERMINAL.has(task.status)) break;
  await sleep(1000);
}
console.log("\n=== G-3 终态 ===");
console.log("status:", task?.status, "| 总耗时:", Math.round((Date.now() - t0) / 1000) + "s", "| trust:", task?.trust ?? task?.trustLevel ?? "?");
console.log("answer:", JSON.stringify(task?.answer ?? task?.result ?? task?.summary ?? task?.finalAnswer ?? "(无)").slice(0, 900));
const trace = await j(B, "/api/v1/queries/" + taskId + "/decision-trace", { headers: HB });
const ts = JSON.stringify(trace.b);
const kimiCalls = (ts.match(/kimi-k2\.6/g) || []).length;
console.log("\ndecision-trace 中 kimi-k2.6 出现次数:", kimiCalls, "| trust in trace:", trace.b?.trust ?? trace.b?.trustLevel ?? "?");
