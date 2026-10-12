import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderWithClient as render } from "./utils";
import { CapacityDerivationDag } from "@/views/capacity/CapacityDerivationDag";
import { CapacityRampEnvelope } from "@/views/capacity/CapacityRampEnvelope";
import { CapacityFactorOntology } from "@/views/capacity/CapacityFactorOntology";
import { ONTO_FACTORS, ONTO_LAYERS, markForText, RAMP_SUBCURVES } from "@/views/capacity/factorOntology";

/**
 * WO-CAPACITY-DEEPEN-ADDITIVE · 4 增量块（块A 派生 DAG / 块B 爬坡 min 包络 / 块C 20 因素本体图例 / 块D 见 base-outlook-card.test）。
 * 纯增量·读真求解器（base_capacity_outlook / bottleneck_matrix·mock 同口径·KILL-MOCK）·每值可溯（R13）·因素表单源（R14）·确定性（R6）。
 */
describe("WO-CAPACITY-DEEPEN-ADDITIVE · 增量块", () => {
  it("块C 单源自洽：20 因素跨 6 层·圈号无重·bottleneck_matrix 因素可映射本体坐标", () => {
    expect(ONTO_FACTORS).toHaveLength(20);
    expect(ONTO_LAYERS).toHaveLength(6);
    expect(new Set(ONTO_FACTORS.map((f) => f.mark)).size).toBe(20); // 圈号唯一
    expect(new Set(ONTO_FACTORS.map((f) => f.num)).size).toBe(20); // 序号唯一 1..20
    for (let l = 1; l <= 6; l++) expect(ONTO_FACTORS.some((f) => f.layer === l)).toBe(true); // 每层非空
    // 现页真实瓶颈因素名 → 本体徽标（附加坐标·非伪造）。
    expect(markForText("设备OEE")).toBe("③");
    expect(markForText("物料齐套")).toBe("⑬");
    expect(markForText("换型损失")).toBe("⑤");
    // 6 条爬坡子曲线覆盖 6 因素（min 包络）。
    expect(RAMP_SUBCURVES).toHaveLength(6);
  });

  it("块A 派生 DAG：6 层自下而上渲染 + 可用产能锚点真值 + 点节点展开判定/驱动因素/溯源字段", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(<CapacityDerivationDag baseId="常州" />);

    await waitFor(() => expect(screen.getByTestId("cap-dag-nodes")).toBeInTheDocument());
    for (let l = 1; l <= 6; l++) expect(screen.getByTestId(`cap-dag-node-${l}`)).toBeInTheDocument(); // 6 层齐
    // 预测层的可用产能锚点真值（>0·溯 base_capacity_outlook.available）——**第一层就看得见**（卡面主数值）。
    const anchor5 = screen.getByTestId("cap-dag-anchor-5");
    expect(Number((anchor5.textContent ?? "0").replace(/[^0-9.]/g, ""))).toBeGreaterThan(0);
    // WO-CAPACITY-CARD-LAYOUT：溯源字段等**逐项明细**已按信息分层规范降到第二层（一次点击），
    // 不再默认展开 —— 故此处补一次点击。断言内容一字未改（仍咬 base_capacity_outlook.available）。
    await user.click(screen.getByTestId("cap-dag-node-toggle-5"));
    expect((await screen.findByTestId("cap-dag-detail-5")).textContent ?? "").toContain("base_capacity_outlook.available");

    // 点设备层（1）→ 展开显驱动因素 + 溯 bottleneck_matrix。
    await user.click(screen.getByTestId("cap-dag-node-toggle-1"));
    const d1 = await screen.findByTestId("cap-dag-detail-1");
    expect(d1.textContent ?? "").toContain("bottleneck_matrix");
  });

  it("块B 爬坡 min 包络：6 条子爬坡 + min 包络 + 绑定因素（被谁拖住·溯 bottleneck_matrix 张力·非写死）", async () => {
    loginAs("planner");
    render(<CapacityRampEnvelope baseId="常州" />);

    await waitFor(() => expect(screen.getByTestId("cap-ramp-chart")).toBeInTheDocument());
    for (const s of RAMP_SUBCURVES) expect(screen.getByTestId(`cap-ramp-curve-${s.mark}`)).toBeInTheDocument(); // 6 条子曲线
    expect(screen.getByTestId("cap-ramp-envelope")).toBeInTheDocument(); // min 包络
    // 绑定因素（被拖住）——溯 bottleneck_matrix。
    const binding = screen.getByTestId("cap-ramp-binding");
    expect(binding.textContent ?? "").toContain("拖住");
  });

  it("块C 本体图例：折叠→展开 6 层色标 ①–⑳ + 给现有因素附加本体徽标（纯附加·不伪造未匹配）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    render(<CapacityFactorOntology baseId="常州" factors={["设备OEE", "物料齐套", "无此因素xyz"]} />);

    // 现有因素本体徽标（附加坐标·匹配到的带圈号）。
    expect(screen.getByTestId("cap-onto-badges")).toBeInTheDocument();
    expect(screen.getByTestId("cap-onto-badge-设备OEE").textContent ?? "").toContain("③");
    expect(screen.getByTestId("cap-onto-badge-无此因素xyz").textContent ?? "").not.toContain("·"); // 未匹配诚实不标圈号

    // 折叠 → 展开 6 层图例。
    expect(screen.queryByTestId("cap-onto-legend")).toBeNull();
    await user.click(screen.getByTestId("cap-onto-toggle"));
    await waitFor(() => expect(screen.getByTestId("cap-onto-legend")).toBeInTheDocument());
    for (let l = 1; l <= 6; l++) expect(screen.getByTestId(`cap-onto-layer-${l}`)).toBeInTheDocument();
  });
});
