import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-SCHEMA-ZH · 前端消费属性中文业务名（效果层断言，非"字段定义了"）。
 *
 * 用户原话：「把截屏里面非必要的英文词汇调整为中文，比如 Material.leadTime」
 *          「系统所有类似的数字，需要配套它的意义，让用户看得懂」
 *
 * 断言：
 *  ① 对象 360 属性区渲染出的是**中文名**（到货周期 / 现货库存 / 产能利用率），
 *     且**不再出现**对应的英文裸键（leadTime / onHand / util）。
 *  ② 数字**配套意义**：中文名 + 单位同格出现（到货周期 21 天）。
 *  ③ **诚实回落**：后端未下发 displayName 的属性（devPct / position）显 propKey 原串，
 *     不是 "undefined"、不是空白。
 *  ④ 中文名**来自后端**：前端不内联映射——mock 拿掉某属性的 displayName，该行即回落裸键
 *     （变异反证在 datacore/前端两侧都留了钩子，见报告）。
 */

describe("WO-SCHEMA-ZH · 本体属性中文业务名（对象 360）", () => {
  it("① Material 360：渲染「到货周期」而非裸键 leadTime；② 中文名与单位同格给出数字的意义", async () => {
    loginAs("planner");
    const r = renderApp("/o/Material/pos_ncm");
    await waitFor(() => expect(r.getByTestId("object-360")).toBeInTheDocument());

    // 中文业务名真渲染
    expect(screen.getByText("到货周期")).toBeInTheDocument();
    expect(screen.getByText("现货库存")).toBeInTheDocument();
    expect(screen.getByText("物料名称")).toBeInTheDocument();

    // 英文裸键不再作为可见文本出现（testid/title 里仍保留技术键，供工程排查）
    expect(screen.queryByText("leadTime")).toBeNull();
    expect(screen.queryByText("onHand")).toBeNull();
    expect(screen.queryByText("unitPrice")).toBeNull();

    // 数字配套意义：同一行里「到货周期 · 21 · 天」
    const row = r.getByTestId("o360-prop-leadTime");
    expect(within(row).getByText("到货周期")).toBeInTheDocument();
    expect(row.textContent).toContain("21");
    expect(within(row).getByText("天")).toBeInTheDocument();
    // 技术键没丢，只是退到 title（改 key 会打断求解器/规则/派生，故 key 零改）
    expect(within(row).getByTitle("leadTime")).toBeInTheDocument();
  });

  it("③ 诚实回落：后端未给中文名的属性显 propKey 原串，不显 undefined / 不留空", async () => {
    loginAs("planner");
    const r = renderApp("/o/Material/pos_ncm");
    await waitFor(() => expect(r.getByTestId("object-360")).toBeInTheDocument());

    const row = r.getByTestId("o360-prop-devPct");
    const th = row.querySelector("th")!;
    expect(th.textContent).toBe("devPct"); // 回落裸键 —— 不是 "undefined"、不是 ""
    expect(th.textContent).not.toContain("undefined");
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("④ Base 360：util → 「产能利用率」；同页留白项 position 仍回落裸键（同一页两种行为并存）", async () => {
    loginAs("planner");
    const r = renderApp("/o/Base/常州");
    await waitFor(() => expect(r.getByTestId("object-360")).toBeInTheDocument());

    const utilRow = r.getByTestId("o360-prop-util");
    expect(within(utilRow).getByText("产能利用率")).toBeInTheDocument();
    expect(within(utilRow).getByText("%")).toBeInTheDocument(); // 单位未回归
    expect(screen.queryByText("util")).toBeNull();

    const posRow = r.getByTestId("o360-prop-position");
    expect(posRow.querySelector("th")!.textContent).toBe("position");
  });

  it("⑤ 本体图谱检视器（业务专家读 Schema 的主界面）：属性列显中文名，技术键退到 title", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/graph");

    await screen.findByTestId("ontology-svg");
    await user.click(await screen.findByTestId("graph-node-n-base"));
    const inspector = await screen.findByTestId("graph-inspector");

    // 图谱节点投影只带 propKey；中文名从权威类型表（/ontology/object-types）取 —— 后端单源。
    await waitFor(() => expect(within(inspector).getByText("产能利用率")).toBeInTheDocument());
    expect(within(inspector).getByText("铭牌年产能")).toBeInTheDocument();
    expect(within(inspector).getByText("基地名称")).toBeInTheDocument();
    // 裸键 util / gwh 不再作为可见文本；技术键仍可经 title 查到（不丢工程可读性）
    expect(within(inspector).queryByText("util")).toBeNull();
    expect(within(inspector).queryByText("gwh")).toBeNull();
    expect(within(inspector).getByTitle("util")).toBeInTheDocument();
    // 既有能力零回归：字段来源溯源仍在（← utilization）
    expect(inspector).toHaveTextContent("← utilization");
  });
});
