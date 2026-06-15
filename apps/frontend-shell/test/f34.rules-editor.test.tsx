import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

describe("F34 · 规则手工管理（管理平台 §5）", () => {
  it("规则表：来源徽章 MANUAL|DOCUMENT|SYNTHETIC + 版本/状态", async () => {
    loginAs("planner");
    renderApp("/admin/rules");
    expect(await screen.findByTestId("rule-origin-C03")).toHaveTextContent("DOCUMENT");
    expect(screen.getByTestId("rule-origin-C08")).toHaveTextContent("MANUAL");
    expect(screen.getByTestId("rule-origin-C13")).toHaveTextContent("SYNTHETIC");
  });

  it("编辑器：非法 expression dry-run → 内联语法错误定位字符位；合法 → 即时求值", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    await user.click(screen.getByTestId("rule-create"));
    const expr = screen.getByTestId("rule-expression");

    // 非法：@@ → 错误定位到字符位（mock 返回 position = indexOf("@@")）
    await user.type(expr, "Order.qty @@ 5");
    await user.click(screen.getByTestId("dry-run-button"));
    const errBadge = await screen.findByTestId("rule-syntax-error");
    expect(errBadge).toHaveTextContent("语法错误 @ 字符 10");

    // 合法 + 样例载荷 → 即时求值（违规命中）
    await user.clear(expr);
    await user.type(expr, "Order.qty > 50");
    const payload = screen.getByTestId("dry-run-payload");
    fireEvent.change(payload, { target: { value: '{"Order":{"qty":100}}' } });
    await user.click(screen.getByTestId("dry-run-button"));
    expect(await screen.findByTestId("dry-run-result")).toHaveTextContent("命中违规条件");
  });

  it("新建规则保存（origin=MANUAL DRAFT）→ 入表", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");
    await screen.findByTestId("rule-origin-C03");

    await user.click(screen.getByTestId("rule-create"));
    await user.type(screen.getByTestId("rule-key-input"), "C99");
    await user.type(screen.getByTestId("rule-name-input"), "手工新规则");
    await user.type(screen.getByTestId("rule-expression"), "Order.qty > 999");
    await user.click(screen.getByTestId("rule-save"));
    await waitFor(() => {
      const created = db.rules.find((r) => r.key === "C99");
      expect(created?.origin.type).toBe("MANUAL");
      expect(created?.status).toBe("DRAFT");
    });
    expect(await screen.findByTestId("rule-origin-C99")).toHaveTextContent("MANUAL");
  });
});
