import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN, PKG, type TestApp } from "./helpers.js";

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

  it("WO-10: 空套件 → passRate=0（无用例不充作满分·防假阳性），结构合法", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "agent_quality" } });
    const report = res.json() as { total: number; passRate: number; metrics: { intentAccuracy: number; toolCorrectness: number } };
    expect(report.total).toBe(0);
    // 0 用例证明不了任何质量 → 不给满分（此前 passRate=1 是"什么都没测=满分"假阳性）。
    expect(report.passRate).toBe(0);
    expect(report.metrics.intentAccuracy).toBe(0);
    expect(report.metrics.toolCorrectness).toBe(0);
  });

  it("WO-10-②: REST 透传 llmMode（默认 MOCK·诚实标注；可请求 REAL → 真打 LLM 真分）", async () => {
    const t = await createTestApp();
    // 不传 → 默认 MOCK（mock 跑出的分只证框架·非真 agent 质量）。
    const def = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "classifier" } });
    expect((def.json() as { llmMode: string }).llmMode).toBe("MOCK");
    // 传 llmMode:REAL → 透传进 report（真打需配真 provider·此处验透传链路，真分由 env-gated 真 Kimi FDE 证）。
    const real = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "classifier", llmMode: "REAL" } });
    expect((real.json() as { llmMode: string }).llmMode).toBe("REAL");
  });
});
