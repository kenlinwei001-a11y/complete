import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PKG, PLANNER, TENANT, type TestApp } from "./helpers.js";

// ═══════════════════════════════════════════════════════════════════════════
// WO-SANDBOX-CONFIG-DERIVE-WIRE · 沙盘配套派生**活路径**接线（治竞态·非绕竞态假绿）
// ───────────────────────────────────────────────────────────────────────────
// 背景：deriveSandboxConfigNeeds（从 RequirementGraph 传导语义派生 propagation_rule/state_var）逻辑已对，
//   但**活 POST 路径**有竞态：后台预分析旁路（startPreAnalysis）只轮询到 classification 落定即醒，
//   而 RequirementGraph 由 orchestrator sideband 在 classification patch **之后**才 upsert
//   （runPipelineInner: 707 patch classification → 713 buildRequirementGraphSideband upsert）。二者异步竞速，
//   预分析抢先读到空 RG → 派生沙盘配套 need 落空（活报告为空）。此前测试用 T6 先 seed RG **绕**竞态（假绿）。
//
// 本测试**真走活 POST 路径**（不预 seed RG）：真起 app·真 POST·真跑 orchestrator sideband 建 RG·
//   真跑后台预分析派生。为让竞态**确定性显形**（否则内存态管线可能抢先赢·掩盖 bug），把充当 DataCore 的
//   本体图端点**注入真实网络时延**（mirror 生产 RG 构建的 OBO REST 时延）——使 RG upsert 稳定落在预分析
//   首读之后。修复前（预分析不等 RG）→ 首读空 → 派生落空=红；修复后（preAnalyzeQuery 自等 RG 就绪）→ 落报告=绿。
//   LLM 全 mock（queueClassification·不打真网络）。
// ═══════════════════════════════════════════════════════════════════════════

// 本体图端点时延（ms）：> 预分析轮询间隔（startPreAnalysis 250ms）→ RG upsert 稳定落在预分析首读之后（竞态显形）。
const GRAPH_DELAY_MS = 500;

// 真本体图夹具（node.key=真类型键·edge 端点约定 n-<typeKey>·label=真链路 key）——Base --supplies--> Order。
const ONTOLOGY_GRAPH = {
  nodes: [{ key: "Base" }, { key: "Order" }, { key: "Model" }],
  edges: [{ from: "n-Base", to: "n-Order", label: "base_supplies_order" }],
};

// A 栈现状快照（含 state_var/propagation_rule → snapshotAvailable=true·两类不被诚实降级丢弃）。
// Base.load 已有（→ EXISTS）；Order.load 缺 + 无任何传导规则（→ 派生的 Order.load / pr 全 MISSING）。
const REGISTRY_SNAPSHOT: Record<string, string[]> = {
  solver: [], rule: [], slice: [], ontology_type: [], dataset: [], kb_doc: [],
  state_var: ["Base.load"], propagation_rule: [],
};

let stub: Server;
let base: string;

