import { readFileSync, writeFileSync } from "node:fs";
/**
 * 绑定真 Kimi 供应商 + 四用途绑定（classifier/agent/compose/comprehend）。
 * 用法：node bind-kimi.mjs <datacorePort> <keyFile>
 *
 * no-secrets-echo 铁律自检：本脚本**只**从 keyFile 读 key，绝不打印、绝不写盘；
 * 并对 provider 创建/读取的响应做明文 key 扫描，命中即 exit 1 停机。
 */
const A = `http://127.0.0.1:${process.argv[2] || 4601}`;
const KEYFILE = process.argv[3] || "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/.kimi";
const KEY = readFileSync(KEYFILE, "utf8").trim();

const login = async () => {
  const r = await fetch(`${A}/a/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.accessToken;
};

/** 明文 key 扫描：整个响应体（含嵌套）里出现 key 全文或其后 20 位尾段即判泄漏。 */
const tail = KEY.slice(-20);
function assertNoSecret(label, text) {
  if (text.includes(KEY) || text.includes(tail)) {
    console.error(`❌ no-secrets-echo 违反：${label} 响应体里出现明文 key —— 停机`);
    process.exit(1);
  }
  console.log(`✅ no-secrets-echo OK: ${label}（${text.length}B，无明文 key/尾段）`);
}

const TOK = await login();
const H = { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" };

// 1) 建 provider
const createRes = await fetch(`${A}/a/v1/llm-providers`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    name: "kimi",
    kind: "openai_compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: KEY,
    models: [{
      modelId: "kimi-k2.5",
      displayName: "Kimi K2.5",
      capabilities: { tools: true, structuredOutput: true, maxContext: 128000, reasoning: true },
    }],
  }),
});
const createBody = await createRes.text();
assertNoSecret("POST /a/v1/llm-providers", createBody);
const prov = JSON.parse(createBody);
if (!prov.id) { console.error(`❌ provider 创建失败：${createBody.slice(0, 400)}`); process.exit(1); }
console.log(`provider id=${prov.id} kind=${prov.kind} credentialRef=${prov.credentialRef ?? "(none)"}`);

// 2) 四用途绑定
const purposes = ["classifier", "agent", "compose", "comprehend"];
const bindRes = await fetch(`${A}/a/v1/llm-bindings`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({
    bindings: purposes.map((purpose) => ({ purpose, providerId: prov.id, modelId: "kimi-k2.5" })),
  }),
});
const bindBody = await bindRes.text();
assertNoSecret("PUT /a/v1/llm-bindings", bindBody);
if (bindRes.status >= 300) { console.error(`❌ 绑定失败 ${bindRes.status}: ${bindBody.slice(0, 400)}`); process.exit(1); }
console.log(`bindings: ${bindBody.slice(0, 300)}`);

// 3) 回读复验（GET 列表也不许回显）
const listBody = await (await fetch(`${A}/a/v1/llm-providers`, { headers: H })).text();
assertNoSecret("GET /a/v1/llm-providers", listBody);
const getBody = await (await fetch(`${A}/a/v1/llm-bindings`, { headers: H })).text();
assertNoSecret("GET /a/v1/llm-bindings", getBody);
console.log(`bindings readback: ${getBody.slice(0, 400)}`);

writeFileSync(process.env.PROVIDER_OUT || "/tmp/kimi-provider-id.txt", prov.id);
console.log(`\n✅ 绑定完成 · provider=${prov.id} · 用途=${purposes.join(",")}`);
