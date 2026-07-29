import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN, PKG, type TestApp } from "./helpers.js";
import { EvalService } from "../src/evals.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { seedScenarioPackage } from "../src/mocks/seed.js";
import type { QueryTask } from "@platform/contracts";

const RISK_CTX = { view: "risk", selectedObjects: [], filters: {} };

function classifyAffected() {
  return { candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} };
}

async function makeCase(t: TestApp, query: string, expectIntent: string | null, toolSeq?: { name: string }[]) {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/evals",
    headers: debugHeaders(ADMIN),
    payload: {
      suite: "classifier",
      packageId: PKG,
      input: { query, context: RISK_CTX },
      expect: { intentKey: expectIntent, ...(toolSeq ? { toolSequence: toolSeq } : {}) },
      origin: "MANUAL",
    },
  });
  return (res.json() as { id: string }).id;
}

describe("AIP Evals §2 / E4 — 评测框架（mock LLM 证框架，真分待接真模型）", () => {
  it("跑 classifier 套件：逐 case 经真实 QOS，命中意图 → pass，指标可量化、报告落库", async () => {
    const t = await createTestApp();
    await makeCase(t, "常州基地影响哪些订单？", "affected_orders");
    await makeCase(t, "常州受影响订单清单", "affected_orders");
    // 每个 case 提交触发一次分类；排队足量同款高置信分类（顺序无关）
    t.llm.queueClassification(classifyAffected(), classifyAffected(), classifyAffected(), classifyAffected());

    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "classifier" } });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { total: number; passed: number; passRate: number; metrics: { intentAccuracy: number; avgToolCalls: number; avgLatencyMs: number }; llmMode: string; results: { pass: boolean; observed: { intentKey: string | null } }[] };
    expect(report.total).toBe(2);
    expect(report.passed).toBe(2);
    expect(report.passRate).toBe(1);
    expect(report.metrics.intentAccuracy).toBe(1);
    expect(report.llmMode).toBe("MOCK"); // 诚实标注：mock 跑出的分数只证框架
    expect(report.results.every((r) => r.observed.intentKey === "affected_orders")).toBe(true);

    // 落库可对比历史
    const hist = await t.app.inject({ method: "GET", url: "/b/v1/evals/runs", headers: debugHeaders(ADMIN) });
    expect((hist.json() as { items: unknown[] }).items.length).toBe(1);
  });

  it("意图不匹配 → 该 case 红、intentAccuracy 下降（指标对回归敏感）", async () => {
    const t = await createTestApp();
    await makeCase(t, "随便问问产能", "affected_orders"); // 期望 affected_orders
    t.llm.queueClassification(
      { candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} }, // 实际判成别的
    );
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "classifier" } });
    const report = res.json() as { passed: number; total: number; metrics: { intentAccuracy: number }; results: { failures: string[] }[] };
    expect(report.total).toBe(1);
    expect(report.passed).toBe(0);
    expect(report.metrics.intentAccuracy).toBe(0);
    expect(report.results[0]!.failures.some((f) => f.startsWith("intent"))).toBe(true);
  });

  it("§2 种子：从 20 场景目录派生应触发用例（GET 可列）", async () => {
    const t = await createTestApp();
    const seed = await t.app.inject({ method: "POST", url: "/b/v1/evals/seed-scenarios", headers: debugHeaders(ADMIN), payload: { packageId: PKG } });
    expect((seed.json() as { created: number }).created).toBe(20);
    const list = await t.app.inject({ method: "GET", url: "/b/v1/evals?suite=classifier", headers: debugHeaders(ADMIN) });
    const items = (list.json() as { items: { origin: string; expect: { intentKey: string } }[] }).items;
    expect(items.length).toBe(20);
    expect(items.every((c) => c.origin === "SCENARIO")).toBe(true);
    expect(items.some((c) => c.expect.intentKey === "affected_orders")).toBe(true);
    // 幂等：重复 seed 不重复创建
    const again = await t.app.inject({ method: "POST", url: "/b/v1/evals/seed-scenarios", headers: debugHeaders(ADMIN), payload: { packageId: PKG } });
    expect((again.json() as { created: number }).created).toBe(0);
  });

  it("§2 发布门禁：存在 agent_quality 用例时,发布 agent 触发评测运行（历史 +1）且首发不阻断", async () => {
    const t = await createTestApp();
    // 一条 agent_quality 用例
    await t.app.inject({
      method: "POST",
      url: "/b/v1/evals",
      headers: debugHeaders(ADMIN),
      payload: { suite: "agent_quality", packageId: PKG, input: { query: "影响哪些订单", context: RISK_CTX }, expect: { intentKey: "affected_orders" }, origin: "MANUAL" },
    });
    t.llm.queueClassification(classifyAffected()); // 发布时门禁跑这条用例
    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/agents",
      headers: debugHeaders(ADMIN),
      payload: { key: "gated_agent", name: "门禁 agent", description: "d", model: "claude-opus-4-8", systemPrompt: "你是助手", tools: [{ kind: "BUILTIN", name: "query_objects" }], ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" }, skills: [], mcpServers: [], scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] }, budget: { maxIterations: 4 } },
    });
    const agentId = (created.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/agents/${agentId}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { status?: string; ok?: boolean }).status).toBe("PUBLISHED"); // 首发无 prior → 不阻断
    // 门禁确实跑了 agent_quality 评测（历史含一条）
    const runs = (await t.app.inject({ method: "GET", url: "/b/v1/evals/runs", headers: debugHeaders(ADMIN) })).json() as { items: { suite: string; agentKey?: string }[] };
    expect(runs.items.some((r) => r.suite === "agent_quality" && r.agentKey === "gated_agent")).toBe(true);
  });

  it("空套件 → passRate=1（无回归项），结构合法", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "agent_quality" } });
    const report = res.json() as { total: number; passRate: number };
    expect(report.total).toBe(0);
    expect(report.passRate).toBe(1);
  });
});

