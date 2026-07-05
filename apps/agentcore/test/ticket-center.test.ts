import { describe, expect, it, vi } from "vitest";
import type { GrowthTicket, TicketBoardRow, TicketDetail, WorklistItem } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, type TestApp } from "./helpers.js";

/**
 * TICKET-CENTER-UNIFIED 齿轮测试（用户亲定 2026-07-05「所有补 X 工单集中一页·点单见详情列举补充内容」）：
 *  - T1 聚合端点三源 union：growthWorklist（DATA_GAP + B3 HARD DataRequest 人工描述单）⊕ growthTickets
 *    （FEATURE/PLAN_SCAFFOLD/SOLVER_GAP）→ GET /board 统一 kind 标 + claimable 语义（零造行：行数=真源行数之和）。
 *  - T2 详情清单字段完整性：按类型列举补充内容（DATA_GAP→fillPlan+B2 边界结论；DATA_REQUEST→dataRequest.descriptionSchema；
 *    SOLVER_GAP/FEATURE→ioContract/ontologyRefs/acceptance；PLAN_SCAFFOLD→scaffoldedDrafts+审批深链）。
 *  - T3 认领跨类型分流不误闸：gtk_ 工单 id 走 worklist claim → 既有 409 WORKLIST_ITEM_READONLY guard 不绕。
 *  - T4 R2 租户隔离：跨租户 board 空 / detail 404。
 *  - T5 manifest requires 投影：fromQuestion 携 solver 入口 entryRef → detail 经 checkReadiness 实测 present-vs-needed。
 */
const H = (user: string) => ({ "x-debug-user": user, "content-type": "application/json" });
const NOW = "2026-07-05T08:00:00.000Z";

const wliSoft: WorklistItem = {
  id: "wli_tc_soft", tenantId: TENANT, fromQuestion: "常州影响哪些订单？", gapCode: "EMPTY_DATA",
  kind: "DATA_GAP", status: "OPEN", evidence: "SOFT 缺数据（Order）",
  fillPlan: { mode: "SOFT", action: "fillData", typeKey: "Order", fields: ["id", "name", "value"], rows: 6, seed: 42 },
  createdAt: NOW, updatedAt: NOW,
};
const wliHard: WorklistItem = {
  id: "wli_tc_hard", tenantId: TENANT, fromQuestion: "新供应商甲交付如何？", gapCode: "EMPTY_DATA",
  kind: "DATA_GAP", status: "OPEN", evidence: "[B3 越界新实体] 词表外新实体｜数据描述: 供应商主数据",
  fillPlan: { mode: "HARD", action: "importData", typeKey: "Supplier" },
  dataRequest: {
    typeKey: "Supplier", columns: ["supplier_id", "name"], entities: ["供应商甲"],
    reason: "词表外新实体", newEntity: true, descriptionRequired: true,
    descriptionSchema: [{ field: "字段清单", hint: "每列名称与含义" }, { field: "值域", hint: "取值范围" }],
    description: "供应商主数据",
  },
  deeplink: "/connections", createdAt: NOW, updatedAt: NOW,
};
const tkFeature: GrowthTicket = {
  id: "gtk_tc_feat", tenantId: TENANT, fromQuestion: "未知能力问句", gapCode: "NO_CAPABILITY",
  ioContract: { inputs: ["view:dash"], outputShape: ["answer", "provenance"] },
  ontologyRefs: { objectTypes: ["dash"], slices: [], rules: [] },
  acceptance: "问句应能答出可验证答案并过门禁。", status: "OPEN", createdAt: NOW,
};
const tkSolver: GrowthTicket = {
  id: "gtk_tc_solver", tenantId: TENANT, fromQuestion: "算一下产能弹性", gapCode: "SOLVER_NOT_FOUND",
  ioContract: { inputs: ["Base"], outputShape: ["value", "unit", "rows", "provenance"] },
  ontologyRefs: { objectTypes: ["Base"], slices: ["base_line_slice"], rules: ["C08"] },
  acceptance: "求解器应注册并产出 value/unit/rows。", status: "OPEN", createdAt: NOW,
};
const tkPlan: GrowthTicket = {
  id: "gtk_tc_plan", tenantId: TENANT, fromQuestion: "产能爬坡影响哪些基地？", gapCode: "NO_PLAN",
  ioContract: { inputs: ["Base"], outputShape: ["steps", "rows"] },
  ontologyRefs: { objectTypes: ["Base"], slices: [], rules: [] },
  acceptance: "已 scaffold DRAFT 骨架（plan_capacity_ramp），施工 = 审批发布/补全参数。",
  status: "OPEN", scaffoldedDrafts: [{ kind: "plan", key: "plan_capacity_ramp" }], createdAt: NOW,
};

