import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProviders } from "@/App";
import { Provenance } from "@/components/Provenance";
import { loginAs } from "./utils";

/**
 * 活数据可溯 P3（PRD-live-traceable-data §3.3）回归：
 * 推演结论里的数据悬浮 → 弹出"引用来源"（来源连接器 / 原始表 / 派生口径），数据来自 lineage 端点。
 * 兑现用户诉求："结论中的数据，鼠标悬浮则弹框展示引用的来源"。
 */
describe("Provenance · 数据悬浮溯源", () => {
  it("悬浮带溯源的数据 → 弹出来源连接器 + 原始表 + 派生口径", async () => {
    const user = userEvent.setup();
    loginAs("planner"); // lineage 端点需登录态（OBO）
    render(
      <AppProviders>
        <Provenance objectType="Order" objectId="obj_order_SO-1" rule="C15" inputs={["qty", "unitPrice"]} note="接单毛利口径">
          <b>SO-1</b>
        </Provenance>
      </AppProviders>,
    );
    // 默认不显示溯源框
    expect(screen.queryByTestId("prov-tip")).toBeNull();
    // 悬浮 → 懒加载 lineage → 弹框
    await user.hover(screen.getByTestId("prov-Order-obj_order_SO-1"));
    // 悬浮先显"溯源中…"，待 lineage 异步加载后弹出来源
    await waitFor(() => expect(screen.getByTestId("prov-tip").textContent).toContain("合成数据源"));
    const tip = screen.getByTestId("prov-tip");
    expect(tip.textContent).toContain("Order"); // ① 原始表名
    expect(tip.textContent).toContain("value"); // ③ 推导公式
    expect(tip.textContent).toContain("qty"); // ④ 输入因子（作者标注）
    expect(screen.getByTestId("prov-rule").textContent).toContain("C15"); // ⑤ 关联规则
    expect(tip.textContent).toContain("接单毛利口径"); // ⑥ 备注
    // ② 新鲜度：mock lastSyncAt 为 5h 前 → 降级标注
    expect(screen.getByTestId("prov-fresh").textContent).toContain("降级");
  });
});
