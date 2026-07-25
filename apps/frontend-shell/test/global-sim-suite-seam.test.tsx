import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { mockGlobalSim } from "@/mocks/simSolvers";

/**
 * WO-GLOBALSIM-SUITE · 前端 SEAM（②③④⑤⑥·展示/路由/真驱动 → 真求解 arg → 响应上屏·非前端假过滤/写死）。
 *
 * 头号判据（KILL-MOCK-RED）：改开关/旋钮/交期 → 请求真携新 arg（后端真重算）+ 响应字段真上屏；② 产线来自真 Line 对象；
 * ⑥ 客户卡 → 真项目详情路由（无死按钮）。引擎侧 ③④⑤ 真变已由 datacore global-sim-var-seam 守（此处守前端接线）。
 */

const PROV = (drillType: string, drillId: string, drillField: string, drillValue: number) => ({ kind: "派生", drillType, drillId, drillField, drillValue });

/** 装一个记录请求 args 的 portfolio 求解桩（记录后仍返真 mockGlobalSim·响应字段真上屏）。 */
function spyPortfolio(): { last: () => Record<string, unknown> | null } {
  let last: Record<string, unknown> | null = null;
  server.use(http.post("*/b/v1/solvers/portfolio/run", async ({ request }) => {
    const body = (await request.json()) as { args: Record<string, unknown> };
    last = body.args;
    return HttpResponse.json({ data: mockGlobalSim(body.args), snapshotVersion: "ov-spy" });
  }));
  return { last: () => last };
}

describe("WO-GLOBALSIM-SUITE · ② G-UI-2 每订单基地 + 产线（真 Line 对象·非占位）", () => {
  it("订单清单 + 分配台账每单显示 base + line（line 来自真 Line 对象·非写死占位）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // 订单行显示基地 + 产线（产线名来自真 Line 对象·含「线」·非「—」占位）。
    const baseCell = await screen.findByTestId("global-sim-order-base-SO-10001");
    const lineCell = screen.getByTestId("global-sim-order-line-SO-10001");
    expect(baseCell.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(baseCell.textContent).not.toBe("—");
    expect(lineCell.textContent).toContain("线"); // 真 Line 名（如「常州PACK线」）
    expect(lineCell.textContent).not.toBe("—");

    // 分配台账也带产线列（真数据）。
    const allocLine = await screen.findByTestId("global-sim-alloc-line-SO-10001");
    expect(allocLine.textContent).toContain("线");
    expect(allocLine.textContent).not.toBe("—");
  });
});

