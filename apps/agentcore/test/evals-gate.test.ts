import { describe, expect, it } from "vitest";
import type { EvalRunReport } from "@platform/contracts";
import { createTestApp, debugHeaders, lastToolCallId, ADMIN, PKG, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

const CTX = { view: "dash", selectedObjects: [], filters: {} };
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

async function makeAgentCase(t: TestApp, query: string): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/evals",
    headers: debugHeaders(ADMIN),
    payload: {
      suite: "agent_quality",
      packageId: PKG,
      input: { query, context: CTX },
      expect: { intentKey: null }, // 期望走 out-of-catalog → agent 路径
      origin: "MANUAL",
    },
  });
  return (res.json() as { id: string }).id;
}

/**
 * 单一通用脚本 turn：按 req 中的 query 关键字分支（HALLU / CLEAN），顺序无关。
 * 首轮发 query_objects(limit=200)，拿到 <tool_data> 后发 final_answer。
 * - CLEAN：回答里的 200 可在工具输入证据中溯源 → 非幻觉。
 * - HALLU：回答里的 7777777 无法在证据中溯源 → 幻觉。
 */
function scriptedAgentTurn(req: { messages: { content: unknown }[] }) {
  const s = JSON.stringify(req.messages);
  const isHallu = s.includes("HALLU");
  if (!s.includes("<tool_data")) {
    return { content: [text("先查对象。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 200 })] };
  }
  const tc = lastToolCallId(req as { messages: { content: unknown }[] });
  const markdown = isHallu
    ? "预测将新增 7777777 个订单，风险偏高。"
    : "共扫描 200 个对象，结构均衡。";
  return {
    content: [
      toolUse("final_answer", {
        blocks: [{ type: "text", markdown }],
        provenance: [{ toolCallId: tc, outputPath: "$.data.items" }],
      }),
    ],
  };
}

function seedReport(over: {
  id: string;
  intentAccuracy: number;
  toolCorrectness: number;
  hallucinationRate?: number;
}): EvalRunReport {
  return {
    id: over.id,
    tenantId: TENANT,
    suite: "agent_quality",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    total: 10,
    passed: 10,
    passRate: 1,
    metrics: {
      intentAccuracy: over.intentAccuracy,
      toolCorrectness: over.toolCorrectness,
      avgToolCalls: 1,
      avgLatencyMs: 5,
      avgTokenCost: 100,
      ...(over.hallucinationRate !== undefined ? { hallucinationRate: over.hallucinationRate } : {}),
    },
    results: [],
    llmMode: "MOCK",
  };
}

describe("E4 幻觉率指标 — 无法溯源的数值即计幻觉", () => {
  it("一脏一净两 case：脏 case 命中 7777777，净 case 假；hallucinationRate=0.5", async () => {
    const t = await createTestApp();
    await makeAgentCase(t, "HALLU 订单预测");
    await makeAgentCase(t, "CLEAN 对象扫描");
    // 两个 case 均 out-of-catalog（顺序无关）；每 case 两轮 agent（工具 + final）
    t.llm.queueClassification(OUT_OF_CATALOG, OUT_OF_CATALOG);
    t.llm.queueAgentTurn(scriptedAgentTurn, scriptedAgentTurn, scriptedAgentTurn, scriptedAgentTurn);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/run", headers: debugHeaders(ADMIN), payload: { suite: "agent_quality" } });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      total: number;
      metrics: { hallucinationRate: number };
      results: { observed: { hallucination?: boolean; unverifiedNumerics?: string[]; answerExcerpt?: string } }[];
    };
    expect(report.total).toBe(2);
    expect(report.metrics.hallucinationRate).toBe(0.5);

    const hallu = report.results.find((r) => r.observed.hallucination);
    const clean = report.results.find((r) => !r.observed.hallucination);
    expect(hallu).toBeDefined();
    expect(clean).toBeDefined();
    expect(hallu!.observed.unverifiedNumerics).toContain("7777777");
    // 净 case：200 可在工具输入证据溯源 → 不计幻觉，无未核实数值
    expect(clean!.observed.unverifiedNumerics).toEqual([]);
    expect(clean!.observed.hallucination).toBe(false);
  });
});

describe("E4 影子发布门禁 — 绝对阈值 + 基线不退化", () => {
  it("候选全数达标 → pass，failures 空（无 hallucinationRate 老报告按 0 处理）", async () => {
    const t = await createTestApp();
    await t.repos.evalRuns.insert(seedReport({ id: "erun_ok", intentAccuracy: 0.95, toolCorrectness: 0.9 }));
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/gate", headers: debugHeaders(ADMIN), payload: { candidateRunId: "erun_ok" } });
    expect(res.statusCode).toBe(200);
    const gate = res.json() as { pass: boolean; failures: string[]; metrics: { hallucinationRate: number } };
    expect(gate.pass).toBe(true);
    expect(gate.failures).toEqual([]);
    expect(gate.metrics.hallucinationRate).toBe(0); // 老报告缺字段 → 0
  });

  it("三项均低于阈值 → pass=false，三条对应中文原因", async () => {
    const t = await createTestApp();
    await t.repos.evalRuns.insert(seedReport({ id: "erun_bad", intentAccuracy: 0.5, toolCorrectness: 0.5, hallucinationRate: 0.5 }));
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/gate", headers: debugHeaders(ADMIN), payload: { candidateRunId: "erun_bad" } });
    const gate = res.json() as { pass: boolean; failures: string[] };
    expect(gate.pass).toBe(false);
    expect(gate.failures.some((f) => f.includes("意图准确率") && f.includes("低于阈值"))).toBe(true);
    expect(gate.failures.some((f) => f.includes("工具正确率") && f.includes("低于阈值"))).toBe(true);
    expect(gate.failures.some((f) => f.includes("幻觉率") && f.includes("高于上限"))).toBe(true);
  });

  it("候选达绝对阈值但较基线退化 → pass=false，报退化", async () => {
    const t = await createTestApp();
    await t.repos.evalRuns.insert(seedReport({ id: "erun_base", intentAccuracy: 0.99, toolCorrectness: 0.99, hallucinationRate: 0.0 }));
    await t.repos.evalRuns.insert(seedReport({ id: "erun_cand", intentAccuracy: 0.92, toolCorrectness: 0.99, hallucinationRate: 0.0 }));
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/evals/gate",
      headers: debugHeaders(ADMIN),
      payload: { candidateRunId: "erun_cand", baselineRunId: "erun_base" },
    });
    const gate = res.json() as { pass: boolean; baselineRunId?: string; failures: string[] };
    expect(gate.baselineRunId).toBe("erun_base");
    expect(gate.pass).toBe(false); // 0.92 ≥ 0.9 绝对达标，但 < 基线 0.99 → 退化
    expect(gate.failures.some((f) => f.includes("意图准确率较基线退化"))).toBe(true);
  });

  it("候选不存在 / 跨租户 → 404 EVAL_RUN_NOT_FOUND", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/evals/gate", headers: debugHeaders(ADMIN), payload: { candidateRunId: "erun_missing" } });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("EVAL_RUN_NOT_FOUND");
  });
});
