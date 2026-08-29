import { describe, expect, it } from "vitest";
import { createTestApp, TENANT, PKG, debugHeaders, PLANNER } from "./helpers.js";
import type { Answer, QueryTask } from "@platform/contracts";

/**
 * 实时验证审计层：统一决策痕迹导出（聚合 task/answer/toolCalls → 单一可导出 JSON）。
 * ontology_validation 总判定 + human_review_required 显式字段。
 */
const mkTask = (id: string, answer?: Answer): QueryTask => ({
  id, tenantId: TENANT, userId: "user-planner", packageId: PKG, conversationId: "conv1",
  query: "常州产能影响哪些订单", context: { view: "orders", selectedObjects: [], filters: {}, conversationId: "conv1" } as QueryTask["context"],
  status: "COMPLETED", path: "WORKFLOW", clarificationRounds: 0, answer,
  resolvedRefs: [{ kind: "plan", key: "plan_x", version: 2 }] as QueryTask["resolvedRefs"],
  createdAt: "2026-06-18T00:00:00.000Z", completedAt: "2026-06-18T00:00:05.000Z",
});

describe("决策痕迹导出 · GET /api/v1/queries/:taskId/decision-trace", () => {
  it("VERIFIED_WORKFLOW 无切片 → ontologyValidation NONE、humanReviewRequired false、含版本钉", async () => {
    const t = await createTestApp();
    await t.repos.tasks.insert(mkTask("task_v", { trustLevel: "VERIFIED_WORKFLOW", blocks: [], provenance: [], unverifiedNumerics: false }));
    const res = await t.app.inject({ method: "GET", url: "/api/v1/queries/task_v/decision-trace", headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(200);
    const dt = res.json() as { ontologyValidation: string; humanReviewRequired: boolean; resolvedRefs: unknown[]; decisionId: string };
    expect(dt.decisionId).toBe("task_v");
    expect(dt.ontologyValidation).toBe("NONE");
    expect(dt.humanReviewRequired).toBe(false);
    expect(dt.resolvedRefs.length).toBe(1); // 版本钉留痕
  });

  it("AGENT_EXPLORATORY + 交叉验证 CONFLICT → humanReviewRequired true、ontologyValidation CONFLICT", async () => {
    const t = await createTestApp();
    await t.repos.tasks.insert(mkTask("task_a", {
      trustLevel: "AGENT_EXPLORATORY", blocks: [], provenance: [], unverifiedNumerics: true,
      validationTrace: {
        slicesUsed: ["affected_orders"],
        consistency: { checks: [], verdict: "ALL_PASS" },
        crossValidation: { claims: [], verdict: "CONFLICT" },
        generatedAt: "2026-06-18T00:00:00.000Z",
      },
    }));
    const res = await t.app.inject({ method: "GET", url: "/api/v1/queries/task_a/decision-trace", headers: debugHeaders(PLANNER) });
    const dt = res.json() as { ontologyValidation: string; humanReviewRequired: boolean };
    expect(dt.ontologyValidation).toBe("CONFLICT");
    expect(dt.humanReviewRequired).toBe(true);
  });
});