describe("WO-GLOBALSIM-SUITE · ⑥ G-UI-3 客户卡 → 真项目详情路由（去死按钮）", () => {
  const withDisplaced = {
    status: "OPTIMAL", optimal: true, feasible: false, reconciled: true,
    allocation: [{ item: "SO-10002", kind: "order", committed: false, base: "xiamen", baseName: "厦门", window: 0, windowStartDay: 0, qty: 800, model: "4680-LFP", delayDays: 0, onTime: true, provenance: PROV("Order", "SO-10002", "qty", 800) }],
    displaced: [{ orderId: "SO-10001", kind: "order", qty: 1500, model: "4680-NCM", provenance: PROV("Order", "SO-10001", "qty", 1500) }],
    scenarios: [{ key: "max_ontime", objectiveValues: { ontime: 1, delay: 0, changeover: 0, fgInventory: 0, cost: 20 }, servedCount: 1, displacedCount: 1, servedQty: 800 }],
    objectiveValues: { ontime: 1, delay: 0, changeover: 0, fgInventory: 0, cost: 20 },
    capacityLedger: [{ baseId: "xiamen", window: 0, cap: 5000, allocated: 800 }],
    reconChecks: [{ ok: true }], cost: { delay: 0, changeover: 0, unserved: 100, total: 100 },
    frozen: [], summary: "⑥ SEAM：被挤 1 单。",
  };

  it("客户卡指向真项目详情路由 + 「协调加产」是预览→确认（非点了即提交的鲁莽/死按钮）", async () => {
    const user = userEvent.setup();
    server.use(http.post("*/b/v1/solvers/portfolio/run", () => HttpResponse.json({ data: withDisplaced, snapshotVersion: "ov-6" })));
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    // 客户卡整卡指向该客户项目详情（真路由·ProjectSimView 按 ?order= 反查真 Order）。
    const card = await screen.findByTestId("global-sim-impact-SO-10001");
    expect(card.getAttribute("data-impact-link")).toContain("/v/project-sim?order=SO-10001");
    expect(within(card).getByTestId("global-sim-impact-cust-SO-10001").textContent?.length ?? 0).toBeGreaterThan(0);

    // 「协调加产」死按钮改真动作：点击先弹**预览 Modal**（订单/客户）→ 非点了即盲提交。
    expect(screen.queryByTestId("global-sim-coord-preview")).not.toBeInTheDocument();
    await user.click(within(card).getByTestId("global-sim-impact-coord-SO-10001"));
    const modal = await screen.findByTestId("global-sim-coord-preview");
    expect(within(modal).getByTestId("global-sim-coord-order").textContent).toContain("SO-10001");
    // 点协调加产不误触整卡跳转（stopPropagation·仍在全局页）。
    expect(screen.getByTestId("global-sim")).toBeInTheDocument();
  });

  it("点客户卡 → 真跳该客户项目详情页（数据一致·非假跳转）", async () => {
    const user = userEvent.setup();
    server.use(http.post("*/b/v1/solvers/portfolio/run", () => HttpResponse.json({ data: withDisplaced, snapshotVersion: "ov-6b" })));
    loginAs("planner");
    renderApp("/v/global-sim");
    const card = await screen.findByTestId("global-sim-impact-SO-10001");
    await user.click(card);
    // 跳到项目推演页并识别自全局页下钻的 SO-10001（真数据一致·ProjectSimView 反查真 Order）。
    await waitFor(() => expect(screen.getByTestId("proj-from-global").textContent).toContain("SO-10001"));
  });

  it("协调加产 预览→确认 → plan_change 草稿真携 versionId + reason（后端 paramsSchema required·真 bug 修）", async () => {
    const user = userEvent.setup();
    let draftBody: { actionTypeKey?: string; payload?: Record<string, unknown> } | null = null;
    server.use(
      http.post("*/b/v1/solvers/portfolio/run", () => HttpResponse.json({ data: withDisplaced, snapshotVersion: "ov-6c" })),
      http.post("*/a/v1/action-drafts", async ({ request }) => {
        draftBody = (await request.json()) as { actionTypeKey?: string; payload?: Record<string, unknown> };
        return HttpResponse.json({ draftId: "drf-1", status: "PENDING_APPROVAL" });
      }),
    );
    loginAs("planner");
    renderApp("/v/global-sim");
    const card = await screen.findByTestId("global-sim-impact-SO-10001");
    await user.click(within(card).getByTestId("global-sim-impact-coord-SO-10001"));
    await screen.findByTestId("global-sim-coord-preview");
    await user.click(screen.getByTestId("global-sim-coord-confirm"));
    // plan_change 非 global-sim payload → 必带 versionId + reason（缺则后端 VALIDATION_ERROR）。
    await waitFor(() => expect(draftBody).not.toBeNull());
    expect(draftBody!.actionTypeKey).toBe("plan_change");
    expect(typeof draftBody!.payload!.versionId).toBe("string");
    expect(String(draftBody!.payload!.versionId)).toContain("SO-10001");
    expect(typeof draftBody!.payload!.reason).toBe("string");
    expect(String(draftBody!.payload!.reason).length).toBeGreaterThan(0);
  });
});

