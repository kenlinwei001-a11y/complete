import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN, PKG } from "./helpers.js";
import { classifyFailKind } from "../src/evals.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";

const RISK_CTX = { view: "risk", selectedObjects: [], filters: {} };

function classifyAffected() {
  return { candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} };
}

/**
 * A14 · agent evals parity（对 PRD 期望比对）。mock 证框架（真 Kimi env-gated）：
 * 失因分类 INTENT/TOOLSEQ/ANSWER/OTHER + parity 报告（按失因聚合 + 逐 case 偏差）+ PRD 期望用例库（20 场景）。
 */
describe("A14 · evals parity 报告", () => {
  it("classifyFailKind：首要失因归类（意图>工具序列>答案>其它）", () => {
    expect(classifyFailKind(["intent: expected x, got y"])).toBe("INTENT");
    expect(classifyFailKind(["toolSequence: expected ..."])).toBe("TOOLSEQ");
    expect(classifyFailKind(["maxToolCalls: 5 > 3"])).toBe("TOOLSEQ");
    expect(classifyFailKind(['answerMust: missing "x"'])).toBe("ANSWER");
    expect(classifyFailKind(["submit failed: boom"])).toBe("OTHER");
    // 优先级：意图先于工具
    expect(classifyFailKind(["toolSequence: ...", "intent: ..."])).toBe("INTENT");
  });

  it("run 产出 parity 报告：按失因聚合 + 逐 case（含 failKind），与 results 一致", async () => {
    const t = await createTestApp();
    // 一个会 PASS（命中意图），一个会 FAIL（期望意图不符 → INTENT 失因）
    await t.app.inject({ method: "POST", url: "/b/v1/evals", headers: debugHeaders(ADMIN), payload: { suite: "classifier", packageId: PKG, input: { query: "常州基地影响哪些订单？", context: RISK_CTX }, expect: { intentKey: "affected_orders" }, origin: "MANUAL" } });
    await t.app.inject({ method: "POST", url: "/b/v1/evals", headers: debugHeaders(ADMIN), payload: { suite: "classifier", packageId: PKG, input: { query: "另一问句", context: RISK_CTX }, expect: { intentKey: "capacity_forecast" }, origin: "MANUAL" } });
    t.llm.queueClassification(classifyAffected(), classifyAffected(), classifyAffected(), classifyAffected());

    const report = (await (await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "classifier" } })).json()) as {
      total: number; passed: number;
      parity: { byFailKind: { INTENT: number; TOOLSEQ: number; ANSWER: number; OTHER: number }; byCase: { caseId: string; pass: boolean; failKind?: string; expectIntent?: string }[] };
      results: { caseId: string; pass: boolean; failKind?: string }[];
    };
    expect(report.parity).toBeTruthy();
    expect(report.parity.byCase.length).toBe(report.total);
    // 一个 INTENT 失因（capacity_forecast 期望未命中，观测 affected_orders）
    expect(report.parity.byFailKind.INTENT).toBe(1);
    // parity.byCase 的 failKind 与 results 对齐
    const failed = report.results.find((r) => !r.pass)!;
    expect(failed.failKind).toBe("INTENT");
    expect(report.parity.byCase.find((c) => c.caseId === failed.caseId)!.failKind).toBe("INTENT");
    // 失因histogram 总和 = 失败用例数
    const fails = report.total - report.passed;
    const sum = report.parity.byFailKind.INTENT + report.parity.byFailKind.TOOLSEQ + report.parity.byFailKind.ANSWER + report.parity.byFailKind.OTHER;
    expect(sum).toBe(fails);
  });

  it("PRD 期望用例库：seed-parity 派生 20 场景（带 intent + 工具序列期望）+ 幂等", async () => {
    const t = await createTestApp();
    const seed = (await (await t.app.inject({ method: "POST", url: "/b/v1/evals/seed-parity", headers: debugHeaders(ADMIN), payload: { packageId: PKG } })).json()) as { created: number };
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）：seed 产出数 == 目录卡数（产出 vs 源互校）
    expect(seed.created).toBe(SCENARIO_CATALOG.length);
    const items = (await (await t.app.inject({ method: "GET", url: "/b/v1/evals?suite=agent_quality", headers: debugHeaders(ADMIN) })).json()) as { items: { id: string; expect: { intentKey?: string; toolSequence?: { name: string }[] } }[] };
    const parityCases = items.items.filter((c) => c.id.startsWith("ec_parity_"));
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）：列出的 parity 用例数 == 目录卡数（产出 vs 源互校）
    expect(parityCases.length).toBe(SCENARIO_CATALOG.length);
    // PRD 期望三元：每条带 intent + 工具序列（invoke_solver）
    expect(parityCases.every((c) => c.expect.intentKey && (c.expect.toolSequence?.length ?? 0) > 0)).toBe(true);
    // 幂等
    const again = (await (await t.app.inject({ method: "POST", url: "/b/v1/evals/seed-parity", headers: debugHeaders(ADMIN), payload: { packageId: PKG } })).json()) as { created: number };
    expect(again.created).toBe(0);
  });
});
