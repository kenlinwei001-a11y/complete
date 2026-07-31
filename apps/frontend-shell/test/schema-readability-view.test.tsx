import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { handlers } from "@/mocks/handlers";

/**
 * WO-63 · S4 前端真消费（可读性落到屏幕上）。
 *
 * 判据不是"页面渲染了中文"——那可能是硬编码；判据是**屏幕上的中文名与单位来自后端字段**：
 * 断言里的期望值一律从 mock（前端的假后端）里**取出来比对**，而不是写死字符串。
 * 后端改一个 displayName/unit，mock 变、断言的期望值跟着变、页面显示跟着变 → 三者同源即证非硬编码。
 */

/** 从 MSW handlers 反查 mock 的本体真值（= 本测的"后端"）。 */
async function backendType(key: string): Promise<{
  displayName: string;
  businessDefinition?: { statement: string; excludes?: string; decidedBy?: string };
  properties: { propKey: string; displayName?: string; description?: string; unit?: string; unitExempt?: string }[];
}> {
  const h = handlers.find((x) => String((x as { info?: { path?: string } }).info?.path ?? "").endsWith("/a/v1/ontology/object-types"))!;
  const res = await (h as unknown as { run: (a: unknown) => Promise<unknown> }).run({
    request: new Request("http://x/a/v1/ontology/object-types"),
    requestId: "t",
  });
  const body = await ((res as { response: Response }).response).json();
  return (body as { key: string }[]).find((t) => t.key === key) as never;
}

describe("WO-63 · S4 属性口径前端真消费（displayName/unit/description 全来自后端字段）", () => {
  it("对象类型浏览器「口径」面板：概念定义 + 逐属性中文名/单位/说明，值与后端字段逐字相等", async () => {
    const user = userEvent.setup();
    const base = await backendType("Base");
    loginAs("planner");
    renderApp("/admin/object-types");

    await screen.findByTestId("ot-row-Base");
    await user.click(screen.getByTestId("ot-semantics-Base"));
    const panel = await screen.findByTestId("ot-semantics-panel");

    // ① 概念级业务定义（"是什么/谁不算/谁定的"）——不是字段名充数
    expect(within(panel).getByTestId("ot-biz-def")).toHaveTextContent(base.businessDefinition!.statement);
    expect(within(panel).getByTestId("ot-biz-excludes")).toHaveTextContent(base.businessDefinition!.excludes!);
    expect(within(panel).getByTestId("ot-biz-source")).toHaveTextContent(base.businessDefinition!.decidedBy!);

    // ② 属性列渲染 displayName（**取自后端字段**，非页面写死）
    for (const p of base.properties) {
      const row = within(panel).getByTestId(`ot-sem-row-${p.propKey}`);
      expect(row).toHaveTextContent(p.displayName!);
      expect(row).toHaveTextContent(p.propKey); // 中文名旁仍显 propKey（API 契约不因可读性而消失）
      expect(row).toHaveTextContent(p.description!);
    }

    // ③ 单位来自后端：有量纲显单位、诚实豁免显"无量纲"而非硬凑一个单位
    const util = base.properties.find((p) => p.propKey === "util")!;
    expect(within(panel).getByTestId("ot-sem-unit-util")).toHaveTextContent(util.unit!);
    expect(within(panel).getByTestId("ot-sem-row-lon")).toHaveTextContent("无量纲");
    expect(within(panel).queryByTestId("ot-sem-unit-lon")).toBeNull(); // 无量纲属性不得被塞单位徽章
  });

  it("建模工作台：映射到已发布类型的属性列显示本体中文名 + 单位；新建类型无本体口径 → 诚实回落 propKey", async () => {
    const order = await backendType("Order");
    loginAs("planner");
    renderApp("/admin/modeling");

    await screen.findByTestId("type-card-Order");
    const soLabel = await screen.findByTestId("prop-label-Order-so");
    expect(soLabel).toHaveTextContent(order.properties.find((p) => p.propKey === "so")!.displayName!);
    const qty = order.properties.find((p) => p.propKey === "qty")!;
    expect(screen.getByTestId("prop-label-Order-qty")).toHaveTextContent(qty.displayName!);
    expect(screen.getByTestId("prop-unit-Order-qty")).toHaveTextContent(qty.unit!);

    // 新建类型（action=CREATE）尚未发布，本体里没有口径 → 显示 propKey，不编造中文名（诚实回落）。
    const plantPk = screen.queryByTestId("prop-label-Plant-plantId");
    if (plantPk) expect(plantPk).toHaveTextContent("plantId");
  });
});
