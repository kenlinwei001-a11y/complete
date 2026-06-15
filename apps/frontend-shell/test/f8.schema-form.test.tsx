import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonSchemaForm } from "@/components/JsonSchemaForm/JsonSchemaForm";
import { CONNECTOR_TYPES } from "@/mocks/fixtures";
import { loginAs, renderApp } from "./utils";

describe("F8 · 连接器向导动态表单 + 字段画像", () => {
  it("configSchema → 表单生成（string/number/boolean/enum/secret），secret 不回显", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema = CONNECTOR_TYPES[0]!.configSchema;
    const { rerender } = render(<JsonSchemaForm schema={schema} value={{}} onChange={onChange} />);

    // secret → password 输入
    const pwd = screen.getByLabelText(/密码/);
    expect(pwd).toHaveAttribute("type", "password");
    // enum → 下拉
    expect(screen.getByLabelText(/环境/)).toBeInstanceOf(HTMLSelectElement);
    // boolean → checkbox
    expect(screen.getByLabelText(/启用 TLS/)).toHaveAttribute("type", "checkbox");
    // 必填星标
    expect(screen.getByText("主机").parentElement?.textContent).toContain("*");

    await user.type(screen.getByLabelText(/主机/), "sap.example.com");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ host: expect.any(String) }));

    // 已保存的 secret 不回显：占位提示且值为空
    rerender(<JsonSchemaForm schema={schema} value={{}} onChange={onChange} savedSecrets={["password"]} />);
    const savedPwd = screen.getByLabelText(/密码/) as HTMLInputElement;
    expect(savedPwd.value).toBe("");
    expect(savedPwd.placeholder).toContain("不回显");
  });

  it("字段画像页：类型徽章 / 枚举候选 chips / 空值率条 / 时序数据集标记", async () => {
    loginAs("planner");
    renderApp("/admin/connections/conn-erp/schema");

    const ds = await screen.findByTestId("dataset-orders.csv");
    const custRow = within(ds).getByTestId("field-customer");
    expect(within(custRow).getByText("string")).toBeInTheDocument();
    expect(within(custRow).getAllByText(/蔚途汽车/).length).toBeGreaterThanOrEqual(1); // enum chip
    expect(within(custRow).getByText("2%")).toBeInTheDocument(); // 空值率

    // TIMESERIES 数据集标记（A8.1）
    const tsDs = screen.getByTestId("dataset-oee_points.csv");
    expect(within(tsDs).getByText("TIMESERIES")).toBeInTheDocument();
  });
});
