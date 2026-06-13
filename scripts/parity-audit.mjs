#!/usr/bin/env node
/**
 * parity-audit — 管理台「真连」防漂移闸门。
 *
 * 以 SPA（apps/frontend-shell）的【确切请求形态】重放每一个管理台交互，对照
 * 页面实际消费的响应字段断言。mock-first 漂移（mock 通过 / 真后端不通）在此现形。
 *
 * 运行方式（不构建，假设 dist 已存在）：
 *   pnpm run parity
 *
 * - 内存模式拉起 DataCore + AgentCore（与 pg 模式仓储层以上同一代码路径）
 * - 内置一个 OpenAI-compatible LLM stub，使 A2 规则抽取 / A3 建模建议 / QOS 全链
 *   可离线确定性重放（生产中由真实 LLM 提供）
 * - 鉴权与 SPA 一致：POST /a/v1/auth/login 取 JWT，两系统均走 Bearer（不使用 X-Debug-User）
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOB_DIR = mkdtempSync(join(tmpdir(), "parity-blobs-"));

// 契约 zod schema —— 前端就是用这些 parse 的（fetchAop/fetchCalibrationReport/…）
const contracts = await import(join(ROOT, "packages/contracts/dist/index.js")).catch(() => null);

// ---------------------------------------------------------------------------
// 0 · OpenAI-compatible LLM stub（确定性：A2 抽取 / A3 建模 / QOS 分类+Agent）
// ---------------------------------------------------------------------------
function startLlmStub() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
      const user = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
      const schemaName = body.response_format?.json_schema?.name;
      let out;
      if (schemaName === "intent_classification") {
        // QOS 分类：恒定 out-of-catalog → 路径 B（agent 兜底）
        out = { candidates: [], outOfCatalog: true, extractedSlotsJson: "{}" };
      } else if (Array.isArray(body.tools) && body.tools.length > 0) {
        // Agent 工具循环：直接给最终文本（end_turn → 降级文本回答 → ANSWERED + 兜底留痕）
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已完成分析：当前产能态势平稳。" }, finish_reason: "stop" }] }));
        return;
      } else if (String(system).includes("规则抽取器")) {
        // A2：sourceQuote 必须逐字摘录 segment 文本（服务端子串校验）
        const m = />\n([\s\S]*?)\n<\/segment>/.exec(String(user));
        const text = (m?.[1] ?? String(user)).trim();
        const quote = text.slice(0, Math.min(16, text.length));
        out = {
          candidates: quote
            ? [{ name: `规则·${quote.slice(0, 6)}`, description: "stub 抽取的候选规则", expression: "Order.qty > 0", expressionConfidence: 0.9, scopeObjectTypes: ["Order"], severity: "WARN", sourceQuote: quote }]
            : [],
        };
      } else if (String(system).includes("本体建模助手")) {
        // A3：把每个数据集映射为一个对象类型，第一个字段为主键
        let datasets = [];
        try {
          datasets = JSON.parse(String(user)).datasets ?? [];
        } catch {
          /* ignore */
        }
        const typeKeyOf = (n) => `T_${String(n).replace(/[^A-Za-z0-9]/g, "_")}`;
        out = {
          objectTypes: datasets.map((d) => ({
            action: "CREATE",
            existingTypeKey: null,
            typeKey: typeKeyOf(d.name),
            displayName: String(d.name),
            sourceDataset: String(d.name),
            properties: (d.fields ?? []).map((f, i) => ({
              propKey: String(f.name),
              sourceField: String(f.name),
              dataType: ["string", "number", "boolean", "date", "enum", "ref"].includes(f.inferredType) ? f.inferredType : "string",
              isPrimaryKey: i === 0,
              refToTypeKey: null,
            })),
            confidence: 0.9,
          })),
          linkTypes: [],
        };
      } else {
        out = { text: "stub" };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(out) } }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

// ---------------------------------------------------------------------------
// 1 · 服务启动
// ---------------------------------------------------------------------------
const children = [];
function spawnService(name, script, env) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  child.tail = () => log.split("\n").slice(-12).join("\n");
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const { server: llmStub, port: llmPort } = await startLlmStub();
const A_PORT = 14600 + Math.floor(Math.random() * 200);
const B_PORT = A_PORT + 1;
const A = `http://127.0.0.1:${A_PORT}`;
const B = `http://127.0.0.1:${B_PORT}`;

const dc = spawnService("datacore", join(ROOT, "apps/datacore/dist/server.js"), {
  PORT: String(A_PORT),
  JWT_SECRET: "parity",
  SERVICE_TOKEN: "parity-svc-token",
  CREDENTIAL_KEY: "a".repeat(64),
  BLOB_DIR,
  SEED_DEMO: "1",
  // 管理平台增量 §1：bootstrap 检查先于 SEED_DEMO 播种 —— 空表 + 环境变量 → default 租户 platform_admin
  BOOTSTRAP_ADMIN_EMAIL: "ops@parity.io",
  BOOTSTRAP_ADMIN_PASSWORD: "parity-boot-1",
  LOG_LEVEL: "warn",
  DC_LLM_PROVIDER: "openai_compatible",
  DC_LLM_BASE_URL: `http://127.0.0.1:${llmPort}`,
  DC_LLM_API_KEY_ENV: "PARITY_LLM_KEY",
  PARITY_LLM_KEY: "parity-key",
});
const ac = spawnService("agentcore", join(ROOT, "apps/agentcore/dist/main.js"), {
  PORT: String(B_PORT),
  DATACORE_BASE_URL: A,
  SERVICE_TOKEN: "parity-svc-token",
  LOG_LEVEL: "warn",
  PARITY_LLM_KEY: "parity-key",
});

try {
  await waitFor(`${A}/a/v1/healthz`, 60000);
  await waitFor(`${B}/b/v1/healthz`, 60000);
} catch (e) {
  console.error(String(e));
  console.error("--- datacore tail ---\n" + dc.tail());
  console.error("--- agentcore tail ---\n" + ac.tail());
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2 · SPA 形态的 http 助手（与 apps/frontend-shell/src/api/apiClient.ts 对齐）
// ---------------------------------------------------------------------------
let TOKEN = "";
async function http(base, path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  const token = opts.token ?? TOKEN;
  if (token) headers["authorization"] = `Bearer ${token}`;
  let body;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.formData ? "POST" : "GET"),
    headers,
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = text.length ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}
const a = (path, opts) => http(A, path, opts);
const b = (path, opts) => http(B, path, opts);

