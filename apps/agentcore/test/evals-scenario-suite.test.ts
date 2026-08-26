import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN, PKG } from "./helpers.js";

/**
 * A14 · 亲手跑 agent evals 比对 PRD：把 20 场景目录（= PRD 验收场景）种子化为 eval 用例，
 * 逐条经真实 QOS 管线跑一遍，喂入各场景应得意图（模拟完美分类器），验证**下游 intent→计划→
 * 求解器→答案 全链对每个场景都真能跑通**（绿测试≠能用：这里抓的是某场景计划/求解器断链）。
 * "结果正确" = 20/20 全过、intentAccuracy=1、REUSED 求解器场景真的 invoke_solver。
 */
describe("A14 · 20 场景 eval 套件 hand-run（比对 PRD）", () => {
  it("全 20 场景经真实 QOS 跑通：passRate=1 / intentAccuracy=1 / REUSED 场景真调求解器", async () => {
    const t = await createTestApp();
    // ① 种子化 20 场景为 eval 用例
    const seed = await t.app.inject({ method: "POST", url: "/b/v1/evals/seed-scenarios", headers: debugHeaders(ADMIN), payload: { packageId: PKG } });
    expect((seed.json() as { created: number }).created).toBe(20);
    // ② 取有序用例（run 与 list 同序）
    const cases = (await t.app.inject({ method: "GET", url: "/b/v1/evals?suite=classifier", headers: debugHeaders(ADMIN) })).json() as {
      items: { id: string; input: { query: string }; expect: { intentKey: string | null; toolSequence?: { name: string }[] } }[];
    };
    expect(cases.items.length).toBe(20);
    // ③ 喂入每条用例"应得意图"（模拟完美分类器；考验的是下游执行）
    for (const c of cases.items) {
      t.llm.queueClassification({ candidates: c.expect.intentKey ? [{ intentKey: c.expect.intentKey, confidence: 0.95 }] : [], outOfCatalog: c.expect.intentKey === null, extractedSlots: {} });
    }
    // ④ 跑套件
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "classifier" } });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      total: number; passed: number; passRate: number;
      metrics: { intentAccuracy: number };
      results: { caseId: string; pass: boolean; failures: string[]; observed: { intentKey: string | null; path?: string; toolNames: string[]; answerExcerpt?: string } }[];
    };
    // ⑤ 正确性判据（比对 PRD）：每个场景都①命中意图 ②真执行(有 path) ③产出真答案(非空)。
    const broken = report.results.filter((r) => !r.observed.path || !(r.observed.answerExcerpt && r.observed.answerExcerpt.length > 0));
    for (const f of report.results.filter((r) => !r.pass)) console.log(`[A14] INTENT-FAIL ${f.caseId}: ${f.failures.join(";")}`);
    for (const b of broken) console.log(`[A14] NO-ANSWER ${b.caseId} path=${b.observed.path} ans=${(b.observed.answerExcerpt ?? "").slice(0, 80)}`);
    console.log(`[A14] 比对 PRD：${report.passed}/${report.total} 意图命中 · ${report.total - broken.length}/${report.total} 真执行并产出答案 · llmMode=MOCK`);
    expect(report.total).toBe(20);
    expect(report.metrics.intentAccuracy).toBe(1); // ① 20/20 意图命中
    expect(report.passed).toBe(20);
    expect(report.passRate).toBe(1);
    expect(broken).toEqual([]); // ②③ 20/20 真执行 + 产出非空答案（无静态/空壳场景）
  });
});
