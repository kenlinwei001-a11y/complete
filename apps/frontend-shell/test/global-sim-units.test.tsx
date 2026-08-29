import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { OBJECTIVE_UNITS, KPI_DIM_UNITS, objectiveHeader, objectiveUnit, kpiDimUnit } from "@platform/contracts";

/**
 * WO-UNIT-MEANING · 多目标 / 7 维 KPI 量纲单源回归（治 G-UNIT-NORMALIZE 范式级断点）。
 *
 * 病灶：`objectiveValues` 5 个目标键与 7 维 KPI 此前**逐处内联单位**（对比矩阵列头 / 方法旋钮读数 /
 * 自由杠杆 before-after 表 / i18n 里的「换型(小时)」），换口径要改多处、且各处会漂移。
 *
 * 红咬：量纲**唯一出处** = contracts `OBJECTIVE_UNITS` / `KPI_DIM_UNITS`——
 * 退回内联即红；改字典的 unit 即改本断言（证真单源，非各存一份 R14）。
 */
describe("WO-UNIT-MEANING · 多目标量纲单源（objectiveValues / 7维KPI）", () => {
  it("单源纯函数：objectiveHeader 拼「标签(单位)」·缺项诚实回退键名不臆造", () => {
    // 与字典同步（改字典即改此断言）
    expect(objectiveHeader("delay")).toBe(`${OBJECTIVE_UNITS.delay!.label}(${OBJECTIVE_UNITS.delay!.unit})`);
    expect(objectiveHeader("cost")).toBe(`${OBJECTIVE_UNITS.cost!.label}(${OBJECTIVE_UNITS.cost!.unit})`);
    expect(objectiveUnit("changeover")).toBe(OBJECTIVE_UNITS.changeover!.unit);
    // 未登记键 → 回退键名本身（不臆造单位）
    expect(objectiveHeader("__unknown__")).toBe("__unknown__");
    expect(objectiveUnit("__unknown__")).toBe("");
    expect(kpiDimUnit("__unknown__")).toBe("");
  });

  it("口径红线：换型为全链**小时**（不残留分钟）· 代价为非货币「代价单位」", () => {
    // contracts 顶部单位红线（用户曾亲自校正）：换型不得再出现「分」
    expect(OBJECTIVE_UNITS.changeover!.unit).toBe("小时");
    expect(KPI_DIM_UNITS.changeoverHours).toBe("小时");
    // 代价是惩罚加权分，不是元——note 必须显式标注，避免被当货币读
    expect(OBJECTIVE_UNITS.cost!.note ?? "").toContain("非货币");
    // 延误/成品库存是量×时长的积分量，非纯数量
    expect(OBJECTIVE_UNITS.delay!.unit).toBe("套·天");
    expect(OBJECTIVE_UNITS.fgInventory!.unit).toBe("套·天");
  });

  it("对比矩阵列头带量纲（来自单源·退回裸列头即红）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");

    const matrix = await screen.findByTestId("global-sim-matrix", undefined, { timeout: 15000 });
    await waitFor(() => expect(matrix.textContent ?? "").toContain(OBJECTIVE_UNITS.delay!.label));
    const text = matrix.textContent ?? "";
    // 逐列量纲在位（单源拼出）
    for (const key of ["ontime", "delay", "changeover", "fgInventory", "cost"]) {
      expect(text, `列头应含 ${objectiveHeader(key)}`).toContain(objectiveHeader(key));
    }
  }, 30000);
});