describe("WO-GLOBALSIM-SUITE · ③ G-VAR-1 分批交付开关 → 真携 splitOrderIds（后端真重算·非前端假过滤）", () => {
  it("勾选某单分批 → 求解请求真携 splitOrderIds=[该单]（切开关驱动真 arg）", async () => {
    const user = userEvent.setup();
    const spy = spyPortfolio();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    await waitFor(() => expect(spy.last()).not.toBeNull());
    expect((spy.last()!.splitOrderIds as unknown) ?? undefined).toBeUndefined(); // 初始未分批

    await user.click(screen.getByTestId("global-sim-split-SO-10001"));
    await waitFor(() => expect((spy.last()!.splitOrderIds as string[] | undefined)?.includes("SO-10001")).toBe(true));
    // 取消 → arg 撤回（真开关·非写死）。
    await user.click(screen.getByTestId("global-sim-split-SO-10001"));
    await waitFor(() => expect((spy.last()!.splitOrderIds as unknown) ?? undefined).toBeUndefined());
  });
});

describe("WO-GLOBALSIM-SUITE · ④ G-VAR-2 最终交期 → 真携 finalDueDays + 目标vs可达交期推演上屏", () => {
  it("设某单最终交期 → 请求真携 finalDueDays + dueComparison 表上屏（目标/可达/差·真求解产物）", async () => {
    const user = userEvent.setup();
    const spy = spyPortfolio();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    await waitFor(() => expect(spy.last()).not.toBeNull());
    expect(screen.queryByTestId("global-sim-duecompare")).not.toBeInTheDocument(); // 未设 → 无推演

    const input = screen.getByTestId("global-sim-finaldue-SO-10001");
    await user.clear(input);
    await user.type(input, "60");
    // 请求真携 finalDueDays（后端真放宽最晚窗）。
    await waitFor(() => expect((spy.last()!.finalDueDays as Record<string, number> | undefined)?.["SO-10001"]).toBe(60));
    // 目标 vs 最终可达交期推演表上屏（真求解产物·SO-10001 行含目标/可达/差）。
    const dc = await screen.findByTestId("global-sim-duecompare");
    const row = within(dc).getByTestId("global-sim-duecompare-SO-10001");
    expect(within(row).getByTestId("global-sim-achievable-SO-10001").textContent?.length ?? 0).toBeGreaterThan(0);
    expect(within(row).getByTestId("global-sim-gap-SO-10001").textContent).toMatch(/[0-9+-]/); // 差为真算数字
  });
});

describe("WO-GLOBALSIM-SUITE · ⑤ G-VAR-3 方法旋钮 → 真携 method 参数 + methodScenario 上屏（三法真重解）", () => {
  it("切字典序 → 请求真携 method=lexicographic + priority + methodScenario 上屏；调权重 → 携 methodWeights", async () => {
    const user = userEvent.setup();
    const spy = spyPortfolio();
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    await waitFor(() => expect(spy.last()).not.toBeNull());

    // 切到字典序方法（左轨）→ 请求 method=lexicographic + priority；methodScenario 联合方案上屏。
    await user.click(screen.getByTestId("global-sim-lever-method-lexicographic"));
    await waitFor(() => expect(spy.last()!.method).toBe("lexicographic"));
    expect(Array.isArray(spy.last()!.priority)).toBe(true);
    const ms = await screen.findByTestId("global-sim-methodscenario");
    expect(ms.getAttribute("data-method")).toBe("lexicographic");
    expect(screen.getByTestId("global-sim-method-lexicographic")).toBeInTheDocument(); // 字典序旋钮区渲染

    // 切回加权 + 调权重（拉 ontime 权重离默认 1）→ 请求真携 methodWeights（改旋钮 → 真 arg·非旋钮空转）。
    await user.click(screen.getByTestId("global-sim-lever-method-weighted"));
    const slider = screen.getByTestId("global-sim-weight-ontime") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "5" } }); // range·直接改值（jsdom 拖动等价）
    await waitFor(() => {
      const mw = spy.last()!.methodWeights as Record<string, number> | undefined;
      expect(mw?.ontime).toBe(5); // 改权重 → 真携 methodWeights.ontime=5
    });
    expect(screen.getByTestId("global-sim-weight-val-ontime").textContent).toBe("5.0");
  });
});
