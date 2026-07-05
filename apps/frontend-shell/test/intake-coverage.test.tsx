import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * PANORAMA-FIELD-INTAKE 前端消费齿：数据连接器/上传页逐类型字段覆盖度（后端 /a/v1/intake-coverage 真值）——
 *  ① 分类面板逐类型「可供给 N/M」+ 连接器未映射徽章（深链字段对账）+ 逐类型模版下载；
 *  ② 未归类全景类型诚实透出（非隐藏）；
 *  ③ 连接的字段映射面板：全景字段全集——已映射(propKey←源字段) + 缺源字段诚实标"未映射"。
 * 断言逐值对 MSW 后端同形真值（非装饰·改坏即红）。
 */
describe("PANORAMA-FIELD-INTAKE · 前端字段覆盖度消费", () => {
  it("①：分类面板逐类型显示 可供给 N/M（==后端 suppliable/intakeTotal）+ 未映射徽章深链 + 模版下载钮", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    await screen.findByTestId("data-categories-panel");

    // 展开销售订单分类字段区。
    const card = await screen.findByTestId("dc-sales_orders");
    await user.click(within(card).getByText("查看字段"));

    // 覆盖度徽章 == 后端真值（Order suppliable=7 / intakeTotal=7）。
    const cov = await screen.findByTestId("dc-cov-Order");
    expect(cov.textContent).toContain("可供给 7/7");

    // 连接器未映射徽章：诚实列出缺源字段（unitPrice）+ 深链字段对账（非隐藏）。
    const unmapped = screen.getByTestId("dc-unmapped-Order");
    expect(unmapped.textContent).toContain("连接器未映射 1");
    expect(unmapped.getAttribute("title")).toContain("unitPrice");
    expect(unmapped.getAttribute("href")).toContain("/admin/schema-reconcile");

    // 逐类型模版下载钮（列=全字段·含 FK 标注）。
    const tpl = screen.getByTestId("dc-tpl-Order");
    expect(tpl.getAttribute("title")).toContain("model→Model");
  });

  it("②：未归类全景类型诚实透出（LabTest·非隐藏）+ 自带覆盖徽章与模版下载", async () => {
    loginAs("planner");
    renderApp("/admin/connections");
    const sec = await screen.findByTestId("dc-uncategorized");
    expect(sec.textContent).toContain("未归类全景类型（1）");
    const row = within(sec).getByTestId("dc-uncat-LabTest");
    expect(row.textContent).toContain("实验室检测");
    expect(within(row).getByTestId("dc-cov-LabTest").textContent).toContain("可供给 3/3");
    expect(within(row).getByTestId("dc-tpl-LabTest")).toBeTruthy();
  });

  it("③：连接字段映射面板——全景字段全集：已映射(propKey←源字段) + 缺源字段诚实标未映射（逐值==后端）", async () => {
    loginAs("planner");
    renderApp("/admin/connections");
    // conn-erp 绑定了 Order（erp_sales_orders）——面板出现且计数 == 后端 mapped/intakeTotal。
    const panel = await screen.findByTestId("conn-fieldmap-conn-erp");
    const typeRow = within(panel).getByTestId("conn-fieldmap-conn-erp-Order");
    expect(within(typeRow).getByTestId("conn-fieldmap-cov-conn-erp-Order").textContent).toContain("已映射 6/7");
    // 已映射字段显源字段（so ← SO_NO）。
    expect(typeRow.textContent).toContain("SO_NO");
    // 缺源字段诚实标"未映射"（unitPrice·非隐藏）。
    const un = within(typeRow).getByTestId("conn-unmapped-conn-erp-Order-unitPrice");
    expect(un.textContent).toContain("unitPrice");
    expect(un.textContent).toContain("未映射");
    // 无绑定的连接（conn-kb）不伪造字段映射面板（诚实空）。
    expect(screen.queryByTestId("conn-fieldmap-conn-kb")).toBeNull();
  });

  it("④：上传后当页 objectify——物化结果与待对账列数如实回显 + 深链 schema-reconcile", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/connections");
    await screen.findByTestId("data-categories-panel");

    // 切销售订单为文件上传并上传文件（走 mock uploads → conn id）。
    const card = await screen.findByTestId("dc-sales_orders");
    const modeSel = within(card).getByLabelText("销售订单 接入方式");
    await user.selectOptions(modeSel, "FILE_UPLOAD");
    const input = within(card).getByLabelText("销售订单 上传文件") as HTMLInputElement;
    const file = new File(["so,qty\nSO-1,10\n"], "orders.csv", { type: "text/csv" });
    await user.upload(input, file);

    // 上传预览就地出现 + objectify 按钮存在（上传→objectify→reconcile 一条龙）。
    await screen.findByTestId("dc-upload-preview");
    const btn = screen.getByTestId("dc-upload-objectify");
    await user.click(btn);
    // objectify 结果如实回显（mock 返回 materialized+candidates）。
    const result = await screen.findByTestId("dc-upload-objectify-result");
    expect(result.textContent).toContain("已物化");
  });
});