describe("WO-1 · EvalService 生产化缺陷修复", () => {
  it("SP9 · seed 用例 ID 含 tenantId，多租户各有一份", async () => {
    const reposA = createMemoryRepos();
    await reposA.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId: "ta" });
    const svcA = new EvalService({ repos: reposA, orchestrator: {} as any, engine: {} as any });
    await svcA.seedScenarioCases("ta", PKG);
    const casesA = await reposA.evalCases.listByTenant("ta", "classifier");
    expect(casesA.length).toBe(20);
    expect(casesA.every((c) => c.id.startsWith("ec_scenario_ta_"))).toBe(true);

    const reposB = createMemoryRepos();
    await reposB.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId: "tb" });
    const svcB = new EvalService({ repos: reposB, orchestrator: {} as any, engine: {} as any });
    await svcB.seedScenarioCases("tb", PKG);
    const casesB = await reposB.evalCases.listByTenant("tb", "classifier");
    expect(casesB.length).toBe(20);
    expect(casesB.every((c) => c.id.startsWith("ec_scenario_tb_"))).toBe(true);
    expect(casesA[0].id).not.toBe(casesB[0].id);
  });

  it("SP11 · maxToolCalls 违反时 toolCorrectness 下降", async () => {
    const repos = createMemoryRepos();
    const tenantId = "demo";
    await repos.packages.insert({ ...seedScenarioPackage(), id: PKG, tenantId });
    await repos.evalCases.upsert({
      id: "ec_toolmax",
      tenantId,
      suite: "agent_quality",
      packageId: PKG,
      input: { query: "q", context: RISK_CTX },
      expect: { toolSequence: [{ name: "invoke_solver" }], maxToolCalls: 1 },
      origin: "MANUAL",
      createdAt: new Date().toISOString(),
    });

    // mock orchestrator：返回已终态 task，并注入 2 条 toolCalls（超过 maxToolCalls=1）。
    const taskId = "task_toolmax";
    const mockOrc = {
      submitQuery: async () => {
        await repos.tasks.insert({
          id: taskId,
          tenantId,
          userId: "u1",
          packageId: PKG,
          conversationId: taskId,
          query: "q",
          context: { view: "risk", selectedObjects: [], filters: {} },
          status: "COMPLETED",
          clarificationRounds: 0,
          createdAt: new Date().toISOString(),
          matchedIntent: { intentId: "i1", intentKey: "affected_orders", version: 1 },
        });
        await repos.toolCalls.insert({ id: "tc1", taskId, toolName: "invoke_solver", input: {}, outputDigest: "", output: null, outcome: "OK", durationMs: 1, createdAt: new Date().toISOString() });
        await repos.toolCalls.insert({ id: "tc2", taskId, toolName: "query_objects", input: {}, outputDigest: "", output: null, outcome: "OK", durationMs: 1, createdAt: new Date().toISOString() });
        return { taskId, status: "COMPLETED", streamUrl: "", reused: false };
      },
    };

    const svc = new EvalService({ repos, orchestrator: mockOrc as any, engine: {} as any });
    const auth = { tenantId, userId: "u1", roles: ["planner"] };
    const report = await svc.run(auth, "agent_quality");
    expect(report.metrics.toolCorrectness).toBe(0);
    expect(report.results[0].failures.some((f) => f.startsWith("maxToolCalls"))).toBe(true);
  });

  it("SP12 · feedbackQuality 校验 caller 租户权限", async () => {
    const repos = createMemoryRepos();
    const svc = new EvalService({ repos, orchestrator: {} as any, engine: {} as any });
    const report = {
      id: "erun_1",
      tenantId: "tenant_b",
      suite: "agent_quality",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      total: 1,
      passed: 1,
      passRate: 1,
      metrics: { intentAccuracy: 1, toolCorrectness: 1, avgToolCalls: 0, avgLatencyMs: 0, avgTokenCost: 0 },
      results: [],
      llmMode: "MOCK",
    } as any;
    await expect(svc.feedbackQuality({ tenantId: "tenant_a", userId: "u1", roles: [] }, report)).rejects.toThrow("tenant mismatch");
  });
});
