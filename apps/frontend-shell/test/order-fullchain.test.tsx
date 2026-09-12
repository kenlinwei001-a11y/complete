import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * ORD（order 视图 1:1 复刻）：订单全链推演面板（order_fullchain）——订单选择器 + 统一结论（三色）+
 * 三判明细 + 11 节点业务建模链 DAG + 采纳→Action。问题归并 4 类作超集保留在下方（f23 不破）。
 */
describe("ORD · 订单全链推演面板（order_fullchain）", () => {
  it("ofc 面板：统一结论 + 三判明细表 + 11 节点 DAG + 采纳按钮；问题归并超集仍在", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    const panel = await screen.findByTestId("ofc-panel");
    // 统一结论（三色）——等求解器查询解析
    expect((await within(panel).findByTestId("ofc-verdict")).textContent).toContain("提价3%接");
    // 三判明细表（交期/齐套/财务三闸规则）
    const judges = within(panel).getByTestId("ofc-judges");
    expect(judges.textContent).toContain("C02");
    expect(judges.textContent).toContain("C06");
    expect(judges.textContent).toContain("C18");
    // 11 节点业务建模链 DAG
    expect(within(panel).getByTestId("ofc-dag")).toBeTruthy();
    // 采纳按钮
    expect(within(panel).getByTestId("ofc-adopt")).toBeTruthy();
    // 超集：问题归并 4 类仍在
    expect(screen.getByTestId("oc-problems")).toBeTruthy();
  });

  it("WO-PLAN-CHANGE-LEVER-MAP：采纳结论 → plan_change 草稿带**真域映射 levers**（提价3% → Order.unitPrice × 1.03）", async () => {
    const user = userEvent.setup();
    let draftBody: { actionTypeKey?: string; payload?: Record<string, unknown> } | null = null;
    server.use(
      http.post("*/a/v1/action-drafts", async ({ request }) => {
        draftBody = (await request.json()) as { actionTypeKey?: string; payload?: Record<string, unknown> };
        return HttpResponse.json({ draftId: "drf-ofc-1", status: "PENDING_APPROVAL" });
      }),
    );
    loginAs("planner");
    renderApp("/v/order-chain");
    const panel = await screen.findByTestId("ofc-panel");
    await within(panel).findByTestId("ofc-verdict"); // 等求解器响应上屏（verdict 提价3%接）
    await user.click(within(panel).getByTestId("ofc-adopt"));

    await waitFor(() => expect(draftBody).not.toBeNull());
    expect(draftBody!.actionTypeKey).toBe("plan_change");
    expect(String(draftBody!.payload!.versionId)).toBe("order-chain:SO-10001");
    // 判据在 payload **形状**（{objectId,prop,value}）：mock 案例 = 交期可达（1260 ≥ 800→无对冲杠杆）+
    // 财务「需提价3%」→ unitPrice 22000（mock ORDERS·ord-001·4680-NCM）× 1.03 = 22660。
    // 缺了 levers，后端 applyLeverWrites 进不去、草稿落回诚实失败（G-PLAN-CHANGE-NO-LEVER 回潮）。
    expect(draftBody!.payload!.levers).toEqual([
      { objectType: "Order", objectId: "ord-001", prop: "unitPrice", value: 22660 },
    ]);
  });
});