// ---------------------------------------------------------------------------
// 3 · 断言与结果表
// ---------------------------------------------------------------------------
const results = [];
let failures = 0;
async function check(group, name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
  } catch (e) {
    failures++;
    results.push({ group, name, ok: false, detail: String(e?.message ?? e).slice(0, 220) });
  }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label ?? "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, label) {
  if (!cond) throw new Error(label ?? "assertion failed");
}
function isArr(v, label) {
  ok(Array.isArray(v), `${label ?? "value"} should be array, got ${typeof v}`);
}
function envelope(resp, status, code) {
  eq(resp.status, status, "status");
  eq(resp.body?.error?.code, code, "error.code");
  ok(typeof resp.body?.error?.message === "string", "error.message");
  ok(typeof resp.body?.error?.requestId === "string", "error.requestId");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===========================================================================
// AUTH / WORKSPACE
// ===========================================================================
let refreshCookie = "";
let plannerToken = "";
let approverToken = "";
await check("auth", "登录（admin/demo1234）→ accessToken + refresh cookie(Path=/a/v1/auth)", async () => {
  const r = await a("/a/v1/auth/login", { body: { tenantId: "demo", username: "admin", password: "demo1234" } });
  eq(r.status, 200, "status");
  ok(typeof r.body.accessToken === "string", "accessToken");
  TOKEN = r.body.accessToken;
  const sc = r.headers.get("set-cookie") ?? "";
  ok(sc.includes("refresh_token="), "set-cookie refresh_token");
  ok(sc.includes("Path=/a/v1/auth"), "cookie Path=/a/v1/auth（网关同源前缀必须匹配）");
  refreshCookie = sc.split(";")[0];
});
await check("auth", "静默刷新（cookie + 空 body，SPA silentRefresh 形态）", async () => {
  const r = await a("/a/v1/auth/refresh", { method: "POST", body: {}, headers: { cookie: refreshCookie }, token: "" });
  eq(r.status, 200, "status");
  ok(typeof r.body.accessToken === "string", "accessToken");
});
await check("auth", "planner / approver 演示账号可登录（审批链需要第二审批人）", async () => {
  const p = await a("/a/v1/auth/login", { body: { tenantId: "demo", username: "planner", password: "demo1234" } });
  eq(p.status, 200, "planner login");
  plannerToken = p.body.accessToken;
  const ap = await a("/a/v1/auth/login", { body: { tenantId: "demo", username: "approver", password: "demo1234" } });
  eq(ap.status, 200, "approver login");
  approverToken = ap.body.accessToken;
});

let workspace;
await check("workspace", "GET /a/v1/me/workspace → 前端 WorkspaceSchema 消费形态", async () => {
  const r = await a("/a/v1/me/workspace");
  eq(r.status, 200, "status");
  workspace = r.body;
  ok(workspace.tenant?.id === "demo", "tenant.id");
  isArr(workspace.navigation, "navigation");
  ok(workspace.navigation.every((n) => n.key && n.label && (n.group === "business" || n.group === "admin")), "navigation[{key,label,group}]");
  isArr(workspace.views, "views");
  ok(workspace.views.every((v) => v.viewKey || v.key), "views viewKey/key");
  isArr(workspace.scenarioPackages, "scenarioPackages");
  ok(workspace.scenarioPackages.every((p) => typeof p === "string" || typeof p?.id === "string"), "scenarioPackages [{id}]|string[]");
  isArr(workspace.features, "features");
  ok(Number.isInteger(workspace.configVersion), "configVersion");
});
const pkgId = typeof workspace?.scenarioPackages?.[0] === "string" ? workspace.scenarioPackages[0] : workspace?.scenarioPackages?.[0]?.id;

// ===========================================================================
// FEATURES（Entitlement 管理台）
// ===========================================================================
let registry = [];
await check("features", "registry / tenant get（页面构建三层树）", async () => {
  const r = await a("/a/v1/features/registry");
  eq(r.status, 200, "status");
  isArr(r.body, "registry");
  ok(r.body.every((f) => f.key && f.name && f.level), "registry[{key,name,level}]");
  registry = r.body;
  const t = await a("/a/v1/tenants/demo/features");
  eq(t.status, 200, "tenant features status");
  isArr(t.body.features, "features");
  ok(Number.isInteger(t.body.configVersion), "configVersion");
});
await check("features", "PUT 租户开关（页面 state 全量 overrides）→ configVersion", async () => {
  const resolved = await a("/a/v1/tenants/demo/features");
  const overrides = Object.fromEntries(registry.map((f) => [f.key, resolved.body.features.includes(f.key)]));
  const r = await a("/a/v1/tenants/demo/features", { method: "PUT", body: { overrides } });
  eq(r.status, 200, "status");
  ok(Number.isInteger(r.body.configVersion), "configVersion");
});
await check("features", "PUT 角色覆盖（收窄合法）→ configVersion", async () => {
  const r = await a("/a/v1/tenants/demo/features/roles/planner", { method: "PUT", body: { overrides: { "view.sop-balance": true } } });
  eq(r.status, 200, "status");
  ok(Number.isInteger(r.body.configVersion), "configVersion");
});
await check("features", "角色覆盖越过租户 → 422 ROLE_CANNOT_EXCEED_TENANT", async () => {
  const key = "view.task-dag";
  const resolved = await a("/a/v1/tenants/demo/features");
  const overrides = Object.fromEntries(registry.map((f) => [f.key, resolved.body.features.includes(f.key)]));
  overrides[key] = false;
  await a("/a/v1/tenants/demo/features", { method: "PUT", body: { overrides } });
  const r = await a("/a/v1/tenants/demo/features/roles/planner", { method: "PUT", body: { overrides: { [key]: true } } });
  envelope(r, 422, "ROLE_CANNOT_EXCEED_TENANT");
  overrides[key] = true; // 恢复
  await a("/a/v1/tenants/demo/features", { method: "PUT", body: { overrides } });
  await a("/a/v1/tenants/demo/features/roles/planner", { method: "PUT", body: { overrides: {} } });
});
await check("features", "preview?role= → {navigation[{key,label}], views[{key,title}]}", async () => {
  const r = await a("/a/v1/tenants/demo/features/preview?role=planner");
  eq(r.status, 200, "status");
  isArr(r.body.navigation, "navigation");
  isArr(r.body.views, "views");
  ok(r.body.views.every((v) => v.key && v.title), "views[{key,title}]");
});
await check("features", "audit → 数组", async () => {
  const r = await a("/a/v1/tenants/demo/features/audit");
  eq(r.status, 200, "status");
  isArr(r.body, "audit");
});

// ===========================================================================
// A1 · 连接器（ConnectionsPage 向导 / 同步 / 上传 / 健康度）
// ===========================================================================
let connectorTypes = [];
await check("A1 连接", "connector-types → [{key,category,configSchema}]", async () => {
  const r = await a("/a/v1/connector-types");
  eq(r.status, 200, "status");
  isArr(r.body, "types");
  ok(r.body.every((t) => t.key && t.category), "key/category");
  connectorTypes = r.body;
});
for (const ct of [
  "sap_erp",
  "salesforce_crm",
  "generic_jdbc",
  "rest_api",
  "knowledge_base",
  "external_feed",
  "mock_erp",
  "mock_crm",
]) {
  await check("A1 连接", `测试连接 ${ct}（向导 configSchema 必填全填）→ ok:true`, async () => {
    const type = connectorTypes.find((t) => t.key === ct);
    ok(type, `connector type ${ct} 存在`);
    const required = type.configSchema?.required ?? [];
    const config = Object.fromEntries(required.map((k) => [k, k.toLowerCase().includes("url") ? "http://example.local" : "x"]));
    const r = await a("/a/v1/connections/test", { body: { connectorTypeKey: ct, config } });
    eq(r.status, 200, "status");
    eq(r.body.ok, true, "ok");
  });
}
await check("A1 连接", "测试连接缺必填 → ok:false + message（页面红徽内联展示）", async () => {
  const r = await a("/a/v1/connections/test", { body: { connectorTypeKey: "sap_erp", config: {} } });
  eq(r.status, 200, "status");
  eq(r.body.ok, false, "ok");
  ok(typeof r.body.message === "string", "message");
});
let connId = "";
await check("A1 连接", "创建连接（mock_erp）→ 201 {id,status}", async () => {
  const r = await a("/a/v1/connections", { body: { connectorTypeKey: "mock_erp", name: "ERP 演示", config: {} } });
  eq(r.status, 201, "status");
  ok(r.body.id, "id");
  connId = r.body.id;
});
await check("A1 连接", "凭据不回显：创建 sap_erp（password）→ 响应/列表均无明文", async () => {
  const SECRET = "TOP-SECRET-9x7";
  const r = await a("/a/v1/connections", { body: { connectorTypeKey: "sap_erp", name: "SAP", config: { host: "h", client: "100", username: "u", password: SECRET } } });
  eq(r.status, 201, "status");
  ok(!JSON.stringify(r.body).includes(SECRET), "create 不回显");
  const list = await a("/a/v1/connections");
  ok(!JSON.stringify(list.body).includes(SECRET), "list 不回显");
});
await check("A1 连接", "手动同步 → 202 {syncJobId}；轮询 sync-jobs → SUCCEEDED + rowCounts", async () => {
  const r = await a(`/a/v1/connections/${connId}/sync`, { body: {} });
  eq(r.status, 202, "status");
  ok(r.body.syncJobId, "syncJobId");
  let job;
  for (let i = 0; i < 20; i++) {
    job = (await a(`/a/v1/sync-jobs/${r.body.syncJobId}`)).body;
    if (job.status === "SUCCEEDED" || job.status === "FAILED") break;
    await sleep(300);
  }
  eq(job.status, "SUCCEEDED", "job.status");
  ok(job.rowCounts && typeof job.rowCounts === "object", "rowCounts（页面 Object.entries）");
});
await check("A1 连接", "schema 页 → datasets[].fields[{name,inferredType,nullRate,uniqueRate,samples}]", async () => {
  const r = await a(`/a/v1/connections/${connId}/schema`);
  eq(r.status, 200, "status");
  isArr(r.body.datasets, "datasets");
  const f = r.body.datasets[0]?.fields?.[0];
  ok(f && f.name && f.inferredType && typeof f.nullRate === "number" && typeof f.uniqueRate === "number" && Array.isArray(f.samples), "field profile 形态");
});
let uploadConnId = "";
let rawDatasetId = "";
await check("A1 连接", "文件上传（multipart CSV，SPA FormData 形态）→ 201 {connId,datasetName}", async () => {
  const csv = "so_no,customer,qty,due_date\nSO-1,蔚途汽车,1500,2026-06-20\nSO-2,星河储能,820,2026-07-01\n";
  const fd = new FormData();
  fd.append("file", new Blob([csv], { type: "text/csv" }), "orders.csv");
  const r = await a("/a/v1/uploads", { formData: fd });
  eq(r.status, 201, "status");
  ok(r.body.connId, "connId");
  ok(r.body.datasetName, "datasetName");
  uploadConnId = r.body.connId;
});
await check("A1 连接", "上传后字段画像页 + raw-datasets 出现（建模入口可选）", async () => {
  const r = await a(`/a/v1/connections/${uploadConnId}/schema`);
  eq(r.status, 200, "status");
  ok(r.body.datasets?.[0]?.fields?.length >= 4, "fields");
  const rds = await a("/a/v1/raw-datasets");
  eq(rds.status, 200, "raw-datasets status");
  const mine = rds.body.find((d) => d.sourceConnId === uploadConnId || d.name === "orders");
  ok(mine, "raw dataset created");
  rawDatasetId = mine.id;
});
await check("A1 连接", "数据健康度 §7.22（contracts DataHealthResponseSchema parse）", async () => {
  const r = await a("/a/v1/data-health");
  eq(r.status, 200, "status");
  if (contracts?.DataHealthResponseSchema) {
    const p = contracts.DataHealthResponseSchema.safeParse(r.body);
    ok(p.success, `zod: ${p.error?.issues?.[0]?.path?.join(".")}`);
  } else isArr(r.body.sources, "sources");
});

// ===========================================================================
// A2 · 规则文档（RuleDocsPage：上传→候选→审核）
// ===========================================================================
let ruleDocId = "";
let ruleCandidates = [];
await check("A2 规则文档", "上传 .md（multipart，新上传按钮形态）→ 202 {docId,candidateCount}", async () => {
  const md = "# 产销规则\n\n## 产能承接\n单型号需求增量超过基准产能的 50% 时禁止直接承接。\n\n## 外协管理\n外协比例原则上不得超过 20%。\n";
  const fd = new FormData();
  fd.append("file", new Blob([md], { type: "text/markdown" }), "产销规则.md");
  const r = await a("/a/v1/rule-docs", { formData: fd });
  eq(r.status, 202, "status");
  ok(r.body.docId, "docId");
  ok(r.body.candidateCount >= 1, "candidateCount>=1");
  ruleDocId = r.body.docId;
});
await check("A2 规则文档", "列表/详情 → 含 segments（左栏渲染）", async () => {
  const r = await a("/a/v1/rule-docs");
  eq(r.status, 200, "status");
  const doc = r.body.find((d) => d.id === ruleDocId);
  ok(doc, "doc in list");
  isArr(doc.segments, "segments");
  ok(doc.segments.every((s) => typeof s.idx === "number" && typeof s.text === "string"), "segments[{idx,text}]");
});
await check("A2 规则文档", "候选卡形态 {candidate{…sourceQuote},status}", async () => {
  const r = await a(`/a/v1/rule-docs/${ruleDocId}/candidates`);
  eq(r.status, 200, "status");
  isArr(r.body, "candidates");
  ok(r.body.length >= 1, "non-empty");
  const c = r.body[0];
  ok(c.id && c.docId === ruleDocId && typeof c.segmentIdx === "number", "id/docId/segmentIdx");
  ok(c.candidate?.name && typeof c.candidate.expressionConfidence === "number" && c.candidate.sourceQuote, "candidate{name,expressionConfidence,sourceQuote}");
  eq(c.status, "PENDING", "status");
  ruleCandidates = r.body;
});
await check("A2 规则文档", "review APPROVE → APPROVED（入规则库）", async () => {
  const r = await a(`/a/v1/rule-candidates/${ruleCandidates[0].id}/review`, { body: { action: "APPROVE" } });
  eq(r.status, 200, "status");
  eq(r.body.status, "APPROVED", "status");
});
await check("A2 规则文档", "review EDIT_APPROVE + patch（页面编辑后通过形态）", async () => {
  const target = ruleCandidates[1] ?? ruleCandidates[0];
  const r = await a(`/a/v1/rule-candidates/${target.id}/review`, {
    body: { action: ruleCandidates[1] ? "EDIT_APPROVE" : "REJECT", patch: { name: "外协红线·改", expression: "Outsource.ratio <= 0.2", severity: "BLOCK", scopeObjectTypes: ["Order"] } },
  });
  eq(r.status, 200, "status");
});
await check("A2 规则文档", "review REJECT → REJECTED", async () => {
  // 再上传一份取得新 PENDING 候选
  const fd = new FormData();
  fd.append("file", new Blob(["## 信用\n客户在手订单金额不得超过其授信额度。\n"], { type: "text/markdown" }), "信用规则.md");
  const up = await a("/a/v1/rule-docs", { formData: fd });
  eq(up.status, 202, "upload status");
  const cands = (await a(`/a/v1/rule-docs/${up.body.docId}/candidates`)).body;
  ok(cands.length >= 1, "candidates");
  const r = await a(`/a/v1/rule-candidates/${cands[0].id}/review`, { body: { action: "REJECT" } });
  eq(r.status, 200, "status");
  eq(r.body.status, "REJECTED", "status");
});

// ===========================================================================
// A3 · 半自动建模（ModelingPage：suggest → PATCH 操作 → publish → materialize）
// ===========================================================================
let draftId = "";
let typeKey = "";
await check("A3 建模", "suggest {rawDatasetIds}（新建草案按钮形态）→ 202 {draftId}", async () => {
  const r = await a("/a/v1/modeling/suggest", { body: { rawDatasetIds: [rawDatasetId] } });
  eq(r.status, 202, "status");
  ok(r.body.draftId, "draftId");
  draftId = r.body.draftId;
});
await check("A3 建模", "drafts 列表 → datasets 字段画像 + suggestion.objectTypes（三栏渲染）", async () => {
  const r = await a("/a/v1/modeling/drafts");
  eq(r.status, 200, "status");
  const d = r.body.find((x) => x.id === draftId);
  ok(d, "draft in list");
  isArr(d.datasets, "datasets");
  ok(d.datasets[0]?.fields?.length >= 1, "datasets[].fields");
  ok(d.suggestion?.objectTypes?.length >= 1, "suggestion.objectTypes");
  typeKey = d.suggestion.objectTypes[0].typeKey;
});
await check("A3 建模", "PATCH renameType（{operations:[op]} 形态）", async () => {
  const r = await a(`/a/v1/modeling/drafts/${draftId}`, { method: "PATCH", body: { operations: [{ op: "renameType", typeKey, newTypeKey: "OrderEntity" }] } });
  eq(r.status, 200, "status");
  ok(r.body.suggestion.objectTypes.some((t) => t.typeKey === "OrderEntity"), "renamed");
  typeKey = "OrderEntity";
});
await check("A3 建模", "PATCH addProperty（页面 property 形态 incl. refToTypeKey:null）", async () => {
  const r = await a(`/a/v1/modeling/drafts/${draftId}`, {
    method: "PATCH",
    body: { operations: [{ op: "addProperty", typeKey, property: { propKey: "memo", sourceField: "customer", dataType: "string", isPrimaryKey: false, refToTypeKey: null } }] },
  });
  eq(r.status, 200, "status");
  ok(r.body.suggestion.objectTypes.find((t) => t.typeKey === typeKey).properties.some((p) => p.propKey === "memo"), "property added");
});
await check("A3 建模", "PATCH setRef / removeProperty", async () => {
  let r = await a(`/a/v1/modeling/drafts/${draftId}`, { method: "PATCH", body: { operations: [{ op: "setRef", typeKey, propKey: "memo", refToTypeKey: "Base" }] } });
  eq(r.status, 200, "setRef status");
  const p = r.body.suggestion.objectTypes.find((t) => t.typeKey === typeKey).properties.find((x) => x.propKey === "memo");
  eq(p.dataType, "ref", "dataType ref");
  r = await a(`/a/v1/modeling/drafts/${draftId}`, { method: "PATCH", body: { operations: [{ op: "removeProperty", typeKey, propKey: "memo" }] } });
  eq(r.status, 200, "removeProperty status");
});
await check("A3 建模", "publish 校验失败 → 200 {ok:false, errors[{typeKey,message}]}（卡片内联）", async () => {
  // 删除主键属性制造校验错误
  const d = (await a(`/a/v1/modeling/drafts/${draftId}`)).body;
  const pk = d.suggestion.objectTypes.find((t) => t.typeKey === typeKey).properties.find((p) => p.isPrimaryKey);
  await a(`/a/v1/modeling/drafts/${draftId}`, { method: "PATCH", body: { operations: [{ op: "removeProperty", typeKey, propKey: pk.propKey }] } });
  const r = await a(`/a/v1/modeling/drafts/${draftId}/publish`, { body: {} });
  eq(r.status, 200, "status");
  eq(r.body.ok, false, "ok:false");
  isArr(r.body.errors, "errors");
  ok(r.body.errors.every((e) => "typeKey" in e && e.message), "errors[{typeKey,message}]");
  // 加回主键
  await a(`/a/v1/modeling/drafts/${draftId}`, {
    method: "PATCH",
    body: { operations: [{ op: "addProperty", typeKey, property: { propKey: pk.propKey, sourceField: pk.sourceField, dataType: pk.dataType, isPrimaryKey: true, refToTypeKey: null } }] },
  });
});
await check("A3 建模", "publish 成功 → {ok:true}；materialize → 202 {jobId} + 轮询", async () => {
  const r = await a(`/a/v1/modeling/drafts/${draftId}/publish`, { body: {} });
  eq(r.status, 200, "publish status");
  eq(r.body.ok, true, "ok:true");
  const m = await a(`/a/v1/modeling/drafts/${draftId}/materialize`, { body: {} });
  eq(m.status, 202, "materialize status");
  ok(m.body.jobId, "jobId");
  let job;
  for (let i = 0; i < 20; i++) {
    job = (await a(`/a/v1/sync-jobs/${m.body.jobId}`)).body;
    if (job.status === "SUCCEEDED" || job.status === "FAILED") break;
    await sleep(300);
  }
  eq(job.status, "SUCCEEDED", "materialize job status");
});

// ===========================================================================
// A5 · 规则库 / A6 · 权限
// ===========================================================================
await check("A5 规则", "列表（RulesPage 渲染字段）+ create + publish", async () => {
  const list = await a("/a/v1/rules");
  eq(list.status, 200, "list status");
  ok(list.body.every((r) => r.key && r.name && r.severity && Array.isArray(r.scopeObjectTypes) && r.origin?.type && r.status && Number.isInteger(r.version)), "RuleEntry 形态");
  const c = await a("/a/v1/rules", { body: { key: `parity_rule_${Date.now()}`, name: "parity 规则", expression: "Order.qty > 0", scopeObjectTypes: ["Order"], severity: "WARN" } });
  eq(c.status, 201, "create status");
  const p = await a(`/a/v1/rules/${c.body.id}/publish`, { body: {} });
  eq(p.status, 200, "publish status");
  eq(p.body.status, "PUBLISHED", "published");
});
await check("A6 权限", "policies 列表（页面授权矩阵字段）+ create", async () => {
  const r = await a("/a/v1/policies");
  eq(r.status, 200, "status");
  ok(r.body.every((p) => p.id && p.resource?.kind && p.resource?.key && Array.isArray(p.grants)), "policy 形态");
  const c = await a("/a/v1/policies", { body: { resource: { kind: "OBJECT_TYPE", key: "OrderEntity" }, grants: [{ role: "planner", ops: ["READ"] }] } });
  eq(c.status, 201, "create status");
});
await check("A6 权限", "authz explain（调试器请求形态）→ {allowed,matched[],rowFilter}", async () => {
  const r = await a("/a/v1/authz/explain", {
    body: { user: { roles: ["base_manager:常州"], attributes: {} }, resource: { kind: "OBJECT_TYPE", key: "Base" }, op: "READ" },
  });
  eq(r.status, 200, "status");
  ok(typeof r.body.allowed === "boolean", "allowed");
  isArr(r.body.matched, "matched");
  ok(r.body.matched.every((m) => m.policyId && m.resource && m.grants), "matched[{policyId,resource,grants}]");
  ok("rowFilter" in r.body, "rowFilter");
});

// ===========================================================================
// A7 · 合成数据 + A8 · 模拟时钟（SyntheticPage）
// ===========================================================================
await check("A7 合成", "industry-templates → [{industryKey}]", async () => {
  const r = await a("/a/v1/industry-templates");
  eq(r.status, 200, "status");
  isArr(r.body, "templates");
});
let synJobId = "";
await check("A7 合成", "创建作业（battery/S/seed42）→ 202 {jobId}；六阶段轮询形态 + 报告", async () => {
  const r = await a("/a/v1/synthetic/jobs", { body: { industry: "battery-manufacturing", scale: "S", seed: 42 } });
  eq(r.status, 202, "status");
  ok(r.body.jobId, "jobId");
  synJobId = r.body.jobId;
  let job;
  for (let i = 0; i < 60; i++) {
    job = (await a(`/a/v1/synthetic/jobs/${synJobId}`)).body;
    if (job.status === "SUCCEEDED" || job.status === "FAILED") break;
    await sleep(500);
  }
  eq(job.status, "SUCCEEDED", "job.status");
  isArr(job.phases, "phases");
  eq(job.phases.length, 6, "六阶段");
  ok(job.phases.every((p) => p.name && ["PENDING", "RUNNING", "DONE", "FAILED"].includes(p.status)), "phases[{name,status}]");
  ok(job.report?.rowCounts && typeof job.report.rowCounts === "object", "report.rowCounts");
  isArr(job.report.ruleScan, "report.ruleScan");
  isArr(job.report.derivationSpotChecks, "report.derivationSpotChecks");
  if (job.report.timeseries) {
    ok(job.report.timeseries.every((s) => s.seriesKey && typeof s.points === "number" && typeof s.gaps === "number" && typeof s.aggSpotCheckOk === "boolean"), "report.timeseries VM");
  }
});
await check("A8 时钟", "GET clock → {simDate,currentTick,status,script[]}", async () => {
  const r = await a("/a/v1/synthetic/clock");
  eq(r.status, 200, "status");
  ok(typeof r.body.simDate === "string", "simDate");
  ok(Number.isInteger(r.body.currentTick), "currentTick");
  ok(["ACTIVE", "TICKING", "RESETTING"].includes(r.body.status), "status enum");
  isArr(r.body.script, "script");
  ok(r.body.script.every((s) => Number.isInteger(s.tick) && s.event && typeof s.fired === "boolean"), "script[{tick,event,fired}]");
});
await check("A8 时钟", "tick 1d → 202 {tickJobId}；ticks 报告流 VM（newPoints/changedProps/newAlerts）", async () => {
  const r = await a("/a/v1/synthetic/clock/tick", { body: { advance: "1d" } });
  eq(r.status, 202, "status");
  ok(r.body.tickJobId, "tickJobId");
  for (let i = 0; i < 20; i++) {
    const c = (await a("/a/v1/synthetic/clock")).body;
    if (c.status !== "TICKING") break;
    await sleep(300);
  }
  const ticks = await a("/a/v1/synthetic/clock/ticks");
  eq(ticks.status, 200, "ticks status");
  ok(ticks.body.length >= 1, "ticks non-empty");
  const t = ticks.body[0];
  ok(Number.isInteger(t.tick), "tick");
  ok(typeof t.simDate === "string", "simDate");
  ok(typeof t.newPoints === "number", "newPoints（页面 toLocaleString）");
  isArr(t.changedProps, "changedProps");
  ok(t.changedProps.every((c) => c.object && c.prop !== undefined), "changedProps[{object,prop,from,to}]");
  isArr(t.newAlerts, "newAlerts");
  isArr(t.clearedAlerts, "clearedAlerts");
});
await check("A8 时钟", "reset → 202 时钟 VM（页面立即重渲染）", async () => {
  const r = await a("/a/v1/synthetic/clock/reset", { body: {} });
  eq(r.status, 202, "status");
  ok(typeof r.body.simDate === "string", "simDate");
  eq(r.body.currentTick, 0, "currentTick=0");
  isArr(r.body.script, "script");
});

// ===========================================================================
// 计划域 / S&OP / 校准（业务视图写路径）
// ===========================================================================
await check("计划域", "AOP / 季度滚动（contracts schema parse —— 前端就是这样消费）", async () => {
  const aop = await a("/a/v1/plan/aop?year=2026");
  eq(aop.status, 200, "aop status");
  if (contracts?.AopResponseSchema) ok(contracts.AopResponseSchema.safeParse(aop.body).success, "AopResponseSchema parse");
  const q = await a("/a/v1/plan/quarterly?from=2026-Q3&n=6");
  eq(q.status, 200, "quarterly status");
  if (contracts?.QuarterlyResponseSchema) ok(contracts.QuarterlyResponseSchema.safeParse(q.body).success, "QuarterlyResponseSchema parse");
});
let sopId = "";
await check("S&OP", "创建月度版本 → 201；列表/详情", async () => {
  const r = await a("/a/v1/sop/versions", { body: { month: "2026-08" } });
  eq(r.status, 201, "status");
  sopId = r.body.id;
  const list = await a("/a/v1/sop/versions");
  ok(list.body.some((v) => v.id === sopId), "in list");
});
await check("S&OP", "PATCH 字段平铺形态（SPA patchSopVersion 形态）→ inputs 合并", async () => {
  const r = await a(`/a/v1/sop/versions/${sopId}`, { method: "PATCH", body: { demTotal: 133 } });
  eq(r.status, 200, "status");
  eq(r.body.inputs?.demTotal, 133, "inputs.demTotal");
});
await check("S&OP", "PATCH {fields:{…}} 兼容形态（API 调用方）", async () => {
  const r = await a(`/a/v1/sop/versions/${sopId}`, { method: "PATCH", body: { fields: { demTotal: 135 } } });
  eq(r.status, 200, "status");
  eq(r.body.inputs?.demTotal, 135, "inputs.demTotal");
});
await check("S&OP", "五步法 advance ①→⑤ + finalize；FINAL 后 PATCH → 409 PLAN_LOCKED", async () => {
  for (const [step, payload] of [
    [1, {}],
    [2, {}],
    [3, {}],
    [4, { revSum: 100, gmSum: 25, gmBudget: 15, cashCushion: 9999 }],
    [5, { resolutions: [{ name: "外协补缺", delta: 0.5 }] }],
  ]) {
    const r = await a(`/a/v1/sop/versions/${sopId}/advance`, { body: { step, payload } });
    eq(r.status, 200, `step${step} status`);
  }
  const fin = await a(`/a/v1/sop/versions/${sopId}/finalize`, { body: {} });
  eq(fin.status, 200, "finalize status");
  eq(fin.body.status, "FINAL", "FINAL");
  const locked = await a(`/a/v1/sop/versions/${sopId}`, { method: "PATCH", body: { demTotal: 140 } });
  envelope(locked, 409, "PLAN_LOCKED");
});
await check("S&OP", "GET /a/v1/plan-versions/current（规划体检基线 —— SPA PlanVersionCurrentSchema parse）", async () => {
  const r = await a("/a/v1/plan-versions/current");
  eq(r.status, 200, "status");
  if (contracts?.PlanVersionCurrentSchema) ok(contracts.PlanVersionCurrentSchema.safeParse(r.body).success, "PlanVersionCurrentSchema parse");
  ok(typeof r.body.versionLabel === "string" && r.body.versionLabel.length > 0, "versionLabel");
  for (const k of ["dem", "seg_pas", "seg_ess", "seg_com", "sup", "ltaCov", "kitGap", "gmTarget", "cashCushion", "capex"]) {
    ok(typeof r.body.input?.[k] === "number", `input.${k} number`);
  }
  // 上一检定稿了 2026-08 → current 应解析到该 FINAL 版本（供给=supFinal）
  eq(r.body.versionId, sopId, "versionId = 最新 FINAL 版本");
  eq(r.body.status, "FINAL", "status FINAL");
});
await check("S&OP", "定稿走 Action（增量 §7.12）：草稿 → 版本待审批 → admin 批准 → EXECUTED → FINAL；变更走 计划版本变更", async () => {
  // SPA SopBalanceView 形态：planner 创建版本并推进 ①→⑤ 到 EXEC_MEETING
  const created = await a("/a/v1/sop/versions", { token: plannerToken, body: { month: "2026-09", inputs: { demTotal: 132 } } });
  eq(created.status, 201, "create status");
  const vid = created.body.id;
  for (const [step, payload] of [
    [1, {}],
    [2, {}],
    [3, {}],
    [4, { revSum: 248, gmSum: 39.7, gmBudget: 15.5, cashCushion: 58 }],
    [5, { resolutions: [{ name: "常州化成夜班×1", delta: 1.2 }] }],
  ]) {
    const r = await a(`/a/v1/sop/versions/${vid}/advance`, { token: plannerToken, body: { step, payload } });
    eq(r.status, 200, `step${step} status`);
  }
  // 定稿按钮 = POST /a/v1/action-drafts actionType=定稿月度计划版本（不再直接 POST finalize）
  const draft = await a("/a/v1/action-drafts", {
    token: plannerToken,
    body: {
      actionTypeKey: "定稿月度计划版本",
      payload: { versionId: vid, month: "2026-09", snapshot: {}, resolutions: [{ name: "常州化成夜班×1", delta: 1.2 }] },
      origin: { userId: "usr_demo_planner" },
      submit: true,
    },
  });
  eq(draft.status, 201, "draft status");
  eq(draft.body.status, "PENDING_APPROVAL", "PENDING_APPROVAL");
  const pending = await a(`/a/v1/sop/versions/${vid}`, { token: plannerToken });
  eq(pending.body.status, "EXEC_MEETING", "版本未 FINAL（待审批）");
  eq(pending.body.pendingApproval?.draftId, draft.body.draftId, "version.pendingApproval.draftId");
  // admin 批准（SPA decideActionDraft 形态）→ 域执行器：草稿 EXECUTED、版本 FINAL、pendingApproval 清空
  const dec = await a(`/a/v1/action-drafts/${draft.body.draftId}/decision`, { body: { decision: "APPROVE", comment: "月度定稿" } });
  eq(dec.status, 200, "decision status");
  eq(dec.body.status, "EXECUTED", "EXECUTED");
  const fin = await a(`/a/v1/sop/versions/${vid}`, { token: plannerToken });
  eq(fin.body.status, "FINAL", "FINAL");
  ok(fin.body.pendingApproval == null, "pendingApproval cleared");
  // C22 锁定：直改 409；变更走 计划版本变更 Action，EXECUTED 后 inputs 落库
  const locked = await a(`/a/v1/sop/versions/${vid}`, { method: "PATCH", token: plannerToken, body: { demTotal: 140 } });
  envelope(locked, 409, "PLAN_LOCKED");
  const change = await a("/a/v1/action-drafts", {
    token: plannerToken,
    body: {
      actionTypeKey: "计划版本变更",
      payload: { versionId: vid, reason: "需求口径修订", patch: { demTotal: 140 } },
      origin: { userId: "usr_demo_planner" },
      submit: true,
    },
  });
  eq(change.status, 201, "change draft status");
  const changeDec = await a(`/a/v1/action-drafts/${change.body.draftId}/decision`, { body: { decision: "APPROVE", comment: "同意变更" } });
  eq(changeDec.body.status, "EXECUTED", "change EXECUTED");
  const patched = await a(`/a/v1/sop/versions/${vid}`, { token: plannerToken });
  eq(patched.body.inputs?.demTotal, 140, "inputs.demTotal 落库");
  eq(patched.body.status, "FINAL", "仍 FINAL");
});
let calibProposalId = "";
let calibDraftId = "";
await check("校准", "report（带筛选，CalibrationReportSchema parse）/ proposals / history（M11 形态）", async () => {
  const r = await a(`/a/v1/calibration/report?objectType=${encodeURIComponent("产能预测")}`);
  eq(r.status, 200, "report status");
  if (contracts?.CalibrationReportSchema) ok(contracts.CalibrationReportSchema.safeParse(r.body).success, "schema parse");
  const props = await a("/a/v1/calibration/proposals");
  eq(props.status, 200, "proposals status");
  ok(props.body.length >= 1, "proposals seeded");
  const p = props.body[0];
  ok(p.id && p.parameter && p.basis?.windowFrom && Number.isInteger(p.basis.samples) && p.status, "proposal 形态");
  if (contracts?.CalibrationProposalSchema) {
    ok(props.body.every((x) => contracts.CalibrationProposalSchema.safeParse(x).success), "proposal schema parse（M11 增量字段）");
  }
  // M11 增量：method + 回测证据 evidence（种子提案即携带）
  const withEvidence = props.body.find((x) => x.method && x.evidence);
  ok(withEvidence, "method/evidence 字段存在");
  ok(
    withEvidence.evidence.windowFrom &&
      Number.isInteger(withEvidence.evidence.nPairs) &&
      typeof withEvidence.evidence.mapeBefore === "number" &&
      typeof withEvidence.evidence.simulatedMapeAfter === "number" &&
      Array.isArray(withEvidence.evidence.flags),
    "evidence 形态（窗口/nPairs/mapeBefore/simulatedMapeAfter/flags）",
  );
  calibProposalId = props.body.find((x) => x.status === "PENDING")?.id ?? p.id;
  const hist = await a("/a/v1/calibration/history");
  eq(hist.status, 200, "history status");
  ok(hist.body.every((h) => h.at && h.trigger && Array.isArray(h.changedParams)), "history 形态");
  // M11 元闭环：预言 vs 实现（种子历史带 simulatedMapeAfter/realizedMape）
  ok(hist.body.some((h) => typeof h.simulatedMapeAfter === "number" && typeof h.realizedMape === "number"), "预言 vs 实现 字段");
});
await check("校准", "POST /calibration/run（M11 §3 手动「立即校准」，catalog_admin）→ 运行摘要", async () => {
  const r = await a("/a/v1/calibration/run", { body: {} });
  eq(r.status, 200, "status");
  if (contracts?.CalibrationRunResultSchema) ok(contracts.CalibrationRunResultSchema.safeParse(r.body).success, "run result schema parse");
  ok(Number.isInteger(r.body.paired) && Number.isInteger(r.body.slicesEvaluated), "run 摘要形态");
});
await check("校准", "批准提案（admin 点击）→ 202 {draftId,status}（走 S2 审批，不直改）", async () => {
  const r = await a(`/a/v1/calibration/proposals/${calibProposalId}/approve`, { body: {} });
  eq(r.status, 202, "status");
  ok(r.body.draftId, "draftId");
  eq(r.body.status, "PENDING_APPROVAL", "PENDING_APPROVAL");
  calibDraftId = r.body.draftId;
});

// ===========================================================================
// S2 · Action 审批（ActionsPage）
// ===========================================================================
let actionDraftId = "";
await check("S2 审批", "planner 采纳（plan_change，sim 视图形态）→ 201 PENDING_APPROVAL", async () => {
  const r = await a("/a/v1/action-drafts", {
    token: plannerToken,
    body: { actionTypeKey: "plan_change", payload: { versionId: "plan-balanced", reason: "采纳规划方案" }, origin: { userId: "usr_demo_planner" }, submit: true },
  });
  eq(r.status, 201, "status");
  ok(r.body.draftId, "draftId");
  eq(r.body.status, "PENDING_APPROVAL", "status");
  actionDraftId = r.body.draftId;
});
await check("S2 审批", "列表 ?status= 与 ?role=mine（待我审批）", async () => {
  const byStatus = await a("/a/v1/action-drafts?status=PENDING_APPROVAL");
  eq(byStatus.status, 200, "status filter");
  ok(byStatus.body.some((d) => d.id === actionDraftId), "in status list");
  const mine = await a("/a/v1/action-drafts?role=mine");
  eq(mine.status, 200, "role=mine");
  ok(mine.body.some((d) => d.id === actionDraftId), "admin 待审包含 planner 草稿");
});
await check("S2 审批", "详情 → payload/origin/approvalSteps（页面渲染字段）", async () => {
  const r = await a(`/a/v1/action-drafts/${actionDraftId}`);
  eq(r.status, 200, "status");
  ok(r.body.payload && r.body.origin?.userId, "payload/origin");
  isArr(r.body.approvalSteps, "approvalSteps");
  ok(r.body.approvalSteps.every((s) => Number.isInteger(s.seq) && s.role), "steps[{seq,role}]");
  ok(typeof r.body.createdAt === "string", "createdAt");
});
await check("S2 审批", "decision APPROVE + comment（单端点别名）→ EXECUTED", async () => {
  const r = await a(`/a/v1/action-drafts/${actionDraftId}/decision`, { body: { decision: "APPROVE", comment: "同意" } });
  eq(r.status, 200, "status");
  ok(["APPROVED", "EXECUTED"].includes(r.body.status), `status ${r.body.status}`);
});
await check("S2 审批", "decision REJECT + comment → REJECTED", async () => {
  const c = await a("/a/v1/action-drafts", {
    token: plannerToken,
    body: { actionTypeKey: "plan_change", payload: { versionId: "plan-x", reason: "驳回演示" }, origin: { userId: "usr_demo_planner" }, submit: true },
  });
  eq(c.status, 201, "create");
  const r = await a(`/a/v1/action-drafts/${c.body.draftId}/decision`, { body: { decision: "REJECT", comment: "不同意" } });
  eq(r.status, 200, "status");
  eq(r.body.status, "REJECTED", "REJECTED");
  const step = r.body.approvalSteps.find((s) => s.decision === "REJECT");
  eq(step?.comment, "不同意", "comment 留痕");
});
await check("S2 审批", "cancel（暂存草稿可取消）→ CANCELLED", async () => {
  const c = await a("/a/v1/action-drafts", {
    body: { actionTypeKey: "plan_change", payload: { versionId: "plan-y", reason: "取消演示" }, origin: { userId: "usr_demo_admin" }, submit: false },
  });
  eq(c.status, 201, "create");
  const r = await a(`/a/v1/action-drafts/${c.body.draftId}/cancel`, { body: {} });
  eq(r.status, 200, "status");
  eq(r.body.status, "CANCELLED", "CANCELLED");
});
await check("S2 审批", "校准草稿由第二审批人（approver）APPROVE → 提案 APPLIED + 历史增长", async () => {
  const r = await a(`/a/v1/action-drafts/${calibDraftId}/decision`, { token: approverToken, body: { decision: "APPROVE", comment: "校准生效" } });
  eq(r.status, 200, "status");
  ok(["APPROVED", "EXECUTED"].includes(r.body.status), `status ${r.body.status}`);
  const props = await a("/a/v1/calibration/proposals");
  const p = props.body.find((x) => x.id === calibProposalId);
  eq(p?.status, "APPLIED", "proposal APPLIED");
});

// ===========================================================================
// B · LLM 供应商（凭据不回显）+ 绑定（QOS 走 stub 全链）
// ===========================================================================
await check("B LLM", "创建 provider（credential 不回显，仅 credentialRef）", async () => {
  const SECRET = "LLM-SECRET-42";
  const r = await b("/b/v1/llm/providers", {
    body: { key: "parity-stub", kind: "openai_compatible", baseUrl: `http://127.0.0.1:${llmPort}`, credential: SECRET, status: "ACTIVE" },
  });
  eq(r.status, 201, "status");
  ok(!JSON.stringify(r.body).includes(SECRET), "不回显");
  ok(r.body.credentialRef, "credentialRef");
  const list = await b("/b/v1/llm/providers");
  ok(!JSON.stringify(list.body).includes(SECRET), "list 不回显");
  const put = await b(`/b/v1/llm/providers/${r.body.id}`, { method: "PUT", body: { baseUrl: `http://127.0.0.1:${llmPort}` } });
  eq(put.status, 200, "PUT status");
});
await check("B LLM", "PUT bindings（classifier/agent/compose → stub）", async () => {
  const r = await b("/b/v1/llm/bindings", {
    method: "PUT",
    body: {
      bindings: [
        { role: "classifier", providerKey: "parity-stub", model: "stub-1" },
        { role: "agent", providerKey: "parity-stub", model: "stub-1" },
        { role: "compose", providerKey: "parity-stub", model: "stub-1" },
      ],
    },
  });
  eq(r.status, 200, "status");
  isArr(r.body, "bindings list");
});

// ===========================================================================
// B1 · Agents（AgentsPage 编辑器/发布）
// ===========================================================================
let agentId = "";
await check("B1 Agent", "列表 + 创建（create body 不带 id/tenantId/version/status）", async () => {
  const list = await b("/b/v1/agents");
  eq(list.status, 200, "list status");
  isArr(list.body, "agents");
  const r = await b("/b/v1/agents", {
    body: {
      key: "parity_agent",
      name: "parity 探针",
      description: "d",
      model: "claude-opus-4-8",
      systemPrompt: "你是产能分析助手",
      tools: [{ kind: "BUILTIN", name: "query_objects" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] },
      budget: { maxIterations: 4 },
    },
  });
  eq(r.status, 201, "create status");
  eq(r.body.status, "DRAFT", "DRAFT");
  agentId = r.body.id;
});
await check("B1 Agent", "PUT（编辑器 form 形态：仅页面字段，无 key/mcpServers）", async () => {
  const r = await b(`/b/v1/agents/${agentId}`, {
    method: "PUT",
    body: {
      name: "parity 探针·改",
      description: "d2",
      model: "claude-opus-4-8",
      systemPrompt: "你是产能分析助手 v2",
      tools: [{ kind: "BUILTIN", name: "query_objects" }, { kind: "BUILTIN", name: "invoke_solver" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "BOTH" },
      skills: [],
      scopeDeclaration: { objectTypes: ["Order", "Base"], toolNames: ["query_objects", "invoke_solver"] },
      budget: { maxIterations: 6 },
    },
  });
  eq(r.status, 200, "status");
  eq(r.body.name, "parity 探针·改", "name updated");
});
await check("B1 Agent", "publish → {ok:true}（页面读 r.ok）", async () => {
  const r = await b(`/b/v1/agents/${agentId}/publish`, { body: {} });
  eq(r.status, 200, "status");
  eq(r.body.ok, true, "ok:true");
});
await check("B1 Agent", "publish 校验失败（空 scope/空提示词）→ {ok:false, errors[{field,message}]}", async () => {
  const c = await b("/b/v1/agents", {
    body: {
      key: "parity_agent_bad",
      name: "无范围",
      description: "",
      model: "m",
      systemPrompt: "",
      tools: [],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: [], toolNames: [] },
    },
  });
  eq(c.status, 201, "create");
  const r = await b(`/b/v1/agents/${c.body.id}/publish`, { body: {} });
  eq(r.status, 200, "status");
  eq(r.body.ok, false, "ok:false");
  ok(r.body.errors?.every((e) => e.field && e.message), "errors[{field,message}]");
});

// ===========================================================================
// B2 · Workflows（WorkflowsPage 步骤编辑器/发布错误定位/运行）
// ===========================================================================
let wfId = "";
await check("B2 Workflow", "创建 + PUT {steps}（页面只发 steps）", async () => {
  const r = await b("/b/v1/workflows", {
    body: {
      key: "parity_wf",
      name: "parity 流程",
      inputs: { type: "object", properties: {} },
      steps: [
        { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
        { id: "s2", type: "render_answer", params: { blocks: [] } },
      ],
    },
  });
  eq(r.status, 201, "create status");
  wfId = r.body.id;
  const put = await b(`/b/v1/workflows/${wfId}`, {
    method: "PUT",
    body: {
      steps: [
        { id: "s1", type: "query_objects", params: { objectType: "Order", filter: { x: "{{steps.s9.output}}" } } },
        { id: "s2", type: "render_answer", params: { blocks: [] } },
      ],
    },
  });
  eq(put.status, 200, "PUT status");
});
await check("B2 Workflow", "publish 前向引用 → 200 {ok:false, errors[{stepId,code,message}]}（行内定位）", async () => {
  const r = await b(`/b/v1/workflows/${wfId}/publish`, { body: {} });
  eq(r.status, 200, "status");
  eq(r.body.ok, false, "ok:false");
  isArr(r.body.errors, "errors");
  ok(r.body.errors.some((e) => e.stepId === "s1"), "stepId 定位");
  ok(r.body.errors.every((e) => e.code && e.message), "code/message");
});
await check("B2 Workflow", "修正后 publish → {ok:true}；run → 200 {runId,status}", async () => {
  await b(`/b/v1/workflows/${wfId}`, {
    method: "PUT",
    body: {
      steps: [
        { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
        { id: "s2", type: "render_answer", params: { blocks: [] } },
      ],
    },
  });
  const r = await b(`/b/v1/workflows/${wfId}/publish`, { body: {} });
  eq(r.status, 200, "publish status");
  eq(r.body.ok, true, "ok:true");
  const run = await b(`/b/v1/workflows/${wfId}/run`, { body: { inputs: {} } });
  eq(run.status, 200, "run status");
  ok(run.body.runId, "runId");
  eq(run.body.status, "COMPLETED", "COMPLETED");
});

// ===========================================================================
// B4 · Skills / B3 · MCP / B5 · Scenes
// ===========================================================================
await check("B4 Skill", "create / PUT（页面 {name,summary,body}）/ publish", async () => {
  const c = await b("/b/v1/skills", { body: { key: "parity_skill", name: "parity 技能", summary: "s", body: "# md", resources: [] } });
  eq(c.status, 201, "create status");
  const put = await b(`/b/v1/skills/${c.body.id}`, { method: "PUT", body: { name: "parity 技能·改", summary: "s2", body: "# md2" } });
  eq(put.status, 200, "PUT status");
  const pub = await b(`/b/v1/skills/${c.body.id}/publish`, { body: {} });
  eq(pub.status, 200, "publish status");
  eq(pub.body.status, "PUBLISHED", "PUBLISHED");
});
let mcpId = "";
await check("B3 MCP", "create（secret 不回显）/ PUT（凭据留空=不修改）", async () => {
  const SECRET = "MCP-SECRET-7";
  const r = await b("/b/v1/mcp-configs", {
    body: { name: "parity-mcp", transport: { type: "streamable_http", url: "http://127.0.0.1:9/mcp" }, credential: SECRET, status: "ACTIVE" },
  });
  eq(r.status, 201, "create status");
  ok(!JSON.stringify(r.body).includes(SECRET), "不回显");
  ok(r.body.credentialRef, "credentialRef");
  mcpId = r.body.id;
  const put = await b(`/b/v1/mcp-configs/${mcpId}`, {
    method: "PUT",
    body: { name: "parity-mcp·改", transport: { type: "streamable_http", url: "http://127.0.0.1:9/mcp" }, status: "ACTIVE" },
  });
  eq(put.status, 200, "PUT status");
  eq(put.body.credentialRef, r.body.credentialRef, "凭据留空 → credentialRef 不变");
});
await check("B3 MCP", "连接测试（不可达 → ok:false + message，不抛 5xx）", async () => {
  const r = await b(`/b/v1/mcp-configs/${mcpId}/test`, { body: {} });
  eq(r.status, 200, "status");
  eq(r.body.ok, false, "ok:false");
  isArr(r.body.tools, "tools");
  ok(typeof r.body.message === "string", "message");
});
await check("B5 场景", "scene-entries 列表 / scenes?view= 单对象", async () => {
  const list = await b("/b/v1/scene-entries");
  eq(list.status, 200, "list status");
  ok(list.body.length >= 1, "non-empty");
  ok(list.body.every((s) => s.viewKey && s.mode && s.uiHints?.placeholder !== undefined && Array.isArray(s.uiHints.suggestedQuestions)), "SceneEntry 形态");
  const one = await b("/b/v1/scenes?view=dash");
  eq(one.status, 200, "scenes?view status");
  eq(one.body?.viewKey, "dash", "single entry");
});
await check("B5 场景", "PUT（页面部分字段形态）→ 200；AGENT_* 无 defaultAgentId → 400", async () => {
  const r = await b("/b/v1/scene-entries/dash", {
    method: "PUT",
    body: { mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问点什么…", suggestedQuestions: ["产能缺口多大？"] } },
  });
  eq(r.status, 200, "status");
  eq(r.body.mode, "WORKFLOW_FIRST", "mode saved");
  const bad = await b("/b/v1/scene-entries/dash", {
    method: "PUT",
    body: { mode: "AGENT_FIRST", uiHints: { placeholder: "p", suggestedQuestions: [] } },
  });
  envelope(bad, 400, "VALIDATION_ERROR");
  // 恢复
  await b("/b/v1/scene-entries/dash", {
    method: "PUT",
    body: { mode: "WORKFLOW_FIRST", uiHints: { placeholder: "问点什么…", suggestedQuestions: ["产能缺口多大？"] } },
  });
});

// ===========================================================================
// B · 同步求解器代理（推演视图）
// ===========================================================================
await check("B 求解代理", "solvers/:key/run（OBO 透传）→ {data,snapshotVersion}", async () => {
  const r = await b("/b/v1/solvers/capacity_forecast/run", { body: { args: { modelId: "4680-NCM", weeks: 6 } } });
  eq(r.status, 200, "status");
  ok("data" in r.body, "data");
  ok(typeof r.body.snapshotVersion === "string", "snapshotVersion");
});
await check("B 求解代理", "上游校验错误透传（modelId 缺失 → 400 VALIDATION_ERROR，非 500）", async () => {
  const r = await b("/b/v1/solvers/capacity_forecast/run", { body: { args: {} } });
  envelope(r, 400, "VALIDATION_ERROR");
});

// ===========================================================================
// QOS · QueryDock（提交 → SSE → 任务详情）+ 兜底留痕 → promote
// ===========================================================================
let taskId = "";
await check("QOS", "提交查询（SPA buildContext 形态 + Idempotency-Key）→ 202 {taskId,streamUrl}", async () => {
  const idem = `parity-${Date.now()}`;
  const r = await b("/b/v1/queries", {
    headers: { "idempotency-key": idem },
    body: { packageId: pkgId, query: "常州基地下月产能缺口多大？", context: { view: "dash", selectedObjects: [], filters: {} } },
  });
  eq(r.status, 202, "status");
  ok(r.body.taskId, "taskId");
  ok(typeof r.body.streamUrl === "string", "streamUrl");
  taskId = r.body.taskId;
  // 幂等：同 key 重发 → 同 taskId
  const again = await b("/b/v1/queries", {
    headers: { "idempotency-key": idem },
    body: { packageId: pkgId, query: "常州基地下月产能缺口多大？", context: { view: "dash", selectedObjects: [], filters: {} } },
  });
  eq(again.status, 202, "idem status");
  eq(again.body.taskId, taskId, "idempotent taskId");
});
await check("QOS", "SSE 连接（EventSource ?access_token= 形态）→ text/event-stream", async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${B}/b/v1/queries/${taskId}/events?access_token=${TOKEN}`, {
    headers: { accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  eq(res.status, 200, "status");
  ok(String(res.headers.get("content-type")).includes("text/event-stream"), "content-type");
  ctrl.abort();
});
await check("QOS", "任务终态合理（stub 分类 out-of-catalog → 路径 B → ANSWERED/合理失败）", async () => {
  let task;
  for (let i = 0; i < 30; i++) {
    task = (await b(`/b/v1/queries/${taskId}`)).body;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) break;
    await sleep(400);
  }
  ok(["COMPLETED", "FAILED"].includes(task.status), `终态 ${task.status}`);
  eq(task.path, "AGENT", "路径 B");
  if (task.status === "FAILED") ok(task.error?.code, "失败必须带错误信封（不崩溃）");
});
await check("QOS", "反馈 UP → 204", async () => {
  const r = await b(`/b/v1/queries/${taskId}/feedback`, { body: { vote: "UP" } });
  eq(r.status, 204, "status");
});

// ===========================================================================
// Catalog（CatalogPage）+ Ops（OpsFallbackPage）
// ===========================================================================
let intentId = "";
let planIdForIntent = "";
await check("Catalog", "intents 列表（含 ?status= 过滤）/ plans 列表（页面下拉形态）", async () => {
  const r = await b(`/b/v1/catalog/packages/${pkgId}/intents`);
  eq(r.status, 200, "status");
  ok(r.body.length >= 1, "intents seeded");
  ok(r.body.every((i) => i.id && i.key && i.name && Number.isInteger(i.version) && i.status && Array.isArray(i.slots) && Array.isArray(i.examples) && i.planId), "IntentDefinition 形态");
  const drafts = await b(`/b/v1/catalog/packages/${pkgId}/intents?status=PUBLISHED`);
  ok(drafts.body.every((i) => i.status === "PUBLISHED"), "status filter");
  const plans = await b(`/b/v1/catalog/packages/${pkgId}/plans`);
  eq(plans.status, 200, "plans status");
  ok(plans.body.every((p) => p.id && p.key && Number.isInteger(p.version) && p.status), "plans[{id,key,version,status}]");
  planIdForIntent = plans.body[0].id;
});
await check("Catalog", "创建意图 → PUT（编辑器字段）→ publish → retire", async () => {
  const c = await b(`/b/v1/catalog/packages/${pkgId}/intents`, {
    body: {
      key: "parity_intent",
      name: "parity 意图",
      description: "d",
      examples: ["常州产能如何"],
      enabledViews: "*",
      slots: [{ name: "base", type: "string", required: false, description: "" }],
      planId: planIdForIntent,
      riskLevel: "READ",
      owner: "parity",
    },
  });
  eq(c.status, 201, "create status");
  intentId = c.body.id;
  const put = await b(`/b/v1/catalog/intents/${intentId}`, {
    method: "PUT",
    body: { name: "parity 意图·改", description: "d2", examples: ["常州产能如何", "缺口多大"], slots: c.body.slots, planId: planIdForIntent },
  });
  eq(put.status, 200, "PUT status");
  const pub = await b(`/b/v1/catalog/intents/${intentId}/publish`, { body: {} });
  eq(pub.status, 200, "publish status");
  eq(pub.body.status, "PUBLISHED", "PUBLISHED");
  const ret = await b(`/b/v1/catalog/intents/${intentId}/retire`, { body: {} });
  eq(ret.status, 200, "retire status");
  eq(ret.body.status, "RETIRED", "RETIRED");
});
await check("Catalog", "plan create + publish 校验（无 render_answer → 400 PLAN_VALIDATION_ERROR 信封）", async () => {
  const c = await b(`/b/v1/catalog/packages/${pkgId}/plans`, {
    body: { key: "parity_plan_bad", steps: [{ id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } }] },
  });
  eq(c.status, 201, "create status");
  const bad = await b(`/b/v1/catalog/plans/${c.body.id}/publish`, { body: {} });
  envelope(bad, 400, "PLAN_VALIDATION_ERROR");
  const fix = await b(`/b/v1/catalog/plans/${c.body.id}`, {
    method: "PUT",
    body: {
      steps: [
        { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
        { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
      ],
    },
  });
  eq(fix.status, 200, "PUT status");
  const pub = await b(`/b/v1/catalog/plans/${c.body.id}/publish`, { body: {} });
  eq(pub.status, 200, "publish status");
});
await check("Ops 兜底", "fallback-stats → {items[{traceId,querySample,count,trend,topToolSketch}]}", async () => {
  const r = await b(`/b/v1/ops/fallback-stats?packageId=${pkgId}`);
  eq(r.status, 200, "status");
  isArr(r.body.items, "items");
  ok(r.body.items.length >= 1, "QOS 兜底已留痕（路径 B 执行后）");
  const c = r.body.items[0];
  ok(typeof c.traceId === "string" && c.traceId.length > 0, "traceId（promote 按钮入参）");
  ok(typeof c.querySample === "string", "querySample");
  ok(Number.isInteger(c.count), "count");
  isArr(c.trend, "trend（sparkline）");
  isArr(c.topToolSketch, "topToolSketch");
  ok(c.topToolSketch.every((t) => typeof t === "string"), "topToolSketch string[]");
  ok(c.outcomeBreakdown && typeof c.outcomeBreakdown === "object", "outcomeBreakdown");
});
await check("Ops 兜底", "promote → 201 {intentId}（孵化 DRAFT 意图，页面跳转编辑）", async () => {
  const stats = await b(`/b/v1/ops/fallback-stats?packageId=${pkgId}`);
  const traceId = stats.body.items[0]?.traceId;
  ok(traceId, "traceId 存在");
  const r = await b(`/b/v1/ops/fallback/${traceId}/promote`, { body: {} });
  eq(r.status, 201, "status");
  ok(r.body.intentId, "intentId");
  const intent = (await b(`/b/v1/catalog/packages/${pkgId}/intents?status=DRAFT`)).body.find((i) => i.id === r.body.intentId);
  ok(intent, "DRAFT 意图已入目录");
});

// ===========================================================================
// Entitlement 联动（功能关→404 FEATURE_NOT_FOUND，先于 authz）
// ===========================================================================
await check("Entitlement", "关闭 view.project-sim → B 侧 capacity_forecast 代理 404 FEATURE_NOT_FOUND", async () => {
  const resolved = await a("/a/v1/tenants/demo/features");
  const overrides = Object.fromEntries(registry.map((f) => [f.key, resolved.body.features.includes(f.key)]));
  const bound = registry.find((f) => f.bindings?.solverKeys?.includes("capacity_forecast"));
  ok(bound, "存在绑定 capacity_forecast 的功能");
  overrides[bound.key] = false;
  await a("/a/v1/tenants/demo/features", { method: "PUT", body: { overrides } });
  const r = await b("/b/v1/solvers/capacity_forecast/run", { body: { args: { modelId: "4680-NCM" } } });
  envelope(r, 404, "FEATURE_NOT_FOUND");
  overrides[bound.key] = true; // 恢复
  await a("/a/v1/tenants/demo/features", { method: "PUT", body: { overrides } });
});

// ===========================================================================
// 管理平台增量（M1–M8）：bootstrap / 租户用户 / 场景包视图 / 统一资源模式 / 规则 dry-run
// ===========================================================================
let padminToken = "";
await check("M1 Bootstrap", "SEED_DEMO=1 → readyz 不被 bootstrap 闸拦（bootstrap-bypass）；超管已创建可登录", async () => {
  const ready = await a("/a/v1/readyz", { token: "" });
  eq(ready.status, 200, "readyz");
  const login = await a("/a/v1/auth/login", { token: "", body: { tenantId: "default", username: "ops@parity.io", password: "parity-boot-1" } });
  eq(login.status, 200, "platform_admin login");
  ok(login.body.user.roles.includes("platform_admin"), "roles 含 platform_admin");
  padminToken = login.body.accessToken;
});
await check("M1 Bootstrap", "platform_admin 不通过业务数据 authz（对象查询 403）", async () => {
  const r = await a("/a/v1/objects/query", { token: padminToken, body: { objectType: "Order", filter: {} } });
  envelope(r, 403, "FORBIDDEN");
});

let m2AdminToken = "";
await check("M2 最小路径", "platform_admin 建租户 → 建首个 tenant_admin → 登录", async () => {
  const created = await a("/a/v1/tenants", { token: padminToken, body: { key: "m2t", name: "M2 租户" } });
  eq(created.status, 201, "tenant created");
  // 非 platform_admin → 403
  const denied = await a("/a/v1/tenants", { method: "GET" });
  envelope(denied, 403, "FORBIDDEN");
  const admin = await a("/a/v1/tenants/m2t/users", { token: padminToken, body: { email: "boss@m2t.io", roles: ["tenant_admin", "admin", "catalog_admin", "planner"] } });
  eq(admin.status, 201, "first tenant_admin");
  ok(admin.body.initialPassword, "initialPassword 一次性返回");
  ok(!JSON.stringify(admin.body).includes("passwordHash"), "不回显 passwordHash");
  const login = await a("/a/v1/auth/login", { token: "", body: { tenantId: "m2t", username: "boss@m2t.io", password: admin.body.initialPassword } });
  eq(login.status, 200, "tenant_admin login");
  m2AdminToken = login.body.accessToken;
});
await check("M2 最小路径", "一键合成 → 8 个管理面全部有内容、可编辑保存、全程无 5xx", async () => {
  const job = await a("/a/v1/synthetic/jobs", { token: m2AdminToken, body: { industry: "battery-manufacturing", scale: "S", seed: 7 } });
  eq(job.status, 202, "synthetic accepted");
  let st;
  for (let i = 0; i < 60; i++) {
    st = (await a(`/a/v1/synthetic/jobs/${job.body.jobId}`, { token: m2AdminToken })).body;
    if (st.status === "SUCCEEDED" || st.status === "FAILED") break;
    await sleep(500);
  }
  eq(st.status, "SUCCEEDED", "synthetic job");
  const pages = [
    ["/a/v1/rules", (b) => b.length > 0],
    ["/a/v1/policies", (b) => b.length > 0],
    ["/a/v1/view-configs", (b) => b.items.length > 0],
    ["/a/v1/scenario-packages", (b) => b.length > 0],
    ["/a/v1/tenants/m2t/users", (b) => b.length > 0],
    ["/a/v1/features/registry", (b) => b.length > 0],
    ["/a/v1/synthetic/clock", (b) => typeof b.simDate === "string"],
    ["/a/v1/me/workspace", (b) => b.views.length > 0 && b.navigation.length > 0],
  ];
  for (const [path, pred] of pages) {
    const r = await a(path, { token: m2AdminToken });
    ok(r.status < 500, `${path} 无 5xx（got ${r.status}）`);
    eq(r.status, 200, `${path} status`);
    ok(pred(r.body), `${path} 有内容`);
  }
  // 可编辑保存：场景包 PATCH + 视图配置 PUT（configVersion 递增）
  const pkgs = (await a("/a/v1/scenario-packages", { token: m2AdminToken })).body;
  const patched = await a(`/a/v1/scenario-packages/${pkgs[0].id}`, { method: "PATCH", token: m2AdminToken, body: { name: "M2 场景包·改" } });
  eq(patched.status, 200, "scenario-package PATCH");
  eq(patched.body.name, "M2 场景包·改", "name saved");
  const views = (await a("/a/v1/view-configs", { token: m2AdminToken })).body;
  const v0 = views.items[0];
  const put = await a(`/a/v1/view-configs/${v0.viewKey}`, { method: "PUT", token: m2AdminToken, body: { title: `${v0.title}·改` } });
  eq(put.status, 200, "view-config PUT");
  ok(put.body.configVersion > views.configVersion, "configVersion 递增");
});

await check("M3 用户管理", "参数化角色保存生效；自改角色被拒；最后管理员不可禁用 → 409 LAST_ADMIN；重置密码可登录", async () => {
  const users = (await a("/a/v1/tenants/m2t/users", { token: m2AdminToken })).body;
  const boss = users.find((u) => u.email === "boss@m2t.io");
  // 参数化角色 + attributes
  const cz = await a("/a/v1/tenants/m2t/users", {
    token: m2AdminToken,
    body: { email: "cz@m2t.io", roles: ["base_manager:常州"], attributes: { baseScope: ["changzhou"] } },
  });
  eq(cz.status, 201, "create base_manager");
  ok(cz.body.roles.includes("base_manager:常州"), "参数化角色保存");
  // 自改角色 → 403
  const selfEdit = await a(`/a/v1/tenants/m2t/users/${boss.id}`, { method: "PATCH", token: m2AdminToken, body: { roles: ["planner"] } });
  envelope(selfEdit, 403, "FORBIDDEN");
  // 最后管理员禁用 → 409 LAST_ADMIN（独立租户 m3t：唯一 tenant_admin；platform_admin 操作绕过自我保护）
  await a("/a/v1/tenants", { token: padminToken, body: { key: "m3t", name: "M3 租户" } });
  const only = await a("/a/v1/tenants/m3t/users", { token: padminToken, body: { email: "solo@m3t.io", roles: ["tenant_admin"] } });
  eq(only.status, 201, "m3t solo admin");
  const last = await a(`/a/v1/tenants/m3t/users/${only.body.id}`, { method: "PATCH", token: padminToken, body: { status: "DISABLED" } });
  envelope(last, 409, "LAST_ADMIN");
  // 重置密码（TODO 邮件，本期直接返回）→ 新密码可登录
  const reset = await a(`/a/v1/users/${cz.body.id}/reset-password`, { token: m2AdminToken, body: {} });
  eq(reset.status, 200, "reset status");
  ok(typeof reset.body.password === "string", "password 返回");
  const login = await a("/a/v1/auth/login", { token: "", body: { tenantId: "m2t", username: "cz@m2t.io", password: reset.body.password } });
  eq(login.status, 200, "new password login");
  // 角色下拉数据源
  const roles = await a("/a/v1/roles", { token: m2AdminToken });
  eq(roles.status, 200, "roles status");
  ok(roles.body.builtIn.includes("tenant_admin") && roles.body.builtIn.includes("viewer"), "builtIn 六角色");
  ok(roles.body.inUse.includes("base_manager:常州"), "inUse 含参数化角色");
});

await check("M6 场景包/视图", "场景包空建+克隆；视图创建 → feature 自动注册；删除 → 级联提示需确认", async () => {
  const created = await a("/a/v1/scenario-packages", { body: { name: "parity 空白包" } });
  eq(created.status, 201, "空建");
  const cloned = await a("/a/v1/scenario-packages", { body: { name: "parity 克隆包", fromTemplate: created.body.id } });
  eq(cloned.status, 201, "克隆");
  eq(cloned.body.fromTemplate, created.body.id, "fromTemplate 记录");
  // 视图创建（demo 租户）
  const view = await a("/a/v1/view-configs", {
    body: { viewKey: "parity-board", title: "parity 看板", renderer: "dashboard", layout: { widgets: [] }, roles: ["planner"], nav: { group: "business", order: 0 } },
  });
  eq(view.status, 201, "view created");
  eq(view.body.featureKey, "view.parity-board", "feature 自动注册键");
  const reg = await a("/a/v1/features/registry");
  ok(reg.body.some((f) => f.key === "view.parity-board"), "registry 含动态项");
  const resolved = await a("/a/v1/tenants/demo/features");
  ok(resolved.body.features.includes("view.parity-board"), "默认开");
  // 删除：无 confirm → 级联提示；confirm=1 → 删除 + 注销
  const prompt = await a("/a/v1/view-configs/parity-board", { method: "DELETE" });
  eq(prompt.status, 200, "prompt status");
  eq(prompt.body.requiresConfirm, true, "requiresConfirm");
  eq(prompt.body.references.feature, "view.parity-board", "references.feature");
  const del = await a("/a/v1/view-configs/parity-board?confirm=1", { method: "DELETE" });
  eq(del.body.deleted, true, "deleted");
  const reg2 = await a("/a/v1/features/registry");
  ok(!reg2.body.some((f) => f.key === "view.parity-board"), "registry 注销");
});

await check("M4 统一资源模式", "agent publish → PUT 409 IMMUTABLE_VERSION → new-version 可改 → references → retire 需确认 → delete 被拒", async () => {
  const created = await b("/b/v1/agents", {
    body: {
      key: "parity_uni", name: "parity 统一模式", description: "d", model: "claude-opus-4-8",
      systemPrompt: "你是产能分析助手", tools: [{ kind: "BUILTIN", name: "query_objects" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" }, skills: [], mcpServers: [],
      scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] }, budget: { maxIterations: 4 },
    },
  });
  eq(created.status, 201, "create");
  const id = created.body.id;
  const pub = await b(`/b/v1/agents/${id}/publish`, { body: {} });
  eq(pub.body.ok, true, "publish ok");
  const put = await b(`/b/v1/agents/${id}`, { method: "PUT", body: { name: "改名" } });
  envelope(put, 409, "IMMUTABLE_VERSION");
  const nv = await b(`/b/v1/agents/${id}/new-version`, { body: {} });
  eq(nv.status, 201, "new-version");
  eq(nv.body.status, "DRAFT", "DRAFT");
  const put2 = await b(`/b/v1/agents/${nv.body.id}`, { method: "PUT", body: { name: "v2 可改" } });
  eq(put2.status, 200, "PUT v2");
  // 详情含版本列表
  const detail = await b(`/b/v1/agents/${id}`);
  isArr(detail.body.versions, "versions");
  ok(detail.body.versions.length >= 2, "至少两个版本");
  // 场景入口引用 → references 非空 → retire 需确认 → delete 被拒
  const scn = await b("/b/v1/scene-entries/parity-uni-view", {
    method: "PUT",
    body: { mode: "AGENT_FIRST", defaultAgentId: id, uiHints: { placeholder: "p", suggestedQuestions: [] } },
  });
  eq(scn.status, 200, "scene PUT");
  const refs = await b(`/b/v1/agents/${id}/references`);
  ok(refs.body.count >= 1, "references 非空");
  const retire1 = await b(`/b/v1/agents/${id}/retire`, { body: {} });
  envelope(retire1, 409, "RETIRE_REQUIRES_CONFIRM");
  const retire2 = await b(`/b/v1/agents/${id}/retire`, { body: { confirm: true } });
  eq(retire2.body.status, "RETIRED", "retire confirmed");
  const del = await b(`/b/v1/agents/${id}`, { method: "DELETE" });
  envelope(del, 409, "REFERENCED");
});
await check("M5 场景入口", "AGENT_FIRST 且 defaultAgent 未发布 → 发布失败信息明确；mcp publish 连接测试失败信息明确", async () => {
  const draft = await b("/b/v1/agents", {
    body: {
      key: "parity_uni_draft", name: "未发布", description: "d", model: "claude-opus-4-8",
      systemPrompt: "x", tools: [], ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" }, skills: [], mcpServers: [],
      scopeDeclaration: { objectTypes: ["Order"], toolNames: [] },
    },
  });
  eq(draft.status, 201, "draft agent");
  const scn = await b("/b/v1/scene-entries/parity-m5-view", {
    method: "PUT",
    body: { mode: "AGENT_FIRST", defaultAgentId: draft.body.id, uiHints: { placeholder: "p", suggestedQuestions: [] } },
  });
  eq(scn.status, 400, "未发布 → 400");
  ok(scn.body.error.message.includes("已发布") || scn.body.error.message.includes("DRAFT"), "失败信息明确");
  // mcp publish：连接测试不可达 → ok:false + 明确信息（不抛 5xx）
  const mcp = await b("/b/v1/mcp-configs", {
    body: { name: "parity-uni-mcp", transport: { type: "streamable_http", url: "http://127.0.0.1:9/mcp" }, status: "ACTIVE" },
  });
  eq(mcp.status, 201, "mcp create");
  eq(mcp.body.lifecycle, "DRAFT", "DRAFT v1");
  const pub = await b(`/b/v1/mcp-configs/${mcp.body.id}/publish`, { body: {} });
  eq(pub.status, 200, "publish status");
  eq(pub.body.ok, false, "连接测试失败 → ok:false");
  ok(pub.body.errors?.[0]?.message.includes("连接测试失败"), "信息明确");
});

await check("M7 规则手工管理", "非法 expression 定位字符位（400 + dry-run position）；dry-run 即时求值；publish 后 PUT → 409", async () => {
  const bad = await a("/a/v1/rules", {
    body: { key: "parity_m7_bad", name: "坏规则", expression: "Order.qty >> 5", scopeObjectTypes: ["Order"], severity: "WARN" },
  });
  envelope(bad, 400, "VALIDATION_ERROR");
  ok(bad.body.error.message.includes("位置"), "message 含字符位");
  const dryBad = await a("/a/v1/rules/dry-run", { body: { expression: "Order.qty > ", samplePayload: {} } });
  eq(dryBad.status, 200, "dry-run status");
  eq(dryBad.body.ok, false, "ok:false");
  ok(Number.isInteger(dryBad.body.error.position), "error.position 为字符位");
  const hit = await a("/a/v1/rules/dry-run", { body: { expression: "Order.demandDelta > 0.5", samplePayload: { Order: { demandDelta: 0.9 } } } });
  eq(hit.body.ok, true, "ok");
  eq(hit.body.violated, true, "violated");
  const miss = await a("/a/v1/rules/dry-run", { body: { expression: "Order.demandDelta > 0.5", samplePayload: { Order: { demandDelta: 0.1 } } } });
  eq(miss.body.violated, false, "not violated");
  // 版本化：DRAFT 可改 → publish → PUT 409 IMMUTABLE_VERSION → retire
  const created = await a("/a/v1/rules", {
    body: { key: "parity_m7", name: "手工规则", expression: "Order.qty > 100", scopeObjectTypes: ["Order"], severity: "WARN" },
  });
  eq(created.status, 201, "create");
  const put = await a(`/a/v1/rules/${created.body.id}`, { method: "PUT", body: { expression: "Order.qty > 200" } });
  eq(put.status, 200, "DRAFT PUT");
  await a(`/a/v1/rules/${created.body.id}/publish`, { body: {} });
  const immutable = await a(`/a/v1/rules/${created.body.id}`, { method: "PUT", body: { expression: "Order.qty > 300" } });
  envelope(immutable, 409, "IMMUTABLE_VERSION");
  const retired = await a(`/a/v1/rules/${created.body.id}/retire`, { body: {} });
  eq(retired.body.status, "RETIRED", "retired");
});


// ===========================================================================
// LLM Provider 配置体系（增量 §1，落位 A）+ 统一引用模式（增量 §2）
// ===========================================================================
let llmpId = "";
await check("LLM Provider", "CRUD：apiKey write-only（hasApiKey，不回显）+ 连接测试返回延迟", async () => {
  const SECRET = "sk-parity-llm-9";
  const r = await a("/a/v1/llm-providers", {
    body: {
      name: "parity vLLM",
      kind: "openai_compatible",
      baseUrl: `http://127.0.0.1:${llmPort}`,
      apiKey: SECRET,
      models: [
        { modelId: "stub-1", displayName: "Stub", capabilities: { tools: true, structuredOutput: true, maxContext: 128000 } },
        { modelId: "stub-noso", displayName: "Stub-NoSO", capabilities: { tools: false, structuredOutput: false, maxContext: 32000 } },
      ],
    },
  });
  eq(r.status, 201, "create status");
  llmpId = r.body.id;
  eq(r.body.hasApiKey, true, "hasApiKey");
  ok(!JSON.stringify(r.body).includes(SECRET), "明文不回显");
  const list = await a("/a/v1/llm-providers");
  eq(list.status, 200, "list status");
  ok(!JSON.stringify(list.body).includes(SECRET), "list 不回显");
  const test = await a(`/a/v1/llm-providers/${llmpId}/test`, { body: {} });
  eq(test.status, 200, "test status");
  ok(typeof test.body.latencyMs === "number", "latencyMs 数值");
  const put = await a(`/a/v1/llm-providers/${llmpId}`, { method: "PUT", body: { name: "parity vLLM v2" } });
  eq(put.status, 200, "PUT status");
  eq(put.body.hasApiKey, true, "PUT 后密钥保留（write-only 不被清除）");
});
await check("LLM Provider", "服务间凭证：用户 JWT → 403；X-Service-Token → 解密密钥", async () => {
  const denied = await a(`/a/v1/llm-providers/${llmpId}/credential`);
  envelope(denied, 403, "FORBIDDEN");
  const res = await fetch(`${A}/a/v1/llm-providers/${llmpId}/credential`, {
    headers: { "x-service-token": "parity-svc-token", "x-tenant-id": "demo", "x-service-caller": "parity" },
  });
  eq(res.status, 200, "service status");
  const body = await res.json();
  eq(body.apiKey, "sk-parity-llm-9", "解密密钥（仅服务间）");
});
await check("LLM Provider", "绑定矩阵：无 tools 绑 agent → 400 注明缺失能力；合法绑定 → bindings + warnings", async () => {
  const bad = await a("/a/v1/llm-bindings", {
    method: "PUT",
    body: { bindings: [{ purpose: "agent", providerId: llmpId, modelId: "stub-noso" }] },
  });
  envelope(bad, 400, "VALIDATION_ERROR");
  ok(bad.body.error.message.includes("缺失能力"), "注明缺失能力");
  const okRes = await a("/a/v1/llm-bindings", {
    method: "PUT",
    body: {
      bindings: [
        { purpose: "extraction", providerId: llmpId, modelId: "stub-1" },
        { purpose: "template_gen", providerId: llmpId, modelId: "stub-noso" },
      ],
    },
  });
  eq(okRes.status, 200, "PUT status");
  isArr(okRes.body.bindings, "bindings");
  ok(okRes.body.warnings.some((w) => w.message.includes("JSON-mode")), "structuredOutput 缺失 → 降级警告");
  const get = await a("/a/v1/llm-bindings");
  eq(get.body.bindings.length, 2, "GET bindings");
});
await check("LLM Provider", "B 只读别名 /b/v1/llm/providers 经 A（source of truth）+ 内部失效钩子", async () => {
  // §2.4：A 发布 llm_provider.updated → webhook 调 B 失效钩子 → B 下一次读取即新值（SLO ≤60s，TTL 兜底）
  const inv = await b("/b/v1/internal/invalidate", { body: { event: "llm_provider.updated", tenantId: "demo" } });
  eq(inv.status, 200, "invalidate status");
  eq(inv.body.ok, true, "ok");
  const r = await b("/b/v1/llm/providers");
  eq(r.status, 200, "alias status");
  ok(r.body.some((p) => p.id === llmpId), "失效后 B 读到 A 的新 provider");
});

