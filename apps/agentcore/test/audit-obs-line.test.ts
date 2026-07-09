import { describe, expect, it } from "vitest";
import { classifyGap } from "../src/growth/probe.js";
import { GENERIC_SOLVER_INTENT_KEYS } from "../src/capability/generic-solvers.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT } from "./helpers.js";

/**
 * FILL-AUDIT-OBS-LINE（WO-6 曝 Q9 洞 GAP-AUDIT-OBS）验收：
 *  Q9 原症：AUDIT-hand-run.md §③ 称「5 杀手多跳全落地 + 真 HTTP E2E」实为 4 个**直调**
 *  `/a/v1/solvers/{key}/invoke`（手搓 args），NL→QOS **从未真跑**，审计散点未成一线。
 *
 *  C1：代表问经 QOS **NL 真路由**（submitQuery·分类→路径A 工作流→invoke_solver·非直调）→ 达终态后
 *      经 `GET /api/v1/queries/:taskId/decision-trace` 取出**完整决策链审计一线**：
 *      `decisionId`（=task.id·spine）串起 数据(classification/resolvedRefs) → 推演(toolCalls 求解器调用)
 *      → 结论(trustLevel/provenance/ontologyValidation)，**同一 requestId/decisionId 串成一线**（非散点）。
 *  C2：classifyGap 视之为 ANSWERABLE（非 OTHER·内含 dataBearing 门）。
 *
 *  LLM 一律 mock（分类脚本化·其余全链真跑）。这是「NL→QOS 真跑出审计一线」的 teeth——
 *  revert NL 路由（回直调）→ 无 task/无 decision-trace spine → 本测试塌（green→red 自证·非直调冒充）。
 */

const CARDS = SCENARIO_CATALOG.filter((c) => (GENERIC_SOLVER_INTENT_KEYS as readonly string[]).includes(c.intentKey));
// 审计杀手级代表问（断供影响半径 / 毛利倒挂根因）——多跳归因/传导，正是 Q9「决策链成一线」的对象。
const AUDIT_KILLERS = ["supplier_disruption_q", "margin_attribution_q"];

describe("FILL-AUDIT-OBS-LINE · 代表问经 NL 真跑 → 决策链审计成一线（requestId/decisionId spine·非直调）", () => {
  for (const intentKey of AUDIT_KILLERS) {
    const card = CARDS.find((c) => c.intentKey === intentKey)!;
    it(`「${card.triggerQuestion}」→ ${card.solver}：NL 真跑 → decision-trace 完整一线（数据→推演→结论 同 spine）`, async () => {
      const t = await createTestApp();
      // NL 路径：分类器把代表问路由到该意图（非手搓 args 直调求解器）。
      t.llm.queueClassification({ candidates: [{ intentKey: card.intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });

      const { taskId, statusCode } = await submitQuery(t, PLANNER, card.triggerQuestion, { view: card.view });
      expect(statusCode).toBe(202);
      const task = await waitForTask(t, taskId);

      // ① NL 路由证据（非直调）：分类→路径A 工作流→命中意图。
      expect(task.status).toBe("COMPLETED");
      expect(task.path).toBe("WORKFLOW");
      expect(task.matchedIntent?.intentKey).toBe(card.intentKey);
      // ② classifyGap ANSWERABLE（非 OTHER）。
      expect(classifyGap(task).verdict).toBe("ANSWERABLE");

      // ③ 决策链审计成一线：拉 decision-trace 端点，验 spine 串起数据→推演→结论。
      const res = await t.app.inject({
        method: "GET",
        url: `/api/v1/queries/${taskId}/decision-trace`,
        headers: { "x-debug-user": encodeURIComponent(PLANNER) },
      });
      expect(res.statusCode).toBe(200);
      const trace = res.json() as {
        decisionId: string; tenantId: string; question: string; status: string; path: string;
        matchedIntent?: { intentKey?: string }; toolCalls: { tool: string; outcome: string }[];
        ontologyValidation: string; provenanceCount: number;
      };
      // spine：decisionId = task.id，串起同一决策全链（非散点·R2 租户隔离）。
      expect(trace.decisionId).toBe(taskId);
      expect(trace.tenantId).toBe(TENANT);
      expect(trace.question).toBe(card.triggerQuestion); // 数据段：原问句
      expect(trace.path).toBe("WORKFLOW");
      expect(trace.matchedIntent?.intentKey).toBe(card.intentKey); // 分类→意图段
      // 推演段：toolCalls 记该求解器真实调用（NL→plan→invoke_solver 的真实痕迹·非手搓直调）。
      expect(trace.toolCalls.some((tc) => tc.tool === "invoke_solver" || tc.tool.includes(card.solver))).toBe(true);
      // 结论段：本体校验位存在（NONE/ALL_PASS/…·非缺失）。
      expect(typeof trace.ontologyValidation).toBe("string");

      // ④ 编排 DAG（trace 投影）亦成链：数据/推演节点齐（同 taskId 一线·可视审计）。
      const dagRes = await t.app.inject({
        method: "GET",
        url: `/api/v1/queries/${taskId}/trace`,
        headers: { "x-debug-user": encodeURIComponent(PLANNER) },
      });
      expect(dagRes.statusCode).toBe(200);
      const dag = dagRes.json() as { nodes: { id: string; status?: string }[] };
      expect(Array.isArray(dag.nodes)).toBe(true);
      expect(dag.nodes.length).toBeGreaterThan(0); // 决策链投影非空（散点→一线）
    });
  }

  it("R2 隔离：跨租户取 decision-trace → 404 TASK_NOT_FOUND（审计一线不泄漏跨租户）", async () => {
    const t = await createTestApp();
    const card = CARDS.find((c) => c.intentKey === "supplier_disruption_q")!;
    t.llm.queueClassification({ candidates: [{ intentKey: card.intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(t, PLANNER, card.triggerQuestion, { view: card.view });
    await waitForTask(t, taskId);
    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/decision-trace`,
      headers: { "x-debug-user": encodeURIComponent("other-tenant:u:planner") },
    });
    expect(res.statusCode).toBe(404);
  });
});
