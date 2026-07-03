import { describe, expect, it, vi } from "vitest";
import type { SubmitQueryBody, WorklistItem } from "@platform/contracts";
import { SubmitQueryBodySchema } from "@platform/contracts";
import { createTestApp, PKG, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { buildGrowthLoopWiring } from "../src/growth/scenario-grow.js";
import type { RequestAuth } from "../src/auth.js";

/**
 * GROWTH-WORKLIST-HUMAN-FILL 齿轮测试：自成长发动机去自动补 → 登记在办项（人工闸控补）。
 *  - T1 治本齿：SOFT 缺数据 fill(registerWorklist) **不自动跑** fillData → 登记 WorklistItem(OPEN·DATA_GAP·needsHuman)。revert（去掉 registerWorklist 门控）→ 红。
 *  - T2 人工触发闭环：claim(owner=actor) → CLAIMED；fill → 真跑 fillData（R6 seed 确定性）→ DONE；未认领 fill → 403。
 *  - T3 R2 隔离：跨租户看不到/取不到在办项。
 */
const H = (user: string) => ({ "x-debug-user": user, "content-type": "application/json" });

function neutralBody(query: string): SubmitQueryBody {
  return SubmitQueryBodySchema.parse({ packageId: PKG, query, context: { view: "dash", selectedObjects: [], filters: {} } });
}

describe("GROWTH-WORKLIST-HUMAN-FILL · 去自动补·人工闸控补", () => {
  it("T1 治本齿：SOFT 缺数据 fill(registerWorklist) 不自动跑 fillData/provisionWorld → 登记在办项(OPEN·DATA_GAP·needsHuman)", async () => {
    const t: TestApp = await createTestApp();
    const fillSpy = vi.spyOn(t.dataCore.ontology, "fillData");
    const provSpy = vi.spyOn(t.dataCore.ontology, "provisionWorld");
    const auth: RequestAuth = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    const body = neutralBody("给我一份通用统计"); // 无业务实体词 → decideDataGap=SOFT
    const wiring = buildGrowthLoopWiring(t.deps, auth, body, async () => {}, { registerWorklist: true });

    const res = await wiring.fill({ gapCode: "EMPTY_DATA", evidence: "切片返回空集", suggestedFill: "合成", blocking: true });
    // 不自动补：advanced=false + needsHuman + 未真跑 fillData/provisionWorld。
    expect(res.advanced).toBe(false);
    expect(res.needsHuman).toBe(true);
    expect(res.worklistItemId).toBeTruthy();
    expect(fillSpy).not.toHaveBeenCalled();
    expect(provSpy).not.toHaveBeenCalled();

    // 登记出在办项（OPEN·DATA_GAP·带 fillPlan）。
    const items = await t.repos.growthWorklist.listByTenant(TENANT);
    expect(items.length).toBe(1);
    const w = items[0]!;
    expect(w.status).toBe("OPEN");
    expect(w.kind).toBe("DATA_GAP");
    expect(w.fillPlan?.mode).toBe("SOFT");
    expect(["fillData", "provisionWorld"]).toContain(w.fillPlan?.action);
  });

  it("T2 人工触发闭环：未认领 fill→403；claim→CLAIMED；fill→真跑 fillData(seed 确定性)→DONE", async () => {
    const t: TestApp = await createTestApp();
    const now = new Date().toISOString();
    const seed: WorklistItem = {
      id: "wli_test_1", tenantId: TENANT, fromQuestion: "给我一份通用统计", gapCode: "EMPTY_DATA",
      kind: "DATA_GAP", status: "OPEN", evidence: "空集",
      fillPlan: { mode: "SOFT", action: "fillData", typeKey: "Order", fields: ["id", "name", "value"], rows: 6, seed: 42 },
      createdAt: now, updatedAt: now,
    };
    await t.repos.growthWorklist.upsert(seed);

    // 未认领直接 fill → 403（非 owner，R4 认领人才可触发）。
    const forbidden = await t.app.inject({ method: "POST", url: "/api/v1/growth/worklist/wli_test_1/fill", headers: H(PLANNER) });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("NOT_WORKLIST_OWNER");

    // 认领 → owner=actor(user-planner) · CLAIMED · 发 growth.fill_claimed。
    const claimed = await t.app.inject({ method: "POST", url: "/api/v1/growth/worklist/wli_test_1/claim", headers: H(PLANNER) });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().status).toBe("CLAIMED");
    expect(claimed.json().owner).toBe("user-planner");

    // 认领人触发补数据缺口 → 真跑 fillData（R6 seed=42 确定性）→ DONE。
    const fillSpy = vi.spyOn(t.dataCore.ontology, "fillData");
    const filled = await t.app.inject({ method: "POST", url: "/api/v1/growth/worklist/wli_test_1/fill", headers: H(PLANNER) });
    expect(filled.statusCode).toBe(200);
    expect(filled.json().status).toBe("DONE");
    expect(fillSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ typeKey: "Order", seed: 42, rows: 6 }));
    expect(filled.json().result).toContain("Order");

    // 事件：growth.fill_claimed + growth.fill_triggered 经 outbox 馈源。
    const evts = (await t.app.inject({ method: "GET", url: "/b/v1/outbox", headers: H(PLANNER) }).then((r) => r.json())) as { event: string }[];
    const names = new Set(evts.map((e) => e.event));
    expect(names.has("growth.fill_claimed")).toBe(true);
    expect(names.has("growth.fill_triggered")).toBe(true);
  });

  it("T3 R2 隔离：另一租户列/取不到本租户在办项", async () => {
    const t: TestApp = await createTestApp();
    const now = new Date().toISOString();
    await t.repos.growthWorklist.upsert({ id: "wli_iso", tenantId: TENANT, fromQuestion: "q", gapCode: "EMPTY_DATA", kind: "DATA_GAP", status: "OPEN", evidence: "e", createdAt: now, updatedAt: now });
    // 跨租户 get → undefined。
    expect(await t.repos.growthWorklist.get("other-tenant", "wli_iso")).toBeUndefined();
    // 跨租户 list 空。
    const other = await t.app.inject({ method: "GET", url: "/b/v1/growth/worklist", headers: H("other-tenant:user-x:planner") });
    expect((other.json() as { items: WorklistItem[] }).items.find((i) => i.id === "wli_iso")).toBeUndefined();
  });
});
