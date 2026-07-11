import { describe, expect, it } from "vitest";
import type { ClassificationResult, MaterializedIntent } from "@platform/contracts";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { deriveRequirements, listSandboxConfigGaps, preAnalyzeQuery, type PreAnalyzeDeps } from "../src/growth/pre-analyze.js";

/**
 * UPG-L0-PREANALYSIS · C1 纯核/R6 单测（不作假·真跑纯核）：
 * preAnalyzeQuery 复用共享 diffGap（@platform/contracts）+ 既有 ClassificationResult 推需求，
 * 自组两侧 existing → 咨询信号最高 WARNING（永不 BLOCKER·§10）· R6 同输入注入 generatedAt 字节一致。
 */

const mi = (over: Partial<MaterializedIntent> & { key: string }): MaterializedIntent => ({
  id: `mint_${over.key}`,
  tenantId: "demo",
  key: over.key,
  name: over.key,
  description: "",
  examples: [],
  slots: [],
  mode: "WORKFLOW_FIRST",
  bindings: { solverKey: "", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "" },
  status: "PUBLISHED",
  version: 1,
  ...over,
});

const classification = (intentKeys: string[]): ClassificationResult => ({
  candidates: intentKeys.map((k) => ({ intentKey: k, confidence: 0.9 })),
  outOfCatalog: false,
  extractedSlots: {},
  latencyMs: 0,
  model: "deterministic:test",
});

/** 假 A 栈快照（服务间 registry-snapshot 6 类）——含 solver risk_timeline、rule r1、slice s1。 */
const snapshotFetch = (snapshot: Record<string, string[]>): typeof fetch =>
  (async () => ({ ok: true, json: async () => snapshot })) as unknown as typeof fetch;

/** URL 路由 fetch：registry-snapshot 与 ontology/graph 两端点各返其体（UPG-L0-HIDDENREQ §8 整合验证）。 */
const routedFetch = (snapshot: Record<string, string[]>, graph: unknown): typeof fetch =>
  (async (url: string) => {
    if (String(url).includes("/ontology/graph")) return { ok: true, json: async () => graph };
    return { ok: true, json: async () => snapshot };
  }) as unknown as typeof fetch;

// 真电池本体图（节点=真类型键·边=真链路）——affected_orders 依赖 base/order/model → Base/Order/Model。
const BATTERY_GRAPH = {
  nodes: ["Base", "Line", "Process", "Equipment", "Model", "Order", "Shipment"].map((key) => ({ key })),
  edges: [
    { from: "n-Order", to: "n-Model", label: "order_uses_model" },
    { from: "n-Order", to: "n-Shipment", label: "order_ships_via" },
    { from: "n-Model", to: "n-Base", label: "model_at_base" },
  ],
};

describe("deriveRequirements · 复用分类器绑定推需求（不造轮子·R14 抽象键）", () => {
  it("候选意图 → 其 MaterializedIntent.bindings 展开需求；未物化意图仍计 intent 缺口", () => {
    const byKey = new Map([
      ["bind_ok", mi({ key: "bind_ok", bindings: { solverKey: "risk_timeline", ruleKeys: ["r1"], constraintKeys: [], skillId: "skl_a", ontologySliceKey: "s1" } })],
    ]);
    const req = deriveRequirements(classification(["bind_ok", "not_materialized"]), byKey);
    expect(req.intent).toEqual(["bind_ok", "not_materialized"]);
    expect(req.solver).toEqual(["risk_timeline"]);
    expect(req.rule).toEqual(["r1"]);
    expect(req.slice).toEqual(["s1"]);
    expect(req.skill).toEqual(["skl_a"]);
  });
});

