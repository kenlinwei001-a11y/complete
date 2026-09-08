import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { mockCapacityForecast, type MockForecastArgs } from "@/mocks/simSolvers";

/**
 * WO-R13-ONTOCHAIN-PANEL · 项目推演（project-sim）结论 ⇒ 本体链 接缝门。
 *
 * 咬三件事（每段独立断言，变异反证：规则段挂了只红规则断言，不被对象/边段带绿）：
 *  ① 判定条旁「本体链」按钮 ⇒ Modal 出 OntologyChainView：
 *     - 规则/公式段 = 后端响应 provenance 真值串（非内联编造）+ 求解器 capacity_forecast；
 *     - 对象段 = 面板既有状态（无选中订单 ⇒ Model.modelId；选中订单 ⇒ Order.so）；
 *     - 边段 = 诚实缺位（data-present="0" + 「后端未下发」）—— 默认粒度响应不带派生边；
 *  ② KPI P50 浮层推导公式 = 后端 provenance.capWanP50.formula（内联编造串退场）；
 *  ③ DAG 节点抽屉底部含本体链段（agg 节点公式取后端真值；边/对象缺位 + 静态映射口径标注）。
 *
 * fixture 实况（2026-08-18 实测）：共享 mock `mockCapacityForecast`（src/mocks/simSolvers.ts）
 * **不带** provenance 字段，而真后端 capacity.ts 发（capWanP50/capWanP90/baselineDemand/
 * effectiveDemand/gap 五键）。共享 mock 不在本单边界内不许改 ⇒ 本文件在 MSW 层用
 * server.use 给 capacity_forecast/run 叠上**与真后端一字不差**的 provenance 键
 * （照抄 apps/datacore/src/solvers/capacity.ts 主分支），面板代码本身保留
 * `?? <内联串>` 兜底给「响应缺该键」的路径。
 */

/** 与真后端 apps/datacore/src/solvers/capacity.ts 主分支 provenance 五键一字不差。 */
const PROV = {
  capWanP50: { formula: "Σ_base weeklyCap × certFactor × curveMult(周)", valueLabel: "P50 产能（万套/窗口）" },
  capWanP90: { formula: "capWanP50 × healthFactor", valueLabel: "P90 产能（万套/窗口）" },
  baselineDemand: { formula: "Σ Order.qty（modelId，due in weeks，OPEN）/ 10000", valueLabel: "订单簿基线需求（万套/窗口）" },
  effectiveDemand: { formula: "(qty > 0 ? qty : baselineDemand) × (1 + demandDelta)", valueLabel: "有效需求（万套/窗口）" },
  gap: { formula: "max(0, effectiveDemand − capWanP90) / effectiveDemand", valueLabel: "缺口比例" },
} as const;

const SNAPSHOT = "ov-r13-seam";

/** 共享机在跑多路 vitest 时 CPU 争用剧烈（load 数百/4 核），findBy 默认 15s 会被负载抖红 —— 本文件统一放宽。 */
const T = { timeout: 120_000 } as const;

/** MSW 层覆盖：共享 mock 真重算 + 叠真后端口径 provenance（不改共享 mock，免得动其它测试共用件）。 */
function useProvenanceForecast(): void {
  server.use(
    http.post("*/b/v1/solvers/capacity_forecast/run", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
      // 请求体 args 是运行时 JSON（Record），mock 入口要强类型 MockForecastArgs —— 经 unknown 收窄，类型面不装。
      const data = mockCapacityForecast((body.args ?? {}) as unknown as MockForecastArgs);
      if ("error" in data) {
        return HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: String(data.error), requestId: "t" } }, { status: 422 });
      }
      return HttpResponse.json({ data: { ...data, provenance: PROV }, snapshotVersion: SNAPSHOT });
    }),
  );
}

/** 默认整单（4680-NCM · 40 万套 · 6 周）的期望输出 —— 与面板共享同一 mock 真重算，ok 走向不写死。 */
function expectedDefault(): { ok: boolean } {
  const d = mockCapacityForecast({ modelId: "4680-NCM", qty: 40, weeks: 6 }) as { ok: boolean };
  return { ok: d.ok };
}

async function openStep6(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByTestId("pm-stepper", undefined, T);
  await user.click(screen.getByTestId("pm-step-chip-6"));
  await screen.findByTestId("pm-step6", undefined, T);
}

