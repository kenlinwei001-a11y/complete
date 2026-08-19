import { describe, expect, it } from "vitest";
import { ADMIN, createTestApp, debugHeaders, PKG } from "./helpers.js";
import type { RefReport } from "../src/refs/report.js";

/**
 * WO-SLICE-REF-REPORTER · G-SLICE-REF-PRODUCER-EMPTY 的 B 侧（生产方）接线测试。
 *
 * 病史：§2.3 上报路（makeRefReporter → POST /a/v1/references/report）一直在，但两个产出函数
 * 只认 evaluate_rules 步 ⇒ 带 resolve_slice 步的 workflow/plan 发布时上报 0 条 kind:"slice"，
 * DataCore 的 governance.sliceReferences（十六层 ①②）恒空。形态 = 接了线没数据（产出端恒空）。
 *
 * 本测试咬的是**链路**不是函数：真走 HTTP 发布端点 → 捕获型 reportRefs 断言上报载荷。
 * 变异反证：摘掉调用点的 planStepSliceRefs（或 guard 改回只看 ruleRefs）⇒ 本测试当场红。
 */

function captureReports(): { reports: RefReport[]; reporter: (tenantId: string, r: RefReport) => Promise<void> } {
  const reports: RefReport[] = [];
  return { reports, reporter: async (_t, r) => void reports.push(r) };
}

describe("G-SLICE-REF-PRODUCER-EMPTY · B 侧发布时上报 resolve_slice 出向引用（§2.4）", () => {
  it("发布带 resolve_slice 步的 workflow ⇒ 上报含 kind:\"slice\" 引用（与 rule 引用同路）", async () => {
    const { reports, reporter } = captureReports();
    const t = await createTestApp({ reportRefs: reporter });

    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "slice_ref_wf",
        name: "切片引用流程",
        inputs: { type: "object", properties: {} },
        steps: [
          { id: "s1", type: "resolve_slice", params: { sliceKey: "monthly_balance", args: {} } },
          { id: "s2", type: "resolve_slice", params: { sliceKey: "base_risk_profile", args: {} } },
          // 同一 sliceKey 重复出现 ⇒ 上报去重（与 planStepRuleRefs 同口径）
          { id: "s3", type: "resolve_slice", params: { sliceKey: "monthly_balance", args: { month: "2026-08" } } },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const wf = created.json() as { id: string };
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wf.id}/publish`, headers: debugHeaders(ADMIN), payload: {} });
    expect(pub.statusCode).toBe(200);

    const rep = reports.find((r) => r.source.kind === "workflow" && r.source.key === "slice_ref_wf");
    expect(rep).toBeDefined();
    expect(rep!.refs).toContainEqual({ kind: "slice", key: "monthly_balance", version: "latest" });
    expect(rep!.refs).toContainEqual({ kind: "slice", key: "base_risk_profile", version: "latest" });
    // 去重：monthly_balance 只上报一次
    expect(rep!.refs.filter((r) => r.kind === "slice" && r.key === "monthly_balance")).toHaveLength(1);
  });

  it("发布带 resolve_slice 步的 plan ⇒ 上报 source.kind=\"plan\" + kind:\"slice\" 引用（十六层②认 refKind=plan）", async () => {
    const { reports, reporter } = captureReports();
    const t = await createTestApp({ reportRefs: reporter });

    const created = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/packages/${PKG}/plans`,
      headers: debugHeaders(ADMIN),
      payload: {
        key: "slice_ref_plan",
        steps: [
          { id: "s1", type: "resolve_slice", params: { sliceKey: "model_capacity_network", args: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json() as { id: string };
    const pub = await t.app.inject({ method: "POST", url: `/api/v1/catalog/plans/${plan.id}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);

    const rep = reports.find((r) => r.source.kind === "plan" && r.source.key === "slice_ref_plan");
    expect(rep).toBeDefined();
    expect(rep!.refs).toContainEqual({ kind: "slice", key: "model_capacity_network", version: "latest" });
  });

  it("金丝雀：rule 引用上报不回归（evaluate_rules 步仍上报 kind:\"rule\"，与 slice 引用同帧）", async () => {
    const { reports, reporter } = captureReports();
    const t = await createTestApp({ reportRefs: reporter });

    const created = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/packages/${PKG}/plans`,
      headers: debugHeaders(ADMIN),
      payload: {
        key: "mixed_ref_plan",
        steps: [
          { id: "s1", type: "resolve_slice", params: { sliceKey: "monthly_balance", args: {} } },
          { id: "s2", type: "evaluate_rules", params: { ruleIds: ["C08"], payload: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json() as { id: string };
    const pub = await t.app.inject({ method: "POST", url: `/api/v1/catalog/plans/${plan.id}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);

    const rep = reports.find((r) => r.source.kind === "plan" && r.source.key === "mixed_ref_plan");
    expect(rep).toBeDefined();
    expect(rep!.refs).toContainEqual({ kind: "rule", key: "C08", version: "latest" });
    expect(rep!.refs).toContainEqual({ kind: "slice", key: "monthly_balance", version: "latest" });
  });
});
