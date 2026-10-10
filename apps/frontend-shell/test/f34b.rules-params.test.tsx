import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * P3-a 规则即引用：编辑器 params（命名阈值）可编辑闭环。
 * P2 让 RuleRef tooltip 显示 params；P3 让 params 在编辑器增/删/改 + 经 PUT/POST 落库 + dry-run 用上。
 */
describe("F34b · 规则编辑器命名阈值（params）可编辑闭环", () => {
  it("新建规则：增 params 行 + 改键值 → 保存经 POST 入库（params 落库）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    await user.click(screen.getByTestId("rule-create"));
    await user.type(screen.getByTestId("rule-key-input"), "P01");
    await user.type(screen.getByTestId("rule-name-input"), "带阈值规则");
    await user.type(screen.getByTestId("rule-expression"), "Order.qty > maxQty");

    // 初始无 params 行 → 点 + 阈值新增一行 → 填 key/value
    await user.click(screen.getByTestId("rule-param-add"));
    await user.type(screen.getByTestId("rule-param-key-0"), "maxQty");
    await user.type(screen.getByTestId("rule-param-value-0"), "50");

    await user.click(screen.getByTestId("rule-save"));
    await waitFor(() => {
      const created = db.rules.find((r) => r.key === "P01");
      expect(created?.params).toEqual({ maxQty: 50 });
      expect(created?.status).toBe("DRAFT");
    });
  });

  it("删除 params 行 → 该键不入库", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    await user.click(screen.getByTestId("rule-create"));
    await user.type(screen.getByTestId("rule-key-input"), "P02");
    await user.type(screen.getByTestId("rule-name-input"), "两阈值删一");
    await user.type(screen.getByTestId("rule-expression"), "Order.qty > maxQty");

    await user.click(screen.getByTestId("rule-param-add"));
    await user.type(screen.getByTestId("rule-param-key-0"), "maxQty");
    await user.type(screen.getByTestId("rule-param-value-0"), "50");
    await user.click(screen.getByTestId("rule-param-add"));
    await user.type(screen.getByTestId("rule-param-key-1"), "minQty");
    await user.type(screen.getByTestId("rule-param-value-1"), "10");
    // 删除第二行（minQty）
    await user.click(screen.getByTestId("rule-param-del-1"));

    await user.click(screen.getByTestId("rule-save"));
    await waitFor(() => {
      const created = db.rules.find((r) => r.key === "P02");
      expect(created?.params).toEqual({ maxQty: 50 });
    });
  });

  it("dry-run 把命名阈值并入载荷：maxQty=50 + Order.qty=100 → 命中违规条件", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    await user.click(screen.getByTestId("rule-create"));
    // expression 用裸标识符 maxQty —— 仅当 params 并入载荷时才能解析求值。
    await user.type(screen.getByTestId("rule-expression"), "maxQty > 50");
    await user.click(screen.getByTestId("rule-param-add"));
    await user.type(screen.getByTestId("rule-param-key-0"), "maxQty");
    await user.type(screen.getByTestId("rule-param-value-0"), "100");
    const payload = screen.getByTestId("dry-run-payload");
    fireEvent.change(payload, { target: { value: "{}" } });
    await user.click(screen.getByTestId("dry-run-button"));
    expect(await screen.findByTestId("dry-run-result")).toHaveTextContent("命中违规条件");
  });
});