let refPlanId = "";
await check("引用模式", "planRef 意图：planId 仍为输入别名（归一化）+ plan publish 响应附影响面", async () => {
  const plan = await b(`/api/v1/catalog/packages/${pkgId}/plans`, {
    body: {
      key: "parity_ref_plan",
      steps: [
        { id: "s1", type: "evaluate_rules", params: { ruleIds: ["C08"], payload: { outsourceRatio: 0.1 } } },
        { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
      ],
    },
  });
  eq(plan.status, 201, "plan create");
  refPlanId = plan.body.id;
  const intent = await b(`/api/v1/catalog/packages/${pkgId}/intents`, {
    body: {
      key: "parity_ref_intent",
      name: "引用意图",
      description: "planRef latest",
      examples: ["引用一下"],
      enabledViews: "*",
      slots: [{ name: "note", type: "string", required: false, description: "备注" }],
      planRef: { planKey: "parity_ref_plan", version: "latest" },
      riskLevel: "READ",
      owner: "parity",
    },
  });
  eq(intent.status, 201, "intent create");
  eq(intent.body.planRef?.planKey, "parity_ref_plan", "planRef 落库");
  ok(typeof intent.body.planId === "string", "过渡期响应仍含 planId 别名");
  const pub = await b(`/api/v1/catalog/plans/${refPlanId}/publish`, { body: {} });
  eq(pub.status, 200, "plan publish");
  ok(pub.body.impact && Number.isInteger(pub.body.impact.intents), "publish 响应附 impact");
  const ipub = await b(`/api/v1/catalog/intents/${intent.body.id}/publish`, { body: {} });
  eq(ipub.status, 200, "intent publish");
});
await check("引用模式", "规则发布响应附影响面（B 上报引用 → A references 反查）+ references 端点", async () => {
  // B 发布 plan 时已上报 C08 引用（服务间）；再补一条 agent 引用
  const rep = await fetch(`${A}/a/v1/references/report`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-service-token": "parity-svc-token", "x-tenant-id": "demo" },
    body: JSON.stringify({ source: { kind: "agent", key: "parity_agent", name: "parity agent" }, refs: [{ kind: "rule", key: "C08", version: "latest" }] }),
  });
  eq(rep.status, 204, "report status");
  const rule = await a("/a/v1/rules", {
    body: { key: "C08", name: "外协红线", expression: "Plan.outsourceRatio > 0.2", scopeObjectTypes: ["Plan"], severity: "WARN" },
  });
  eq(rule.status, 201, "rule create");
  const pub = await a(`/a/v1/rules/${rule.body.id}/publish`, { body: {} });
  eq(pub.status, 200, "publish status");
  ok(pub.body.impact && Number.isInteger(pub.body.impact.agents), "impact 形态");
  ok(pub.body.impact.refs.some((r) => r.key === "parity_agent"), "impact 含上报引用方");
  isArr(pub.body.warnings, "warnings");
  const refs = await a(`/a/v1/rules/${rule.body.id}/references`);
  eq(refs.status, 200, "references status");
  ok(Number.isInteger(refs.body.count) && Array.isArray(refs.body.references), "统一形态 {references, count}");
  // §2.2：求值带 ruleVersion（留痕「当时生效」）
  const ev = await a("/a/v1/rules/evaluate", { body: { ruleIds: ["C08"], payload: { Plan: { outsourceRatio: 0.3 } } } });
  ok(Number.isInteger(ev.body[0]?.ruleVersion), "RuleVerdict.ruleVersion");
});
await check("引用模式", "workflow 破坏性变更门禁：latest 引用 → 409 BREAKING_CHANGE_WITH_LATEST_REFS；force 越过", async () => {
  const wf = await b("/b/v1/workflows", {
    body: {
      key: "parity_gate_wf",
      name: "门禁流程",
      inputs: { type: "object", properties: { x: { type: "string" } } },
      steps: [{ id: "s1", type: "query_objects", params: { objectType: "Base", filter: {} } }],
    },
  });
  eq(wf.status, 201, "wf create");
  const pub1 = await b(`/b/v1/workflows/${wf.body.id}/publish`, { body: {} });
  eq(pub1.body.ok, true, "v1 publish");
  ok(pub1.body.impact, "publish 响应附 impact");
  // latest 引用方：agent 引用该 workflow
  const agent = await b("/b/v1/agents", {
    body: {
      key: "parity_gate_agent", name: "门禁引用", description: "d", model: "claude-opus-4-8",
      systemPrompt: "x", tools: [{ kind: "WORKFLOW", workflowId: wf.body.id, version: "latest" }],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" }, skills: [], mcpServers: [],
      scopeDeclaration: { objectTypes: ["Base"], toolNames: [] },
    },
  });
  eq(agent.status, 201, "agent create");
  const apub = await b(`/b/v1/agents/${agent.body.id}/publish`, { body: {} });
  eq(apub.body.ok, true, "agent publish");
  // 破坏性新版（删除字段 x）
  const nv = await b(`/b/v1/workflows/${wf.body.id}/new-version`, { body: {} });
  eq(nv.status, 201, "new-version");
  await b(`/b/v1/workflows/${nv.body.id}`, { method: "PUT", body: { inputs: { type: "object", properties: {} } } });
  const rejected = await b(`/b/v1/workflows/${nv.body.id}/publish`, { body: {} });
  envelope(rejected, 409, "BREAKING_CHANGE_WITH_LATEST_REFS");
  ok(rejected.body.error.message.includes("门禁引用"), "列出引用方");
  const forced = await b(`/b/v1/workflows/${nv.body.id}/publish`, { body: { force: true } });
  eq(forced.body.ok, true, "force publish");
  eq(forced.body.forced, true, "forced 标记（审计）");
});