describe("S0 · WO-SANDBOX-CONFIG-COVERAGE：沙盘配套需求（意图绑定声明 → gap 可诊断）", () => {
  it("deriveRequirements：绑定声明 stateVarKeys/propagationRuleKeys → 需求树补 state_var/propagation_rule；未声明零变化（诚实惰性）", () => {
    const byKey = new Map([
      ["sim_intent", mi({
        key: "sim_intent",
        bindings: {
          solverKey: "", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "",
          stateVarKeys: ["Base.load", "Base.backlog"],
          propagationRuleKeys: ["pr_order_to_capacity"],
        },
      })],
      ["plain_intent", mi({ key: "plain_intent" })],
    ]);
    const req = deriveRequirements(classification(["sim_intent"]), byKey);
    expect(req.state_var).toEqual(["Base.load", "Base.backlog"]);
    expect(req.propagation_rule).toEqual(["pr_order_to_capacity"]);
    // 未声明的意图 → 两类不出现（不凭空报缺口·F4 同源）
    const reqPlain = deriveRequirements(classification(["plain_intent"]), byKey);
    expect(reqPlain.state_var).toBeUndefined();
    expect(reqPlain.propagation_rule).toBeUndefined();
  });

  it("E2E：快照含两类现状 → 有的 EXISTS·缺的 MISSING(MANUAL·非 DEVELOP·非 BLOCKER)；listSandboxConfigGaps 只抽 MISSING", async () => {
    const repos = createMemoryRepos();
    await repos.materializedIntents.upsert(mi({
      key: "sim_intent",
      bindings: {
        solverKey: "", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "",
        stateVarKeys: ["Base.load", "Base.ghost_var"],
        propagationRuleKeys: ["pr_have", "pr_ghost"],
      },
    }));
    const deps: PreAnalyzeDeps = {
      repos,
      config: { DATACORE_BASE_URL: "http://x", SERVICE_TOKEN: "svc" },
      fetchImpl: snapshotFetch({
        solver: [], rule: [], slice: [], ontology_type: [], dataset: [], kb_doc: [],
        state_var: ["Base.load"], propagation_rule: ["pr_have"],
      }),
    };
    const report = await preAnalyzeQuery(deps, {
      tenantId: "demo", taskId: "task_s0", query: "订单激增对基地负载的传导推演？",
      classification: classification(["sim_intent"]), generatedAt: "2026-07-11T00:00:00.000Z",
    });
    const flat = report.gapAnalysis!.entries.flatMap((e) => e.items.map((i) => ({ kind: e.kind, ...i })));
    expect(flat.find((f) => f.kind === "state_var" && f.key === "Base.load")!.status).toBe("EXISTS");
    const missSv = flat.find((f) => f.kind === "state_var" && f.key === "Base.ghost_var")!;
    expect(missSv.status).toBe("MISSING");
    expect(missSv.severity).toBe("WARNING"); // §10 咨询信号永不误红
    expect(missSv.remediation!.strategy).toBe("MANUAL"); // 非 code → 人工建模正门,非 DEVELOP
    expect(flat.find((f) => f.kind === "propagation_rule" && f.key === "pr_have")!.status).toBe("EXISTS");
    expect(flat.find((f) => f.kind === "propagation_rule" && f.key === "pr_ghost")!.status).toBe("MISSING");
    // §3.5 工单抽取器：只抽 MISSING 两条（EXISTS 不抽）
    const gaps = listSandboxConfigGaps(report);
    expect(gaps).toEqual(expect.arrayContaining([
      { kind: "state_var", key: "Base.ghost_var" },
      { kind: "propagation_rule", key: "pr_ghost" },
    ]));
    expect(gaps).toHaveLength(2);
  });

  it("诚实降级：A 栈快照不可达 → 两类需求被丢弃（existing 无从自组·不造假缺口）", async () => {
    const repos = createMemoryRepos();
    await repos.materializedIntents.upsert(mi({
      key: "sim_intent",
      bindings: { solverKey: "", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "", stateVarKeys: ["Base.load"], propagationRuleKeys: ["pr_x"] },
    }));
    const deps: PreAnalyzeDeps = { repos, config: { DATACORE_BASE_URL: undefined, SERVICE_TOKEN: undefined } };
    const report = await preAnalyzeQuery(deps, {
      tenantId: "demo", taskId: "task_s0b", query: "q",
      classification: classification(["sim_intent"]), generatedAt: "2026-07-11T00:00:00.000Z",
    });
    const kinds = new Set(report.gapAnalysis!.entries.map((e) => e.kind));
    expect(kinds.has("state_var")).toBe(false);
    expect(kinds.has("propagation_rule")).toBe(false);
    expect(listSandboxConfigGaps(report)).toEqual([]);
  });
});

