import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-ORDERCHAIN-DAG-DRILL 齿检（死交互治本·防再退回静态 <g>）：
 * 「排产推动/瓶颈紧张 · 逐单根因链（订单→判定→根因→对策）」弹窗每块必须**可下钻**——
 * 后端每层派 typed ref（order|judge|risk|action）→ 前端 ProblemDag 传 onNodeClick 分层路由。
 *
 * 牙齿：若还原（ProblemDag 去掉 onNodeClick），LayeredDag 节点失去 role="button"/tabIndex →
 *       下方 getByRole/toHaveAttribute 断言转红；order/rootCause 点击不再改变路由 → 导航断言转红。
 */
describe("WO-ORDERCHAIN-DAG-DRILL · 根因链节点分层下钻", () => {
  async function openProblemDag() {
    loginAs("planner");
    const { router } = renderApp("/v/order-chain");
    // 待解决问题卡（DELIVERY 类·mock 首链 SO-10001）→ 点开根因链弹窗
    const card = await screen.findByTestId("oc-problem-DELIVERY");
    fireEvent.click(card);
    const dag = await screen.findByTestId("problem-dag");
    return { router, dag };
  }

  it("四层节点均 role=button + tabIndex=0（不再是静态 <g> 空操作）", async () => {
    const { dag } = await openProblemDag();
    for (const kind of ["order", "judgement", "rootCause", "remedy"]) {
      const node = within(dag).getByTestId(`problem-dag-node-0-${kind}`);
      expect(node.getAttribute("role")).toBe("button"); // 牙齿：去 onNodeClick → 无 role → 红
      expect(node.getAttribute("tabindex")).toBe("0");
    }
  });

  it("order 层下钻 → 订单 360 /o/Order/{so}", async () => {
    const { router, dag } = await openProblemDag();
    fireEvent.click(within(dag).getByTestId("problem-dag-node-0-order"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/Order/SO-10001"));
  });

  it("rootCause 层下钻 → 风险看板对应瓶颈类 /v/risk?category=...&focus=...", async () => {
    const { router, dag } = await openProblemDag();
    fireEvent.click(within(dag).getByTestId("problem-dag-node-0-rootCause"));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/v/risk");
      const qs = new URLSearchParams(router.state.location.search);
      expect(qs.get("category")).toBe("push"); // DELIVERY 首链 ref.risk.key
      expect(qs.get("focus")).toBe("常州基地"); // ref.extra.base → 触发下钻返回
    });
  });

  it("judgement 层下钻 → 关弹窗 + 全链推演面板聚焦（judge=cap 高亮）", async () => {
    const { dag } = await openProblemDag();
    fireEvent.click(within(dag).getByTestId("problem-dag-node-0-judgement"));
    // 关根因链弹窗 → 全链三判面板本页可见（滚动定位 + 对应判高亮由 focus 信号驱动）
    await waitFor(() => expect(screen.queryByTestId("problem-dag")).not.toBeInTheDocument());
    // OFC 面板因 so 切换（judge 下钻设为 SO-10001）触发新 query key 重取 → 放宽等待覆盖 refetch loading。
    expect(await screen.findByTestId("ofc-judge-row-cap", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("ofc-dag 节点亦可下钻（order 建模链节点 role=button + order 节点跳 360）", async () => {
    loginAs("planner");
    const { router } = renderApp("/v/order-chain");
    const ofcDag = await screen.findByTestId("ofc-dag");
    // 订单节点（mock 首单 SO-10001）role=button + 点击 → 订单 360
    const orderNode = await within(ofcDag).findByTestId("ofc-dag-node-order:SO-10001");
    expect(orderNode.getAttribute("role")).toBe("button");
    fireEvent.click(orderNode);
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/Order/SO-10001"));
  });
});