// ===========================================================================
// 运营态出厂配置（PRD-addendum-lived-in-state）：livedIn 合成 → history/bundle →
// review 视图 → 水印。放在最后：回放会重写 demo 租户时序/订单，避免扰动前序检查。
// ===========================================================================
let livedAdminToken = "";
let livedBundleRaw = "";
await check("运营态", "livedIn 合成作业（battery/S/seed42）→ job.livedIn 回放统计（12 批 / 365 天 / ≤5 分钟）", async () => {
  const login = await a("/a/v1/auth/login", { body: { tenantId: "demo", username: "admin", password: "demo1234" } });
  eq(login.status, 200, "admin login");
  livedAdminToken = login.body.accessToken;
  const r = await a("/a/v1/synthetic/jobs", {
    body: { industry: "battery-manufacturing", scale: "S", seed: 42, livedIn: true },
    token: livedAdminToken,
  });
  eq(r.status, 202, "status");
  let job = r.body;
  for (let i = 0; i < 120 && job.status === "RUNNING"; i++) {
    await sleep(1000);
    job = (await a(`/a/v1/synthetic/jobs/${job.id ?? job.jobId}`, { token: livedAdminToken })).body;
  }
  eq(job.status, "SUCCEEDED", "job.status");
  ok(job.livedIn, "job.livedIn 回放统计存在");
  eq(job.livedIn.batches, 12, "月批次 12");
  eq(job.livedIn.days, 365, "回放 365 天");
  ok(job.livedIn.points > 50_000, "回放点数 > 5 万");
  ok(job.livedIn.durationMs < 300_000, "S 规模回放 ≤ 5 分钟");
});
await check("运营态", "GET /a/v1/history/bundle → 契约 parse + 形态（trend 12 / delivered 60 / 案例 10 / Action 200 / MAPE 52 / V1–V12）", async () => {
  const r = await a("/a/v1/history/bundle?pageSize=200", { token: livedAdminToken });
  eq(r.status, 200, "status");
  livedBundleRaw = JSON.stringify(r.body);
  const bundle = contracts ? contracts.HistoryBundleSchema.parse(r.body) : r.body;
  eq(bundle.trend.length, 12, "trend 12 个月");
  eq(bundle.deliveredCount, 60, "已交付 60");
  eq(bundle.delivered.filter((d) => d.delayDays > 0).length, 9, "9 单曾延期");
  eq(bundle.delivered.filter((d) => d.rescue).length, 7, "7 单挽回（关联案例+Action）");
  eq(bundle.riskCases.length, 10, "告警-处置闭环案例 10 例");
  eq(bundle.actionStats.total, 200, "Action 审计史 200 条");
  eq(bundle.mapeSeries.length, 52, "MAPE 52 周");
  eq(bundle.calibrations.proposals.length, 8, "8 次校准提案");
  eq(bundle.calibrations.proposals.filter((p) => p.status === "REJECTED").length, 2, "2 次方法学拒绝");
  eq(bundle.sopVersions.length, 12, "S&OP V1–V12");
  eq(bundle.sopVersions[0].attainment, 88, "V1 达成率 88%");
  eq(bundle.sopVersions[11].attainment, 94, "V12 达成率 94%");
  ok(bundle.ruleVersions.length >= 5, "规则版本史 ≥5");
  eq(bundle.incubated.length, 3, "意图孵化 ×3");
  ok(bundle.taskHistory.length >= 7, "任务/对话史（7 场景 ≥1 条）");
  // actionHistory 分页参数（§5 大体量子集）
  const p2 = await a("/a/v1/history/bundle?page=2&pageSize=50", { token: livedAdminToken });
  eq(p2.body.actionHistory.items.length, 50, "page=2&pageSize=50 → 50 条");
  eq(p2.body.actionHistory.page, 2, "page 回显");
});
await check("运营态", "读路径确定性：同参数重复 GET bundle → 字节一致", async () => {
  const again = await a("/a/v1/history/bundle?pageSize=200", { token: livedAdminToken });
  eq(JSON.stringify(again.body), livedBundleRaw, "重复读取字节一致");
});
await check("运营态", "行级权限作用于历史：base_manager 仅常州月度/案例，准交率按可见范围重算", async () => {
  const login = await a("/a/v1/auth/login", { body: { tenantId: "demo", username: "base_manager", password: "demo1234" } });
  eq(login.status, 200, "base_manager login");
  const r = await a("/a/v1/history/bundle", { token: login.body.accessToken });
  eq(r.status, 200, "status");
  ok(r.body.monthly.every((m) => m.baseId === "changzhou"), "monthly 仅常州");
  ok(r.body.riskCases.every((c) => c.baseId === "changzhou"), "案例仅常州");
  ok(r.body.deliveredCount < 60, "delivered 子集");
  const onTime = r.body.delivered.filter((d) => d.onTime).length;
  eq(r.body.onTimeRate, Math.round((onTime / r.body.delivered.length) * 1000) / 10, "准交率按可见范围重算");
});
await check("运营态", "workspace 含 review 运营回顾视图（renderer=review，零配置导航）", async () => {
  const r = await a("/a/v1/me/workspace", { token: livedAdminToken });
  eq(r.status, 200, "status");
  const view = (r.body.views ?? []).find((v) => v.viewKey === "review" || v.key === "review");
  ok(view, "views 含 review");
  eq(view.renderer, "review", "renderer=review");
  ok((r.body.navigation ?? []).some((n) => n.key === "review"), "导航含 review");
});
await check("运营态", "B5 场景入口预载历史问答（preloadedHistory，Y8 数据面）", async () => {
  const r = await b("/b/v1/scene-entries", { token: livedAdminToken });
  eq(r.status, 200, "status");
  // dash 在前序「B5 场景 PUT」检查中被管理员整体覆盖（出厂配置是起点不是锁定）→ 用未动过的 risk 校验出厂形态
  const risk = r.body.find((s) => s.viewKey === "risk");
  ok(Array.isArray(risk?.preloadedHistory) && risk.preloadedHistory.length >= 2, "risk 历史问答 ≥2 条");
  ok(risk.preloadedHistory.every((h) => h.question && h.answer && h.date && ["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"].includes(h.trustLevel)), "条目形态 {question,answer,trustLevel,date}");
  const graph = r.body.find((s) => s.viewKey === "graph");
  eq(graph?.mode, "AGENT_FIRST", "explore=AGENT_FIRST");
  ok((graph?.preloadedHistory ?? []).some((h) => h.trustLevel === "AGENT_EXPLORATORY"), "AGENT 信任级样例");
});
await check("运营态", "水印 + §6 origin 替换：live-ingest 一月 → 趋势无缝、liveRatio 变化、origin=LIVE", async () => {
  const before = (await a("/a/v1/history/bundle", { token: livedAdminToken })).body.trend.map((t) => t.output);
  const wm0 = await a("/a/v1/history/watermark", { token: livedAdminToken });
  eq(wm0.body.synthetic, true, "watermark.synthetic");
  eq(wm0.body.seed, 42, "watermark.seed（hover 显示）");
  const ing = await a("/a/v1/history/live-ingest", { body: { month: "2026-03" }, token: livedAdminToken });
  eq(ing.status, 202, "live-ingest 202");
  ok(ing.body.written > 4000, "回填点数");
  const after = (await a("/a/v1/history/bundle", { token: livedAdminToken })).body;
  eq(JSON.stringify(after.trend.map((t) => t.output)), JSON.stringify(before), "趋势无缝（同管线回填不跳变）");
  eq(after.trend.find((t) => t.month === "2026-03")?.live, true, "2026-03 标记 LIVE");
  const wm1 = await a("/a/v1/history/watermark", { token: livedAdminToken });
  ok((wm1.body.liveRatio ?? 0) > 0, "水印 LIVE 占比变化（消退）");
});

// ---------------------------------------------------------------------------
// 收尾：结果表
// ---------------------------------------------------------------------------
const groups = [...new Set(results.map((r) => r.group))];
console.log("\n========== 管理台真连 parity 审计 ==========\n");
for (const g of groups) {
  console.log(`【${g}】`);
  for (const r of results.filter((x) => x.group === g)) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : `\n     ↳ ${r.detail}`}`);
  }
}
const passed = results.length - failures;
console.log(`\n${failures === 0 ? "✅" : "❌"} ${passed}/${results.length} checks passed`);

if (failures > 0) {
  console.error("\n--- datacore tail ---\n" + dc.tail());
  console.error("\n--- agentcore tail ---\n" + ac.tail());
}

for (const c of children) c.kill("SIGTERM");
llmStub.close();
process.exit(failures === 0 ? 0 : 1);