describe("preAnalyzeQuery · 两侧 existing → 共享 diffGap（咨询信号非判决）", () => {
  it("A 栈快照可用：solver 命中→EXISTS·未命中→MISSING(WARNING·非 BLOCKER)；intent 已发布→EXISTS", async () => {
    const repos = createMemoryRepos();
    await repos.materializedIntents.upsert(
      mi({ key: "have_intent", bindings: { solverKey: "risk_timeline", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "" } }),
    );
    const deps: PreAnalyzeDeps = {
      repos,
      config: { DATACORE_BASE_URL: "http://x", SERVICE_TOKEN: "svc" },
      fetchImpl: snapshotFetch({ solver: ["risk_timeline"], rule: [], slice: [], ontology_type: [], dataset: [], kb_doc: [] }),
    };
    // 候选：have_intent(已发布→EXISTS) + missing_intent(未发布→TO_CREATE)；缺 solver only_missing
    await repos.materializedIntents.upsert(
      mi({ key: "have_intent2", bindings: { solverKey: "no_such_solver", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "" } }),
    );
    const report = await preAnalyzeQuery(deps, {
      tenantId: "demo",
      taskId: "task_pa1",
      query: "常州基地风险时间线？",
      classification: classification(["have_intent", "have_intent2", "missing_intent"]),
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    expect(report.status).toBe("DONE");
    const flat = report.gapAnalysis!.entries.flatMap((e) => e.items.map((i) => ({ kind: e.kind, ...i })));
    // intent: have_intent/have_intent2 已发布 EXISTS·missing_intent TO_CREATE
    const intents = flat.filter((f) => f.kind === "intent");
    expect(intents.find((i) => i.key === "have_intent")!.status).toBe("EXISTS");
    expect(intents.find((i) => i.key === "missing_intent")!.status).toBe("TO_CREATE");
    // solver: risk_timeline 命中快照 EXISTS·no_such_solver 未命中 → MISSING（code 不可自动建），severity 最高 WARNING
    const solvers = flat.filter((f) => f.kind === "solver");
    expect(solvers.find((s) => s.key === "risk_timeline")!.status).toBe("EXISTS");
    const missSolver = solvers.find((s) => s.key === "no_such_solver")!;
    expect(missSolver.status).toBe("MISSING");
    expect(missSolver.severity).toBe("WARNING");
    expect(missSolver.remediation!.strategy).toBe("DEVELOP");
    // §10：预分析永不 BLOCKER/ERROR
    expect(flat.every((f) => f.severity !== "BLOCKER" && f.severity !== "ERROR")).toBe(true);
    // summary 真源计数
    expect(report.summary!.developRequired).toBe(1);
    expect(report.summary!.executionSteps).toBe(report.gapAnalysis!.executionPlan!.length);
  });

  it("A 栈快照不可达（无 SERVICE_TOKEN）→ 诚实降级：不诊断 A 栈 kind（不造假缺口）", async () => {
    const repos = createMemoryRepos();
    await repos.materializedIntents.upsert(
      mi({ key: "k", bindings: { solverKey: "s", ruleKeys: ["r"], constraintKeys: [], skillId: "", ontologySliceKey: "sl" } }),
    );
    const deps: PreAnalyzeDeps = { repos, config: { DATACORE_BASE_URL: undefined, SERVICE_TOKEN: undefined } };
    const report = await preAnalyzeQuery(deps, {
      tenantId: "demo",
      taskId: "task_pa2",
      query: "q",
      classification: classification(["k"]),
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    const kinds = new Set(report.gapAnalysis!.entries.map((e) => e.kind));
    // A 栈（solver/rule/slice）无 existing → 不入诊断；仅 B 栈 intent 在场
    expect(kinds.has("solver")).toBe(false);
    expect(kinds.has("rule")).toBe(false);
    expect(kinds.has("slice")).toBe(false);
    expect(kinds.has("intent")).toBe(true);
  });

  it("C3 回退演练：growth.hidden_req OFF → 诊断=仅显式需求（== 不做隐藏需求发现）", async () => {
    const repos = createMemoryRepos();
    await repos.materializedIntents.upsert(
      mi({ key: "orders_intent", bindings: { solverKey: "affected_orders", ruleKeys: [], constraintKeys: [], skillId: "", ontologySliceKey: "" } }),
    );
    const snapshot = { solver: ["affected_orders"], rule: [], slice: [], ontology_type: ["Base", "Order", "Model", "Shipment"], dataset: [], kb_doc: [] };
    const deps: PreAnalyzeDeps = {
      repos,
      config: { DATACORE_BASE_URL: "http://x", SERVICE_TOKEN: "svc" },
      fetchImpl: routedFetch(snapshot, BATTERY_GRAPH),
    };
    const base = {
      tenantId: "demo",
      taskId: "task_c3",
      query: "订单受影响推演？",
      classification: classification(["orders_intent"]),
      generatedAt: "2026-07-09T00:00:00.000Z",
    };
    const off = await preAnalyzeQuery(deps, { ...base, hiddenReqEnabled: false });
    const offKinds = new Set(off.gapAnalysis!.entries.map((e) => e.kind));
    // 关闸：无隐藏对象类型闭包 → ontology_type 侧不出现（显式需求里没有 ontology_type）。
    expect(offKinds.has("ontology_type")).toBe(false);
    // 显式 solver 仍在（affected_orders）。
    expect(off.gapAnalysis!.entries.find((e) => e.kind === "solver")!.items.map((i) => i.key)).toEqual(["affected_orders"]);

    // 开闸对照：隐藏需求闭包纳入真类型（Base/Order/Model + 一跳 Shipment）·每个 ∈ 真图节点（零幽灵）。
    const on = await preAnalyzeQuery(deps, { ...base, hiddenReqEnabled: true });
    const onOntology = on.gapAnalysis!.entries.find((e) => e.kind === "ontology_type");
    expect(onOntology, "开闸后 ontology_type 侧应出现隐藏对象类型").toBeTruthy();
    const graphKeys = new Set(BATTERY_GRAPH.nodes.map((n) => n.key));
    for (const it of onOntology!.items) expect(graphKeys.has(it.key), `隐藏类型 ${it.key} ∈ 真本体图`).toBe(true);
    expect(onOntology!.items.map((i) => i.key)).toEqual(expect.arrayContaining(["Base", "Order", "Model", "Shipment"]));
    // 关闸 == 改造前：OFF 报告不含任何隐藏扩展（与「不做」逐字一致的结构证据）。
    expect(JSON.stringify(off.gapAnalysis!.entries.map((e) => e.kind))).not.toContain("ontology_type");
  });

  it("R6：同 query 同现状同注入 generatedAt → PreAnalysisReport 字节一致", async () => {
    const build = async () => {
      const repos = createMemoryRepos();
      await repos.materializedIntents.upsert(
        mi({ key: "k1", bindings: { solverKey: "sv", ruleKeys: ["r1"], constraintKeys: [], skillId: "sk", ontologySliceKey: "sl" } }),
      );
      const deps: PreAnalyzeDeps = {
        repos,
        config: { DATACORE_BASE_URL: "http://x", SERVICE_TOKEN: "svc" },
        fetchImpl: snapshotFetch({ solver: ["sv"], rule: [], slice: ["sl"], ontology_type: [], dataset: [], kb_doc: [] }),
      };
      return preAnalyzeQuery(deps, {
        tenantId: "demo",
        taskId: "task_r6",
        query: "确定性问句",
        classification: classification(["k1", "k2"]),
        generatedAt: "2026-07-09T12:00:00.000Z",
      });
    };
    const a = await build();
    const b = await build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
