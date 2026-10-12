import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * WO-MULTIOBJ-CONVERGE · 多目标 what-if 面板（前端半）。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 * **X**：本面板自己拼订单簿（`searchObjects("Order")` —— 且只拿分页第一页 50/500 单），
 *   营收/违约金/换型成本由前端自定系数派生（优先级 → 元/套、800 元/套）。
 *   于是同一租户同一批订单，本面板与「方案寻优」屏上给出 **39.49 亿** 与 **244.59 亿** 两个数。
 * **Y**：本面板与方案寻优读**同一个装配出口**、同一份轴集合与缺席位、同一份权重语义。
 *
 * 证：① `opt.multiobj` 关 → 整块不存在（R3）
 *    ② 装配不出 → 屏上如实说装不出，**不回退到自造订单簿**（无任何自造行）
 *    ③ 装得出 → 六轴齐（在册轴 + 缺席位），缺席位原文是「本系统今天算不出」
 *
 * ⚠ 轴读数与方案寻优逐字节相等这件事，由 **datacore 侧的接缝门**
 *   （`multiobj-converge.seam.test.ts`）走真路由 + 真求解器咬 —— 那才是"算得对不对"的落点；
 *   这里咬的是"屏上该有什么"。
 */
const ASSEMBLE = "*/a/v1/sim/optimize-pareto/assemble";
const PARETO = "*/a/v1/sim/optimize-pareto";

const OBJECTIVES = [
  { key: "margin", dir: "max" as const, label: "毛利（L.p × L.q − C.c）", unit: "元" },
  { key: "serviceRate", dir: "max" as const, label: "获排率（获排单数 ÷ 总单数）", unit: "" },
  { key: "revenue", dir: "max" as const, label: "L.p × L.q", unit: "元" },
  { key: "cost", dir: "min" as const, label: "C.c", unit: "元" },
];
const GAPS = [
  { key: "penalty", label: "违约金", reason: "本体上没有按订单计价的违约金额字段。" },
  { key: "changeover", label: "换型成本", reason: "本族是指派问题，解里没有次序，换型次数无从起算。" },
  { key: "cash", label: "现金", reason: "本族没有时间维，现金周期无从起算。" },
];
const REQUEST = {
  family: "cross_object_occupancy",
  args: {
    orders: [
      { id: "L-1", revenue: 1000, qty: 10 },
      { id: "L-2", revenue: 2000, qty: 20 },
    ],
    lines: [{ id: "c1", capacity: 15 }],
    contracts: [],
    eligibility: [
      { order: "L-1", line: "c1", cost: 5 },
      { order: "L-2", line: "c1", cost: 5 },
    ],
    currencyAligned: true,
  },
  objectives: OBJECTIVES,
  levers: [{ key: "lines.c1.capacity", label: "c1", values: [15, 30] }],
  unavailableObjectives: GAPS,
};
const SOLUTION = {
  id: "s1",
  label: "c1=30",
  levers: [{ key: "lines.c1.capacity", value: 30 }],
  metrics: { cost: 10, margin: 2990, orderCount: 2, revenue: 3000, servedCount: 2, serviceRate: 1 },
  bindings: [],
  feasible: true,
};

describe("WO-MULTIOBJ-CONVERGE · 多目标面板与方案寻优同轴", () => {
  afterEach(() => {
    delete db.tenantOverrides["opt.solver-pool"];
    delete db.tenantOverrides["opt.whatif"];
    delete db.tenantOverrides["opt.multiobj"];
  });
  const openFeature = (): void => {
    db.tenantOverrides["opt.solver-pool"] = true;
    db.tenantOverrides["opt.whatif"] = true;
    db.tenantOverrides["opt.multiobj"] = true;
  };

  it("① R3：opt.multiobj 关 → 面板整块不存在", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");
    expect(screen.queryByTestId("multiobj-whatif")).not.toBeInTheDocument();
  });

  it("② 装配不出 → 屏上如实说装不出，不回退到自造订单簿", async () => {
    server.use(
      http.post(ASSEMBLE, () =>
        HttpResponse.json({ applicable: false, missingRoles: ["cost（本体上没有占用成本字段）"], note: "只接地到 1 个真目标。" }),
      ),
    );
    openFeature();
    loginAs("planner");
    renderApp("/v/global-sim");
    const panel = await screen.findByTestId("multiobj-whatif");
    const said = await within(panel).findByTestId("multiobj-not-assembled");
    expect(said).toHaveTextContent("装配不出");
    expect(said).toHaveTextContent("只接地到 1 个真目标");
    // 病根反例：绝不回退到自造订单簿 —— 一行都不许有。
    expect(panel.querySelectorAll('[data-testid^="multiobj-row-"]').length).toBe(0);
  });

  it("③ 装得出 → 六轴齐（在册轴 + 缺席位），缺席位原文是「本系统今天算不出」", async () => {
    server.use(
      http.post(ASSEMBLE, () => HttpResponse.json({ applicable: true, roles: [], unboundRoles: [], note: "", request: REQUEST })),
      http.post(PARETO, () =>
        HttpResponse.json({
          objectives: OBJECTIVES,
          frontier: [SOLUTION],
          dominated: [],
          iterations: 2,
          residual: 1,
          weights: { cost: 1, margin: 1, revenue: 1, serviceRate: 1 },
          ranking: [{ id: "s1", rank: 1, score: 1 }],
          recommendedId: "s1",
          unavailableObjectives: GAPS,
        }),
      ),
    );
    openFeature();
    loginAs("planner");
    renderApp("/v/global-sim");
    const panel = await screen.findByTestId("multiobj-whatif");

    // 四根在册轴 —— 轴名来自装配器回包，前端零猜测。
    for (const k of ["margin", "serviceRate", "revenue", "cost"]) {
      await waitFor(() => expect(within(panel).getByTestId(`multiobj-axis-${k}`)).toBeInTheDocument());
    }
    // 两根补不出来的轴 + 现金，全部是**显式缺席位**，不是空白（留白会被读成「这一维没问题」）。
    for (const k of ["penalty", "changeover", "cash"]) {
      const gap = within(panel).getByTestId(`multiobj-gap-${k}`);
      expect(gap).toHaveTextContent("本系统今天算不出");
    }
    // 病根反例：违约金/换型成本绝不能再以**在册轴**的身份出现（那意味着又有人拿系数编了一根）。
    expect(within(panel).queryByTestId("multiobj-axis-penalty")).not.toBeInTheDocument();
    expect(within(panel).queryByTestId("multiobj-axis-changeover")).not.toBeInTheDocument();
    // 占用明细来自装配器给的那批行（需求行 id，非自造 SO-A/B/C）。
    await waitFor(() => expect(within(panel).getByTestId("multiobj-row-L-1")).toBeInTheDocument());
    for (const toy of ["SO-A", "SO-B", "SO-C"]) {
      expect(within(panel).queryByTestId(`multiobj-row-${toy}`)).not.toBeInTheDocument();
    }
  });
});
