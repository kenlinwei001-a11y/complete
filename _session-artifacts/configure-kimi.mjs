const A = "http://127.0.0.1:4001";
const KEY = process.env.KIMI_KEY; // 从 env 传入·不硬编码·不打印
if (!KEY) { console.log("NO KEY in env"); process.exit(1); }
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b, raw: t }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };

// 1) 创建 Kimi provider(openai_compatible)
const create = await j("/a/v1/llm-providers", { method: "POST", headers: H, body: JSON.stringify({
  name: "Kimi（月之暗面）", kind: "openai_compatible", baseUrl: "https://api.moonshot.cn/v1", apiKey: KEY,
  models: [{ modelId: "kimi-k2-0905-preview", displayName: "Kimi K2", capabilities: { tools: true, structuredOutput: true, maxContext: 256000 } }],
}) });
console.log("1) 创建 provider:", create.status, "id=" + (create.b.id || "?"));
const pid = create.b.id;
// R5：响应里有没有明文 key？
console.log("   R5·响应含明文key:", create.raw.includes(KEY) ? "⚠️有(违R5!)" : "无✓", "| hasApiKey:", create.b.hasApiKey ?? "?", "| credentialRef:", create.b.credentialRef ? "有✓" : (create.b.credential ? "有" : "?"));

// 2) GET providers 再验不回显
const get = await j("/a/v1/llm-providers", { headers: H });
console.log("2) GET providers·含明文key:", get.raw.includes(KEY) ? "⚠️有(违R5!)" : "无✓", "| provider数:", (Array.isArray(get.b) ? get.b : []).length);

// 3) test 探测(真打 Kimi·验 key+连通)
const test = await j("/a/v1/llm-providers/" + pid + "/test", { method: "POST", headers: H, body: "{}" });
console.log("3) test 探测:", test.status, "ok=" + (test.b.ok ?? "?"), "latency=" + (test.b.latencyMs ?? "?") + "ms", "models=" + JSON.stringify(test.b.probedModels || []), test.b.message ? "msg:" + String(test.b.message).slice(0, 120) : "");

// 4) 绑定 classifier/agent/comprehend
const bind = await j("/a/v1/llm-bindings", { method: "PUT", headers: H, body: JSON.stringify({ bindings: [
  { purpose: "classifier", providerId: pid, modelId: "kimi-k2-0905-preview" },
  { purpose: "agent", providerId: pid, modelId: "kimi-k2-0905-preview" },
  { purpose: "comprehend", providerId: pid, modelId: "kimi-k2-0905-preview" },
] }) });
console.log("4) 绑定 classifier/agent/comprehend:", bind.status, bind.status >= 400 ? JSON.stringify(bind.b).slice(0, 160) : "✓");
console.log("\nPROVIDER_ID=" + pid);
