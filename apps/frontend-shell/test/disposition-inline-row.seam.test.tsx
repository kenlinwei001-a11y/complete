import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-DISPOSITION-INLINE-ROW · 处置行动项详情**必须展开在被点那一行下面**（前端 SEAM 组合测）。
 *
 * 现场：产能推演 →「产能风险处置 · 最终方案与行动计划」表（17 行），点第 k 行的行动项，
 * 详情却出现在**整张表最下面** —— 用户要滚到底，且看不出这段详情属于哪一行。
 * 根因：`DispositionDetailPanel` 挂在 `</table>` **之后**，与被点的 `<tr>` 无位置关系。
 *
 * ⚠️ 判据必须落在**相对位置**上，不能只断言「详情出现了」——
 *    「出现了」在**修复前也成立**（面板一直渲染，只是在最下面），那种断言修前修后同色 = 装饰品。
 *    故本测全部咬「详情节点在 tbody 里的序号 == 被点行序号 + 1，且严格早于第 k+1 行」。
 *
 * 走**真实路由** `/v/risk`（renderApp）渲染，非直接渲染组件 —— 咬的是链路不是函数。
 */

/** 详情节点在 `<tbody>` 直接子节点（即各 `<tr>`）中的序号；不在表内 ⇒ -1（= 修复前那种"挂在表外"）。 */
function domIndexIn(tbody: HTMLElement, node: HTMLElement): number {
  return Array.from(tbody.children).findIndex((child) => child.contains(node));
}

/** `a` 在文档顺序上严格早于 `b`？（Node.DOCUMENT_POSITION_FOLLOWING = 4） */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

async function openPlanTable() {
  loginAs("planner");
  renderApp("/v/risk");
  const table = await screen.findByTestId("risk-plan-table");
  const tbody = table.querySelector("tbody") as HTMLElement | null;
  expect(tbody, "处置表必须有 tbody").not.toBeNull();
  return { table, tbody: tbody! };
}

