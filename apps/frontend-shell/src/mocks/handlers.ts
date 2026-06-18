import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { PlanStep, Scenario } from "@platform/contracts";
import {
  ACCOUNTS,
  BASES,
  CONNECTOR_TYPES,
  FALLBACK_CLUSTERS,
  FEATURE_REGISTRY,
  featuresForAccount,
  GRAPH,
  ORDERS,
  PACKAGE_ID,
  POLICIES,
  PLANS,
  RISK_TIMELINE,
  ROLES_RESPONSE,
  SYNTHETIC_PHASES,
  SYNTHETIC_REPORT,
  TENANT_ID,
  tickReport,
  TS_AGG_POINTS,
  workspaceForAccount,
  type MockAccount,
} from "./fixtures";
import { accountFromAuth, db, tokenFor, type MockTask } from "./db";
import { historyBundleFor, LIVED_WATERMARK } from "./livedInFixtures";

/** 引用模式增量 §2.3：规则被引用反查（mock：agent ruleKeys + 计划步骤 evaluate_rules） */
function ruleReferences(ruleKey: string): { kind: string; key: string; name?: string; via: string }[] {
  const out: { kind: string; key: string; name?: string; via: string }[] = [];
  for (const a of db.agents) {
    const keys = a.ruleBindings?.ruleKeys;
    if (Array.isArray(keys) && keys.includes(ruleKey)) out.push({ kind: "agent", key: a.key, name: a.name, via: "ruleBindings" });
  }
  for (const w of db.workflows) {
    if (w.steps.some((s) => s.type === "evaluate_rules" && Array.isArray(s.params.ruleIds) && s.params.ruleIds.includes(ruleKey))) {
      out.push({ kind: "workflow", key: w.key, name: w.name, via: "steps.evaluate_rules" });
    }
  }
  return out;
}
import { registerTaskScript, releaseNextSegment } from "./mockEventSource";
import { scriptForQuery } from "./sseScripts";
import {
  mockBottleneckMatrix,
  mockCapacityForecast,
  mockPlanAudit,
  mockPlanGenerate,
  mockSopAdvance,
  PLAN_VERSION_CURRENT,
  SopMockError,
  sopPlanLocked,
  type MockAuditInput,
  type MockForecastArgs,
} from "./simSolvers";
import {
  affectedOrdersOutput,
  AOP_RESPONSE,
  CALIBRATION_HISTORY,
  CALIBRATION_PROPOSALS,
  calibrationReportFor,
  DATA_HEALTH,
  MAPPING_ROWS,
  QUARTERLY_RESPONSE,
} from "./planFixtures";

const err = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, requestId: `req_${Math.random().toString(36).slice(2, 10)}` } }, { status });

function auth(request: Request): MockAccount | null {
  return accountFromAuth(request.headers.get("Authorization"));
}

/** 行级过滤（QOS §7.6 权限种子语义：base_manager:常州 仅常州数据） */
function filterByScope<T extends { bases?: string; name?: string }>(rows: T[], account: MockAccount): T[] {
  if (!account.baseScope) return rows;
  return rows.filter((r) => {
    const v = r.bases ?? r.name;
    return v == null || account.baseScope!.some((b) => String(v).includes(b));
  });
}

let idSeq = 1000;
const newId = (prefix: string) => `${prefix}-${++idSeq}`;

