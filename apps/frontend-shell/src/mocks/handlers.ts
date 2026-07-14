import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { PlanStep, Scenario } from "@platform/contracts";
import { BOUNDARY_IMPACT, boundaryVersion } from "@platform/contracts";
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
const mockCategoryMode: Record<string, "SYSTEM_INTEGRATION" | "FILE_UPLOAD"> = {};
const mockCategoryTpl: Record<string, string[] | null> = {};

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
const META_POLICY = { tenantId: "demo", roles: ["admin"] as string[] };
const MOCK_STORY_RUNS: { id: string; script: string; status: string; createdAt: string; [k: string]: unknown }[] = [];
/** 工业级工作流运行时 mock：6 步持久化步骤状态机（happy 路径全 SUCCEEDED，含一个 SKIPPED 演示两轴分离）。 */
const WF_STEP_DEFS: { stepKey: string; title: string }[] = [
  { stepKey: "dry_build", title: "试建：出 BuildPlan + A 三向闭包（不发布）" },
  { stepKey: "cross_scaffold", title: "跨系统下发：A 闭包通过则向 AgentCore 下发 B 栈 scaffold" },
  { stepKey: "gap_analysis", title: "比对现状：倒推 BuildPlan vs 系统现状（跨模块统一 diff）" },
  { stepKey: "publish_build", title: "全链 HARD 门：A⊕B 闭合则真建 + 发布 + 落切片" },
  { stepKey: "validation", title: "推演验证痕迹：结论依据反向核对知识图谱" },
  { stepKey: "inference", title: "一键推演：故事主问句经 QOS/求解器跑出答案" },
  { stepKey: "record", title: "记账：装配 StoryBuildRun 落库 + 发 storybuild.run_recorded" },
];
const MOCK_GAP = {
  entries: [
    { kind: "dataset", side: "content", needed: 5, existing: 1, toCreate: 4, missing: 0, items: [] },
    { kind: "ontology_type", side: "structure", needed: 8, existing: 3, toCreate: 5, missing: 0, items: [] },
    { kind: "rule", side: "structure", needed: 1, existing: 0, toCreate: 1, missing: 0, items: [] },
    { kind: "slice", side: "structure", needed: 8, existing: 0, toCreate: 8, missing: 0, items: [] },
    { kind: "solver", side: "code", needed: 5, existing: 4, toCreate: 0, missing: 1, items: [{ key: "schedule_impact", status: "MISSING" }] },
    { kind: "intent", side: "cross_system", needed: 5, existing: 0, toCreate: 5, missing: 0, items: [] },
  ],
  totals: { needed: 21, existing: 8, toCreate: 12, missing: 1 },
  generatedAt: new Date().toISOString(),
};
const MOCK_SCAFFOLD_MANIFEST = {
  runId: "mock",
  items: [
    { module: "agent", key: "agt_affected_orders", status: "PENDING_BSTACK", definition: { systemPrompt: "针对 affected_orders 的推演分析 agent", tools: ["affected_orders"] } },
    { module: "plan", key: "plan_affected_orders", status: "PENDING_BSTACK", definition: { steps: ["invoke_solver", "render"], solverKey: "affected_orders" } },
    { module: "scene", key: "scene_affected_orders", status: "PENDING_BSTACK", definition: { targetView: "risk", mode: "WORKFLOW" } },
  ],
  fullChainOk: false,
  pendingBstack: true,
  recordedAt: new Date().toISOString(),
};
function mockWorkflowRun(script: string, seed: number, status: "SUCCEEDED" | "FAILED" = "SUCCEEDED") {
  const id = newId("bwf");
  const storyRunId = newId("sbr");
  const failAt = status === "FAILED" ? "cross_scaffold" : null;
  let hitFail = false;
  const steps = WF_STEP_DEFS.map((d) => {
    if (hitFail) return { ...d, status: "PENDING", attempts: 0, maxAttempts: d.stepKey === "cross_scaffold" ? 3 : 1 };
    if (d.stepKey === failAt) { hitFail = true; return { ...d, status: "FAILED", attempts: 3, maxAttempts: 3, durationMs: 12, error: { code: "SCAFFOLD_HTTP", message: "scaffold 下发失败：连接超时", retryable: true } }; }
    const skipped = d.stepKey === "inference"; // 演示 SKIPPED（未要求推演）
    if (d.stepKey === "gap_analysis") {
      return { ...d, status: "SUCCEEDED", attempts: 1, maxAttempts: 1, durationMs: 6, detail: "需 21 · 复用 8 · 新建 12 · 缺 1", checkpoint: { gapAnalysis: MOCK_GAP } };
    }
    if (d.stepKey === "cross_scaffold") {
      // A7：单机态 B 栈 scaffold 清单（pending-bstack，看得到倒推出的 agent/plan/scene 定义）
      return { ...d, status: "SUCCEEDED", attempts: 1, maxAttempts: 3, durationMs: 7, detail: "bOk=true · 单机可见(待B对账)", checkpoint: { scaffoldManifest: MOCK_SCAFFOLD_MANIFEST } };
    }
    return { ...d, status: skipped ? "SKIPPED" : "SUCCEEDED", attempts: 1, maxAttempts: d.stepKey === "cross_scaffold" ? 3 : 1, durationMs: 5 + (idSeq % 9), detail: d.stepKey === "record" ? `status=${status}` : undefined };
  });
  return { id, tenantId: "demo", kind: "story_build", script, scriptHash: "mockhash", seed, inference: false, status, steps, context: {}, storyRunId: status === "SUCCEEDED" ? storyRunId : undefined, resumedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as { id: string; status: string; steps: { stepKey: string; status: string }[]; [k: string]: unknown };
}
const MOCK_WORKFLOW_RUNS: ReturnType<typeof mockWorkflowRun>[] = [];
/** 推进一个异步 RUNNING 运行一步（模拟后台脱离驱动；轮询即见逐步实时跳动）。 */
function advanceMockWorkflow(wf: { status: string; steps: { stepKey: string; status: string; durationMs?: number }[]; storyRunId?: string }) {
  if (wf.status !== "RUNNING") return;
  const next = wf.steps.find((s) => s.status === "PENDING");
  if (next) { next.status = next.stepKey === "inference" ? "SKIPPED" : "SUCCEEDED"; next.durationMs = 6; }
  if (!wf.steps.some((s) => s.status === "PENDING")) { wf.status = "SUCCEEDED"; wf.storyRunId = wf.storyRunId ?? newId("sbr"); }
}
/** 全栈 BuildPlan mock（区2 故事理解分组卡片渲染源）：故事倒推出的全栈制品，命名条目供前端结构化展示。 */
function mockBuildPlan(planId: string) {
  return {
    id: planId,
    dataSources: [{ connType: "synthetic", name: "合成数据源（确定性生成）", datasetKey: "ds_order", rowCount: 120, fields: [] }],
    objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "order", properties: [] }, { typeKey: "Base", displayName: "基地", domain: "capacity", properties: [] }],
    sliceNeeds: [{ sliceKey: "order_risk", rootType: "Order", hops: [] }],
    rules: [{ key: "C03", name: "产能约束", expression: "load <= capacity", scopeObjectTypes: ["Base"], severity: "WARN" }],
    solverNeeds: [{ solverKey: "affected_orders", inputFields: [] }],
    intentNeeds: [{ intentKey: "risk_inference", triggers: ["风险推演"], slots: [], riskLevel: "MEDIUM" }],
    planNeeds: [{ planKey: "risk_plan", steps: ["invoke_solver", "render_answer"], renderBindings: [] }],
    workflowNeeds: [{ workflowKey: "risk_workflow", kind: "workflow", steps: [] }],
    skillNeeds: [{ skillKey: "risk_skill", capability: "风险评估", resources: [] }],
    agentNeeds: [{ agentKey: "risk_agent", systemPrompt: "", tools: [], skills: [], ruleBindings: [], scopeObjectTypes: [] }],
    mcpNeeds: [{ serverName: "risk_mcp", tools: [] }],
    sceneNeeds: [{ scenarioKey: "risk_scene", targetView: "risk", presetContext: {} }],
    kbDocs: [{ title: "风险评估手册", content: "" }],
  };
}
/** 区6③ 故事覆盖度 mock：逐句对账，命中已知关键词 = mapped，否则未理解（与后端口径一致）。 */
function mockStoryCoverage(script: string) {
  const KW = ["基地", "订单", "风险", "产能", "信用", "客户", "利用率", "物料", "交期"];
  return script
    .split(/[。！？；;.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => {
      const refs = KW.filter((k) => text.includes(k));
      return { text, mapped: refs.length > 0, refs };
    });
}
/** 区6④ 推演验证痕迹 mock：一致性（实体/公理/版本钉/数字溯源）+ 交叉验证（结论依据对象 vs KG）。 */
function mockValidationTrace() {
  return {
    slicesUsed: ["order_risk"],
    consistency: {
      checks: [
        { kind: "ENTITY_DEFINED", ref: "Order", status: "PASS", detail: "对象类型 订单 已在本体定义" },
        { kind: "AXIOM", ref: "C03", status: "PASS", detail: "load <= capacity" },
        { kind: "VERSION_PIN", ref: "bpl_mock", status: "PASS" },
        { kind: "NUMERIC_PROVENANCE", ref: "affected_orders", status: "PASS" },
      ],
      verdict: "ALL_PASS",
    },
    crossValidation: {
      claims: [{ claim: "Order:SO-1.qty == 1.5", kind: "PROPERTY", subjectType: "Order", subjectId: "SO-1", property: "qty", assertedValue: 1.5, status: "CONSISTENT" }],
      verdict: "ALL_CONSISTENT",
    },
    generatedAt: new Date().toISOString(),
  };
}
/** 区5 模块同步矩阵真值源 mock：跨多模块的产出（A 栈已发布 + B 栈 DRAFT，对应 scaffold）。 */
function mockProducedArtifacts() {
  return [
    { module: "connector", kind: "connection", key: "conn_mock", action: "CREATED", status: "PUBLISHED" },
    { module: "connector", kind: "dataset", key: "rds_mock", action: "CREATED", status: "PUBLISHED" },
    { module: "ontology", kind: "objectType", key: "Order", action: "CREATED", status: "PUBLISHED" },
    { module: "ontology", kind: "objectType", key: "Base", action: "CREATED", status: "PUBLISHED" },
    { module: "slice", kind: "slice", key: "order_risk", action: "CREATED", status: "PUBLISHED" },
    { module: "rule", kind: "rule", key: "C03", action: "CREATED", status: "PUBLISHED" },
    { module: "solver", kind: "solver", key: "affected_orders", action: "REUSED", status: "PUBLISHED" },
    { module: "catalog", kind: "intent", key: "risk_inference", action: "CREATED", status: "DRAFT" },
    { module: "workflow", kind: "workflow", key: "risk_workflow", action: "CREATED", status: "DRAFT" },
    { module: "agent", kind: "agent", key: "risk_agent", action: "CREATED", status: "DRAFT" },
    { module: "scene", kind: "scene", key: "risk_scene", action: "CREATED", status: "DRAFT" },
  ];
}
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

// A18.4 求解器审核台 mock：一个审核中临时件（LLM 生成、未认证）+ 一个已治理件（mutable，promote 翻转）。
const MOCK_SOLVER_ARTIFACTS: {
  id: string; tenantId: string; key: string; computeSource: string; outputShape: string[]; argHints: Record<string, string>;
  rationale: string; origin: string; status: string; trustLevel: string; hash: string; version: number; createdBy: string; createdAt: string; rejectReason?: string;
}[] = [
  {
    id: "sart_demo_seg_share_v1", tenantId: "demo", key: "seg_share_forecast",
    computeSource: "(ctx, args) => {\n  const segs = ctx.objectsByType.DemandSegment || [];\n  const total = segs.reduce((s, d) => s + (d.p50 || 0), 0);\n  return { rows: segs.map(d => ({ segment: d.segment, share: total ? d.p50 / total : 0 })) };\n}",
    outputShape: ["rows"], argHints: {}, rationale: "按需求细分 P50 计算各业态占比，回答『储能占比是多少』。",
    origin: "LLM", status: "PROVISIONAL", trustLevel: "UNVERIFIED", hash: "a1b2c3d4e5f60718", version: 1, createdBy: "usr_demo_admin", createdAt: "2026-06-22T02:00:00.000Z",
  },
  {
    id: "sart_demo_mat_cov_v2", tenantId: "demo", key: "material_coverage",
    computeSource: "(ctx, args) => {\n  const m = ctx.objectsByType.MaterialBalance || [];\n  return { rows: m.map(x => ({ material: x.material, cov: x.ltaPct })) };\n}",
    outputShape: ["rows"], argHints: {}, rationale: "列各物料长协覆盖率。",
    origin: "LLM", status: "GOVERNED", trustLevel: "VERIFIED", hash: "f0e1d2c3b4a59687", version: 2, createdBy: "usr_demo_planner", createdAt: "2026-06-21T09:00:00.000Z",
  },
];

// V11 · VLE 段级红绿矩阵 mock 断言集（七段抽样 + ⑤参照双算 + 一条失败 diff 供下钻）。
const VLE_MOCK_ASSERTIONS = [
  { segment: "①接入", point: "接入产出核心类型行数 == GenSpec", oracle: "constructed", pass: true, expected: { Base: 13, Model: 6, Order: 24 }, actual: { Base: 13, Model: 6, Order: 24 } },
  { segment: "②建模与对象化", point: "链接引用完整性（悬挂引用=0）", oracle: "invariant", pass: true, expected: 0, actual: 0 },
  { segment: "③聚合与派生", point: "聚合下推 == 明细求和（守恒律）", oracle: "invariant", pass: true, expected: 4680, actual: 4680 },
  { segment: "④规则查全查准", point: "植入越线行被独立谓词捕获（C03）", oracle: "constructed", pass: true, expected: ">0", actual: 3 },
  { segment: "⑤求解器执行", point: "参照实现双算 capacity_forecast P50/P90", oracle: "reference", pass: false, expected: { p50: 6.3625, p90: 5.9171 }, actual: { p50: 6.3625, p90: 2.9586 }, diff: "P90 期望 5.9171 实际 2.9586（Δ2.9585）· 首个偏离基地 BASE-CZ" },
  { segment: "⑥行动终态", point: "真值变更必经审批（审批链非空）", oracle: "invariant", pass: true, expected: 0, actual: 0 },
  { segment: "⑦校准注入", point: "校准注入即收敛（mapeAfter<mapeBefore）", oracle: "invariant", pass: true, expected: 0, actual: 0 },
] as const;

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
  // DF.12 边界册治理：影响图 + 版本（直接派生 contracts 单一来源，与真后端同源）。
  http.get("*/a/v1/boundary/impact", () => HttpResponse.json({ impact: BOUNDARY_IMPACT, registries: BOUNDARY_IMPACT.map((b) => b.registry) })),
  http.get("*/a/v1/boundary/version", () => HttpResponse.json(boundaryVersion())),
  // DF.13c 原型 intake（mock：返回确定性示例解析 + 对账；真后端 parsePrototypeHtml 确定性解析上传 HTML）。
  http.post("*/a/v1/databuilder/intake", () =>
    HttpResponse.json({
      intake: {
        dataSources: [
          { name: "BASE_DATA", columns: ["baseId", "name", "util", "gwh"], sampleRows: [{ baseId: "changzhou", name: "常州", util: 88, gwh: 35 }, { baseId: "xiamen", name: "厦门", util: 85, gwh: 28 }] },
          { name: "ORDER_DATA", columns: ["so", "cust", "model", "qty", "baseRef"], sampleRows: [{ so: "SO-001", cust: "星辰汽车", model: "4680-NCM", qty: 1200, baseRef: "changzhou" }] },
        ],
        links: [{ src: "ORDER_DATA", tgt: "BASE_DATA", rel: "produced_at" }],
        unparsed: [{ name: "CHART_CONFIG", reason: "非数据表（图表配置对象，已诚实跳过不静默丢）" }],
      },
      reconcile: {
        autoMapped: [
          { datasetName: "BASE_DATA", column: "name", targetType: "Base", targetField: "name" },
          { datasetName: "BASE_DATA", column: "util", targetType: "Base", targetField: "util" },
        ],
        candidates: [
          { datasetName: "ORDER_DATA", column: "cust", candidates: [{ targetType: "Order", targetField: "cust", score: 0.82 }, { targetType: "Customer", targetField: "name", score: 0.61 }] },
        ],
      },
    }),
  ),

  // P3 导入正门（mock）：HTML 物化进库 → 返回落库连接 + RawDataset 概要（值与原型一致）。
  http.post("*/a/v1/databuilder/intake/import", () =>
    HttpResponse.json({
      connection: { id: "conn_proto_mock", name: "原型导入:prototype.html", category: "PROTOTYPE" },
      datasets: [
        { id: "rds_base", name: "BASE_DATA", rowCount: 2, fields: ["baseId", "name", "util", "gwh"] },
        { id: "rds_order", name: "ORDER_DATA", rowCount: 1, fields: ["so", "cust", "model", "qty", "baseRef"] },
      ],
      rowCounts: { BASE_DATA: 2, ORDER_DATA: 1 },
    }),
  ),

  // P3 闭环末步（mock）：按对账把导入表物化为既有对象类型 ObjectInstance。
  http.post("*/a/v1/databuilder/intake/objectify", () =>
    HttpResponse.json({
      jobId: "job_proto_mock",
      materialized: [{ dataset: "ORDER_DATA", type: "Order", count: 1 }],
      skipped: [{ dataset: "BASE_DATA", reason: "多义/未命中，待人确认（不猜）" }],
    }),
  ),

  // ---- Entitlement ----
  http.get("*/a/v1/features/registry", () => HttpResponse.json(FEATURE_REGISTRY)),

  // C12 配置迁移（OC3 跨系统 Saga）：导出本租户 bundle + 导入跑 Saga。真后端 config-bundle.ts；mock 给确定性 Saga 结果。
  http.get("*/a/v1/config-bundles/export", () =>
    HttpResponse.json({ platformSchemaVersion: "1.0", sourceTenantId: "demo", exportedAt: "2026-06-25T00:00:00Z", featureOverrides: { "view.dash": true, "view.plan-audit": false } }),
  ),
  http.post("*/a/v1/config-bundles/import", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { bundle?: { platformSchemaVersion?: string; featureOverrides?: Record<string, boolean> }; dryRun?: boolean; conflictPolicy?: string };
    const overrides = body.bundle?.featureOverrides ?? {};
    const known = new Set(FEATURE_REGISTRY.map((f) => f.key));
    const unknown = Object.keys(overrides).filter((k) => !known.has(k));
    const base = { id: "imp_mock_1", tenantId: "demo", schemaVersion: body.bundle?.platformSchemaVersion ?? "1.0", dryRun: !!body.dryRun, conflictPolicy: body.conflictPolicy ?? "OVERWRITE", createdAt: "2026-06-25T00:00:00Z", updatedAt: "2026-06-25T00:00:01Z" };
    if (unknown.length > 0) return HttpResponse.json({ ...base, state: "FAILED", error: `未知功能键：${unknown.slice(0, 5).join(", ")}` });
    // 目标当前（mock）：view.dash=true → 同；view.plan-audit 不存在 → 新增。
    const current: Record<string, boolean> = { "view.dash": true };
    const added: string[] = [], changed: { key: string; from: boolean; to: boolean }[] = [], same: string[] = [];
    for (const [k, v] of Object.entries(overrides)) {
      if (!(k in current)) added.push(k);
      else if (current[k] !== v) changed.push({ key: k, from: current[k]!, to: v });
      else same.push(k);
    }
    const diff = { featureOverrides: { added, changed, same }, conflicts: changed.map((c) => c.key) };
    if (body.conflictPolicy === "FAIL" && diff.conflicts.length > 0) return HttpResponse.json({ ...base, state: "FAILED", diff, error: `存在 ${diff.conflicts.length} 项冲突且 policy=FAIL` });
    if (body.dryRun) return HttpResponse.json({ ...base, state: "DRY_RUN_OK", diff });
    return HttpResponse.json({ ...base, state: "COMMITTED", diff });
  }),

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

  // ---- 数据接入分类（mock）----
  http.get("*/a/v1/data-categories", () =>
    HttpResponse.json({
      items: [
        { key: "sales_orders", displayName: "销售订单", description: "客户下达的电池销售订单（型号/数量/交期/状态）。", mode: mockCategoryMode.sales_orders ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "salesforce_crm", "rest_api", "file_upload"], customColumns: mockCategoryTpl.sales_orders ?? null, types: [{ typeKey: "Order", displayName: "销售订单", columns: ["so", "cust", "model", "qty", "due", "status"], present: true }] },
        { key: "demand_forecast", displayName: "销售预测与计划", description: "需求预测、年度情景与触发条件、计划目标（驱动产能/排产推演）。", mode: mockCategoryMode.demand_forecast ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "rest_api"], customColumns: mockCategoryTpl.demand_forecast ?? null, types: [{ typeKey: "PlanTarget", displayName: "计划目标", columns: ["period", "level", "value"], present: true }, { typeKey: "AnnualScenario", displayName: "年度情景", columns: ["key", "name", "version"], present: true }] },
        { key: "customer_ar", displayName: "客户与应收", description: "客户主数据（信用/账期）与应收发票。", mode: mockCategoryMode.customer_ar ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["salesforce_crm", "sap_erp", "file_upload"], customColumns: mockCategoryTpl.customer_ar ?? null, types: [{ typeKey: "Customer", displayName: "客户", columns: ["custId", "name", "creditLimit"], present: true }] },
        { key: "product_master", displayName: "产品主数据", description: "产品平台、系列、型号、版本与应用细分（毛利率口径）及工程变更。", mode: mockCategoryMode.product_master ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "sap_erp", "rest_api"], customColumns: mockCategoryTpl.product_master ?? null, types: [{ typeKey: "ProductPlatform", displayName: "产品平台", columns: ["platformId", "platformCode", "name", "category", "status"], present: true }, { typeKey: "ProductSeries", displayName: "产品系列", columns: ["seriesId", "seriesCode", "name", "category", "targetMarket"], present: true }, { typeKey: "Model", displayName: "产品型号", columns: ["modelId", "name", "chem", "pos", "unitPrice"], present: true }, { typeKey: "ProductVersion", displayName: "产品版本", columns: ["versionId", "versionCode", "status", "effectiveDate"], present: true }, { typeKey: "EngineeringChange", displayName: "工程变更", columns: ["changeId", "changeNumber", "changeType", "status"], present: true }] },
        { key: "capacity_base", displayName: "产能与基地", description: "生产基地、产线、产能投资项目及产品-产线/设备制造能力。", mode: mockCategoryMode.capacity_base ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"], customColumns: mockCategoryTpl.capacity_base ?? null, types: [{ typeKey: "Base", displayName: "生产基地", columns: ["baseId", "name", "kind", "lon", "lat"], present: true }, { typeKey: "Line", displayName: "产线", columns: ["lineId", "baseId", "utilization"], present: true }, { typeKey: "ProductLineCapability", displayName: "产品产线能力", columns: ["capId", "capability", "maxCapacity", "yield"], present: true }, { typeKey: "ProductEquipmentCapability", displayName: "产品设备能力", columns: ["equipCapId", "capability", "maxSpeed"], present: true }] },
        { key: "process_routing", displayName: "工艺路线与工序", description: "工艺路线、工序定义、工艺能力边界及换型矩阵（瓶颈/换型排序推演）。", mode: mockCategoryMode.process_routing ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "generic_jdbc", "rest_api"], customColumns: mockCategoryTpl.process_routing ?? null, types: [{ typeKey: "Process", displayName: "工序", columns: ["procId", "name", "kind", "yield"], present: true }, { typeKey: "Routing", displayName: "工艺路线", columns: ["routingId", "routingCode", "operationCount", "totalStandardTime"], present: true }, { typeKey: "Operation", displayName: "工序定义", columns: ["operationId", "operationName", "standardTime", "yield"], present: true }, { typeKey: "ProcessCapabilityWindow", displayName: "工艺能力边界", columns: ["capabilityId", "parameterName", "minValue", "maxValue", "targetValue"], present: true }] },
        { key: "equipment_ledger", displayName: "设备与能耗", description: "设备台账 OEE、检修计划与能耗计量（MES/IoT）。", mode: mockCategoryMode.equipment_ledger ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["generic_jdbc", "rest_api", "file_upload"], customColumns: mockCategoryTpl.equipment_ledger ?? null, types: [{ typeKey: "Equipment", displayName: "设备", columns: ["equipId", "processId", "ctSeconds", "availFactor"], present: true }] },
        { key: "material_inventory", displayName: "物料与库存", description: "物料主数据、BOM、物料替代关系、批次库存及物料平衡（断供/集中度推演）。", mode: mockCategoryMode.material_inventory ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"], customColumns: mockCategoryTpl.material_inventory ?? null, types: [{ typeKey: "Material", displayName: "物料", columns: ["matId", "name", "unitPrice", "leadTime"], present: true }, { typeKey: "BOMHeader", displayName: "BOM", columns: ["bomId", "bomCode", "bomLevel"], present: true }, { typeKey: "BOMDetail", displayName: "BOM明细", columns: ["bomDetailId", "sequence", "quantity"], present: true }, { typeKey: "MaterialAlternative", displayName: "物料替代", columns: ["altId", "priority", "approvalStatus"], present: true }] },
        { key: "procurement", displayName: "采购与供应商", description: "供应商主数据、采购订单与在途批次（到货延误/缺料推演）。", mode: mockCategoryMode.procurement ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "rest_api", "file_upload"], customColumns: mockCategoryTpl.procurement ?? null, types: [{ typeKey: "Supplier", displayName: "供应商", columns: ["supplierId", "supplierCode", "name", "rating", "status"], present: true }, { typeKey: "PurchaseOrder", displayName: "采购订单", columns: ["poId", "qty", "etaDay"], present: true }] },
        { key: "quality_compliance", displayName: "质量与合规", description: "质量标准、检验特性、数据源健康度与产品认证（合规/碳护照前置）。", mode: mockCategoryMode.quality_compliance ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "rest_api"], customColumns: mockCategoryTpl.quality_compliance ?? null, types: [{ typeKey: "QualityStandard", displayName: "质量标准", columns: ["standardId", "itemName", "targetValue", "toleranceUpper", "toleranceLower"], present: true }, { typeKey: "InspectionCharacteristic", displayName: "检验特性", columns: ["charId", "charName", "inspectionType", "samplingRate"], present: true }] },
        { key: "finance_carbon", displayName: "财务与碳", description: "基地财务账户、情景财务指标、财务预算（收入/成本/毛利）与碳因子。", mode: mockCategoryMode.finance_carbon ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["sap_erp", "generic_jdbc", "file_upload"], customColumns: mockCategoryTpl.finance_carbon ?? null, types: [{ typeKey: "FinanceAccount", displayName: "财务账户", columns: ["accId", "cashOnHand", "receivable"], present: true }] },
        { key: "external_signal", displayName: "外部信号", description: "锂价/镍价/汇率/需求指数/政策等市场与环境信号。", mode: mockCategoryMode.external_signal ?? "SYSTEM_INTEGRATION", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["external_feed", "mock_external", "rest_api"], customColumns: mockCategoryTpl.external_signal ?? null, types: [{ typeKey: "ExternalSignal", displayName: "外部信号", columns: ["signalId", "category", "value"], present: true }] },
        { key: "decision_cockpit", displayName: "经营决策驾驶舱", description: "经营指标库/KSF/责任主体与根因归因模板（目标-指标-责任骨架，驱动各视图 KPI · 根因 DAG）。", mode: mockCategoryMode.decision_cockpit ?? "FILE_UPLOAD", modes: ["SYSTEM_INTEGRATION", "FILE_UPLOAD"], connectorTypeKeys: ["file_upload", "rest_api"], customColumns: mockCategoryTpl.decision_cockpit ?? null, types: [{ typeKey: "Metric", displayName: "指标", columns: ["metricId", "name", "target", "actual"], present: true }] },
      ],
    })),
  http.put("*/a/v1/data-categories/:key/mode", async ({ request, params }) => {
    const body = (await request.json()) as { mode: "SYSTEM_INTEGRATION" | "FILE_UPLOAD" };
    mockCategoryMode[params.key as string] = body.mode;
    return HttpResponse.json({ categoryKey: params.key, mode: body.mode });
  }),
  http.put("*/a/v1/data-categories/:key/template", async ({ request, params }) => {
    const body = (await request.json()) as { columns: string[] };
    mockCategoryTpl[params.key as string] = body.columns.length > 0 ? body.columns : null;
    return HttpResponse.json({ categoryKey: params.key, customColumns: mockCategoryTpl[params.key as string] });
  }),

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
    } else if (type === "DemandSegment") {
      rows = [
        { segId: "dseg-1", segment: "乘用车", tgt: 69, p50: 71, p90: 66.5, act: 66.8 },
        { segId: "dseg-2", segment: "储能", tgt: 45, p50: 49, p90: 45.2, act: 41.9 },
        { segId: "dseg-3", segment: "商用车", tgt: 13.6, p50: 12, p90: 11.1, act: 12.9 },
      ].map((r) => ({ id: r.segId, props: r }));
    } else if (type === "Workshop") {
      const workshops = filterByScope(BASES, account).flatMap((b) =>
        ["制浆", "涂布", "辊压", "分切", "卷绕", "装配", "注液", "化成", "分容", "PACK"].map((wt, i) => ({
          id: `workshop-${b.name}-${i + 1}`,
          props: { workshopId: `${b.name}-WS${String(i + 1).padStart(2, "0")}`, baseId: b.id, name: `${b.name}${wt}车间`, processType: wt },
        })),
      );
      rows = workshops;
    } else if (type === "SopVersionRow") {
      // SOP.4 版本演进对比（V1/V3/V5/V7）
      rows = [
        { ver: "V1", date: "2026-05-01", demand: 127, supply: 114, gap: 13, note: "初版需求", isFinal: false },
        { ver: "V3", date: "2026-05-15", demand: 130, supply: 123, gap: 7, note: "供给评审上修", isFinal: false },
        { ver: "V5", date: "2026-05-29", demand: 132, supply: 129, gap: 3, note: "财务整合", isFinal: false },
        { ver: "V7", date: "2026-06-12", demand: 134, supply: 133, gap: 1, note: "高管会待定稿", isFinal: true },
      ].map((r) => ({ id: `sopv-${r.ver}`, props: r }));
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
    const known = new Set(["Base", "Model", "Order", "Workshop"]);
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
  // V11：断言矩阵 mock（含 ⑤参照双算 + 一条失败 diff，供段级红绿矩阵/下钻渲染）。
  http.get("*/a/v1/validation/runs/:id", ({ params }) =>
    HttpResponse.json({
      id: String(params.id), profile: "SMOKE", seed: 42, startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:09:00Z",
      report: { profile: "SMOKE", seed: 42, pass: false, coverage: { module: 0.92, assertion: 1, loop: 0.86 }, engineeringVerificationScore: 0.95, assertions: VLE_MOCK_ASSERTIONS },
    }),
  ),
  http.get("*/a/v1/validation/runs", () =>
    HttpResponse.json([
      {
        id: "vrun_1", profile: "SMOKE", seed: 42, startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:09:00Z",
        report: { profile: "SMOKE", seed: 42, pass: true, coverage: { module: 0.95, assertion: 0.9, loop: 1 }, engineeringVerificationScore: 0.94, assertions: [] },
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
  // C9 评测用例创建（input/expect）：真后端 POST /b/v1/evals。mock 回回填一条带 id 的用例。
  http.post("*/b/v1/evals", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return HttpResponse.json({ id: `ec_mock_${Date.now()}`, tenantId: "demo", origin: "MANUAL", createdAt: new Date().toISOString(), ...body }, { status: 201 });
  }),
  http.get("*/b/v1/evals/runs", () =>
    HttpResponse.json({
      items: [
        { id: "erun_1", tenantId: "demo", suite: "classifier", startedAt: "2026-06-17T08:00:00Z", finishedAt: "2026-06-17T08:01:00Z", total: 20, passed: 19, passRate: 0.95, metrics: { intentAccuracy: 0.95, toolCorrectness: 0.9, avgToolCalls: 2.1, avgLatencyMs: 320, avgTokenCost: 1200 }, results: [], llmMode: "MOCK", parity: { byFailKind: { INTENT: 1, TOOLSEQ: 0, ANSWER: 0, OTHER: 0 }, byCase: [] } },
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
    // CL.7：可补齐的缺口（EMPTY_DATA 类，含"达成率"标记）→ CONVERGED（续推可出答案）；其余 → BOUNDARY（诚实工单）。
    if (b.query.includes("达成率")) {
      return HttpResponse.json({
        question: b.query, maxRounds: b.maxRounds ?? 4,
        rounds: [{ round: 1, gapReport: { question: b.query, taskId: "t1", verdict: "ANSWERABLE", path: "AGENT", findings: [], generatedAt: "2026-06-17T00:00:00Z" }, fillApplied: { gapCode: "EMPTY_DATA", action: "fill-data 已补", advanced: true } }],
        terminalState: "CONVERGED", openTickets: [], generatedAt: "2026-06-17T00:00:00Z",
      });
    }
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
  // C7 切片编辑器：规划器求路径 + 入库 + 试切预览。真后端 planSlice/PUT slices/resolveSlice；mock 给确定性结果。
  http.post("*/a/v1/slices/plan", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { rootType?: string; targets?: string[] };
    const rootType = body.rootType ?? "Order";
    const targets = body.targets ?? [];
    return HttpResponse.json({
      ok: true,
      plan: {
        sliceKey: `custom_${rootType.toLowerCase()}`,
        rootType,
        paths: targets.map((t) => ({ target: t, hops: [{ linkKey: `${rootType.toLowerCase()}_to_${t.toLowerCase()}`, direction: "out", toType: t }] })),
        pathEvidence: targets.map((t) => `${rootType} -[${rootType.toLowerCase()}_to_${t.toLowerCase()}:out]-> ${t}`),
        spannedDomains: ["factory"],
        reused: false,
      },
    });
  }),
  http.put("*/a/v1/ontology/slices/:sliceKey", ({ params }) =>
    HttpResponse.json({ sliceKey: String(params.sliceKey), version: 1 }, { status: 201 }),
  ),
  http.post("*/a/v1/slices/:sliceKey/resolve", () =>
    HttpResponse.json({
      data: { nodes: [{ id: "o1", type: "Order" }, { id: "b1", type: "Base" }], edges: [{ from: "o1", to: "b1", linkKey: "order_to_base" }], truncated: false },
      snapshotVersion: "ov-12",
    }),
  ),
  http.post("*/b/v1/evals/run", () =>
    HttpResponse.json({ id: "erun_2", tenantId: "demo", suite: "classifier", startedAt: "2026-06-17T09:00:00Z", finishedAt: "2026-06-17T09:01:00Z", total: 20, passed: 20, passRate: 1, metrics: { intentAccuracy: 1, toolCorrectness: 1, avgToolCalls: 2, avgLatencyMs: 300, avgTokenCost: 1100 }, results: [], llmMode: "MOCK" }),
  ),

  // A4 对象/类型浏览器：每类型物化计数（与 object-types mock 对齐）+ 14 业务域注册表。
  http.get("*/a/v1/ontology/object-types/stats", () =>
    HttpResponse.json({
      stats: [
        { key: "Base", displayName: "生产基地", domain: "factory", propCount: 4, derivedCount: 1, pk: "baseId", count: 3 },
        { key: "Model", displayName: "电池型号", domain: "product", propCount: 3, derivedCount: 0, pk: "modelId", count: 5 },
        { key: "Order", displayName: "订单", domain: "product", propCount: 6, derivedCount: 0, pk: "so", count: 20 },
        { key: "ExternalSignal", displayName: "外部信号", domain: "external", propCount: 5, derivedCount: 0, pk: "signalKey", count: 0 },
      ],
    }),
  ),
  http.get("*/a/v1/business-domains", () =>
    HttpResponse.json({
      domains: [
        { key: "factory", displayName: "工厂/基地", color: "#4C8BF5" },
        { key: "product", displayName: "产品/型号", color: "#36BFA5" },
        { key: "process", displayName: "工艺/工序", color: "#9C6ADE" },
        { key: "equip", displayName: "设备", color: "#DD9551" },
        { key: "people", displayName: "人员/班组", color: "#E2719B" },
        { key: "quality", displayName: "质量", color: "#46A758" },
        { key: "capacity", displayName: "产能", color: "#3D9AE8" },
        { key: "forecast", displayName: "预测/需求", color: "#8E6FE8" },
        { key: "sales", displayName: "销售/订单", color: "#E5894B" },
        { key: "material", displayName: "物料/供应", color: "#C2A33B" },
        { key: "finance", displayName: "财务/成本", color: "#5BB98C" },
        { key: "plan", displayName: "规划/情景", color: "#7C8CF8" },
        { key: "external", displayName: "外部信号", color: "#B36AC2" },
        { key: "decision", displayName: "决策/根因", color: "#E5484D" },
      ],
    }),
  ),
  http.get("*/a/v1/ontology/object-types", () =>
    // 图谱体系：与真后端 SEED_DEMO 一致的推演图谱（推演读这些类型），非只 Base。
    HttpResponse.json([
      {
        key: "Base", displayName: "生产基地", domain: "factory", status: "ACTIVE",
        sourceBindings: [{ connId: "conn-synth", dataset: "base" }],
        properties: [
          { propKey: "baseId", dataType: "string", isPrimaryKey: true },
          { propKey: "name", dataType: "string", isPrimaryKey: false },
          { propKey: "util", dataType: "number", isPrimaryKey: false, unit: "%" },
          { propKey: "gwh", dataType: "number", isPrimaryKey: false, unit: "GWh" },
        ],
      },
      { key: "Model", displayName: "电池型号", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "model" }], properties: [{ propKey: "modelId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "chemistry", dataType: "string" }] },
      { key: "Order", displayName: "销售订单", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "order" }], properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "cust", dataType: "string" }, { propKey: "qty", dataType: "number" }, { propKey: "due", dataType: "date" }] },
      { key: "Line", displayName: "产线", domain: "capacity", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "line" }], properties: [{ propKey: "lineNo", dataType: "string", isPrimaryKey: true }, { propKey: "baseId", dataType: "ref", refToTypeKey: "Base" }, { propKey: "utilization", dataType: "number", unit: "%" }] },
      { key: "Process", displayName: "工序", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "process" }], properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }] },
      { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", sourceBindings: [{ connId: "conn-synth", dataset: "customer" }], properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "creditLimit", dataType: "number" }] },
      // Phase 2 产品工程主数据域
      { key: "ProductPlatform", displayName: "产品平台", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_platforms" }], properties: [{ propKey: "platformId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "enum" }] },
      { key: "ProductSeries", displayName: "产品系列", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_series" }], properties: [{ propKey: "seriesId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "category", dataType: "enum" }] },
      { key: "ProductVersion", displayName: "产品版本", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_versions" }], properties: [{ propKey: "versionId", dataType: "string", isPrimaryKey: true }, { propKey: "versionCode", dataType: "string" }, { propKey: "status", dataType: "enum" }] },
      { key: "BOMHeader", displayName: "BOM", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_bom_headers" }], properties: [{ propKey: "bomId", dataType: "string", isPrimaryKey: true }, { propKey: "bomCode", dataType: "string" }, { propKey: "bomLevel", dataType: "number" }] },
      { key: "BOMDetail", displayName: "BOM明细", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_bom_details" }], properties: [{ propKey: "bomDetailId", dataType: "string", isPrimaryKey: true }, { propKey: "sequence", dataType: "number" }, { propKey: "quantity", dataType: "number" }] },
      { key: "Material", displayName: "物料", domain: "supply", status: "ACTIVE", sourceBindings: [{ connId: "conn-erp", dataset: "erp_materials" }], properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "unitPrice", dataType: "number" }] },
      { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", sourceBindings: [{ connId: "conn-srm", dataset: "srm_suppliers" }], properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }, { propKey: "rating", dataType: "enum" }] },
      { key: "MaterialAlternative", displayName: "物料替代", domain: "supply", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_material_alts" }], properties: [{ propKey: "altId", dataType: "string", isPrimaryKey: true }, { propKey: "priority", dataType: "number" }, { propKey: "approvalStatus", dataType: "enum" }] },
      { key: "Routing", displayName: "工艺路线", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_routings" }], properties: [{ propKey: "routingId", dataType: "string", isPrimaryKey: true }, { propKey: "routingCode", dataType: "string" }, { propKey: "operationCount", dataType: "number" }] },
      { key: "Operation", displayName: "工序", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_operations" }], properties: [{ propKey: "operationId", dataType: "string", isPrimaryKey: true }, { propKey: "operationName", dataType: "string" }, { propKey: "standardTime", dataType: "number" }] },
      { key: "ProcessCapabilityWindow", displayName: "工艺能力边界", domain: "process", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_process_capabilities" }], properties: [{ propKey: "capabilityId", dataType: "string", isPrimaryKey: true }, { propKey: "parameterName", dataType: "string" }, { propKey: "minValue", dataType: "number" }] },
      { key: "QualityStandard", displayName: "质量标准", domain: "quality", status: "ACTIVE", sourceBindings: [{ connId: "conn-qms", dataset: "qms_standards" }], properties: [{ propKey: "standardId", dataType: "string", isPrimaryKey: true }, { propKey: "itemName", dataType: "string" }, { propKey: "targetValue", dataType: "number" }] },
      { key: "InspectionCharacteristic", displayName: "检验特性", domain: "quality", status: "ACTIVE", sourceBindings: [{ connId: "conn-qms", dataset: "qms_inspection_chars" }], properties: [{ propKey: "charId", dataType: "string", isPrimaryKey: true }, { propKey: "charName", dataType: "string" }, { propKey: "inspectionType", dataType: "enum" }] },
      { key: "ProductLineCapability", displayName: "产品产线能力", domain: "factory", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_product_line_cap" }], properties: [{ propKey: "capId", dataType: "string", isPrimaryKey: true }, { propKey: "capability", dataType: "enum" }, { propKey: "maxCapacity", dataType: "number" }] },
      { key: "ProductEquipmentCapability", displayName: "产品设备能力", domain: "equip", status: "ACTIVE", sourceBindings: [{ connId: "conn-mes", dataset: "mes_product_equip_cap" }], properties: [{ propKey: "equipCapId", dataType: "string", isPrimaryKey: true }, { propKey: "capability", dataType: "enum" }, { propKey: "maxSpeed", dataType: "number" }] },
      { key: "EngineeringChange", displayName: "工程变更", domain: "product", status: "ACTIVE", sourceBindings: [{ connId: "conn-plm", dataset: "plm_ecn" }], properties: [{ propKey: "changeId", dataType: "string", isPrimaryKey: true }, { propKey: "changeNumber", dataType: "string" }, { propKey: "changeType", dataType: "enum" }] },
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
  http.get("*/a/v1/ontology/mapping/registries", () =>
    HttpResponse.json({
      linkTypes: [
        { key: "model_producible_at", fromType: "Model", toType: "Base", cardinality: "N:N" },
        { key: "order_for_model", fromType: "Order", toType: "Model", cardinality: "1:1" },
        { key: "line_belongs_to_base", fromType: "Line", toType: "Base", cardinality: "1:N" },
      ],
      rules: [
        { key: "C03", expression: "weeklySupply.p90 >= weeklyDemand", scope: "Order、Base", severity: "阻断" },
        { key: "C06", expression: "kitCoverDays >= 5", scope: "MaterialBalance", severity: "阻断" },
        { key: "C15", expression: "marginPct >= floorPct", scope: "Order", severity: "告警" },
      ],
      actions: [
        { name: "采纳产能保障方案", params: "型号 / 需求量 / 交期 / 调参组合(夜班·通道·外协)", check: "C03 上限校验 · C08 外协红线 · 需含审批人(C10)", target: "生产工单MO（写回）", perm: "发起:规划员 · 审批:生产计划部" },
        { name: "预警处置方案", params: "基地 / 风险对象 / 方案编号 / 起效时间", check: "C06 齐套冻结 · C11 错峰评审", target: "处置工单（写回）+ 风险曲线消解", perm: "发起:基地负责人 · 审批:生产计划部" },
        { name: "调整排产分配", params: "订单 / 基地分配比例 / 生效周", check: "C04 仅认证产线 · C01 产线上限", target: "排产计划（写回）", perm: "发起:计划员 · 审批:基地负责人" },
        { name: "定稿月度计划版本", params: "计划版本号 / 三张评审表快照 / 高管决议", check: "C21 差异已提报 · C18 现金安全垫 · C22 定稿后锁定", target: "月度S&OP版本（定稿+锁定）", perm: "发起:S&OP主持人 · 审批:经营决策会" },
      ],
      events: [
        { name: "检修窗口", window: "每基地年度检修周（如常州第8周）", affects: "设备OEE / 产线负载率 +14", source: "EAM/CMMS 检修计划" },
        { name: "交付高峰", window: "订单交期聚集日 ±3天", affects: "产线负载率 / 人力工时 +9", source: "S&OP 订单交期" },
        { name: "到货间隙", window: "采购批次周期(≈14天)末端", affects: "物料供给齐套 / 物流在途 +10", source: "WMS/ERP 采购批次" },
      ],
    }),
  ),
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
  // C5 求解器目录（只读发现页数据源）：真后端来自 /a/v1/solvers/registry（注册表 feature 过滤）。mock 给代表性子集。
  http.get("*/a/v1/solvers/registry", () =>
    HttpResponse.json({
      solvers: [
        { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", argHints: { modelId: "型号 ID", qty: "需求量", weeks: "周数" }, domain: "plan", outputShape: ["p50", "p90", "gap", "ok"] },
        { key: "bottleneck_matrix", name: "瓶颈矩阵", description: "按基地×工序输出瓶颈强度矩阵，定位约束工序。", argHints: { baseId: "基地 ID" }, domain: "plan", outputShape: ["matrix"] },
        { key: "selection_optimize", name: "组合最优化", description: "通用 0/1 选择最优化（CP-SAT 可证最优）：预算约束下选价值最大子集。", argHints: { items: "候选项", budget: "预算上限" }, domain: "generic", outputShape: ["selected", "totalValue"] },
      ],
    }),
  ),
  http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
    const key = String(params.key);
    if (key === "risk_timeline") return HttpResponse.json({ data: RISK_TIMELINE, snapshotVersion: "ov-12" });
    if (key === "schedule_attainment") return HttpResponse.json({ data: { value: 91.4 }, snapshotVersion: "agg-77" });
    if (key === "capacity_forecast")
      return HttpResponse.json({ data: { p50: 21.4, p90: 18.9, gap: -1.2, ok: false, healthFactor: 0.93, mainBn: "化成柜", perBaseRows: [], pendingCertList: [] }, snapshotVersion: "ov-12" });
    if (key === "affected_orders") return HttpResponse.json({ data: affectedOrdersOutput(), snapshotVersion: "ov-12" });
    if (key === "counterfactual_timeline") {
      const baseline = Array.from({ length: 30 }, (_, d) => Math.min(97, Math.round(60 + d * 1.2)));
      const mitigated = baseline.map((v, d) => Math.max(40, Math.round(v - 10 * Math.min(1, Math.max(0, (d - 21) / 7)))));
      return HttpResponse.json({ data: { baselineSeries: baseline, mitigatedSeries: mitigated, threshold: 85, base: "常州", factor: "瓶颈工序", mitigation: "瓶颈工序扩容", delta: { peakCut: Math.max(...baseline) - Math.max(...mitigated), crossDelayDays: 3, ordersSaved: 4 }, events: [], summary: "反事实双轨" }, snapshotVersion: "ov-12" });
    }
    if (key === "mitigation_select")
      // cockpit P3 对症方案优选（与 params.risk.mitigations 同源形状）
      return HttpResponse.json({
        data: {
          factor: "物料齐套", baseName: "常州", urgency: 0.67, recommended: "early_stock",
          plans: [
            { key: "early_stock", name: "提前备料", eff: 12, tn: 2, cost: "中", risk: "低", score: 2.0 },
            { key: "air_freight", name: "空运补料", eff: 15, tn: 1, cost: "极高", risk: "低", score: 1.5 },
            { key: "alt_supplier", name: "备选供应商切换", eff: 9, tn: 5, cost: "高", risk: "中", score: 0.4 },
          ],
          draftPayload: { base: "常州", factor: "物料齐套", planKey: "early_stock" },
        },
        snapshotVersion: "ov-12",
      });
    if (key === "cockpit_kpi")
      // DS.2 富 KPI（mock：从对象派生的 5 标量确定性示例）
      return HttpResponse.json({ data: { supplyV7: 132, revAttainPct: 102, utilPeak: 88, aopBaseRev: 240, cashCushion: 58 }, snapshotVersion: "ov-12" });
    if (key === "metric_rollup")
      // SPINE.4 经营指标条（mock：op 级三指标，物料保障率越线）
      return HttpResponse.json({
        data: {
          metrics: [
            { metricId: "kpi-margin", key: "gm_rate", name: "毛利率", unit: "%", level: "op", category: "profit", target: 16, actual: 15.2, delta: -0.8, miss: false },
            { metricId: "kpi-attain", key: "demand_attain", name: "需求达成率", unit: "%", level: "op", category: "scale", target: 100, actual: 96.4, delta: -3.6, miss: false },
            { metricId: "kpi-material", key: "material_cov", name: "物料保障率", unit: "%", level: "op", category: "material", target: 100, actual: 77.3, delta: -22.7, miss: true },
          ],
          missCount: 1, byLevel: { op: 3 }, summary: "3 项指标，1 项越线",
        },
        snapshotVersion: "ov-12",
      });
    if (key === "plan_rootcause")
      // cockpit P2 根因归因 DAG（mock：物料保障率越线 → 现货缺口 → 取证叶）
      return HttpResponse.json({
        data: {
          kpis: [{ kpiId: "kpi-material", name: "物料保障率", category: "material", actual: 77, target: 100, gap: 23, offTarget: true, status: "RED" }],
          dag: {
            nodes: [
              { id: "kpi:kpi-material", kind: "kpi", label: "物料保障率", status: "RED", actual: 77, target: 100, value: 23, unit: "%" },
              { id: "ksf:ksf-kit", kind: "ksf", label: "物料齐套", sub: "长协与现货缺口" },
              { id: "factor:rc-material-gap", kind: "factor", label: "现货缺口扩大", value: 4200, share: 1 },
              { id: "leaf:rc-material-gap:三元正极", kind: "evidence", label: "三元正极", value: 2600 },
              { id: "leaf:rc-material-gap:隔膜", kind: "evidence", label: "隔膜", value: 1600 },
            ],
            edges: [
              { from: "kpi:kpi-material", to: "ksf:ksf-kit", weight: 1, kind: "kpi_ksf" },
              { from: "ksf:ksf-kit", to: "factor:rc-material-gap", weight: 1, kind: "ksf_factor" },
              { from: "factor:rc-material-gap", to: "leaf:rc-material-gap:三元正极", weight: 0.62, kind: "factor_evidence" },
              { from: "factor:rc-material-gap", to: "leaf:rc-material-gap:隔膜", weight: 0.38, kind: "factor_evidence" },
            ],
          },
          offTargetCount: 1, summary: "1 项 KPI 越线", ruleRefs: [],
        },
        snapshotVersion: "ov-12",
      });
    return err(404, "FEATURE_NOT_FOUND", "求解器不存在或未开通");
  }),

  // A18.4 求解器审核台：列临时求解器制品 / 看代码 / 晋升 GOVERNED（mock 同源）。
  http.get("*/a/v1/solvers/artifacts", ({ request }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const list = status ? MOCK_SOLVER_ARTIFACTS.filter((a) => a.status === status) : MOCK_SOLVER_ARTIFACTS;
    return HttpResponse.json({ artifacts: list });
  }),
  http.get("*/a/v1/solvers/:key/artifact", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const art = MOCK_SOLVER_ARTIFACTS.find((a) => a.key === String(params.key));
    return art ? HttpResponse.json(art) : err(404, "NOT_FOUND", "solver artifact");
  }),
  http.post("*/a/v1/solvers/:key/promote", ({ request, params }) => {
    if (!auth(request)) return err(401, "UNAUTHORIZED", "未登录");
    const art = MOCK_SOLVER_ARTIFACTS.find((a) => a.key === String(params.key));
    if (!art) return err(404, "NOT_FOUND", "solver artifact");
    art.status = "GOVERNED";
    art.trustLevel = "VERIFIED";
    return HttpResponse.json(art);
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
  http.put("*/a/v1/connections/:id/validation-policy", async ({ request, params }) => {
    const body = (await request.json()) as { policy?: unknown };
    const conn = db.connections.find((c) => c.id === (params as { id: string }).id);
    if (!conn) return new HttpResponse(null, { status: 404 });
    (conn as { validationPolicy?: unknown }).validationPolicy = body.policy ?? body;
    return HttpResponse.json(conn);
  }),
  http.post("*/a/v1/connections/test", async ({ request }) => {
    const body = (await request.json()) as { config: Record<string, unknown> };
    const ok = Boolean(Object.values(body.config ?? {}).some((v) => v !== "" && v != null));
    return HttpResponse.json(ok ? { ok: true } : { ok: false, message: "配置为空" });
  }),
  http.post("*/a/v1/connections", async ({ request }) => {
    const body = (await request.json()) as { connectorTypeKey: string; name: string; config: Record<string, unknown>; category?: string };
    // A11：缺省取连接器类型 category（mock 默认 ERP），显式传则覆盖、可自定义。
    const typeCat: Record<string, string> = { mock_erp: "ERP", mock_crm: "CRM", file_upload: "FILE", rest_api: "EXTERNAL", knowledge_base: "KB" };
    const conn = { id: newId("conn"), tenantId: TENANT_ID, connectorTypeKey: body.connectorTypeKey, name: body.name, config: {}, status: "ACTIVE" as const, category: body.category?.trim() || typeCat[body.connectorTypeKey] || "EXTERNAL" };
    db.connections.push(conn);
    return HttpResponse.json(conn, { status: 201 });
  }),
  http.get("*/a/v1/connector-categories", () => {
    const used = db.connections.map((c) => (c as { category?: string }).category).filter((v): v is string => !!v);
    return HttpResponse.json({ categories: [...new Set(["ERP", "CRM", "EXTERNAL", "KB", "FILE", ...used])].sort() });
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
    // 规则即引用 §4：裸标识符比较（key OP number）—— 命名阈值由编辑器并入载荷顶层，按 key 解析求值。
    const b = /^\s*(\w+)\s*(>=|<=|>|<)\s*([\d.]+)\s*$/.exec(expression);
    if (b) {
      const left = Number(samplePayload[b[1]!] ?? NaN);
      const right = Number(b[3]);
      const violated =
        b[2] === ">" ? left > right : b[2] === ">=" ? left >= right : b[2] === "<" ? left < right : left <= right;
      return HttpResponse.json({ ok: true, violated, passed: !violated, explanation: violated ? "命中违规条件" : "未命中" });
    }
    return HttpResponse.json({ ok: true, violated: false, passed: true, explanation: "未命中" });
  }),

  http.post("*/a/v1/rules", async ({ request }) => {
    // 规则即引用 §2.2/§4：params（命名阈值）随 create 透传（与真后端一致），mock 原样回存。
    const body = (await request.json()) as { key: string; name: string; expression: string; scopeObjectTypes: string[]; severity: "BLOCK" | "WARN" | "INFO"; params?: Record<string, number> };
    if (body.expression.includes("@@")) {
      return err(400, "VALIDATION_ERROR", `表达式语法错误（位置 ${body.expression.indexOf("@@")}）：expected comparison operator`);
    }
    const rule = { id: newId("rule"), ...body, params: body.params ?? {}, origin: { type: "MANUAL" as const }, version: 1, status: "DRAFT" as const };
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
  // C6/C11 评审返工：策略↔role 编辑器写回 mock（POST /a/v1/policies）。
  http.post("*/a/v1/policies", async ({ request }) => {
    const body = (await request.json()) as { resource: { kind: string; key: string }; grants: unknown[]; rowFilter?: string };
    const policy = { id: `pol_${POLICIES.length + 1}`, tenantId: "demo", ...body };
    POLICIES.push(policy as (typeof POLICIES)[number]);
    return HttpResponse.json(policy, { status: 201 });
  }),
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
  // 原始数据集（A3 suggest 入口的可选项；与连接器同步/上传产物对应）。
  // Agent F · 数据源面板 additive：sourceConnId 指向真实 db.connections（分组/provenance 解析），
  // name 对齐草案 objectType.sourceDataset（orders.csv/plants.csv）使覆盖度可演示；
  // syncedAt/sourceCategory/rowCount 供新鲜度与来源类标签（值确定性、非业务常数）。
  http.get("*/a/v1/raw-datasets", () =>
    HttpResponse.json([
      { id: "rds-orders", name: "orders.csv", sourceConnId: "conn-erp", rowCount: 1280, syncedAt: "2026-06-11T22:00:00Z", sourceCategory: "ERP" },
      { id: "rds-plants", name: "plants.csv", sourceConnId: "conn-erp", rowCount: 6, syncedAt: "2026-06-11T22:00:00Z", sourceCategory: "ERP" },
      { id: "rds-oee", name: "oee_points", sourceConnId: "conn-iot", rowCount: 9600, syncedAt: "2026-06-12T01:00:00Z", sourceCategory: "EXTERNAL" },
      // Phase 2 产品工程主数据：PLM / MES / QMS / SRM 原始数据集
      { id: "rds-platforms", name: "plm_platforms", sourceConnId: "conn-plm", rowCount: 3, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-series", name: "plm_series", sourceConnId: "conn-plm", rowCount: 6, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-models", name: "plm_models", sourceConnId: "conn-plm", rowCount: 6, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-versions", name: "plm_versions", sourceConnId: "conn-plm", rowCount: 18, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-bom-headers", name: "plm_bom_headers", sourceConnId: "conn-plm", rowCount: 18, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-bom-details", name: "plm_bom_details", sourceConnId: "conn-plm", rowCount: 250, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-material-alts", name: "plm_material_alts", sourceConnId: "conn-plm", rowCount: 5, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-ecn", name: "plm_ecn", sourceConnId: "conn-plm", rowCount: 12, syncedAt: "2026-06-12T03:00:00Z", sourceCategory: "PLM" },
      { id: "rds-materials", name: "erp_materials", sourceConnId: "conn-erp", rowCount: 8, syncedAt: "2026-06-11T22:00:00Z", sourceCategory: "ERP" },
      { id: "rds-suppliers", name: "srm_suppliers", sourceConnId: "conn-srm", rowCount: 14, syncedAt: "2026-06-11T23:00:00Z", sourceCategory: "SRM" },
      { id: "rds-routings", name: "mes_routings", sourceConnId: "conn-mes", rowCount: 18, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-operations", name: "mes_operations", sourceConnId: "conn-mes", rowCount: 180, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-process-caps", name: "mes_process_capabilities", sourceConnId: "conn-mes", rowCount: 50, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-product-line-cap", name: "mes_product_line_cap", sourceConnId: "conn-mes", rowCount: 40, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-product-equip-cap", name: "mes_product_equip_cap", sourceConnId: "conn-mes", rowCount: 250, syncedAt: "2026-06-12T02:30:00Z", sourceCategory: "MES" },
      { id: "rds-quality-standards", name: "qms_standards", sourceConnId: "conn-qms", rowCount: 40, syncedAt: "2026-06-12T01:30:00Z", sourceCategory: "QMS" },
      { id: "rds-inspection-chars", name: "qms_inspection_chars", sourceConnId: "conn-qms", rowCount: 100, syncedAt: "2026-06-12T01:30:00Z", sourceCategory: "QMS" },
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
  // D-29 实时环 F1：领域事件双源馈源（默认空；f51 经 server.use 注入事件验证全局传播）。
  http.get("*/a/v1/outbox", () => HttpResponse.json([])),
  http.get("*/b/v1/outbox", () => HttpResponse.json([])),
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
    if (key === "counterfactual_timeline") {
      const baseline = Array.from({ length: 30 }, (_, d) => Math.min(97, Math.round(60 + d * 1.2)));
      const mitigated = baseline.map((v, d) => Math.max(40, Math.round(v - 10 * Math.min(1, Math.max(0, (d - 21) / 7)))));
      return HttpResponse.json({
        data: {
          baselineSeries: baseline, mitigatedSeries: mitigated, threshold: 85, base: "常州", factor: "瓶颈工序", mitigation: "瓶颈工序扩容",
          delta: { peakCut: Math.max(...baseline) - Math.max(...mitigated), crossDelayDays: 3, ordersSaved: 4 },
          events: [], summary: "如不解决「常州·瓶颈工序」：峰值削减、越线日推迟 3 天",
        },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "mrp_netting")
      return HttpResponse.json({
        data: {
          materials: [
            { material: "三元正极", netDemand: 8180, ltaCoverPct: 92, gap: 654, earliestComplete: "2026-06-28" },
            { material: "隔膜", netDemand: 2376, ltaCoverPct: 100, gap: 0, earliestComplete: "" },
            { material: "电解液", netDemand: 5544, ltaCoverPct: 96, gap: 222, earliestComplete: "2026-06-25" },
          ],
          shortageCount: 2, summary: "3 种物料，2 种现货缺口（C06 齐套口径）",
        },
        snapshotVersion: "ov-12",
      });
    if (key === "finance_pnl")
      return HttpResponse.json({
        data: {
          pnl: [
            { subject: "收入", budget: 240, rolling: 248, diff: 8 },
            { subject: "销售成本", budget: 200.6, rolling: 208.3, diff: 7.7 },
            { subject: "毛利", budget: 39.4, rolling: 39.7, diff: 0.3 },
          ],
          gmRow: { budgetPct: 16.4, rollPct: 16.0, diffPp: -0.4 },
          attribution: "毛利率 16.4%→16.0%（-0.4pp）：储能占比 37% 结构拉低（单价/成本未恶化）",
          summary: "收入/成本/毛利三科目 + 毛利率 16.0%（C15）",
        },
        snapshotVersion: "ov-12",
      });
    if (key === "order_fullchain") {
      // ORD 订单全链推演（mock：储能单越线财务提价）
      const so = typeof args.so === "string" && args.so ? args.so : "SO-10001";
      return HttpResponse.json({
        data: {
          so, verdict: "提价3%接", vc: "#E8B54A",
          kpis: { qty: 800, segment: "储能", marginPct: 11, floorPct: 14, deliveryP90: 1400, kitGap: 654 },
          judges: {
            cap: { verdict: "可达", p50: 1400, p90: 1260, demand: 800, ruleRefs: ["C02", "C03"] },
            kit: { verdict: "缺料", material: "三元正极", gapTon: 654, eta: "2026-06-28", ruleRefs: ["C06", "C16"] },
            fin: { verdict: "需提价3%", marginPct: 11, floorPct: 14, creditUsedRatio: 0.8, priceUpPct: 3, ruleRefs: ["C15", "C13", "C18"] },
          },
          conds: ["毛利率 11% < 细分底线 14%（C15），提价 3% 达线", "三元正极 缺口 654 吨（C06），最早齐套 2026-06-28"],
          dag: {
            nodes: [
              { id: `order:${so}`, kind: "order", label: `订单 ${so}` },
              { id: "net", kind: "network", label: "可产网络" }, { id: "bom", kind: "bom", label: "BOM 展开" },
              { id: "eco", kind: "economics", label: "单价与细分" }, { id: "cred", kind: "credit", label: "信用档案" },
              { id: "jcap", kind: "judge", label: "①交期判" }, { id: "jkit", kind: "judge", label: "②齐套判" }, { id: "jfin", kind: "judge", label: "③财务判" },
              { id: "vrd", kind: "verdict", label: "提价3%接" },
            ],
            edges: [
              { from: `order:${so}`, to: "net" }, { from: `order:${so}`, to: "bom" }, { from: `order:${so}`, to: "eco" }, { from: `order:${so}`, to: "cred" },
              { from: "net", to: "jcap" }, { from: "bom", to: "jkit" }, { from: "eco", to: "jfin" }, { from: "cred", to: "jfin" },
              { from: "jcap", to: "vrd" }, { from: "jkit", to: "vrd" }, { from: "jfin", to: "vrd" },
            ],
          },
          summary: `订单 ${so} 结论：提价3%接`,
        },
        snapshotVersion: "ov-12",
      });
    }
    if (key === "ksf_graph")
      return HttpResponse.json({
        data: {
          problems: [
            { id: "prob:kpi-margin", name: "毛利率越线", severity: "H", ksfRef: "ksf-dem", gap: 3.0 },
            { id: "prob:kpi-attain", name: "产销达成越线", severity: "M", ksfRef: "ksf-bal", gap: 1.5 },
          ],
          ksfNodes: [
            { id: "ksf:ksf-dem", ksfId: "ksf-dem", key: "k_dem", name: "需求结构", sub: "细分占比与价格" },
            { id: "ksf:ksf-bal", ksfId: "ksf-bal", key: "k_bal", name: "产销爬坡", sub: "产能与达成" },
            { id: "ksf:ksf-kit", ksfId: "ksf-kit", key: "k_kit", name: "物料齐套", sub: "长协与现货缺口" },
            { id: "ksf:ksf-cash", ksfId: "ksf-cash", key: "k_cash", name: "信用现金", sub: "应收与现金垫" },
            { id: "ksf:ksf-cost", ksfId: "ksf-cost", key: "k_cost", name: "成本外协", sub: "制造成本与外协" },
          ],
          finNodes: [
            { id: "fin:kpi-margin", name: "毛利率", actual: 13, target: 16, unit: "%", status: "RED" },
            { id: "fin:kpi-attain", name: "产销达成率", actual: 91, target: 95, unit: "%", status: "AMBER" },
          ],
          edges: [
            { from: "prob:kpi-margin", to: "ksf:ksf-dem", kind: "threat" },
            { from: "prob:kpi-attain", to: "ksf:ksf-bal", kind: "threat" },
            { from: "ksf:ksf-dem", to: "fin:kpi-margin", kind: "support" },
            { from: "ksf:ksf-bal", to: "fin:kpi-attain", kind: "support" },
          ],
          summary: "2 个待解决问题压在 2 个关键成功要素上，传导至 2 项财务计划指标",
        },
        snapshotVersion: "ov-12",
      });
    if (key === "audit_timeline") {
      const series = Array.from({ length: 90 }, (_, d) => Math.min(100, Math.round(40 + d * 0.7)));
      return HttpResponse.json({
        data: {
          kind: String(args.kind ?? "毛利"), series,
          stages: [{ label: "事件窗" }, { label: "约束越线" }, { label: "波及订单" }, { label: "财务击穿" }],
          peak: 100, crossDay: 64, threshold: 85,
          events: [{ type: "delivery_peak", day: 22, amp: 6, factors: ["交付高峰"], tag: "交付高峰", obj: "SO-9001", desc: "SO-9001·整车厂A 交付 12 万套到期：当周产线排产负载 +8 个百分点", src: "S&OP/ERP 订单交期" }],
          affectedOrders: [],
        },
        snapshotVersion: "ov-12",
      });
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
  // PRD-scenario-ontogenesis P1：发育验证（mock）—— 经 QOS 跑通触发问句 → VERIFIED → GOVERNED + 留痕。
  http.post("*/b/v1/scenarios/:key/grow", ({ params }) => {
    const sc = db.scenarios.find((s) => s.scenarioKey === params.key) as (typeof db.scenarios)[number] & { maturity?: string; lastOntogenesisRun?: unknown };
    if (!sc) return err(404, "SCENARIO_NOT_FOUND", "场景不存在");
    const run = {
      runId: `sor_${String(params.key)}`, scenarioKey: String(params.key), ranAt: new Date().toISOString(),
      rings: { data: true, ontology: true, capability: true },
      verification: { status: "VERIFIED" as const, path: "WORKFLOW" as const, gapCode: null, answerPreview: "P50 产能 132 GWh · P90 118 GWh · 缺口 3.2%", taskId: "task_mock_grow" },
      gaps: [] as { gapCode: string; disposition: "AUTO_DERIVE" | "NEEDS_HUMAN"; detail: string }[], maturity: "GOVERNED" as const,
    };
    sc.maturity = "GOVERNED"; sc.lastOntogenesisRun = run;
    return HttpResponse.json(run);
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
      { taskId: "task-hist-3", query: "现金垫 45 亿过得了体检吗？", path: "PATH_A", status: "COMPLETED", view: "plan-audit", conversationId: "conv-h3", classification: { intentKey: "plan_audit_q", confidence: 0.88 }, answerSummary: "站不住：现金垫 C18 越线，建议补 5 亿", createdAt: "2026-06-14T16:05:00Z", completedAt: "2026-06-14T16:05:06Z" },
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
  // C10 试分类（确定性词法打分，无 LLM）：真后端 POST /b/v1/intents/classify-preview。mock 用 query token 与意图 name/examples 交集打分。
  http.post("*/b/v1/intents/classify-preview", async ({ request }) => {
    const { query } = ((await request.json().catch(() => ({}))) ?? {}) as { query?: string };
    const tok = (s: string): Set<string> => {
      const out = new Set<string>();
      for (const m of s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) out.add(m);
      for (const m of s.match(/[一-龥]/g) ?? []) out.add(m);
      return out;
    };
    const qtok = tok(query ?? "");
    const scored = db.intents
      .filter((i) => i.status === "PUBLISHED")
      .map((i) => {
        const itok = tok([i.name, i.description, ...(i.examples ?? [])].join(" "));
        const inter = [...qtok].filter((x) => itok.has(x)).length;
        return { intentKey: i.key, name: i.name, score: qtok.size ? inter / qtok.size : 0 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const top = scored[0] && scored[0].score > 0 ? scored[0].intentKey : null;
    return HttpResponse.json({ matched: scored, top, outOfCatalog: top === null });
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
  // C8 试运行（编辑器内所见即所得）：真后端走执行引擎；mock 给确定性步骤输出 + 渲染结果。
  http.post("*/b/v1/workflows/:id/run", ({ params }) => {
    const wf = db.workflows.find((w) => w.id === params.id);
    if (!wf) return err(404, "WORKFLOW_NOT_FOUND", "Workflow 不存在");
    const stepOutputs: Record<string, unknown> = {};
    for (const s of wf.steps) stepOutputs[s.id] = { type: s.type, ok: true };
    const renderStep = wf.steps.find((s) => s.type === "render_answer");
    return HttpResponse.json({
      runId: `wfr_mock_${wf.id}`,
      status: "COMPLETED",
      answer: renderStep ? { blocks: (renderStep.params as { blocks?: unknown[] }).blocks ?? [] } : { blocks: [] },
      stepOutputs,
    });
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
  // Dogfooding meta（系统自我）
  http.post("*/a/v1/meta/sync", () => HttpResponse.json({ objects: 64, links: 120, byKind: { SystemInvariant: 14, SystemBreakpoint: 8, SystemEvent: 27, SystemDomain: 11, SystemObjectType: 30, SystemGate: 5, SystemSlice: 9 } })),
  http.get("*/a/v1/meta/ontology", () => HttpResponse.json({ total: 104, byKind: { SystemInvariant: 14, SystemBreakpoint: 8, SystemEvent: 27, SystemDomain: 11, SystemObjectType: 30, SystemGate: 5, SystemSlice: 9 } })),
  http.get("*/a/v1/meta/impact", ({ request }) => { const n = new URL(request.url).searchParams.get("node") ?? ""; return HttpResponse.json({ node: `meta_SystemInvariant_${n}`, affected: [{ id: "PRD:PRD-platform-foundry-aip.md", via: "covered_by" }, { id: "meta_SystemBreakpoint_G-5", via: "related_to" }] }); }),
  http.get("*/a/v1/meta/access-policy", () => HttpResponse.json(META_POLICY)),
  http.put("*/a/v1/meta/access-policy", async ({ request }) => { const b = (await request.json()) as { roles: string[] }; META_POLICY.roles = b.roles; return HttpResponse.json(META_POLICY); }),
  http.get("*/a/v1/databuilder/runs/:id", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    return r ? HttpResponse.json(r) : new HttpResponse(null, { status: 404 });
  }),
  // 工业级工作流运行时：持久化步骤状态机（检查点/可重入/可重试/可观测）
  http.get("*/a/v1/databuilder/workflow-runs", () => {
    for (const wf of MOCK_WORKFLOW_RUNS) advanceMockWorkflow(wf); // 轮询列表即推进后台异步运行（逐步实时跳动）
    return HttpResponse.json([...MOCK_WORKFLOW_RUNS].reverse());
  }),
  http.get("*/a/v1/databuilder/workflow-runs/:id", ({ params }) => {
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    advanceMockWorkflow(wf);
    return HttpResponse.json(wf);
  }),
  // A5：FDE 编排工作流节点状态图（mock：从工作流步状态投影 8 语义节点）。
  http.get("*/a/v1/databuilder/workflow-runs/:id/fde-graph", ({ params }) => {
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    advanceMockWorkflow(wf);
    const st = (key: string) => wf.steps.find((s) => s.stepKey === key)?.status ?? "PENDING";
    const map = (s: string) => (s === "SUCCEEDED" ? "DONE" : s);
    const FDE: { key: string; label: string; from: string }[] = [
      { key: "story", label: "意图/故事", from: "" },
      { key: "comprehend", label: "comprehend 倒推", from: "dry_build" },
      { key: "capability", label: "查能力", from: "dry_build" },
      { key: "gap", label: "比差", from: "gap_analysis" },
      { key: "generate", label: "各模块生成", from: "publish_build" },
      { key: "closure", label: "闭包", from: "dry_build" },
      { key: "publish", label: "publish（R4）", from: "publish_build" },
      { key: "launcher", label: "进启动器", from: "inference" },
    ];
    const crossFailed = st("cross_scaffold") === "FAILED";
    const nodes = FDE.map((d) => {
      let status = d.from ? map(st(d.from)) : "DONE";
      let gapCode: string | undefined;
      if (crossFailed && (d.key === "generate" || d.key === "publish")) { status = "FAILED"; gapCode = "SCAFFOLD_HTTP"; }
      return { key: d.key, label: d.label, status, gapCode, io: d.key === "generate" && status === "DONE" ? { out: 16 } : undefined };
    });
    const done = nodes.filter((n) => n.status === "DONE").length;
    const failed = nodes.find((n) => n.status === "FAILED");
    return HttpResponse.json({
      runId: wf.id, status: wf.status, nodes,
      summary: { total: nodes.length, done, failed: nodes.filter((n) => n.status === "FAILED").length, running: nodes.filter((n) => n.status === "RUNNING").length, skipped: nodes.filter((n) => n.status === "SKIPPED").length, pending: nodes.filter((n) => n.status === "PENDING").length, failedAt: failed?.key },
    });
  }),
  http.post("*/a/v1/databuilder/workflow-runs", async ({ request }) => {
    const body = (await request.json()) as { script?: string; seed?: number; async?: boolean };
    if (body.async) {
      // 异步：返回初始 RUNNING 快照（全 PENDING），后续 GET 逐步推进。
      const wf = mockWorkflowRun((body.script ?? "").trim(), body.seed ?? 42, "SUCCEEDED");
      for (const s of wf.steps) s.status = "PENDING";
      wf.status = "RUNNING";
      wf.storyRunId = undefined;
      MOCK_WORKFLOW_RUNS.push(wf);
      return HttpResponse.json(wf, { status: 202 });
    }
    // 同步：第一条 mock 故意失败（演示断点 + resume 入口）；其余成功
    const status = MOCK_WORKFLOW_RUNS.length === 0 ? "FAILED" : "SUCCEEDED";
    const wf = mockWorkflowRun((body.script ?? "").trim(), body.seed ?? 42, status as "SUCCEEDED" | "FAILED");
    MOCK_WORKFLOW_RUNS.push(wf);
    return HttpResponse.json(wf, { status: status === "FAILED" ? 200 : 201 });
  }),
  http.post("*/a/v1/databuilder/workflow-runs/recover", () => {
    const recovered: string[] = [];
    for (const wf of MOCK_WORKFLOW_RUNS) if (wf.status === "RUNNING") { for (const s of wf.steps) if (s.status === "PENDING") s.status = "SUCCEEDED"; wf.status = "SUCCEEDED"; recovered.push(wf.id as string); }
    return HttpResponse.json({ recovered });
  }),
  http.post("*/a/v1/databuilder/workflow-runs/:id/resume", ({ params }) => {
    const wf = MOCK_WORKFLOW_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!wf) return new HttpResponse(null, { status: 404 });
    // 重入：失败/PENDING 步全部转 SUCCEEDED，run 收敛（演示自愈）
    for (const s of wf.steps) if (s.status === "FAILED" || s.status === "PENDING") s.status = "SUCCEEDED";
    wf.status = "SUCCEEDED";
    wf.resumedCount = ((wf.resumedCount as number) ?? 0) + 1;
    wf.storyRunId = wf.storyRunId ?? newId("sbr");
    return HttpResponse.json(wf);
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
    // 区7 不可达分支（守"绿测试≠能用"）：脚本含"缺求解器"标记 → 闭包断 + 自检缺口 → 推演不可达
    if (script.includes("缺求解器")) {
      const run = {
        id, tenantId: "demo", script,
        buildPlan: mockBuildPlan("bpl_fail"),
        closureReport: { gatePassed: false, findings: [{ kind: "CHAIN", ref: "solver:ghost_solver", status: "FAILED", detail: "未注册" }], objectsBound: 0, dataOrphans: 0, forwardMissing: 0, chainBroken: 1, shapeBroken: 0 },
        gapReport: { question: script, taskId: id, verdict: "GAP", path: "BOUNDARY", findings: [{ gapCode: "SOLVER_NOT_FOUND", detail: "ghost_solver" }], generatedAt: new Date().toISOString() },
        producedConnections: [], producedDatasets: [], producedArtifacts: [],
        storyCoverage: mockStoryCoverage(script),
        status: "FAILED", createdAt: new Date().toISOString(),
      };
      MOCK_STORY_RUNS.unshift(run);
      return HttpResponse.json(run, { status: 201 });
    }
    const job = mockBuildJob({ script, seed: body.seed }) as { planId: string; closure: unknown };
    const run = {
      id,
      tenantId: "demo",
      script,
      buildPlan: mockBuildPlan(job.planId),
      closureReport: job.closure,
      scaffoldReceipt: { items: [{ kind: "scene", key: "scene_mock", status: "SCAFFOLDED" }, { kind: "intent", key: "intent_mock", status: "SCAFFOLDED" }], fullChainOk: true },
      gapReport: { question: script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
      producedConnections: ["conn_mock"],
      producedDatasets: ["rds_mock"],
      producedArtifacts: mockProducedArtifacts(),
      storyCoverage: mockStoryCoverage(script),
      validationTrace: mockValidationTrace(),
      status: "SUCCEEDED",
      createdAt: new Date().toISOString(),
    };
    MOCK_STORY_RUNS.unshift(run);
    return HttpResponse.json(run, { status: 201 });
  }),
  // A10：终态闭环末步——手动重跑主问句验证（mock：可答则 VERIFIED + 回灌 launcher 节点 DONE）。
  http.post("*/a/v1/databuilder/runs/:id/verify", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!r) return new HttpResponse(null, { status: 404 });
    const reachable = r.status === "SUCCEEDED" && (((r.gapReport as { findings?: unknown[] } | undefined)?.findings?.length ?? 0) === 0);
    r.verification = reachable
      ? { status: "VERIFIED", question: r.script, answer: "经 QOS 实跑：可答", answerable: true, evidence: "RUNTIME_PROBE", verifiedAt: new Date().toISOString() }
      : { status: "NOT_VERIFIED", question: r.script, gapCode: "NOT_ANSWERABLE", verifiedAt: new Date().toISOString() };
    return HttpResponse.json(r);
  }),
  http.post("*/a/v1/databuilder/runs/:id/promote", ({ params }) => {
    const r = MOCK_STORY_RUNS.find((x) => x.id === (params as { id: string }).id);
    if (!r) return new HttpResponse(null, { status: 404 });
    if (r.buildMode !== "PROVISIONAL") return err(400, "VALIDATION_ERROR", "仅 PROVISIONAL 未审核域可整域晋升");
    r.domainTrustLevel = "GOVERNED";
    r.domainPromotion = {
      promotedAt: new Date().toISOString(), promotedBy: "usr-planner", fromNamespace: r.provisionalNamespace ?? `demo::prov::${r.id}`,
      migratedObjects: 12, migratedDatasets: 3, migratedConnections: 1, migratedTypes: 2, promotedSolvers: [],
    };
    return HttpResponse.json(r);
  }),
  http.post("*/a/v1/databuilder/stress", async ({ request }) => {
    const body = (await request.json()) as { scripts: string[] };
    const runs = body.scripts.map((script) => {
      const job = mockBuildJob({ script, seed: 42 }) as { planId: string; closure: unknown };
      const id = newId("sbr");
      MOCK_STORY_RUNS.unshift({
        id, tenantId: "demo", script,
        buildPlan: mockBuildPlan(job.planId),
        closureReport: job.closure,
        gapReport: { question: script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
        producedConnections: ["conn_mock"], producedDatasets: ["rds_mock"],
        producedArtifacts: mockProducedArtifacts(), storyCoverage: mockStoryCoverage(script), validationTrace: mockValidationTrace(),
        status: "SUCCEEDED", createdAt: new Date().toISOString(),
      });
      return { key: script.slice(0, 40), runId: id, status: "SUCCEEDED", fullChainOk: true };
    });
    return HttpResponse.json({ total: runs.length, succeeded: runs.length, failed: 0, runs });
  }),
  http.get("*/a/v1/databuilder/generate-scripts", () => HttpResponse.json([
    { key: "affected_orders", script: "针对订单做风险推演分析" },
    { key: "capacity_forecast", script: "针对基地做产能推演分析" },
    { key: "rule_C03", script: "检查订单的产能约束" },
  ])),
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
        buildPlan: mockBuildPlan(job.planId),
        closureReport: job.closure,
        scaffoldReceipt: { items: [{ kind: "scene", key: `scene_${c.key}`, status: "SCAFFOLDED" }], fullChainOk: true },
        gapReport: { question: c.script, taskId: id, verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: new Date().toISOString() },
        answer: `${c.key}: p50=1200, p90=900`,
        producedConnections: ["conn_mock"], producedDatasets: ["rds_mock"],
        producedArtifacts: mockProducedArtifacts(), storyCoverage: mockStoryCoverage(c.script), validationTrace: mockValidationTrace(),
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
      buildPlan: mockBuildPlan(job.planId),
      closureReport: job.closure,
      scaffoldReceipt: { items: [{ kind: "scene", key: "scene_mock", status: "SCAFFOLDED" }], fullChainOk: true },
      producedConnections: ["conn_mock"],
      producedDatasets: ["rds_mock"],
      producedArtifacts: mockProducedArtifacts(),
      storyCoverage: mockStoryCoverage(run.script),
      validationTrace: mockValidationTrace(),
      status: "SUCCEEDED",
    });
    return HttpResponse.json(run, { status: 201 });
  }),

  // ---- 推演沙盘 · 初始化向导（增量 4 渐进项 · Agent G）：view-config / session / scope-precheck ----
  // 最小 mock：让 mock 模式下 /v/sim-init 三步向导可走通；配置驱动·零行业实体名（演示用占位 key）。
  http.get("*/a/v1/sim/view-config", () =>
    HttpResponse.json({
      tenantId: "demo",
      nodeTypes: ["TypeA", "TypeB", "TypeC"],
      linkTypes: ["linkAB"],
      stateVars: ["s1", "s2"],
      radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
      screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
      propagationCount: 1,
    }),
  ),
  http.post("*/a/v1/sim/sessions", async ({ request }) => {
    const body = (await request.json()) as { baseSnapshot?: Record<string, unknown>; scope?: Record<string, unknown> };
    return HttpResponse.json(
      { id: "sims_mock", tenantId: "demo", baseSnapshot: body.baseSnapshot ?? {}, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: new Date().toISOString() },
      { status: 201 },
    );
  }),
  http.get("*/a/v1/sim/sessions/:id/scope-precheck", ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "LOCAL" ? "LOCAL" : "GLOBAL";
    return HttpResponse.json({
      scope,
      targetRef: scope === "LOCAL" ? url.searchParams.get("target") : null,
      worldCompleteness: {
        pct: 60,
        stateVars: { present: 2, needed: 3 },
        derivationRules: { present: 1, needed: 2 },
        actions: { present: 0, needed: 1 },
        propagationRules: { present: 1, needed: 1 },
        entering: [
          { key: "s1", kind: "DERIVATION", source: "deriv:s1" },
          { key: "s2", kind: "PROPAGATION", source: "prop:linkAB" },
        ],
      },
      canEnterSimulation: false,
      gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
    });
  }),
  // ---- 推演沙盘 P0（增量 4 · Agent I）：tick / checkpoint / branch / compare / certification 最小 mock ----
  http.post("*/a/v1/sim/sessions/:id/tick", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { n?: number };
    const n = body.n ?? 1;
    // 占位递增态（mock 模式仅证交互；真后端走传导核）。
    return HttpResponse.json({ curTick: n, state: { "TypeA#0": { s1: 50 + n * 5, s2: 40 } } });
  }),
  http.post("*/a/v1/sim/sessions/:id/checkpoint", async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { label?: string };
    return HttpResponse.json({ id: "cp_mock", sessionId: String((params as { id: string }).id), tenantId: "demo", tick: 1, label: body.label ?? "cp", createdAt: new Date().toISOString() });
  }),
  http.post("*/a/v1/sim/sessions/:id/branch", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { checkpointId?: string };
    return HttpResponse.json(
      { id: "sims_child_mock", tenantId: "demo", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: body.checkpointId ?? "cp_mock", createdAt: new Date().toISOString() },
      { status: 201 },
    );
  }),
  http.get("*/a/v1/sim/compare", () =>
    HttpResponse.json({
      a: [{ tick: 0, state: { "TypeA#0": { s1: 50 } } }, { tick: 1, state: { "TypeA#0": { s1: 65 } } }],
      b: [{ tick: 0, state: { "TypeA#0": { s1: 50 } } }, { tick: 1, state: { "TypeA#0": { s1: 40 } } }],
    }),
  ),
  http.get("*/a/v1/sim/sessions/:id/certification", ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "LOCAL" ? "LOCAL" : "GLOBAL";
    return HttpResponse.json({
      scope,
      targetRef: scope === "LOCAL" ? url.searchParams.get("target") : null,
      level: "L2_RUNNABLE",
      dims: { structure: 70, knowledge: 50, behavior: 35, composite: 52 },
      l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
      trialTick: { passed: false, rulesFired: 1, at: null, error: null },
      worldCompleteness: {
        pct: scope === "LOCAL" ? 48 : 60,
        stateVars: { present: 2, needed: 3 },
        derivationRules: { present: 1, needed: 2 },
        actions: { present: 0, needed: 1 },
        propagationRules: { present: 1, needed: 1 },
        entering: [
          { key: "s1", kind: "DERIVATION", source: "deriv:s1" },
          { key: "s2", kind: "PROPAGATION", source: "prop:linkAB" },
        ],
      },
      canEnterSimulation: false,
      gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
      computedAt: new Date().toISOString(),
    });
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