describe("WO-DISPOSITION-INLINE-ROW · 处置详情行内展开（相对位置咬死）", () => {
  it("点第 k 行 → 详情节点在 DOM 顺序上位于第 k 行之后、第 k+1 行之前（不是整张表最下面）", async () => {
    const user = userEvent.setup();
    const { tbody } = await openPlanTable();

    // ── 先断言前提存在（否则后面的"相对位置"断言可能空转成假绿）──
    const k = 1; // 故意不取第 0 行：挂在表尾的旧实现对第 0 行也"看着像"在下面
    const rowK = screen.getByTestId(`risk-plan-row-${k}`);
    const rowNext = screen.getByTestId(`risk-plan-row-${k + 1}`);
    expect(rowK, "前提：第 k 行必须存在").toBeInTheDocument();
    expect(rowNext, "前提：第 k+1 行必须存在（否则'在 k+1 之前'无从谈起）").toBeInTheDocument();
    expect(screen.queryByTestId("disposition-detail-panel"), "前提：未点击时不应有详情面板").toBeNull();

    await user.click(rowK);
    const panel = await screen.findByTestId("disposition-detail-panel");

    // ── 判据①：详情必须在 tbody 里，且正好是被点行的下一行 ──
    const iRowK = domIndexIn(tbody, rowK);
    const iPanel = domIndexIn(tbody, panel);
    const iRowNext = domIndexIn(tbody, rowNext);
    expect(iRowK, "被点行必须在 tbody 内").toBeGreaterThanOrEqual(0);
    expect(iPanel, "详情面板必须在 tbody 内（挂在 </table> 之后 ⇒ -1 ⇒ 红）").toBeGreaterThanOrEqual(0);
    expect(iPanel, `详情必须紧跟第 ${k} 行（tbody 序号 = 被点行 + 1），而不是整张表最下面`).toBe(iRowK + 1);
    expect(iPanel, `详情必须严格早于第 ${k + 1} 行`).toBeLessThan(iRowNext);

    // ── 判据②：同一事实换 DOM 原生口径再咬一遍（k 行 → 详情 → k+1 行 三者文档顺序） ──
    expect(precedes(rowK, panel), "文档顺序：被点行 → 详情").toBe(true);
    expect(precedes(panel, rowNext), "文档顺序：详情 → 第 k+1 行（挂表尾时此条必假）").toBe(true);

    // 展开行本身可辨识 + 与触发行有可达性关联。
    const detailRow = tbody.children[iPanel] as HTMLElement;
    expect(detailRow.getAttribute("data-testid")).toBe(`risk-plan-detail-row-${k}`);
    expect(rowK.getAttribute("aria-expanded"), "被点行须报开合态").toBe("true");
    const controls = rowK.getAttribute("aria-controls");
    expect(controls, "被点行须 aria-controls 指向展开单元格").toBeTruthy();
    expect(within(detailRow).getByTestId("disposition-detail-panel")).toBe(panel);
    expect(detailRow.querySelector(`#${CSS.escape(controls!)}`), "aria-controls 必须指到真实存在的节点").not.toBeNull();
  });

  it("colSpan 从列定义现算（== 表头列数），不是写死的数字", async () => {
    const user = userEvent.setup();
    const { table, tbody } = await openPlanTable();
    const headerCols = within(table).getAllByRole("columnheader").length;
    expect(headerCols, "前提：表头必须有列").toBeGreaterThan(0);

    await user.click(screen.getByTestId("risk-plan-row-0"));
    const panel = await screen.findByTestId("disposition-detail-panel");
    const cell = (tbody.children[domIndexIn(tbody, panel)] as HTMLElement).querySelector("td")!;
    expect(cell.getAttribute("colspan"), "展开行 colSpan 必须等于表头列数（加列即跟随）").toBe(String(headerCols));
  });

  it("点另一行 → 详情跟着搬到新行下面（旧位置不再有详情）", async () => {
    const user = userEvent.setup();
    const { tbody } = await openPlanTable();

    await user.click(screen.getByTestId("risk-plan-row-0"));
    const first = await screen.findByTestId("disposition-detail-panel");
    const i0 = domIndexIn(tbody, screen.getByTestId("risk-plan-row-0"));
    expect(domIndexIn(tbody, first), "前提：详情先落在第 0 行下面").toBe(i0 + 1);

    await user.click(screen.getByTestId("risk-plan-row-2"));
    const moved = await screen.findByTestId("disposition-detail-panel");
    const i2 = domIndexIn(tbody, screen.getByTestId("risk-plan-row-2"));
    expect(domIndexIn(tbody, moved), "详情必须搬到第 2 行下面").toBe(i2 + 1);

    // 全表只剩一处详情，且第 0 行下面已不是详情行。
    expect(screen.getAllByTestId("disposition-detail-panel")).toHaveLength(1);
    expect(screen.queryByTestId("risk-plan-detail-row-0"), "旧位置不得残留展开行").toBeNull();
    expect(screen.getByTestId("risk-plan-row-0").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("risk-plan-row-2").getAttribute("aria-expanded")).toBe("true");
  });

  it("再点同一行 → 收起（toggle 语义保留）", async () => {
    const user = userEvent.setup();
    await openPlanTable();
    const row = screen.getByTestId("risk-plan-row-1");

    await user.click(row);
    expect(await screen.findByTestId("disposition-detail-panel")).toBeInTheDocument();
    expect(row.getAttribute("aria-expanded")).toBe("true");

    await user.click(row);
    expect(screen.queryByTestId("disposition-detail-panel"), "再点同一行必须收起").toBeNull();
    expect(screen.queryByTestId("risk-plan-detail-row-1")).toBeNull();
    expect(screen.getByTestId("risk-plan-row-1").getAttribute("aria-expanded")).toBe("false");
  });
});