// ---- A7 Foundry-Grade Data Builder mock ----
const DATA_BUILDER_PRESET = {
  id: "dba-preset",
  tenantId: "demo",
  key: "foundry-grade-data-builder",
  version: 1,
  name: "Foundry-Grade Data Builder",
  description: "工业级数据构建发动机（v1，可二次配置）",
  status: "PUBLISHED",
  config: {
    llm: { binding: "extraction" },
    determinism: { freezePlan: true, seed: 42 },
    closure: {
      object: { mode: "HARD", fallback: ["BIND_EXISTING_SLICE", "CREATE_SLICE"] },
      data: { mode: "SOFT", onOrphan: "PASS_AND_MARK" },
      forward: { mode: "HARD" },
    },
    moduleAdapters: {
      rawIn: ["connector.excel", "knowledge-base", "constraint-doc", "timeseries", "solver-params"],
      transform: ["ontology-modeling", "rule-extract", "derivation"],
    },
    publish: { auto: true, allowOnlineEdit: true },
    audit: { trail: true, rollback: true },
  },
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};
const MOCK_BUILD_JOBS: unknown[] = [];
// g8 故事驱动建域 · P1：StoryBuildRun 历史推演记录（mock 模式内存存储，提交→列出可见）
const MOCK_STORY_RUNS: { id: string; script: string; status: string; createdAt: string; [k: string]: unknown }[] = [];
const MOCK_RAW_ROWS: Record<string, Record<string, unknown>[]> = {
  default: [
    { so: "SO-10001", cust: "蔚途汽车", qty: "1.5", due: "2026-06-20" },
    { so: "SO-10002", cust: "星河储能", qty: "0.82", due: "2026-06-25" },
    { so: "SO-10003", cust: "蓝海电网", qty: "1.1", due: "2026-06-28" },
  ],
};
function mockBuildJob(body: { script?: string; seed?: number; dryRun?: boolean }) {
  const seed = body.seed ?? 42;
  const script = (body.script ?? "").toLowerCase();
  const types = ["Order", "Base"];
  if (script.includes("客户") || script.includes("信用") || script.includes("credit")) types.push("Customer");
  const dryRun = !!body.dryRun;
  const allPhases = ["intake", "comprehend", "gap", "rawin", "transform", "closure", "publish"] as const;
  const phases = allPhases.map((name) => ({
    name,
    status: dryRun && ["gap", "rawin", "transform", "publish"].includes(name) ? "SKIPPED" : "DONE",
  }));
  const closure = {
    gatePassed: true,
    objectsBound: types.length,
    dataOrphans: 0,
    forwardMissing: 0,
    findings: types.map((t) => ({ kind: "OBJECT", ref: t, status: "BOUND" })),
  };
  const planId = `bpl_demo_${script.length}_${seed}`;
  const job = {
    id: newId("bjb"),
    jobId: newId("bjb"),
    tenantId: "demo",
    builderKey: "foundry-grade-data-builder",
    scriptHash: String(script.length),
    seed,
    dryRun,
    replayed: false,
    status: "SUCCEEDED",
    phases,
    planId,
    closure,
    preview: dryRun
      ? { dataSources: types.map((t) => ({ name: `${t}数据源`, datasetKey: t.toLowerCase(), rowCount: 20, fields: 4 })), objectTypes: types, rules: ["C03"], solverNeeds: ["affected_orders"], kbDocs: 1 }
      : undefined,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  MOCK_BUILD_JOBS.unshift(job);
  return job;
}

export const handlers = [
  // ======================== A · DataCore ========================

  http.post("*/a/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { tenantId: string; username: string; password: string };
    const account = ACCOUNTS.find((a) => a.username === body.username && a.password === body.password);
    // mock 容忍 demo（真实种子租户）与 tenant-battery（mock 租户）两者，避免登录默认租户切换后 mock 登录失败
    if (!account || (body.tenantId !== TENANT_ID && body.tenantId !== "demo")) return err(401, "INVALID_CREDENTIALS", "账号或密码错误");
    return HttpResponse.json({ accessToken: tokenFor(account) });
  }),

  http.post("*/a/v1/auth/refresh", () => err(401, "REFRESH_FAILED", "请重新登录")),

  http.get("*/a/v1/me/workspace", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(workspaceForAccount(account, db.tenantOverrides, db.configVersion));
  }),

  // ---- 运营态出厂配置增量 §5：一年运营态历史（行级过滤 + actionHistory 分页） ----
  http.get("*/a/v1/history/bundle", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20)));
    return HttpResponse.json(historyBundleFor(account.baseScope, page, pageSize));
  }),

  http.get("*/a/v1/history/watermark", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(LIVED_WATERMARK);
  }),

  // ---- Entitlement ----
  http.get("*/a/v1/features/registry", () => HttpResponse.json(FEATURE_REGISTRY)),

  http.get("*/a/v1/tenants/:id/features/preview", ({ request }) => {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") ?? "planner";
    const account = ACCOUNTS.find((a) => a.roles.some((r) => r.startsWith(role))) ?? ACCOUNTS[0]!;
    const ws = workspaceForAccount(account, db.tenantOverrides, db.configVersion);
    return HttpResponse.json({ navigation: ws.navigation, views: (ws.views ?? []).map((v) => ({ key: v.key, title: v.title })) });
  }),

  http.get("*/a/v1/tenants/:id/features", ({ request }) => {
    const account = auth(request) ?? ACCOUNTS[0]!;
    return HttpResponse.json({ features: featuresForAccount(account, db.tenantOverrides), configVersion: db.configVersion });
  }),

  http.put("*/a/v1/tenants/:id/features", async ({ request }) => {
    const body = (await request.json()) as { overrides: Record<string, boolean> };
    db.tenantOverrides = { ...db.tenantOverrides, ...body.overrides };
    db.configVersion += 1;
    return HttpResponse.json({ configVersion: db.configVersion });
  }),

  http.put("*/a/v1/tenants/:id/features/roles/:role", async ({ request, params }) => {
    const body = (await request.json()) as { overrides: Record<string, boolean> };
    // 角色只能收窄：尝试开启租户未购项 → 422
    for (const [key, on] of Object.entries(body.overrides)) {
      const tenantOn = db.tenantOverrides[key] ?? FEATURE_REGISTRY.find((f) => f.key === key)?.defaultOn ?? false;
      if (on && !tenantOn) return err(422, "ROLE_CANNOT_EXCEED_TENANT", `角色不可开通租户未购功能：${key}`);
    }
    db.roleOverrides[String(params.role)] = body.overrides;
    db.configVersion += 1;
    return HttpResponse.json({ configVersion: db.configVersion });
  }),

  http.get("*/a/v1/tenants/:id/features/audit", () => HttpResponse.json([])),

  // ---- 对象查询（GET /a/v1/objects?type=&q=&page=&f_*） ----
  http.get("*/a/v1/objects", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "Order";
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
    const base = url.searchParams.get("base");

    let rows: { id: string; props: Record<string, unknown> }[];
    if (type === "Base") {
      rows = filterByScope(BASES, account).map((b) => ({ id: b.id, props: { ...b } }));
    } else if (type === "Model") {
      rows = ["4680-NCM", "4680-LFP", "刀片-LFP", "VDA-NCM", "储能-280Ah", "储能-314Ah"].map((m) => ({ id: `model-${m}`, props: { name: m } }));
    } else {
      let orders = filterByScope(ORDERS, account);
      if (base) orders = orders.filter((o) => o.bases.includes(base));
      rows = orders.map((o) => ({ id: o.id, props: { ...o } }));
    }
    if (q) rows = rows.filter((r) => JSON.stringify(r.props).toLowerCase().includes(q));
    // 列筛选 f_*
    for (const [k, v] of url.searchParams.entries()) {
      if (!k.startsWith("f_") || !v) continue;
      const prop = k.slice(2);
      rows = rows.filter((r) => String(r.props[prop] ?? "").includes(v));
    }
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, type }));
    return HttpResponse.json({ items, total });
  }),

  // ---- 治理增量 §3.3 关键词搜索（命中 name + 相似度降序） ----
  http.get("*/a/v1/objects/search", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return err(400, "VALIDATION_ERROR", "搜索关键词长度需 ≥2");
    const typesParam = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);
    const known = new Set(["Base", "Model", "Order"]);
    const unknown = typesParam.filter((t) => !known.has(t));
    if (unknown.length) return err(400, "VALIDATION_ERROR", `未知对象类型：${unknown.join(", ")}`);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20") || 20, 20);
    const bases = filterByScope(BASES, account);
    const items = (typesParam.length && !typesParam.includes("Base") ? [] : bases)
      .filter((b) => b.name.includes(q) || b.id.includes(q) || (b.mainProduct ?? "").includes(q))
      .map((b) => ({ typeKey: "Base", objectKey: b.name, display: b.name, domainKey: "factory", score: b.name === q ? 1 : 0.7 }));
    items.sort((a, b) => b.score - a.score);
    return HttpResponse.json({ items: items.slice(0, limit), tookMs: 1 });
  }),

  // ---- 治理增量 §3.4 邻接导航 ----
  http.get("*/a/v1/objects/:id/neighbors", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const id = String(params.id);
    const base = filterByScope(BASES, account).find((b) => b.id === id || b.name === id || b.name === decodeURIComponent(id));
    if (!base) return err(404, "NOT_FOUND", "object not found");
    const orders = filterByScope(ORDERS, account).filter((o) => o.bases === base.name);
    const groups = [
      {
        linkKey: "order_at_base",
        direction: "in" as const,
        total: orders.length,
        items: orders.slice(0, 50).map((o) => ({ id: o.id, typeKey: "Order", objectKey: o.so, display: o.so })),
      },
    ].filter((g) => g.total > 0);
    return HttpResponse.json({ groups });
  }),

  // ---- 治理增量 §3.6 聚合查询 ----
  http.post("*/a/v1/objects/aggregate", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as {
      typeKey: string;
      groupBy?: string[];
      metrics: { prop: string; fn: "count" | "sum" | "avg" | "min" | "max" }[];
    };
    const rows = body.typeKey === "Base" ? filterByScope(BASES, account) : body.typeKey === "Order" ? filterByScope(ORDERS, account) : [];
    const groupBy = body.groupBy ?? [];
    const groups = new Map<string, { group: Record<string, string | null>; rows: Record<string, unknown>[] }>();
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const k = groupBy.map((g) => String(r[g] ?? "∅")).join("");
      let g = groups.get(k);
      if (!g) {
        const group: Record<string, string | null> = {};
        for (const gb of groupBy) group[gb] = r[gb] == null ? null : String(r[gb]);
        g = { group, rows: [] };
        groups.set(k, g);
      }
      g.rows.push(r);
    }
    const out = [...groups.values()].map((g) => {
      const metrics: Record<string, number | null> = {};
      for (const m of body.metrics) {
        const key = `${m.fn}_${m.prop}`;
        if (m.fn === "count") metrics[key] = g.rows.length;
        else {
          const vals = g.rows.map((p) => p[m.prop]).filter((v): v is number => typeof v === "number");
          if (!vals.length) metrics[key] = null;
          else if (m.fn === "sum") metrics[key] = vals.reduce((a, b) => a + b, 0);
          else if (m.fn === "avg") metrics[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
          else if (m.fn === "min") metrics[key] = Math.min(...vals);
          else metrics[key] = Math.max(...vals);
        }
      }
      return { group: g.group, metrics };
    });
    return HttpResponse.json({ rows: out, rowCount: out.length, truncated: false });
  }),

  http.get("*/a/v1/ontology/domains", () =>
    HttpResponse.json([
      { domainKey: "factory", displayName: "工厂", color: "#2563eb" },
      { domainKey: "product", displayName: "产品", color: "#16a34a" },
    ]),
  ),
  http.post("*/a/v1/ontology/domains", async ({ request }) => {
    const b = (await request.json()) as { domainKey: string; displayName?: string };
    return HttpResponse.json({ domainKey: b.domainKey, displayName: b.displayName ?? b.domainKey }, { status: 201 });
  }),

  // ---- 七管理页整簇 mock ----
  http.get("*/a/v1/validation/runs", () =>
    HttpResponse.json([
      {
        id: "vrun_1", profile: "SMOKE", seed: 42, startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:09:00Z",
        report: { profile: "SMOKE", seed: 42, pass: true, assertions: [], coverage: { module: 0.95, assertion: 0.9, loop: 1 }, engineeringVerificationScore: 0.94 },
      },
    ]),
  ),
  http.post("*/a/v1/validation/runs", () => HttpResponse.json({ id: "vrun_2" }, { status: 202 })),

  http.get("*/a/v1/quarantine", () =>
    HttpResponse.json([
      { id: "qr_1", connId: "conn_1", dataset: "orders", raw: { so: "", qty: 10 }, reason: "SCHEMA_MISMATCH", detail: "缺主键 so", status: "PENDING", createdAt: "2026-06-17T08:00:00Z" },
      { id: "qr_2", connId: "conn_1", dataset: "orders", raw: { so: "SO-1", qty: "x" }, reason: "TYPE_ERROR", detail: "qty 非数字", status: "DISCARDED", createdAt: "2026-06-17T08:01:00Z" },
    ]),
  ),
  http.post("*/a/v1/quarantine/:id/reprocess", () => HttpResponse.json({ ok: true })),
  http.post("*/a/v1/quarantine/discard", () => HttpResponse.json({ discarded: 1 })),

  http.get("*/a/v1/notifications", () =>
    HttpResponse.json({
      unread: 1,
      items: [
        { id: "ntf_1", kind: "approval_pending", title: "待审批", body: "有一条 capex_action 待你审批", refType: "action", refId: "act_1", createdAt: "2026-06-17T08:00:00Z" },
        { id: "ntf_2", kind: "action_approved", title: "审批通过", body: "你发起的方案已通过", readAt: "2026-06-17T08:05:00Z", createdAt: "2026-06-17T07:00:00Z" },
      ],
    }),
  ),
  http.post("*/a/v1/notifications/:id/read", () => HttpResponse.json({ ok: true })),
  http.post("*/a/v1/notifications/read-all", () => HttpResponse.json({ ok: true })),

  http.get("*/b/v1/evals", () =>
    HttpResponse.json({
      items: [
        { id: "ec_1", tenantId: "demo", suite: "classifier", packageId: "pkg_battery_manufacturing", input: { query: "4680-NCM 加 20% 六周能不能接？", context: { view: "project", selectedObjects: [], filters: {} } }, expect: { intentKey: "capacity_feasibility" }, origin: "SCENARIO", createdAt: "2026-06-17T08:00:00Z" },
      ],
    }),
  ),
  http.get("*/b/v1/evals/runs", () =>
    HttpResponse.json({
      items: [
        { id: "erun_1", tenantId: "demo", suite: "classifier", startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:01:00Z", total: 20, passed: 19, passRate: 0.95, metrics: { intentAccuracy: 0.95, toolCorrectness: 0.9, avgToolCalls: 2.1, avgLatencyMs: 320, avgTokenCost: 1200 }, results: [], llmMode: "MOCK" },
      ],
    }),
  ),
  http.post("*/a/v1/objects/merge-scan", () => HttpResponse.json({ candidates: [{ id: "mc_new" }] })),
  http.get("*/a/v1/objects/merge-candidates", () =>
    HttpResponse.json([
      { id: "mc_1", tenantId: "demo", typeKey: "Base", objectIds: ["obj_a", "obj_b"], score: 1, rule: "归一名称完全一致", status: "PENDING", createdAt: "2026-06-17T08:00:00Z",
        objects: [{ id: "obj_a", props: { baseId: "cz1", name: "常州", util: 0.88 } }, { id: "obj_b", props: { baseId: "cz2", name: "常州", util: 0.9 } }] },
    ]),
  ),
  http.post("*/a/v1/objects/merge-candidates/:id/merge", () => HttpResponse.json({ id: "omg_1", tenantId: "demo", typeKey: "Base", goldenId: "obj_a", mergedIds: ["obj_b"], mergedBy: "planner", mergedAt: "2026-06-17T09:00:00Z", unmergeUntil: "2026-06-20T09:00:00Z" })),
  http.post("*/a/v1/objects/merge-candidates/:id/reject", () => HttpResponse.json({ ok: true })),
  http.get("*/a/v1/objects/merges", () =>
    HttpResponse.json({ items: [{ id: "omg_0", tenantId: "demo", typeKey: "Base", goldenId: "obj_x", mergedIds: ["obj_y"], mergedBy: "planner", mergedAt: "2026-06-16T09:00:00Z", unmergeUntil: "2026-06-19T09:00:00Z" }] }),
  ),
  http.post("*/a/v1/objects/merges/:id/unmerge", () => HttpResponse.json({ ok: true })),

  http.post("*/b/v1/growth/run", async ({ request }) => {
    const b = (await request.json()) as { query: string; maxRounds?: number };
    return HttpResponse.json({
      question: b.query, maxRounds: b.maxRounds ?? 4,
      rounds: [{ round: 1, gapReport: { question: b.query, taskId: "t1", verdict: "BOUNDARY", path: "AGENT", findings: [{ gapCode: "NO_INTENT", evidence: "无意图覆盖", suggestedFill: "scaffold", blocking: true }], generatedAt: "2026-06-17T00:00:00Z" }, fillApplied: { gapCode: "NO_INTENT", action: "scaffold待建（出工单）", advanced: false, ticket: { gapCode: "NO_INTENT", detail: "无意图覆盖" } } }],
      terminalState: "BOUNDARY", openTickets: [{ gapCode: "NO_INTENT", detail: "无意图覆盖" }], generatedAt: "2026-06-17T00:00:00Z",
    });
  }),
  http.get("*/b/v1/growth/ledger", () =>
    HttpResponse.json({ items: [
      { id: "glr_1", tenantId: "demo", createdAt: "2026-06-17T08:00:00Z", report: { question: "常州影响哪些订单？", maxRounds: 4, rounds: [{ round: 1, gapReport: { verdict: "ANSWERABLE", findings: [] } }], terminalState: "CONVERGED", openTickets: [] } },
      { id: "glr_2", tenantId: "demo", createdAt: "2026-06-17T07:00:00Z", report: { question: "未知能力问句", maxRounds: 4, rounds: [{ round: 1, gapReport: { verdict: "BOUNDARY", findings: [] } }], terminalState: "BOUNDARY", openTickets: [{ gapCode: "NO_CAPABILITY", detail: "x" }] } },
    ] }),
  ),
  http.get("*/b/v1/growth/tickets", () =>
    HttpResponse.json({ items: [
      { id: "gtk_1", tenantId: "demo", fromQuestion: "未知能力问句", gapCode: "NO_CAPABILITY", ioContract: { inputs: [], outputShape: [] }, ontologyRefs: { objectTypes: [], slices: [], rules: [] }, acceptance: "应能答", status: "OPEN", createdAt: "2026-06-17T07:00:00Z" },
    ] }),
  ),
  http.post("*/b/v1/growth/tickets/:id/claim", () => HttpResponse.json({ id: "gtk_1", status: "IN_PROGRESS", assignee: "cli-agent" })),

  http.get("*/a/v1/ontology/slices", () =>
    HttpResponse.json([
      { sliceKey: "model_capacity_network", version: 1, rootType: "Model", hops: 2, linkKeys: ["PRODUCIBLE_AT"], maxNodes: 100, fixtures: 1 },
      { sliceKey: "base_risk_profile", version: 1, rootType: "Base", hops: 1, linkKeys: ["HAS_ORDER"], maxNodes: 200, fixtures: 0 },
    ]),
  ),
  http.post("*/b/v1/evals/run", () =>
    HttpResponse.json({ id: "erun_2", tenantId: "demo", suite: "classifier", startedAt: "2026-06-17T09:00:00Z", finishedAt: "2026-06-17T09:01:00Z", total: 20, passed: 20, passRate: 1, metrics: { intentAccuracy: 1, toolCorrectness: 1, avgToolCalls: 2, avgLatencyMs: 300, avgTokenCost: 1100 }, results: [], llmMode: "MOCK" }),
  ),

  http.get("*/a/v1/ontology/object-types", () =>
    HttpResponse.json([
      {
        key: "Base",
        displayName: "生产基地",
        domain: "factory",
        properties: [
          { propKey: "baseId", dataType: "string", isPrimaryKey: true },
          { propKey: "name", dataType: "string", isPrimaryKey: false },
          { propKey: "util", dataType: "number", isPrimaryKey: false, unit: "%" },
          { propKey: "gwh", dataType: "number", isPrimaryKey: false, unit: "GWh" },
        ],
      },
    ]),
  ),

  // ---- 治理增量 §5 对象 360：按键取对象 ----
  http.get("*/a/v1/objects/:type/:id", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const type = String(params.type);
    const idRaw = decodeURIComponent(String(params.id));
    if (type === "Base") {
      const base = filterByScope(BASES, account).find((b) => b.id === idRaw || b.name === idRaw);
      if (!base) return err(404, "NOT_FOUND", "object not found");
      return HttpResponse.json({ data: { id: base.id, type, props: { ...base } }, snapshotVersion: "1.1" });
    }
    if (type === "Order") {
      const o = filterByScope(ORDERS, account).find((x) => x.id === idRaw || x.so === idRaw);
      if (!o) return err(404, "NOT_FOUND", "object not found");
      return HttpResponse.json({ data: { id: o.id, type, props: { ...o } }, snapshotVersion: "1.1" });
    }
    return err(404, "NOT_FOUND", "object not found");
  }),

  // 活数据可溯（PRD-live-traceable-data §3.2）：对象 lineage 反查（mock 返回合成源链路）。
  http.get("*/a/v1/lineage/object/:type/:id", ({ request, params }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const type = String(params.type);
    const id = decodeURIComponent(String(params.id));
    return HttpResponse.json({
      object: { id, type, origin: { type: "SYNTHETIC", rawDatasetId: `rds_${type}`, rawRowIdx: 0, sourceConnId: "conn_synth" } },
      source: {
        connection: { id: "conn_synth", name: "合成数据源（确定性生成）", connectorTypeKey: "mock_erp", lastSyncAt: new Date(Date.now() - 5 * 3600_000).toISOString() },
        rawDataset: { id: `rds_${type}`, name: type, rowCount: 20, fields: ["so", "cust", "model", "qty", "due"] },
        rawRowIdx: 0,
        rawRow: { so: id, cust: "客户A", model: "4680-NCM" },
      },
      derivations: type === "Order" ? [{ prop: "value", formula: "value = qty × unitPrice" }] : [],
      snapshotVersion: "1.1",
    });
  }),

  http.get("*/a/v1/ontology/graph", () => HttpResponse.json(GRAPH)),

  // ---- 剩余视图增量：计划域 / 映射表 / 校准 / 数据健康度 ----
  http.get("*/a/v1/plan/aop", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(AOP_RESPONSE);
  }),
  http.get("*/a/v1/plan/quarterly", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const n = Math.min(Number(url.searchParams.get("n") ?? "6") || 6, QUARTERLY_RESPONSE.rows.length);
    return HttpResponse.json({ ...QUARTERLY_RESPONSE, rows: QUARTERLY_RESPONSE.rows.slice(0, n) });
  }),
  http.get("*/a/v1/ontology/mapping", () => HttpResponse.json(MAPPING_ROWS)),
  http.get("*/a/v1/calibration/report", ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json(
      calibrationReportFor({
        objectType: url.searchParams.get("objectType") ?? undefined,
        baseId: url.searchParams.get("baseId") ?? undefined,
        solverKey: url.searchParams.get("solverKey") ?? undefined,
      }),
    );
  }),
  http.get("*/a/v1/calibration/proposals", () => HttpResponse.json(CALIBRATION_PROPOSALS)),
  http.get("*/a/v1/calibration/history", () => HttpResponse.json(CALIBRATION_HISTORY)),
  // 批准/回滚不直改参数：生成「校准参数变更」Action 草稿走 §S2 审批流
  http.post("*/a/v1/calibration/proposals/:id/:decision", ({ params, request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const proposal = CALIBRATION_PROPOSALS.find((p) => p.id === params.id);
    if (!proposal) return err(404, "NOT_FOUND", "提案不存在");
    const decision = String(params.decision);
    if (decision !== "approve" && decision !== "rollback") return err(404, "NOT_FOUND", "not found");
    const draft = {
      id: newId("act"),
      tenantId: TENANT_ID,
      actionTypeKey: "校准参数变更",
      payload: { proposalId: proposal.id, parameter: proposal.parameter, from: proposal.currentValue, to: proposal.proposedValue, decision },
      origin: { userId: `usr-${account.username}` },
      status: "PENDING_APPROVAL" as const,
      approvalSteps: [{ seq: 1, role: "admin" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.actionDrafts.unshift(draft);
    return HttpResponse.json({ draftId: draft.id, status: draft.status }, { status: 201 });
  }),
  // M11 §3 手动「立即校准」：配对 → 元闭环 → 全切片提案生成（catalog_admin）
  http.post("*/a/v1/calibration/run", ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    if (!account.roles.some((r) => r === "admin" || r === "catalog_admin")) return err(403, "FORBIDDEN", "catalog_admin only");
    return HttpResponse.json({
      paired: 36,
      deferred: 6,
      staleDeferred: false,
      slicesEvaluated: 3,
      created: 1,
      autoApplied: 0,
      held: 1,
      dropped: 1,
      insufficient: 1,
    });
  }),
  http.get("*/a/v1/data-health", () => HttpResponse.json(DATA_HEALTH)),

  // ---- solver ----
  http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
    const key = String(params.key);
    if (key === "risk_timeline") return HttpResponse.json({ data: RISK_TIMELINE, snapshotVersion: "ov-12" });
    if (key === "schedule_attainment") return HttpResponse.json({ data: { value: 91.4 }, snapshotVersion: "agg-77" });
    if (key === "capacity_forecast")
      return HttpResponse.json({ data: { p50: 21.4, p90: 18.9, gap: -1.2, ok: false, healthFactor: 0.93, mainBn: "化成柜", perBaseRows: [], pendingCertList: [] }, snapshotVersion: "ov-12" });
    if (key === "affected_orders") return HttpResponse.json({ data: affectedOrdersOutput(), snapshotVersion: "ov-12" });
    return err(404, "FEATURE_NOT_FOUND", "求解器不存在或未开通");
  }),

  // ---- 增量 §7.10：规划体检基线（当前定稿 S&OP 版本 → plan_audit 输入字段集） ----
  http.get("*/a/v1/plan-versions/current", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json(PLAN_VERSION_CURRENT);
  }),

  // ---- S&OP 月度版本（五步法状态机；FINAL → 409 PLAN_LOCKED） ----
  http.get("*/a/v1/sop/versions", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    return HttpResponse.json([...db.sopVersions].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)));
  }),
  http.post("*/a/v1/sop/versions", async ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as { month: string; inputs?: Record<string, unknown> };
    if (!/^\d{4}-\d{2}$/.test(body.month ?? "")) return err(422, "VALIDATION_ERROR", "month must be YYYY-MM");
    const now = new Date().toISOString();
    const version = {
      id: newId("sop"),
      month: body.month,
      status: "DRAFT" as const,
      inputs: body.inputs ?? {},
      steps: {},
      agenda: [],
      resolutions: [],
      createdAt: now,
      updatedAt: now,
    };
    db.sopVersions.unshift(version);
    return HttpResponse.json(version, { status: 201 });
  }),
  http.get("*/a/v1/sop/versions/:id", ({ params }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    return v ? HttpResponse.json(v) : err(404, "NOT_FOUND", "sop version 不存在");
  }),
  http.patch("*/a/v1/sop/versions/:id", async ({ params, request }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    if (!v) return err(404, "NOT_FOUND", "sop version 不存在");
    if (v.status === "FINAL") {
      const e = sopPlanLocked();
      return err(e.status, e.code, e.message);
    }
    const fields = (await request.json()) as Record<string, unknown>;
    v.inputs = { ...v.inputs, ...fields };
    v.updatedAt = new Date().toISOString();
    return HttpResponse.json(v);
  }),
  http.post("*/a/v1/sop/versions/:id/advance", async ({ params, request }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    if (!v) return err(404, "NOT_FOUND", "sop version 不存在");
    const body = (await request.json()) as { step: number; payload?: Record<string, unknown> };
    try {
      return HttpResponse.json(mockSopAdvance(v, body.step, body.payload ?? {}));
    } catch (e) {
      if (e instanceof SopMockError) return err(e.status, e.code, e.message);
      throw e;
    }
  }),
  http.post("*/a/v1/sop/versions/:id/finalize", ({ params }) => {
    const v = db.sopVersions.find((x) => x.id === params.id);
    if (!v) return err(404, "NOT_FOUND", "sop version 不存在");
    if (v.status === "FINAL") {
      const e = sopPlanLocked();
      return err(e.status, e.code, e.message);
    }
    if (v.status !== "EXEC_MEETING") return err(409, "INVALID_STATE", `cannot finalize from ${v.status}（先执行第⑤步）`);
    v.status = "FINAL";
    v.updatedAt = new Date().toISOString();
    return HttpResponse.json(v);
  }),

  // ---- 时序聚合查询（A8.4，无任何参数组合可返回原始行） ----
  http.post("*/a/v1/timeseries/agg-query", () => HttpResponse.json({ points: TS_AGG_POINTS })),

  // ---- 连接器 ----
  http.get("*/a/v1/connector-types", () => HttpResponse.json(CONNECTOR_TYPES)),
  http.get("*/a/v1/connections", () => HttpResponse.json(db.connections)),
  http.post("*/a/v1/connections/test", async ({ request }) => {
    const body = (await request.json()) as { config: Record<string, unknown> };
    const ok = Boolean(Object.values(body.config ?? {}).some((v) => v !== "" && v != null));
    return HttpResponse.json(ok ? { ok: true } : { ok: false, message: "配置为空" });
  }),
  http.post("*/a/v1/connections", async ({ request }) => {
    const body = (await request.json()) as { connectorTypeKey: string; name: string; config: Record<string, unknown> };
    const conn = { id: newId("conn"), tenantId: TENANT_ID, connectorTypeKey: body.connectorTypeKey, name: body.name, config: {}, status: "ACTIVE" as const };
    db.connections.push(conn);
    return HttpResponse.json(conn, { status: 201 });
  }),
  http.post("*/a/v1/connections/:id/sync", () => {
    const id = newId("sync");
    db.syncJobPolls.set(id, 0);
    return HttpResponse.json({ syncJobId: id }, { status: 202 });
  }),
  http.get("*/a/v1/sync-jobs/:id", ({ params }) => {
    const id = String(params.id);
    const polls = (db.syncJobPolls.get(id) ?? 0) + 1;
    db.syncJobPolls.set(id, polls);
    const status = polls < 3 ? "RUNNING" : "SUCCEEDED";
    return HttpResponse.json({ id, connId: "conn-erp", status, rowCounts: status === "SUCCEEDED" ? { orders: 20, plants: 12 } : { orders: Math.min(polls * 7, 20) } });
  }),
  http.get("*/a/v1/connections/:id/schema", () =>
    HttpResponse.json({
      datasets: [
        {
          name: "orders.csv",
          kind: "ENTITY",
          fields: [
            { name: "so_no", inferredType: "string", samples: ["SO-10001", "SO-10002"], nullRate: 0, uniqueRate: 1 },
            { name: "customer", inferredType: "string", samples: ["蔚途汽车"], nullRate: 0.02, uniqueRate: 0.2, enumCandidates: ["蔚途汽车", "星河储能", "极光新能源"] },
            { name: "qty", inferredType: "number", samples: [1500, 820], nullRate: 0, uniqueRate: 0.9 },
            { name: "due_date", inferredType: "date", samples: ["2026-06-20"], nullRate: 0.05, uniqueRate: 0.7 },
          ],
        },
        {
          name: "oee_points.csv",
          kind: "TIMESERIES",
          timeField: "ts",
          entityRefField: "equip_no",
          fields: [
            { name: "equip_no", inferredType: "string", samples: ["CZ-07"], nullRate: 0, uniqueRate: 0.01 },
            { name: "ts", inferredType: "date", samples: ["2026-06-01T08:00:00Z"], nullRate: 0, uniqueRate: 0.98 },
            { name: "oee", inferredType: "number", samples: [0.86], nullRate: 0.01, uniqueRate: 0.9 },
          ],
        },
      ],
    }),
  ),
  http.post("*/a/v1/uploads", () => HttpResponse.json({ connId: "conn-upload-1", datasetName: "orders.csv" }, { status: 201 })),

  // ---- 规则文档 ----
  http.get("*/a/v1/rule-docs", () => HttpResponse.json(db.ruleDocs)),
  http.get("*/a/v1/rule-docs/:id", ({ params }) => {
    const d = db.ruleDocs.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : err(404, "NOT_FOUND", "文档不存在");
  }),
  // 上传（multipart）→ 202 抽取作业（与 DataCore /a/v1/rule-docs 响应形态一致）
  http.post("*/a/v1/rule-docs", async ({ request }) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const filename = file instanceof File ? file.name : "上传文档.md";
    const docId = newId("doc");
    const seg = { idx: 0, heading: "一、生产约束", text: "单基地外协比例不得超过 25%，超出需提交风险评估。", spanStart: 0, spanEnd: 40 };
    db.ruleDocs.unshift({ id: docId, filename, status: "IN_REVIEW", createdAt: new Date().toISOString(), segments: [seg] });
    db.candidates.push({
      id: newId("cand"), docId, segmentIdx: 0, span: { start: 0, end: 20 },
      candidate: { name: "外协比例红线", description: "外协比例不得超过 25%", expression: "Outsource.ratio <= 0.25", expressionConfidence: 0.86, scopeObjectTypes: ["QualityLot"], severity: "WARN", sourceQuote: "单基地外协比例不得超过 25%" },
      status: "PENDING", diff: "新增",
    });
    return HttpResponse.json({ docId, jobId: newId("xjob"), status: "IN_REVIEW", candidateCount: 1 }, { status: 202 });
  }),
  http.get("*/a/v1/rule-docs/:id/candidates", ({ params }) =>
    HttpResponse.json(db.candidates.filter((c) => c.docId === params.id)),
  ),
  http.post("*/a/v1/rule-candidates/:id/review", async ({ params, request }) => {
    const body = (await request.json()) as { action: string; patch?: Record<string, unknown> };
    const cand = db.candidates.find((c) => c.id === params.id);
    if (!cand) return err(404, "NOT_FOUND", "候选不存在");
    cand.status = body.action === "REJECT" ? "REJECTED" : "APPROVED";
    if (body.action === "EDIT_APPROVE" && body.patch) Object.assign(cand.candidate, body.patch);
    return HttpResponse.json(cand);
  }),

  http.get("*/a/v1/rules", () => HttpResponse.json(db.rules)),

  // ---- 管理平台增量 §5：规则手工管理（编辑器 + dry-run） ----
  http.post("*/a/v1/rules/dry-run", async ({ request }) => {
    const { expression, samplePayload } = (await request.json()) as { expression: string; samplePayload: Record<string, unknown> };
    // 简易 mock：非法符号 → 定位字符位；合法简单比较式 → 即时求值
    for (const badToken of ["@@", ">>", "=="]) {
      if (badToken === "==" ? false : expression.includes(badToken)) {
        return HttpResponse.json({ ok: false, error: { message: "expected comparison operator", position: expression.indexOf(badToken) } });
      }
    }
    if (/[>＜<]\s*$/.test(expression) || expression.trim() === "") {
      return HttpResponse.json({ ok: false, error: { message: "unexpected end of expression", position: expression.length } });
    }
    const m = /^\s*(\w+)\.(\w+)\s*(>=|<=|>|<)\s*([\d.]+)\s*$/.exec(expression);
    if (m) {
      const obj = samplePayload[m[1]!] as Record<string, unknown> | undefined;
      const left = Number(obj?.[m[2]!] ?? NaN);
      const right = Number(m[4]);
      const violated =
        m[3] === ">" ? left > right : m[3] === ">=" ? left >= right : m[3] === "<" ? left < right : left <= right;
      return HttpResponse.json({ ok: true, violated, passed: !violated, explanation: violated ? "命中违规条件" : "未命中" });
    }
    return HttpResponse.json({ ok: true, violated: false, passed: true, explanation: "未命中" });
  }),

  http.post("*/a/v1/rules", async ({ request }) => {
    const body = (await request.json()) as { key: string; name: string; expression: string; scopeObjectTypes: string[]; severity: "BLOCK" | "WARN" | "INFO" };
    if (body.expression.includes("@@")) {
      return err(400, "VALIDATION_ERROR", `表达式语法错误（位置 ${body.expression.indexOf("@@")}）：expected comparison operator`);
    }
    const rule = { id: newId("rule"), ...body, origin: { type: "MANUAL" as const }, version: 1, status: "DRAFT" as const };
    db.rules.unshift(rule);
    return HttpResponse.json(rule, { status: 201 });
  }),

  http.put("*/a/v1/rules/:id", async ({ params, request }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    if (rule.status !== "DRAFT") return err(409, "IMMUTABLE_VERSION", "仅 DRAFT 状态的规则可修改");
    Object.assign(rule, (await request.json()) as Record<string, unknown>);
    return HttpResponse.json(rule);
  }),

  // 引用模式增量 §2.3：publish 响应附影响面 impact + warnings（契约 PublishImpact 形态）
  http.post("*/a/v1/rules/:id/publish", ({ params }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    rule.status = "PUBLISHED";
    const refs = ruleReferences(rule.key);
    return HttpResponse.json({
      ...rule,
      impact: {
        agents: refs.filter((r) => r.kind === "agent").length,
        plans: refs.filter((r) => r.kind === "plan" || r.kind === "workflow").length,
        intents: refs.filter((r) => r.kind === "intent").length,
        refs: refs.map((r) => ({ kind: r.kind, key: r.key, version: "latest", name: r.name })),
      },
      warnings: [],
    });
  }),

  http.get("*/a/v1/rules/:id/references", ({ params }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    const references = ruleReferences(rule.key);
    return HttpResponse.json({ references, count: references.length });
  }),

  // ---- LLM Provider 配置体系增量 §1（/admin/llm-providers 页消费形态） ----
  http.get("*/a/v1/llm-providers", () => HttpResponse.json(db.llmProviders)),
  http.post("*/a/v1/llm-providers", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const { apiKey, ...rest } = body;
    const provider = {
      id: newId("llmp"),
      tenantId: TENANT_ID,
      status: "ACTIVE",
      models: [],
      ...rest,
      hasApiKey: Boolean(apiKey), // write-only：明文永不回显
    } as unknown as (typeof db.llmProviders)[number];
    db.llmProviders.unshift(provider);
    return HttpResponse.json(provider, { status: 201 });
  }),
  http.put("*/a/v1/llm-providers/:id", async ({ params, request }) => {
    const p = db.llmProviders.find((x) => x.id === params.id);
    if (!p) return err(404, "NOT_FOUND", "provider not found");
    const body = (await request.json()) as Record<string, unknown>;
    const { apiKey, ...rest } = body;
    Object.assign(p, rest);
    if (apiKey !== undefined) (p as { hasApiKey?: boolean }).hasApiKey = Boolean(apiKey);
    return HttpResponse.json(p);
  }),
  http.post("*/a/v1/llm-providers/:id/test", ({ params }) => {
    const p = db.llmProviders.find((x) => x.id === params.id);
    if (!p) return err(404, "NOT_FOUND", "provider not found");
    if (p.kind === "custom_http") return HttpResponse.json({ ok: false, message: "custom_http 适配器为预留接口" });
    return HttpResponse.json({ ok: true, latencyMs: 42, probedModels: p.models.map((m) => m.modelId) });
  }),
  http.get("*/a/v1/llm-bindings", () => HttpResponse.json({ bindings: db.llmBindings })),
  http.put("*/a/v1/llm-bindings", async ({ request }) => {
    const { bindings } = (await request.json()) as { bindings: { purpose: string; providerId: string; modelId: string }[] };
    const warnings: { purpose: string; message: string }[] = [];
    for (const b of bindings) {
      const p = db.llmProviders.find((x) => x.id === b.providerId);
      const m = p?.models.find((x) => x.modelId === b.modelId);
      if (!p || !m) return err(400, "VALIDATION_ERROR", `provider/model 不存在：${b.providerId}/${b.modelId}`);
      if (b.purpose === "agent" && !m.capabilities.tools) {
        return err(400, "VALIDATION_ERROR", `绑定被拒：用途「agent」要求 tools 能力，${p.name}/${b.modelId} 缺失能力：tools`);
      }
      if (["classifier", "extraction", "modeling", "template_gen"].includes(b.purpose) && !m.capabilities.structuredOutput) {
        warnings.push({ purpose: b.purpose, message: `${p.name}/${b.modelId} 无原生 structuredOutput —— 运行期 JSON-mode 降级` });
      }
    }
    db.llmBindings = bindings as typeof db.llmBindings;
    return HttpResponse.json({ bindings, warnings });
  }),

  http.post("*/a/v1/rules/:id/retire", ({ params }) => {
    const rule = db.rules.find((r) => r.id === params.id);
    if (!rule) return err(404, "NOT_FOUND", "rule not found");
    rule.status = "RETIRED";
    return HttpResponse.json(rule);
  }),

  // ---- 管理平台增量 §2：租户与用户 ----
  http.get("*/a/v1/tenants", ({ request }) => {
    const account = auth(request);
    if (!account?.roles.includes("platform_admin")) return err(403, "FORBIDDEN", "platform_admin only");
    return HttpResponse.json(db.tenants);
  }),

  http.post("*/a/v1/tenants", async ({ request }) => {
    const account = auth(request);
    if (!account?.roles.includes("platform_admin")) return err(403, "FORBIDDEN", "platform_admin only");
    const body = (await request.json()) as { key: string; name: string; industry?: string };
    if (db.tenants.some((t) => t.id === body.key)) return err(409, "TENANT_EXISTS", `租户已存在：${body.key}`);
    const tenant = { id: body.key, key: body.key, name: body.name, industry: body.industry, status: "ACTIVE" as const, createdAt: new Date().toISOString() };
    db.tenants.push(tenant);
    return HttpResponse.json(tenant, { status: 201 });
  }),

  http.get("*/a/v1/tenants/:id/users", () => HttpResponse.json(db.adminUsers)),

  http.post("*/a/v1/tenants/:id/users", async ({ request, params }) => {
    const body = (await request.json()) as { email: string; displayName?: string; roles: string[]; attributes?: Record<string, unknown> };
    if (db.adminUsers.some((u) => u.email === body.email)) return err(409, "USER_EXISTS", `邮箱已存在：${body.email}`);
    const user = {
      id: newId("usr"), tenantId: String(params.id), username: body.email, email: body.email,
      displayName: body.displayName ?? body.email.split("@")[0]!, roles: body.roles,
      attributes: body.attributes ?? {}, status: "ACTIVE" as const,
    };
    db.adminUsers.push(user);
    return HttpResponse.json({ ...user, initialPassword: "init-pass-9x" }, { status: 201 });
  }),

  http.patch("*/a/v1/tenants/:id/users/:userId", async ({ request, params }) => {
    const account = auth(request);
    const user = db.adminUsers.find((u) => u.id === params.userId);
    if (!user) return err(404, "NOT_FOUND", "user not found");
    const body = (await request.json()) as { displayName?: string; roles?: string[]; attributes?: Record<string, unknown>; status?: "ACTIVE" | "DISABLED" };
    // 自我保护：不能改自己的角色/状态
    if (account && user.username === account.username && (body.roles !== undefined || body.status !== undefined)) {
      return err(403, "FORBIDDEN", "不能修改自己账号的角色/状态");
    }
    // LAST_ADMIN：最后一个 ACTIVE tenant_admin 不可禁用/降权
    const isActiveAdmin = user.roles.some((r) => r.split(":")[0] === "tenant_admin") && user.status === "ACTIVE";
    const loses = isActiveAdmin && (body.status === "DISABLED" || (body.roles !== undefined && !body.roles.some((r) => r.split(":")[0] === "tenant_admin")));
    if (loses) {
      const others = db.adminUsers.filter((u) => u.id !== user.id && u.status === "ACTIVE" && u.roles.some((r) => r.split(":")[0] === "tenant_admin"));
      if (others.length === 0) return err(409, "LAST_ADMIN", "最后一个 ACTIVE 的 tenant_admin 不可禁用/降权");
    }
    Object.assign(user, body);
    return HttpResponse.json(user);
  }),

  http.post("*/a/v1/users/:id/reset-password", () =>
    HttpResponse.json({ password: "new-pass-123", note: "TODO: 邮件下发一次性重置链接（本期直接返回新密码）" }),
  ),

  http.get("*/a/v1/roles", () => HttpResponse.json(ROLES_RESPONSE)),

  // ---- 管理平台增量 §3：视图配置 ----
  http.get("*/a/v1/view-configs", () => HttpResponse.json({ items: db.adminViews, configVersion: db.configVersion })),

  http.post("*/a/v1/view-configs", async ({ request }) => {
    const body = (await request.json()) as (typeof db.adminViews)[number];
    if (db.adminViews.some((v) => v.viewKey === body.viewKey)) return err(409, "VIEWKEY_EXISTS", `viewKey 已存在：${body.viewKey}`);
    db.configVersion += 1;
    const created = { ...body, featureKey: `view.${body.viewKey}`, featureOn: true };
    db.adminViews.push(created);
    return HttpResponse.json({ ...created, configVersion: db.configVersion }, { status: 201 });
  }),

  http.put("*/a/v1/view-configs/:viewKey", async ({ params, request }) => {
    const view = db.adminViews.find((v) => v.viewKey === params.viewKey);
    if (!view) return err(404, "NOT_FOUND", "view config not found");
    const body = (await request.json()) as Partial<(typeof db.adminViews)[number]>;
    Object.assign(view, body, { viewKey: view.viewKey });
    db.configVersion += 1;
    return HttpResponse.json({ ...view, configVersion: db.configVersion });
  }),

  http.delete("*/a/v1/view-configs/:viewKey", ({ params, request }) => {
    const url = new URL(request.url);
    const view = db.adminViews.find((v) => v.viewKey === params.viewKey);
    if (!view) return err(404, "NOT_FOUND", "view config not found");
    const references = {
      feature: view.featureKey ?? null,
      roles: view.roles,
      sceneEntryViewKey: view.viewKey,
      intentsHint: `B 侧意图 enabledViews 含 "${String(params.viewKey)}" 的条目将失去入口`,
    };
    if (url.searchParams.get("confirm") !== "1") {
      return HttpResponse.json({ deleted: false, requiresConfirm: true, references });
    }
    db.adminViews = db.adminViews.filter((v) => v.viewKey !== params.viewKey);
    db.configVersion += 1;
    return HttpResponse.json({ deleted: true, references });
  }),

  // ---- 管理平台增量 §3：场景包 ----
  http.get("*/a/v1/scenario-packages", () =>
    HttpResponse.json([
      { id: PACKAGE_ID, tenantId: TENANT_ID, name: "电池制造场景包", fromTemplate: "battery-manufacturing", views: ["dash", "graph", "risk", "order"], toolWhitelist: [], modelOverrides: {}, thresholds: {}, createdAt: "2026-01-05T08:00:00Z", updatedAt: "2026-06-01T08:00:00Z" },
    ]),
  ),
  http.get("*/a/v1/policies", () => HttpResponse.json(POLICIES)),
  http.post("*/a/v1/authz/explain", async ({ request }) => {
    const body = (await request.json()) as { user?: { roles: string[] }; resource: { kind: string; key: string }; op: string };
    const roles = (body.user?.roles ?? []).map((r) => r.split(":")[0]);
    const matched = POLICIES.filter((p) => p.resource.kind === body.resource.kind && p.resource.key === body.resource.key);
    const allowed = matched.some((p) => p.grants.some((g) => roles.includes(g.role) && g.ops.includes(body.op as "READ")));
    const rowFilter = roles.includes("base_manager") ? `${body.resource.key}.bases IN ['常州']` : null;
    return HttpResponse.json({
      allowed,
      matched: matched.map((p) => ({ policyId: p.id, resource: `${p.resource.kind}:${p.resource.key}`, grants: p.grants.map((g) => `${g.role}:${g.ops.join("/")}`).join(", ") })),
      rowFilter,
    });
  }),

  // ---- 建模 ----
  // 原始数据集（A3 suggest 入口的可选项；与连接器同步/上传产物对应）
  http.get("*/a/v1/raw-datasets", () =>
    HttpResponse.json([
      { id: "rds-orders", name: "orders", sourceConnId: "conn-upload-1" },
      { id: "rds-oee", name: "oee_points", sourceConnId: "conn-iot" },
    ]),
  ),
  // 数据源节点行数据 + 在线编辑（A7 增量）
  http.get("*/a/v1/raw-datasets/:id/rows", ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json({ dataset: { id, name: "orders" }, rows: MOCK_RAW_ROWS[id] ?? MOCK_RAW_ROWS.default! });
  }),
  http.patch("*/a/v1/raw-datasets/:id/rows/:idx", async ({ params, request }) => {
    const id = String(params.id);
    const idx = Number(params.idx);
    const patch = (await request.json()) as Record<string, unknown>;
    const rows = (MOCK_RAW_ROWS[id] ??= structuredClone(MOCK_RAW_ROWS.default!));
    if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) return err(404, "NOT_FOUND", "row 不存在");
    rows[idx] = { ...(rows[idx] ?? {}), ...patch, _editedAt: new Date().toISOString() };
    return HttpResponse.json({ ok: true, idx, row: rows[idx] });
  }),
  http.post("*/a/v1/modeling/suggest", async ({ request }) => {
    const body = (await request.json()) as { rawDatasetIds?: string[] };
    if (!body.rawDatasetIds?.length) return err(422, "VALIDATION_ERROR", "rawDatasetIds 不能为空");
    const draft = structuredClone(db.modelingDrafts[0]!);
    draft.id = newId("draft");
    draft.status = "DRAFT";
    draft.rawDatasetIds = body.rawDatasetIds;
    delete draft.publishErrors;
    db.modelingDrafts.unshift(draft);
    return HttpResponse.json({ draftId: draft.id, status: draft.status }, { status: 202 });
  }),
  // 外部域（EXT_SIG）：环境信号清单 + 敏感性（确定性弹性）。
  http.get("*/a/v1/external-signals", () => {
    const signals = [
      { signalKey: "ev_demand_index", name: "新能源车需求指数", category: "需求", value: 112.4, unit: "index(2025=100)", asOf: "2026-06-01", source: "乘联会", trend: "up", impact: "需求", elasticity: 0.6 },
      { signalKey: "ess_subsidy_signal", name: "储能补贴政策强度", category: "政策", value: 0.72, unit: "0–1", asOf: "2026-06-10", source: "发改委公告解析", trend: "up", impact: "需求", elasticity: 0.25 },
      { signalKey: "li_carbonate_price", name: "电池级碳酸锂价", category: "原料价格", value: 96000, unit: "元/吨", asOf: "2026-06-15", source: "上海有色网", trend: "down", impact: "毛利", elasticity: -0.08 },
      { signalKey: "nickel_price", name: "镍价(LME)", category: "原料价格", value: 18600, unit: "USD/吨", asOf: "2026-06-15", source: "LME", trend: "flat", impact: "毛利", elasticity: -0.03 },
      { signalKey: "usd_cny", name: "美元兑人民币", category: "汇率", value: 7.18, unit: "CNY/USD", asOf: "2026-06-15", source: "中国外汇交易中心", trend: "up", impact: "出口营收", elasticity: 0.9 },
      { signalKey: "industrial_power_price", name: "工业电价", category: "能源", value: 0.78, unit: "元/kWh", asOf: "2026-06-01", source: "国网", trend: "flat", impact: "成本", elasticity: 0.12 },
    ];
    return HttpResponse.json({ signals, total: signals.length });
  }),
  http.get("*/a/v1/external-signals/:key/series", ({ params }) => {
    const key = String(params.key);
    const vals: Record<string, { v: number; t: string; u: string }> = {
      li_carbonate_price: { v: 96000, t: "down", u: "元/吨" }, ev_demand_index: { v: 112.4, t: "up", u: "index" },
      usd_cny: { v: 7.18, t: "up", u: "CNY/USD" }, nickel_price: { v: 18600, t: "flat", u: "USD/吨" },
      ess_subsidy_signal: { v: 0.72, t: "up", u: "0–1" }, industrial_power_price: { v: 0.78, t: "flat", u: "元/kWh" },
    };
    const s = vals[key] ?? { v: 100, t: "flat", u: "" };
    const slope = s.t === "up" ? 0.018 : s.t === "down" ? -0.018 : 0;
    const points = Array.from({ length: 12 }, (_, idx) => {
      const i = 11 - idx;
      const drift = s.v / Math.pow(1 + slope, i);
      const wobble = 1 + 0.006 * Math.sin((i + key.length) * 1.3);
      const d = new Date("2026-06-01T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() - i);
      return { month: d.toISOString().slice(0, 7), value: Math.round(drift * wobble * 1000) / 1000 };
    });
    return HttpResponse.json({ signalKey: key, unit: s.u, trend: s.t, points });
  }),
  http.post("*/a/v1/external-signals/sensitivity", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { shocks?: { signalKey?: string; deltaPct?: number }[] };
    const elas: Record<string, { impact: string; e: number }> = {
      ev_demand_index: { impact: "需求", e: 0.6 }, ess_subsidy_signal: { impact: "需求", e: 0.25 },
      li_carbonate_price: { impact: "毛利", e: -0.08 }, nickel_price: { impact: "毛利", e: -0.03 },
      usd_cny: { impact: "出口营收", e: 0.9 }, industrial_power_price: { impact: "成本", e: 0.12 },
    };
    const byMetric = new Map<string, { metric: string; deltaPct: number; drivers: { signalKey: string; deltaPct: number; contributionPp: number }[] }>();
    const unknownSignals: string[] = [];
    for (const s of body.shocks ?? []) {
      const sig = s.signalKey ? elas[s.signalKey] : undefined;
      if (!sig) { if (s.signalKey) unknownSignals.push(s.signalKey); continue; }
      const contributionPp = Math.round(Number(s.deltaPct ?? 0) * sig.e * 100) / 100;
      const m = byMetric.get(sig.impact) ?? { metric: sig.impact, deltaPct: 0, drivers: [] };
      m.deltaPct = Math.round((m.deltaPct + contributionPp) * 100) / 100;
      m.drivers.push({ signalKey: s.signalKey!, deltaPct: Number(s.deltaPct ?? 0), contributionPp });
      byMetric.set(sig.impact, m);
    }
    return HttpResponse.json({ impacts: [...byMetric.values()].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)), unknownSignals });
  }),

  // A3 确定性建模（无 LLM·字段全建模 100% 覆盖）：每个数据集字段→一个属性。
  http.post("*/a/v1/modeling/derive", async ({ request }) => {
    const body = (await request.json()) as { rawDatasetIds?: string[] };
    if (!body.rawDatasetIds?.length) return err(422, "VALIDATION_ERROR", "rawDatasetIds 不能为空");
    const dsName: Record<string, string> = { "rds-orders": "orders", "rds-oee": "oee_points" };
    const toPascal = (s: string) => s.replace(/(^|[_-])(\w)/g, (_m, _x, c: string) => c.toUpperCase()).replace(/[^\w]/g, "") || s;
    const datasets: { name: string; fields: { name: string; inferredType: string; nullRate: number; uniqueRate: number }[] }[] = [];
    const objectTypes = body.rawDatasetIds.map((id) => {
      const name = dsName[id] ?? id;
      const row = (MOCK_RAW_ROWS[id] ?? MOCK_RAW_ROWS.default!)[0] ?? {};
      const names = Object.keys(row);
      const fields = names.map((n, i) => ({ name: n, inferredType: typeof row[n] === "number" ? "number" : "string", nullRate: 0, uniqueRate: i === 0 ? 1 : 0.5 }));
      datasets.push({ name, fields });
      return {
        action: "CREATE" as const, existingTypeKey: null, typeKey: toPascal(name), displayName: name, domain: "unassigned", sourceDataset: name,
        properties: fields.map((f, i) => ({ propKey: f.name, sourceField: f.name, dataType: (f.inferredType === "number" ? "number" : "string") as "number" | "string", isPrimaryKey: i === 0, refToTypeKey: null })),
        confidence: 1,
      };
    });
    const draft = { id: newId("draft"), status: "DRAFT", rawDatasetIds: body.rawDatasetIds, datasets, suggestion: { objectTypes, linkTypes: [] } } as (typeof db.modelingDrafts)[number];
    db.modelingDrafts.unshift(draft);
    return HttpResponse.json({ draftId: draft.id, status: "DRAFT" }, { status: 201 });
  }),
  // 字段全建模覆盖报告（R12）
  http.get("*/a/v1/modeling/drafts/:id/coverage", ({ params }) => {
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草案不存在");
    const rows = d.datasets.map((ds) => {
      const mapped = new Set(d.suggestion.objectTypes.filter((t) => t.sourceDataset === ds.name).flatMap((t) => t.properties.map((p) => p.sourceField)));
      const unmodeled = ds.fields.map((f) => f.name).filter((n) => !mapped.has(n));
      return { name: ds.name, total: ds.fields.length, modeled: ds.fields.length - unmodeled.length, unmodeled };
    });
    const totalFields = rows.reduce((a, r) => a + r.total, 0);
    const modeledFields = rows.reduce((a, r) => a + r.modeled, 0);
    return HttpResponse.json({ datasets: rows, totalFields, modeledFields, coverage: totalFields ? modeledFields / totalFields : 1, fullyCovered: modeledFields === totalFields });
  }),
  http.get("*/a/v1/modeling/drafts", () => HttpResponse.json(db.modelingDrafts)),
  http.get("*/a/v1/modeling/drafts/:id", ({ params }) => {
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : err(404, "NOT_FOUND", "草案不存在");
  }),
  http.patch("*/a/v1/modeling/drafts/:id", async ({ params, request }) => {
    const body = (await request.json()) as { operations: Record<string, unknown>[] };
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草案不存在");
    for (const op of body.operations) {
      // F10 失败回滚演示：改名为 FAIL 触发 422
      if (op.op === "renameType" && op.newTypeKey === "FAIL") return err(422, "VALIDATION_ERROR", "typeKey 不合法");
      const ot = d.suggestion.objectTypes.find((o) => o.typeKey === op.typeKey);
      if (op.op === "renameType" && ot) ot.typeKey = String(op.newTypeKey);
      if (op.op === "addProperty" && ot) ot.properties.push(op.property as (typeof ot.properties)[number]);
      if (op.op === "removeProperty" && ot) ot.properties = ot.properties.filter((p) => p.propKey !== op.propKey);
      if (op.op === "setRef" && ot) {
        const p = ot.properties.find((x) => x.propKey === op.propKey);
        if (p) {
          p.refToTypeKey = String(op.refToTypeKey);
          p.dataType = "ref";
        }
      }
    }
    return HttpResponse.json(d);
  }),
  http.post("*/a/v1/modeling/drafts/:id/publish", async ({ params, request }) => {
    const d = db.modelingDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草案不存在");
    const body = (await request.json().catch(() => ({}))) as { requireFullCoverage?: boolean };
    const errors = d.suggestion.objectTypes
      .filter((ot) => !ot.properties.some((p) => p.isPrimaryKey))
      .map((ot) => ({ typeKey: ot.typeKey, message: "缺少主键属性（主键必填）" }));
    // 字段全建模门（R12）：开门则未建模字段阻断发布
    if (body?.requireFullCoverage) {
      for (const ds of d.datasets) {
        const mapped = new Set(d.suggestion.objectTypes.filter((t) => t.sourceDataset === ds.name).flatMap((t) => t.properties.map((p) => p.sourceField)));
        for (const f of ds.fields.filter((x) => !mapped.has(x.name))) {
          const tk = d.suggestion.objectTypes.find((t) => t.sourceDataset === ds.name)?.typeKey ?? ds.name;
          errors.push({ typeKey: tk, message: `字段 '${ds.name}.${f.name}' 未建模（字段全建模门 R12）` });
        }
      }
    }
    if (errors.length > 0) return HttpResponse.json({ ok: false, errors });
    d.status = "PUBLISHED";
    return HttpResponse.json({ ok: true });
  }),
  http.post("*/a/v1/modeling/drafts/:id/materialize", () => {
    const id = newId("mat");
    db.syncJobPolls.set(id, 0);
    return HttpResponse.json({ jobId: id }, { status: 202 });
  }),

  // ---- 合成数据 ----
  http.get("*/a/v1/industry-templates", () =>
    HttpResponse.json([{ industryKey: "battery-manufacturing" }, { industryKey: "discrete-assembly" }, { industryKey: "retail-supply-chain" }]),
  ),
  http.post("*/a/v1/synthetic/jobs", () => {
    const id = newId("synjob");
    db.syntheticJobPolls.set(id, 0);
    return HttpResponse.json({ jobId: id }, { status: 202 });
  }),
  http.get("*/a/v1/synthetic/jobs/:id", ({ params }) => {
    const id = String(params.id);
    const polls = (db.syntheticJobPolls.get(id) ?? 0) + 1;
    db.syntheticJobPolls.set(id, polls);
    const phase = Math.min(polls - 1, SYNTHETIC_PHASES.length);
    const done = phase >= SYNTHETIC_PHASES.length;
    return HttpResponse.json({
      id,
      status: done ? "SUCCEEDED" : "RUNNING",
      phase: Math.min(phase, SYNTHETIC_PHASES.length - 1),
      phases: SYNTHETIC_PHASES.map((name, i) => ({
        name,
        status: i < phase ? "DONE" : i === phase && !done ? "RUNNING" : done ? "DONE" : "PENDING",
      })),
      report: done ? SYNTHETIC_REPORT : undefined,
    });
  }),

  // ---- 模拟时钟（A8 §6.2） ----
  http.get("*/a/v1/synthetic/clock/ticks", () => HttpResponse.json(db.tickReports)),
  http.get("*/a/v1/synthetic/clock", () => HttpResponse.json(db.clock)),
  http.post("*/a/v1/synthetic/clock/tick", async ({ request }) => {
    const body = (await request.json()) as { advance: "1d" | "7d" };
    const days = body.advance === "7d" ? 7 : 1;
    db.clock.status = "TICKING";
    setTimeout(() => {
      for (let i = 0; i < days; i++) {
        db.clock.currentTick += 1;
        const date = new Date(new Date(db.clock.simDate).getTime() + 86400_000);
        db.clock.simDate = date.toISOString().slice(0, 10);
        db.clock.script = db.clock.script.map((s) => (s.tick <= db.clock.currentTick ? { ...s, fired: true } : s));
        db.tickReports.unshift(tickReport(db.clock.currentTick, db.clock.simDate));
      }
      db.clock.status = "ACTIVE";
    }, 600);
    return HttpResponse.json({ tickJobId: newId("tick") }, { status: 202 });
  }),
  http.post("*/a/v1/synthetic/clock/reset", () => {
    db.clock = { simDate: "2026-06-12", currentTick: 0, status: "ACTIVE", script: db.clock.script.map((s) => ({ ...s, fired: false })) };
    db.tickReports = [];
    return HttpResponse.json(db.clock);
  }),

  // ---- Action 草稿 ----
  http.post("*/a/v1/action-drafts", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const body = (await request.json()) as {
      actionTypeKey?: string;
      payload?: Record<string, unknown>;
      origin?: { userId?: string; taskId?: string };
      submit?: boolean;
    };
    if (!body.actionTypeKey) return err(422, "VALIDATION_ERROR", "actionTypeKey required");
    // 增量 §7.12：定稿走 Action —— 先校验版本可定稿（FINAL → 409 PLAN_LOCKED）
    let finalizeVersion: (typeof db.sopVersions)[number] | undefined;
    if (body.actionTypeKey === "定稿月度计划版本") {
      const versionId = String((body.payload ?? {}).versionId ?? "");
      finalizeVersion = db.sopVersions.find((v) => v.id === versionId);
      if (!finalizeVersion) return err(404, "NOT_FOUND", "sop version 不存在");
      if (finalizeVersion.status === "FINAL") {
        const e = sopPlanLocked();
        return err(e.status, e.code, e.message);
      }
      if (finalizeVersion.status !== "EXEC_MEETING") return err(409, "INVALID_STATE", `cannot request finalize from ${finalizeVersion.status}（先执行第⑤步）`);
    }
    const draft = {
      id: newId("act"),
      tenantId: TENANT_ID,
      actionTypeKey: body.actionTypeKey,
      payload: body.payload ?? {},
      origin: { userId: body.origin?.userId ?? `usr-${account.username}`, taskId: body.origin?.taskId },
      status: (body.submit ? "PENDING_APPROVAL" : "DRAFT") as "PENDING_APPROVAL" | "DRAFT",
      approvalSteps: [{ seq: 1, role: "admin" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.actionDrafts.unshift(draft);
    if (finalizeVersion) {
      finalizeVersion.pendingApproval = { draftId: draft.id };
      finalizeVersion.updatedAt = new Date().toISOString();
    }
    return HttpResponse.json({ draftId: draft.id, status: draft.status, draft }, { status: 201 });
  }),
  http.post("*/a/v1/action-drafts/:id/submit", ({ params }) => {
    const d = db.actionDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草稿不存在");
    d.status = "PENDING_APPROVAL";
    return HttpResponse.json(d);
  }),
  http.get("*/a/v1/action-drafts/:id", ({ params }) => {
    const d = db.actionDrafts.find((x) => x.id === params.id);
    return d ? HttpResponse.json(d) : err(404, "NOT_FOUND", "草稿不存在");
  }),
  http.get("*/a/v1/action-drafts", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    return HttpResponse.json(status ? db.actionDrafts.filter((d) => d.status === status) : db.actionDrafts);
  }),
  http.post("*/a/v1/action-drafts/:id/decision", async ({ params, request }) => {
    const body = (await request.json()) as { decision: "APPROVE" | "REJECT"; comment: string };
    const d = db.actionDrafts.find((x) => x.id === params.id);
    if (!d) return err(404, "NOT_FOUND", "草稿不存在");
    const step = d.approvalSteps.find((s) => !s.decision);
    if (!step) return err(409, "INVALID_STATE", "无待审批步骤");
    step.decision = body.decision;
    step.comment = body.comment;
    step.decidedAt = new Date().toISOString();
    if (body.decision === "REJECT") d.status = "REJECTED";
    else if (d.approvalSteps.every((s) => s.decision === "APPROVE")) d.status = "APPROVED";
    // 增量 §7.12：域执行器语义镜像 —— 定稿 Action EXECUTED → 版本 FINAL；变更 Action → inputs patch
    if (d.status === "APPROVED") {
      const versionId = String((d.payload as Record<string, unknown>).versionId ?? "");
      const v = db.sopVersions.find((x) => x.id === versionId);
      if (d.actionTypeKey === "定稿月度计划版本" && v) {
        v.status = "FINAL";
        v.pendingApproval = null;
        v.updatedAt = new Date().toISOString();
        d.status = "EXECUTED" as typeof d.status;
      } else if (d.actionTypeKey === "计划版本变更" && v) {
        v.inputs = { ...v.inputs, ...((d.payload as { patch?: Record<string, unknown> }).patch ?? {}) };
        v.updatedAt = new Date().toISOString();
        d.status = "EXECUTED" as typeof d.status;
      }
    }
    return HttpResponse.json(d);
  }),

  // ======================== B · AgentCore ========================

  // ---- 同步求解器代理（Entitlement §4：先查 feature —— solverKey 绑定的功能被关 → 404，不泄露存在性） ----
  http.post("*/b/v1/solvers/:key/run", async ({ params, request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const key = String(params.key);
    const features = featuresForAccount(account, db.tenantOverrides);
    const boundOff = FEATURE_REGISTRY.some(
      (f) => f.bindings?.solverKeys?.includes(key) && !features.includes(f.key),
    );
    if (boundOff) return err(404, "FEATURE_NOT_FOUND", "not found");
    const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
    const args = body.args ?? {};
    if (key === "plan_audit") {
      // F20 竞态演示哨兵：dem=999 的请求慢 400ms（AbortController 最后发出者胜）
      if ((args as { dem?: number }).dem === 999) await new Promise((r) => setTimeout(r, 400));
      return HttpResponse.json({ data: mockPlanAudit(args as unknown as MockAuditInput), snapshotVersion: "ov-12" });
    }
    if (key === "plan_generate") return HttpResponse.json({ data: mockPlanGenerate(args), snapshotVersion: "ov-12" });
    if (key === "bottleneck_matrix") return HttpResponse.json({ data: mockBottleneckMatrix(args as { baseIds?: string[] }), snapshotVersion: "ov-12" });
    if (key === "capacity_forecast") {
      const data = mockCapacityForecast(args as unknown as MockForecastArgs);
      if ("error" in data) return err(422, "VALIDATION_ERROR", String(data.error));
      return HttpResponse.json({ data, snapshotVersion: "ov-12" });
    }
    if (key === "risk_timeline") return HttpResponse.json({ data: RISK_TIMELINE, snapshotVersion: "ov-12" });
    if (key === "affected_orders") {
      // §S1.5 扩展输出：summary + rows + problems[]（4 类归并 + rootChains）
      const base = typeof args.base === "string" && args.base !== "" ? args.base : undefined;
      return HttpResponse.json({ data: affectedOrdersOutput(base), snapshotVersion: "ov-12" });
    }
    return err(404, "FEATURE_NOT_FOUND", "求解器不存在或未开通");
  }),

  http.get("*/b/v1/scenes", ({ request }) => {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    if (view) return HttpResponse.json(db.scenes.find((s) => s.viewKey === view) ?? null);
    return HttpResponse.json(db.scenes);
  }),
  http.get("*/b/v1/scene-entries", () => HttpResponse.json(db.scenes)),
  http.put("*/b/v1/scene-entries/:viewKey", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const scene = db.scenes.find((s) => s.viewKey === params.viewKey);
    if (!scene) return err(404, "NOT_FOUND", "场景不存在");
    Object.assign(scene, body);
    return HttpResponse.json(scene);
  }),

  // ---- 场景启动器：公共目录卡片（按域分组、一键启动）----
  http.get("*/b/v1/scenarios", ({ request }) => {
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
    const items = [...db.scenarios]
      .filter((s) => s.status === "PUBLISHED")
      .sort((a, b) => (a.scenarioKey < b.scenarioKey ? -1 : 1))
      .map((s) => ({
        sNo: s.scenarioKey, name: s.name, view: s.targetView, domain: s.domain, intentKey: s.intentKey,
        triggerQuestion: s.triggerQuestion, solver: s.solver, riskLevel: s.riskLevel, summary: s.summary,
        willProduceDraft: s.riskLevel === "ACTION_DRAFT", inactive: false, presetContext: s.presetContext,
      }));
    const shown = includeInactive ? items : items.filter((c) => !c.inactive);
    return HttpResponse.json({ launcherEnabled: true, total: shown.length, items: shown });
  }),

  // ---- 场景启动器 P2/P3：Scenario 一等对象管理（场景为主键，完整可配）----
  http.get("*/b/v1/scenarios/manage", () => {
    const closureOf = (s: Scenario) => {
      const issues: string[] = [];
      if (!db.intents.some((i) => i.key === s.intentKey)) issues.push(`意图「${s.intentKey}」未配置（死路）`);
      if ((s.mode === "AGENT_FIRST" || s.mode === "AGENT_ONLY") && !s.defaultAgentId) issues.push("AGENT 模式缺 defaultAgent");
      return { ready: issues.length === 0, issues };
    };
    return HttpResponse.json(
      [...db.scenarios].sort((a, b) => (a.scenarioKey < b.scenarioKey ? -1 : 1)).map((s) => ({ ...s, closure: closureOf(s) })),
    );
  }),
  http.post("*/b/v1/scenarios", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const key = String(body.scenarioKey ?? "");
    if (db.scenarios.some((s) => s.scenarioKey === key)) return err(409, "CONFLICT", "场景键已存在");
    const sc = {
      id: `scn-${key}`, tenantId: TENANT_ID, scenarioKey: key, name: String(body.name ?? key),
      domain: body.domain as string | undefined, targetView: String(body.targetView ?? ""), intentKey: String(body.intentKey ?? ""),
      triggerQuestion: String(body.triggerQuestion ?? ""), solver: body.solver as string | undefined,
      rules: (body.rules as string[]) ?? [], riskLevel: (body.riskLevel as "COMPUTE" | "ACTION_DRAFT") ?? "COMPUTE",
      summary: String(body.summary ?? ""), mode: (body.mode as Scenario["mode"]) ?? "WORKFLOW_FIRST",
      defaultAgentId: body.defaultAgentId as string | undefined,
      presetContext: (body.presetContext as Scenario["presetContext"]) ?? { targetView: String(body.targetView ?? ""), selectedObjects: [], slotPresets: {} },
      status: "DRAFT" as const, version: 1, updatedAt: new Date().toISOString(),
    };
    db.scenarios.push(sc);
    return HttpResponse.json(sc, { status: 201 });
  }),
  http.put("*/b/v1/scenarios/:key", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    if (sc.status === "PUBLISHED") return err(409, "INVALID_STATE", "场景已发布，请先退役再改");
    Object.assign(sc, body, { status: "DRAFT", updatedAt: new Date().toISOString() });
    return HttpResponse.json(sc);
  }),
  http.post("*/b/v1/scenarios/:key/publish", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    sc.status = "PUBLISHED";
    sc.version += 1;
    sc.updatedAt = new Date().toISOString();
    return HttpResponse.json(sc);
  }),
  http.post("*/b/v1/scenarios/:key/retire", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key);
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    sc.status = "RETIRED";
    sc.updatedAt = new Date().toISOString();
    return HttpResponse.json(sc);
  }),

  // ---- 查询任务 ----
  http.post("*/b/v1/queries", async ({ request }) => {
    const account = auth(request);
    if (!account) return err(401, "UNAUTHORIZED", "未登录");
    const idemKey = request.headers.get("Idempotency-Key");
    if (idemKey && db.idempotency.has(idemKey)) {
      const taskId = db.idempotency.get(idemKey)!;
      return HttpResponse.json({ taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events` }, { status: 202 });
    }
    const body = (await request.json()) as { packageId: string; query: string; context: Record<string, unknown> };
    if (body.packageId !== PACKAGE_ID) return err(404, "PACKAGE_NOT_FOUND", "场景包不存在");
    // shell.query-dock 关闭 → 404（Entitlement §5）
    const features = featuresForAccount(account, db.tenantOverrides);
    if (!features.includes("shell.query-dock")) return err(404, "FEATURE_NOT_FOUND", "功能未开通");

    const taskId = newId("task");
    const plan = scriptForQuery(taskId, body.query, body.context as never);
    const task: MockTask = {
      id: taskId,
      query: body.query,
      context: body.context,
      plan,
      status: "ROUTING",
      clarificationRounds: 0,
      createdAt: new Date().toISOString(),
    };
    db.tasks.set(taskId, task);
    if (idemKey) db.idempotency.set(idemKey, taskId);
    registerTaskScript(taskId, plan.segments);
    return HttpResponse.json({ taskId, status: "ROUTING", streamUrl: `/b/v1/queries/${taskId}/events` }, { status: 202 });
  }),

  http.post("*/b/v1/queries/:taskId/clarification", ({ params }) => {
    const task = db.tasks.get(String(params.taskId));
    if (!task) return err(404, "NOT_FOUND", "任务不存在");
    if (task.plan.segments.length < 2) return err(409, "INVALID_STATE", "任务不在等待澄清状态");
    task.clarificationRounds += 1;
    releaseNextSegment(task.id);
    return HttpResponse.json({ ok: true });
  }),

  http.post("*/b/v1/queries/:taskId/cancel", () => HttpResponse.json({ ok: true }, { status: 202 })),
  http.post("*/b/v1/queries/:taskId/feedback", () => HttpResponse.json({ ok: true })),

  // 推演历史列表（Phase9C；时钟图标侧滑面板消费）：本租户最近 QOS 任务。
  http.get("*/b/v1/queries", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? "50") || 50));
    const items = [
      { taskId: "task-hist-1", query: "4680-NCM 加 20% 六周能不能接？", path: "PATH_A", status: "COMPLETED", view: "project-sim", conversationId: "conv-h1", classification: { intentKey: "capacity_feasibility", confidence: 0.94 }, answerSummary: "P50 42.0 万套 · 缺口 1.0；加夜班可补齐", createdAt: "2026-06-15T09:12:00Z", completedAt: "2026-06-15T09:12:08Z" },
      { taskId: "task-hist-2", query: "常州基地影响哪些订单？", path: "PATH_A", status: "COMPLETED", view: "risk", conversationId: "conv-h2", classification: { intentKey: "affected_orders", confidence: 0.91 }, answerSummary: "8 单受影响 · 营收暴露 27.6 亿", createdAt: "2026-06-15T08:40:00Z", completedAt: "2026-06-15T08:40:05Z" },
      { taskId: "task-hist-3", query: "现金垫 45 亿过得了体检吗？", path: "PATH_A", status: "COMPLETED", view: "plan-audit", conversationId: "conv-h3", classification: { intentKey: "plan_audit_q", confidence: 0.88 }, answerSummary: "有条件通过：现金垫 C18 越线，建议补 5 亿", createdAt: "2026-06-14T16:05:00Z", completedAt: "2026-06-14T16:05:06Z" },
    ].slice(0, limit);
    return HttpResponse.json({ items, total: items.length });
  }),

  http.get("*/b/v1/queries/:taskId", ({ params }) => {
    const task = db.tasks.get(String(params.taskId));
    if (!task) return err(404, "NOT_FOUND", "任务不存在");
    return HttpResponse.json({
      id: task.id,
      tenantId: TENANT_ID,
      userId: "usr-planner",
      packageId: PACKAGE_ID,
      conversationId: "conv-1",
      query: task.query,
      context: task.context,
      status: "COMPLETED",
      path: task.plan.path,
      classification: {
        candidates: task.plan.intentKey ? [{ intentKey: task.plan.intentKey, confidence: 0.93 }] : [],
        outOfCatalog: task.plan.path === "AGENT",
        extractedSlots: {},
        latencyMs: 420,
        model: "claude-haiku-4-5",
      },
      matchedIntent: task.plan.intentKey ? { intentId: `int-${task.plan.intentKey}`, intentKey: task.plan.intentKey, version: 1 } : undefined,
      clarificationRounds: task.clarificationRounds,
      answer: task.plan.finalAnswer,
      createdAt: task.createdAt,
      completedAt: new Date().toISOString(),
    });
  }),

  // ---- 意图目录 ----
  http.get("*/b/v1/catalog/packages/:packageId/intents", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    return HttpResponse.json(status ? db.intents.filter((i) => i.status === status) : db.intents);
  }),
  http.put("*/b/v1/catalog/intents/:intentId", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const intent = db.intents.find((i) => i.id === params.intentId);
    if (!intent) return err(404, "NOT_FOUND", "意图不存在");
    if (intent.status !== "DRAFT") return err(409, "INVALID_STATE", "仅 DRAFT 可改");
    Object.assign(intent, body);
    return HttpResponse.json(intent);
  }),
  http.post("*/b/v1/catalog/intents/:intentId/publish", ({ params }) => {
    const intent = db.intents.find((i) => i.id === params.intentId);
    if (!intent) return err(404, "NOT_FOUND", "意图不存在");
    if (intent.slots.length === 0) return err(422, "PLAN_VALIDATION_ERROR", "slots 为空，无法发布");
    intent.status = "PUBLISHED";
    return HttpResponse.json(intent);
  }),
  http.post("*/b/v1/catalog/intents/:intentId/retire", ({ params }) => {
    const intent = db.intents.find((i) => i.id === params.intentId);
    if (!intent) return err(404, "NOT_FOUND", "意图不存在");
    intent.status = "RETIRED";
    return HttpResponse.json(intent);
  }),
  http.get("*/b/v1/catalog/packages/:packageId/plans", () => HttpResponse.json(db.plans)),
  // G-4：自助创建执行计划（消裁决#27 死路 —— 意图可绑定新建计划）
  http.post("*/b/v1/catalog/packages/:packageId/plans", async ({ request }) => {
    const body = (await request.json()) as { key?: string };
    const plan = { id: `plan_${Date.now()}`, key: body.key ?? `plan_${Date.now()}`, version: 1, status: "DRAFT" };
    db.plans.push(plan);
    return HttpResponse.json(plan, { status: 201 });
  }),

  // ---- 兜底运营 ----
  http.get("*/b/v1/ops/fallback-stats", () => HttpResponse.json({ items: FALLBACK_CLUSTERS })),
  http.post("*/b/v1/ops/fallback/:traceId/promote", ({ params }) => {
    const cluster = FALLBACK_CLUSTERS.find((c) => c.traceId === params.traceId);
    const intentId = newId("int");
    db.intents.push({
      id: intentId,
      packageId: PACKAGE_ID,
      key: `incubated_${intentId}`,
      version: 1,
      status: "DRAFT",
      name: `孵化意图（${cluster?.querySample.slice(0, 12) ?? "新"}…）`,
      description: "由兜底留痕孵化，待人工补全",
      examples: cluster ? [cluster.querySample] : [],
      enabledViews: "*",
      slots: [],
      planId: PLANS[0]!.id,
      riskLevel: "READ",
      owner: "ops",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return HttpResponse.json({ intentId });
  }),

  // ---- 运营自动化 OpsSchedule（§6） ----
  http.get("*/a/v1/ops/schedule", () => HttpResponse.json({ schedule: db.opsSchedule })),
  http.put("*/a/v1/ops/schedule", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    db.opsSchedule = {
      ...(body as object),
      tenantId: TENANT_ID,
      updatedAt: new Date().toISOString(),
      updatedBy: "usr_demo_admin",
    } as typeof db.opsSchedule;
    return HttpResponse.json({ schedule: db.opsSchedule });
  }),

  // ---- agents / workflows / skills / mcp ----
  http.get("*/b/v1/agents", () => HttpResponse.json(db.agents)),
  http.put("*/b/v1/agents/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const agent = db.agents.find((a) => a.id === params.id);
    if (!agent) return err(404, "NOT_FOUND", "Agent 不存在");
    Object.assign(agent, body);
    return HttpResponse.json(agent);
  }),
  http.post("*/b/v1/agents/:id/publish", ({ params }) => {
    const agent = db.agents.find((a) => a.id === params.id);
    if (!agent) return err(404, "NOT_FOUND", "Agent 不存在");
    const errors: { field: string; message: string }[] = [];
    if (agent.scopeDeclaration.objectTypes.length === 0) errors.push({ field: "scopeDeclaration.objectTypes", message: "必须声明对象类型范围（最小授权）" });
    if (!agent.systemPrompt) errors.push({ field: "systemPrompt", message: "系统提示词不能为空" });
    if (errors.length > 0) return HttpResponse.json({ ok: false, errors });
    agent.status = "PUBLISHED";
    return HttpResponse.json({ ok: true });
  }),

  http.get("*/b/v1/workflows", () => HttpResponse.json(db.workflows)),
  // G-4：自助创建工作流（此前无创建入口）
  http.post("*/b/v1/workflows", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const base = structuredClone(db.workflows[0] ?? {}) as Record<string, unknown>;
    const wf = { ...base, ...body, id: `wf_${Date.now()}`, tenantId: "demo", version: 1, status: "DRAFT" } as unknown as (typeof db.workflows)[number];
    db.workflows.push(wf);
    return HttpResponse.json(wf, { status: 201 });
  }),
  http.put("*/b/v1/workflows/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const wf = db.workflows.find((w) => w.id === params.id);
    if (!wf) return err(404, "NOT_FOUND", "Workflow 不存在");
    Object.assign(wf, body);
    return HttpResponse.json(wf);
  }),
  http.post("*/b/v1/workflows/:id/publish", async ({ params, request }) => {
    const wf = db.workflows.find((w) => w.id === params.id);
    if (!wf) return err(404, "NOT_FOUND", "Workflow 不存在");
    const { force } = ((await request.json().catch(() => ({}))) ?? {}) as { force?: boolean };
    const errors = validateWorkflow(wf.steps);
    if (errors.length > 0) return HttpResponse.json({ ok: false, errors });
    // 引用模式增量 §2.3 破坏性门禁（mock：名称含 [breaking] 模拟 inputs 不兼容 + latest 引用方）
    const referrers = db.agents.filter((a) => a.tools.some((t) => t.kind === "WORKFLOW" && t.workflowId === wf.id && t.version === "latest"));
    if (wf.name.includes("[breaking]") && referrers.length > 0 && !force) {
      return err(409, "BREAKING_CHANGE_WITH_LATEST_REFS", `破坏性变更且存在 latest 引用方：${referrers.map((a) => `agent:${a.name}`).join("、")}`);
    }
    wf.status = "PUBLISHED";
    return HttpResponse.json({
      ok: true,
      impact: { agents: referrers.length, plans: 0, intents: 0, refs: referrers.map((a) => ({ kind: "agent", key: a.key, version: a.version, name: a.name })) },
      ...(force ? { forced: true } : {}),
    });
  }),

  http.get("*/b/v1/skills", () => HttpResponse.json(db.skills)),
  // G-4：自助创建技能（此前无创建入口）
  http.post("*/b/v1/skills", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const base = structuredClone(db.skills[0] ?? {}) as Record<string, unknown>;
    const sk = { ...base, ...body, id: `skl_${Date.now()}`, version: 1, status: "DRAFT", resources: [] } as unknown as (typeof db.skills)[number];
    db.skills.push(sk);
    return HttpResponse.json(sk, { status: 201 });
  }),
  http.put("*/b/v1/skills/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const s = db.skills.find((x) => x.id === params.id);
    if (!s) return err(404, "NOT_FOUND", "Skill 不存在");
    Object.assign(s, body);
    return HttpResponse.json(s);
  }),
  http.post("*/b/v1/skills/:id/publish", ({ params }) => {
    const s = db.skills.find((x) => x.id === params.id);
    if (!s) return err(404, "NOT_FOUND", "Skill 不存在");
    s.status = "PUBLISHED";
    return HttpResponse.json(s);
  }),

  http.get("*/b/v1/mcp-configs", () => HttpResponse.json(db.mcpConfigs)),
  http.post("*/b/v1/mcp-configs/:id/test", () =>
    HttpResponse.json({
      ok: true,
      tools: [
        { name: "demo_weather", description: "查询天气（演示工具）" },
        { name: "demo_exchange_rate", description: "汇率查询（演示工具）" },
      ],
    }),
  ),
  http.post("*/b/v1/mcp-configs", async ({ request }) => {
    const body = (await request.json()) as Record<string, DefaultBodyType>;
    const cfg = { id: newId("mcp"), tenantId: TENANT_ID, name: String(body.name), transport: body.transport, credentialRef: body.credential ? "cred-new" : undefined, status: "ACTIVE" } as never;
    db.mcpConfigs.push(cfg);
    return HttpResponse.json(cfg, { status: 201 });
  }),
  http.put("*/b/v1/mcp-configs/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const cfg = db.mcpConfigs.find((c) => c.id === params.id);
    if (!cfg) return err(404, "NOT_FOUND", "MCP 配置不存在");
    const { credential, ...rest } = body;
    Object.assign(cfg, rest);
    if (credential) cfg.credentialRef = "cred-updated";
    return HttpResponse.json(cfg);
  }),

  // ---- A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）----
  http.get("*/a/v1/data-builders", () => HttpResponse.json([DATA_BUILDER_PRESET])),
  http.post("*/a/v1/data-builders/run", async ({ request }) => {
    const body = (await request.json()) as { script?: string; seed?: number; dryRun?: boolean };
    return HttpResponse.json(mockBuildJob(body));
  }),
  http.get("*/a/v1/data-builders/jobs/list", () => HttpResponse.json(MOCK_BUILD_JOBS)),
  // g8 故事驱动建域 · P1：StoryBuildRun 历史推演记录
  http.get("*/a/v1/databuilder/runs", () => HttpResponse.json(MOCK_STORY_RUNS)),
  http.get("*/a/v1/databuilder/runs/:id", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    return r ? HttpResponse.json(r) : new HttpResponse(null, { status: 404 });
  }),
  http.post("*/a/v1/databuilder/runs", async ({ request }) => {
    const body = (await request.json()) as { script?: string; seed?: number; stage?: string };
    const id = newId("sbr");
    const script = (body.script ?? "").trim();
    // g8-P2：stage=manifest → 倒推补录表单（PENDING_INPUT，不建域）
    if (body.stage === "manifest") {
      const run = {
        id,
        tenantId: "demo",
        script,
        inputManifest: {
          runId: id,
          fields: [
            { key: "type:Order", label: "对象类型 · 订单", dataType: "string", required: false, default: "Order", source: "STORY" },
            { key: "seed", label: "确定性 seed（同 seed 重跑字节级一致）", dataType: "number", required: true, default: body.seed ?? 42, source: "ASK_USER" },
            { key: "reuseConnectors", label: "复用既有连接器（可选）", dataType: "string", required: false, source: "REUSE_EXISTING", options: ["合成数据源（确定性生成）"] },
          ],
        },
        producedConnections: [],
        producedDatasets: [],
        status: "PENDING_INPUT",
        createdAt: new Date().toISOString(),
      };
      MOCK_STORY_RUNS.unshift(run);
      return HttpResponse.json(run, { status: 201 });
    }
    const job = mockBuildJob({ script, seed: body.seed }) as { planId: string; closure: unknown };
    const run = {
      id,
      tenantId: "demo",
      script,
      buildPlan: { id: job.planId, objectTypes: [{}, {}], rules: [{}], solverNeeds: [{}], intentNeeds: [{}], planNeeds: [{}], sceneNeeds: [{}] },
      closureReport: job.closure,
      scaffoldReceipt: { items: [{ kind: "scene", key: "scene_mock", status: "SCAFFOLDED" }, { kind: "intent", key: "intent_mock", status: "SCAFFOLDED" }], fullChainOk: true },
      gapReport: { question: script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
      producedConnections: ["conn_mock"],
      producedDatasets: ["rds_mock"],
      status: "SUCCEEDED",
      createdAt: new Date().toISOString(),
    };
    MOCK_STORY_RUNS.unshift(run);
    return HttpResponse.json(run, { status: 201 });
  }),
  http.post("*/a/v1/databuilder/backfill", () => {
    // g8-P6：逆向导出既有推演能力（风险/产能）→ 逐条建域 → 写入历史 + 压测报告
    const caps = [
      { key: "affected_orders", script: "针对订单做风险推演分析" },
      { key: "capacity_forecast", script: "针对基地做产能推演分析" },
    ];
    const runs = caps.map((c) => {
      const job = mockBuildJob({ script: c.script, seed: 42 }) as { planId: string; closure: unknown };
      const id = newId("sbr");
      MOCK_STORY_RUNS.unshift({
        id, tenantId: "demo", script: c.script,
        buildPlan: { id: job.planId, objectTypes: [{}, {}], rules: [{}], solverNeeds: [{}], intentNeeds: [{}], planNeeds: [{}], sceneNeeds: [{}] },
        closureReport: job.closure,
        scaffoldReceipt: { items: [{ kind: "scene", key: `scene_${c.key}`, status: "SCAFFOLDED" }], fullChainOk: true },
        producedConnections: ["conn_mock"], producedDatasets: ["rds_mock"],
        status: "SUCCEEDED", createdAt: new Date().toISOString(),
      });
      return { key: c.key, runId: id, status: "SUCCEEDED", fullChainOk: true };
    });
    return HttpResponse.json({ total: runs.length, succeeded: runs.length, failed: 0, runs });
  }),
  http.patch("*/a/v1/databuilder/runs/:id/inputs", async ({ request, params }) => {
    const body = (await request.json()) as { inputs?: { seed?: number } };
    const run = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!run) return new HttpResponse(null, { status: 404 });
    const job = mockBuildJob({ script: run.script, seed: body.inputs?.seed }) as { planId: string; closure: unknown };
    Object.assign(run, {
      buildPlan: { id: job.planId, objectTypes: [{}, {}], rules: [{}], solverNeeds: [{}], intentNeeds: [{}], planNeeds: [{}], sceneNeeds: [{}] },
      closureReport: job.closure,
      scaffoldReceipt: { items: [{ kind: "scene", key: "scene_mock", status: "SCAFFOLDED" }], fullChainOk: true },
      producedConnections: ["conn_mock"],
      producedDatasets: ["rds_mock"],
      status: "SUCCEEDED",
    });
    return HttpResponse.json(run, { status: 201 });
  }),
];

/**
 * 发布校验（QOS §4.2 语义约束 + 环检测）：
 * - steps[i] 只能引用 steps[j].output（j<i）→ 违反报 PLAN_VALIDATION_ERROR（定位 stepId）
 * - render_answer 必须为末步
 * - invoke_agent 指向会回调本 workflow 的 agent → CYCLIC_INVOCATION（定位 stepId）
 */
export function validateWorkflow(steps: PlanStep[]): { stepId?: string; code: string; message: string }[] {
  const errors: { stepId?: string; code: string; message: string }[] = [];
  const seen = new Set<string>();
  steps.forEach((s, i) => {
    const text = JSON.stringify(s.params);
    const refs = [...text.matchAll(/\{\{steps\.([\w-]+)\./g)].map((m) => m[1]!);
    for (const ref of refs) {
      if (!seen.has(ref)) {
        errors.push({ stepId: s.id, code: "PLAN_VALIDATION_ERROR", message: `步骤只能引用前序步骤产出：${ref} 不在 #${i + 1} 之前` });
      }
    }
    if (s.type === "invoke_agent" && (s.params as { agentId?: string }).agentId === "agt-explore") {
      // agt-explore 的工具里挂了本 workflow（wf-cap）→ 静态可达环
      errors.push({ stepId: s.id, code: "CYCLIC_INVOCATION", message: "检测到循环调用：agent agt-explore 的工具链回到本 workflow" });
    }
    seen.add(s.id);
  });
  const last = steps[steps.length - 1];
  if (last && last.type !== "render_answer") {
    errors.push({ stepId: last.id, code: "PLAN_VALIDATION_ERROR", message: "render_answer 必须为最后一步" });
  }
  return errors;
}
