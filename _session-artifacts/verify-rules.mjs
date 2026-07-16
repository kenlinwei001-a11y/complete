const A = "http://127.0.0.1:4001", B = "http://127.0.0.1:4002";
async function j(base, p, h) { const r = await fetch(base + p, { headers: h }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b, raw: t }; }
const lg = await (await fetch(A + "/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) })).json();
const H = { authorization: "Bearer " + lg.accessToken };
const HB = { authorization: "Bearer " + lg.accessToken, "x-debug-user": "demo:admin:admin" };

// #1 规则库内容
const rules = await j(A, "/a/v1/rules", H);
const rArr = Array.isArray(rules.b) ? rules.b : (rules.b?.items || rules.b?.rules || []);
console.log("#1 GET /a/v1/rules:", rules.status, "| 条数:", rArr.length);
console.log("   规则码样例:", rArr.slice(0, 12).map((r) => r.key || r.code || r.id).join(", ") || "(空·raw=" + rules.raw.slice(0, 80) + ")");
console.log("   有 PUBLISHED 的:", rArr.filter((r) => r.status === "PUBLISHED").length, "| 状态分布:", JSON.stringify([...new Set(rArr.map((r) => r.status))]));
console.log("   含 C03/C08 这类码:", rArr.some((r) => /^C\d/.test(r.key || r.code || "")) ? "✓(workflow 勾选就是这些)" : "✗(workflow 的码另有来源)");

// #3 求解器作为 MCP
const sm = await j(B, "/b/v1/mcp/servers/solvers", HB);
console.log("\n#3 GET /b/v1/mcp/servers/solvers:", sm.status, "| 类型:", Array.isArray(sm.b) ? "数组" + sm.b.length : typeof sm.b);
console.log("   raw:", sm.raw.slice(0, 220));