describe("WO-R13-ONTOCHAIN-PANEL · project-sim 结论 ⇒ 本体链", () => {
  it("① 判定条旁「本体链」⇒ Modal 三段：规则=后端 provenance 真值 + capacity_forecast；对象=Model id；边=诚实缺位", async () => {
    useProvenanceForecast();
    const { ok } = expectedDefault();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await openStep6(user);

    await user.click(screen.getByTestId("proj-verdict-chain-btn"));
    const chain = await screen.findByTestId("proj-verdict-chain", undefined, T);

    // 规则/公式段：公式 = 响应真值（ok ⇒ capWanP50；缺口 ⇒ gap），求解器 capacity_forecast
    const rule = within(chain).getByTestId("proj-verdict-chain-rule");
    expect(rule.getAttribute("data-present")).toBe("1");
    expect(within(chain).getByTestId("proj-verdict-chain-rule-formula").textContent).toBe(
      ok ? PROV.capWanP50.formula : PROV.gap.formula,
    );
    expect(within(chain).getByTestId("proj-verdict-chain-rule-solver")).toHaveTextContent("capacity_forecast");

    // 对象段：未选订单 ⇒ Model.4680-NCM（面板既有状态，非编造）
    const object = within(chain).getByTestId("proj-verdict-chain-object");
    expect(object.getAttribute("data-present")).toBe("1");
    expect(object).toHaveTextContent("Model.4680-NCM");

    // 边段：默认粒度响应不带派生边 ⇒ 诚实缺位
    const edge = within(chain).getByTestId("proj-verdict-chain-edge");
    expect(edge.getAttribute("data-present")).toBe("0");
    expect(within(chain).getByTestId("proj-verdict-chain-edge-missing")).toHaveTextContent("后端未下发");

    // 快照随行 + gaps 写明边段缺因（granularity=process-model 挂账）
    expect(within(chain).getByTestId("proj-verdict-chain-snapshot")).toHaveTextContent(SNAPSHOT);
    expect(within(chain).getByTestId("proj-verdict-chain-gaps").textContent).toContain("granularity=process-model");
  });

  it("①b 选中订单后对象段 = Order.so（下钻细排口径）", async () => {
    useProvenanceForecast();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("pm-stepper", undefined, T);
    await user.click(await screen.findByTestId("proj-order-SO-10001", undefined, T));
    await openStep6(user);

    await user.click(screen.getByTestId("proj-verdict-chain-btn"));
    const chain = await screen.findByTestId("proj-verdict-chain", undefined, T);
    const object = within(chain).getByTestId("proj-verdict-chain-object");
    expect(object.getAttribute("data-present")).toBe("1");
    expect(object).toHaveTextContent("Order.SO-10001");
  });

  it("② KPI P50 浮层推导公式 = 后端 provenance.capWanP50.formula（内联编造串退场）", async () => {
    useProvenanceForecast();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await openStep6(user);

    await user.hover(screen.getByTestId("prov-v-p50"));
    const tip = await screen.findByTestId("prov-tip", undefined, T);
    expect(tip.textContent).toContain(PROV.capWanP50.formula);
    expect(tip.textContent).not.toContain("P50 = Σ可产基地 Σ周(周产能 × 爬坡曲线 × 检修窗 × 认证系数)");
  });

  it("③ DAG 节点抽屉含本体链段：agg 公式取后端真值；对象/边诚实缺位 + 静态映射口径标注", async () => {
    useProvenanceForecast();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");
    await screen.findByTestId("pm-dag-panel", undefined, T);

    await user.click(screen.getByTestId("pm-dag-node-agg"));
    const drawer = await screen.findByTestId("dag-node-drawer", undefined, T);
    const chain = within(drawer).getByTestId("dag-node-chain");

    // 规则/公式段：后端 provenance.capWanP50 真值 + 求解器
    expect(within(chain).getByTestId("dag-node-chain-rule-formula").textContent).toBe(PROV.capWanP50.formula);
    expect(within(chain).getByTestId("dag-node-chain-rule-solver")).toHaveTextContent("capacity_forecast");

    // 对象/边段：引擎未下发逐节点链 ⇒ 诚实缺位
    expect(within(chain).getByTestId("dag-node-chain-object").getAttribute("data-present")).toBe("0");
    expect(within(chain).getByTestId("dag-node-chain-edge").getAttribute("data-present")).toBe("0");

    // 口径标注：六要素为编辑口径静态映射（dagNodeDetail），保留不删
    expect(within(chain).getByTestId("dag-node-chain-gaps").textContent).toContain("dagNodeDetail");
    // 既有六要素表仍在（别的判据在用）
    expect(within(drawer).getByTestId("dag-node-src")).toHaveTextContent("capacity_forecast");
  });
});