beforeAll(async () => {
  stub = createServer((req, res) => {
    const url = req.url ?? "/";
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    // 充当 DataCore：本体图（注入时延·喂 orchestrator sideband 建 RG 的真链路边/发布类型白名单）。
    if (url === "/a/v1/ontology/graph") {
      setTimeout(() => json(200, ONTOLOGY_GRAPH), GRAPH_DELAY_MS);
      return;
    }
    // 充当 DataCore：现状快照（喂 preAnalyzeQuery 组装 existing → diffGap）。
    if (url === "/a/v1/databuilder/registry-snapshot") {
      json(200, REGISTRY_SNAPSHOT);
      return;
    }
    // features 端点 404 → FeatureGate 诚实降级 fail-open ALL（暗发键 growth.* 全开·候选不被 entitlement 剔除）。
    json(404, { error: { code: "NOT_FOUND", message: "stub", requestId: "r" } });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
});

afterAll(() => stub.close());

// 含传导语义的问句（生产基地=Base·销售订单=Order·停机=SHUTDOWN·延期=DELAY）→ RG 有 event + Base→Order 真链路边。
const PROPAGATION_QUERY = "生产基地设备停机导致销售订单交付延期，影响哪些销售订单？";
// 纯查询/罗列（无扰动动词·链路语义非"影响"）→ RG 无 event、边为 depends_on → 无传导语义 → 零派生。
const PLAIN_QUERY = "销售订单与生产基地之间是什么关系？请列出销售订单。";

const H = { "x-debug-user": PLANNER, "content-type": "application/json" };

/** 真 POST 一条问句（先 queue 一个确定性 classification·低置信→路径 B·仍在 707 patch 后 713 建 RG）。返回 taskId。 */
async function postQuery(t: TestApp, query: string): Promise<string> {
  // 低置信（<τ_low 0.55）→ 走路径 B 干净终态（无需计划）；RG 恒在路由决策前（713）已建，与路由结果解耦。
  t.llm.queueClassification({ candidates: [{ intentKey: "sim.shock_whatif", confidence: 0.1 }], outOfCatalog: false, extractedSlots: {} });
  const res = await t.app.inject({ method: "POST", url: "/api/v1/queries", headers: H, payload: { packageId: PKG, query, context: { view: "risk", selectedObjects: [], filters: {} } } });
  expect(res.statusCode).toBe(202);
  return (res.json() as { taskId: string }).taskId;
}

/** 轮询后台预分析报告至 DONE（真起后台旁路·非同步返回）。 */
async function waitReport(t: TestApp, taskId: string) {
  for (let i = 0; i < 200; i++) {
    const r = await t.repos.preAnalyses.getByTaskId(TENANT, taskId);
    if (r && r.status === "DONE") return r;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`pre-analysis report not DONE for ${taskId}`);
}

describe("WO-SANDBOX-CONFIG-DERIVE-WIRE · 活 POST 路径派生沙盘配套 need（治竞态·非 seed 绕竞态）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp({ env: { QOS_REQUIREMENT_GRAPH: "1", DATACORE_BASE_URL: base, SERVICE_TOKEN: "svc" } });
  });
  afterEach(async () => {
    await t.app.close();
  });

  it("齿①：含传导语义问句真走活路径 → 派生 propagation_rule/state_var need 真落预分析报告（竞态未修=空=红）", async () => {
    const taskId = await postQuery(t, PROPAGATION_QUERY);
    const report = await waitReport(t, taskId);

    // 证活路径：RG 由 orchestrator sideband 真建（非测试 seed·taskId 对得上）。
    const rg = await t.repos.requirementGraphs.getByTaskId(TENANT, taskId);
    expect(rg?.taskId).toBe(taskId);

    // 派生的两类 need 真落报告（竞态未修→预分析抢在 RG upsert 前读空→此处无 propagation_rule/state_var=红）。
    const entries = report.gapAnalysis!.entries;
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds.has("propagation_rule")).toBe(true);
    expect(kinds.has("state_var")).toBe(true);

    const flat = entries.flatMap((e) => e.items.map((i) => ({ kind: e.kind, ...i })));
    // Base→Order 真链路传导规则派生·现状无传导规则 → MISSING（咨询信号 WARNING·非误红）。
    const pr = flat.find((f) => f.kind === "propagation_rule" && f.key === "pr_Base__base_supplies_order__Order");
    expect(pr?.status).toBe("MISSING");
    expect(pr?.severity).toBe("WARNING");
    // Base.load 现状已有→EXISTS；Order.load 现状缺→MISSING（诚实逐值对照现状快照）。
    expect(flat.find((f) => f.kind === "state_var" && f.key === "Base.load")?.status).toBe("EXISTS");
    expect(flat.find((f) => f.kind === "state_var" && f.key === "Order.load")?.status).toBe("MISSING");
    // §10：预分析永不 BLOCKER/ERROR。
    expect(flat.every((f) => f.severity !== "BLOCKER" && f.severity !== "ERROR")).toBe(true);

    // 派生的 MISSING 沙盘配套 → 落 GrowthTicket（[sandbox-config:*] 锚·人工建模正门）。
    const tickets = await t.repos.growthTickets.listByTenant(TENANT);
    const markers = tickets.flatMap((tk) => (tk.acceptance.match(/\[sandbox-config:[^\]]+\]/g) ?? []));
    expect(markers).toContain("[sandbox-config:propagation_rule:pr_Base__base_supplies_order__Order]");
    expect(markers).toContain("[sandbox-config:state_var:Order.load]");
  }, 30000);

  it("齿②：纯查询/罗列问句（无传导语义）→ 零派生（无假阳·诚实惰性·KILL-MOCK-RED）", async () => {
    const taskId = await postQuery(t, PLAIN_QUERY);
    const report = await waitReport(t, taskId);

    // RG 仍真建（活路径），但无 event、边非 affects → 无传导语义 → 不派生配套（两类不出现）。
    const rg = await t.repos.requirementGraphs.getByTaskId(TENANT, taskId);
    expect(rg?.taskId).toBe(taskId);
    const kinds = new Set(report.gapAnalysis!.entries.map((e) => e.kind));
    expect(kinds.has("propagation_rule")).toBe(false);
    expect(kinds.has("state_var")).toBe(false);

    // 零假阳工单：无 [sandbox-config:*] 锚开票。
    const tickets = await t.repos.growthTickets.listByTenant(TENANT);
    expect(tickets.flatMap((tk) => tk.acceptance.match(/\[sandbox-config:/g) ?? [])).toHaveLength(0);
  }, 30000);

  it("齿③ R6：同传导问句双跑（活路径各自建 RG）→ 派生沙盘配套 need 键一致（确定性）", async () => {
    const keysOf = async (query: string) => {
      const taskId = await postQuery(t, query);
      const report = await waitReport(t, taskId);
      return report
        .gapAnalysis!.entries.filter((e) => e.kind === "propagation_rule" || e.kind === "state_var")
        .flatMap((e) => e.items.map((i) => `${e.kind}:${i.key}`))
        .sort();
    };
    const a = await keysOf(PROPAGATION_QUERY);
    const b = await keysOf(PROPAGATION_QUERY);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  }, 30000);
});