async function seedAll(t: TestApp) {
  await t.repos.growthWorklist.upsert(wliSoft);
  await t.repos.growthWorklist.upsert(wliHard);
  await t.repos.growthTickets.upsert(tkFeature);
  await t.repos.growthTickets.upsert(tkSolver);
  await t.repos.growthTickets.upsert(tkPlan);
}

describe("TICKET-CENTER-UNIFIED · 统一工单中心（聚合看板 + 详情清单）", () => {
  it("T1 聚合端点三源 union：统一 kind 标（DATA_GAP/DATA_REQUEST/FEATURE/SOLVER_GAP/PLAN_SCAFFOLD）+ claimable 语义·零造行", async () => {
    const t: TestApp = await createTestApp();
    await seedAll(t);
    const res = await t.app.inject({ method: "GET", url: "/api/v1/growth/board", headers: H(PLANNER) });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { items: TicketBoardRow[] }).items;
    // 零造行：行数 == 真源行数之和（2 worklist + 3 tickets）。
    expect(rows.length).toBe(5);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // 统一 kind 标（kind-first）。
    expect(byId.get("wli_tc_soft")).toMatchObject({ kind: "DATA_GAP", source: "WORKLIST", claimable: true });
    expect(byId.get("wli_tc_hard")).toMatchObject({ kind: "DATA_REQUEST", source: "WORKLIST", claimable: true });
    expect(byId.get("gtk_tc_feat")).toMatchObject({ kind: "FEATURE", source: "GROWTH_TICKET", claimable: false });
    expect(byId.get("gtk_tc_solver")).toMatchObject({ kind: "SOLVER_GAP", source: "GROWTH_TICKET", claimable: false });
    expect(byId.get("gtk_tc_plan")).toMatchObject({ kind: "PLAN_SCAFFOLD", source: "GROWTH_TICKET", claimable: false, deeplink: "/admin/actions" });

    // kind 筛（列表端点统一 kind 标真收窄）。
    const only = await t.app.inject({ method: "GET", url: "/api/v1/growth/board?kind=DATA_REQUEST", headers: H(PLANNER) });
    expect((only.json() as { items: TicketBoardRow[] }).items.map((r) => r.id)).toEqual(["wli_tc_hard"]);
  });

  it("T2 详情清单字段完整性：按类型列举补充内容（fillPlan/边界结论/descriptionSchema/ioContract/scaffoldedDrafts）", async () => {
    const t: TestApp = await createTestApp();
    await seedAll(t);
    const get = async (id: string): Promise<TicketDetail> => {
      const r = await t.app.inject({ method: "GET", url: `/api/v1/growth/tickets/${id}/detail`, headers: H(PLANNER) });
      expect(r.statusCode).toBe(200);
      return r.json() as TicketDetail;
    };
    // DATA_GAP → fillPlan（typeKey/字段/行数/seed）+ B2 模式封闭边界结论。
    const dSoft = await get("wli_tc_soft");
    expect(dSoft.supply.fillPlan).toMatchObject({ mode: "SOFT", action: "fillData", typeKey: "Order", rows: 6, seed: 42 });
    expect(dSoft.supply.fillPlan?.fields).toEqual(["id", "name", "value"]);
    expect(dSoft.supply.boundary?.gate).toContain("B2");
    expect(dSoft.worklistItem?.id).toBe("wli_tc_soft");
    expect(dSoft.timeline.length).toBeGreaterThan(0);
    // DATA_REQUEST → dataRequest 结构化留痕（descriptionSchema 字段清单逐条）+ B3 边界结论 + 导入深链。
    const dHard = await get("wli_tc_hard");
    expect(dHard.row.kind).toBe("DATA_REQUEST");
    expect(dHard.supply.boundary?.gate).toContain("B3");
    expect(dHard.supply.dataRequest?.typeKey).toBe("Supplier");
    expect(dHard.supply.dataRequest?.descriptionSchema?.map((f) => f.field)).toEqual(["字段清单", "值域"]);
    expect(dHard.supply.dataRequest?.description).toBe("供应商主数据");
    expect(dHard.supply.deeplink).toBe("/connections");
    // SOLVER_GAP/FEATURE → ioContract.inputs/outputShape 逐条 + ontologyRefs + acceptance。
    const dSolver = await get("gtk_tc_solver");
    expect(dSolver.row.kind).toBe("SOLVER_GAP");
    expect(dSolver.supply.ioContract?.outputShape).toEqual(["value", "unit", "rows", "provenance"]);
    expect(dSolver.supply.ontologyRefs?.slices).toEqual(["base_line_slice"]);
    expect(dSolver.supply.acceptance).toContain("求解器");
    expect(dSolver.ticket?.id).toBe("gtk_tc_solver");
    // PLAN_SCAFFOLD → scaffoldedDrafts 步序 + 审批深链。
    const dPlan = await get("gtk_tc_plan");
    expect(dPlan.row.kind).toBe("PLAN_SCAFFOLD");
    expect(dPlan.supply.scaffoldedDrafts).toEqual([{ kind: "plan", key: "plan_capacity_ramp" }]);
    expect(dPlan.supply.deeplink).toBe("/admin/actions");
  });

  it("T3 认领跨类型分流不误闸：gtk_ 工单 id 走 worklist claim → 既有 409 WORKLIST_ITEM_READONLY guard 不绕", async () => {
    const t: TestApp = await createTestApp();
    await seedAll(t);
    // board 标 claimable=false 的 GrowthTicket 行，若旧客户端仍误调 worklist claim → 409（不 404 静默、不误认领）。
    const res = await t.app.inject({ method: "POST", url: "/api/v1/growth/worklist/gtk_tc_feat/claim", headers: H(PLANNER) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("WORKLIST_ITEM_READONLY");
    // 真在办项认领仍走通（对照·kind-first 分流）→ 我的在办可聚合（owner=me）。
    const ok = await t.app.inject({ method: "POST", url: "/api/v1/growth/worklist/wli_tc_soft/claim", headers: H(PLANNER) });
    expect(ok.statusCode).toBe(200);
    const mine = await t.app.inject({ method: "GET", url: "/api/v1/growth/board?owner=me", headers: H(PLANNER) });
    expect((mine.json() as { items: TicketBoardRow[] }).items.map((r) => r.id)).toEqual(["wli_tc_soft"]);
  });

  it("T4 R2 租户隔离：跨租户 board 不见他租户工单 / detail 404", async () => {
    const t: TestApp = await createTestApp();
    await seedAll(t);
    const OTHER = "other-tenant:user-x:planner";
    const board = await t.app.inject({ method: "GET", url: "/api/v1/growth/board", headers: H(OTHER) });
    expect((board.json() as { items: TicketBoardRow[] }).items.length).toBe(0);
    const detail = await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets/wli_tc_soft/detail", headers: H(OTHER) });
    expect(detail.statusCode).toBe(404);
  });

  it("T5 manifest requires 投影：fromQuestion 携 solver 入口 entryRef → detail 经 checkReadiness 实测 present-vs-needed 逐条", async () => {
    const t: TestApp = await createTestApp();
    const w: WorklistItem = {
      ...wliSoft, id: "wli_tc_readiness", fromQuestion: "solver:capacity_forecast|world-empty",
      evidence: "[solver:capacity_forecast|world-empty] 空世界（2 个角色全 0 行）",
      fillPlan: { mode: "SOFT", action: "provisionWorld", seed: 42 },
    };
    await t.repos.growthWorklist.upsert(w);
    const spy = vi.spyOn(t.dataCore.solver, "checkReadiness").mockResolvedValue({
      entryRef: "solver:capacity_forecast", ready: false,
      roles: [
        { roleType: "base", resolvedType: "Base", present: 0, needed: 1, ok: false },
        { roleType: "order", resolvedType: "Order", present: 3, needed: 1, ok: true },
      ],
      missingParams: [], gaps: [], generatedAt: NOW,
    });
    const res = await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets/wli_tc_readiness/detail", headers: H(PLANNER) });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), "capacity_forecast");
    const d = res.json() as TicketDetail;
    expect(d.supply.requires).toEqual([
      { roleType: "base", resolvedType: "Base", needed: 1, present: 0, ok: false },
      { roleType: "order", resolvedType: "Order", needed: 1, present: 3, ok: true },
    ]);
  });
});
