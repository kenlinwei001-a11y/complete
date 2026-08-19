import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyPerturbationToState, type Perturbation, type SandboxViewConfig, type TickState } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import SandboxView from "@/views/sim/SandboxView";

/**
 * WO-U2-STEPWISE-2 · 判据 **U2**（推演过程分步可见 · 每步标 数据·求解器·规则）——剩余 9 页。
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U2）：
 *   「页内有推演过程的步骤态（同一份结果按步展开），且每步能看到它的 数据·求解器·规则。
 *    **业务流程步骤（评审→平衡→定稿）与行动计划步骤不算**」
 *
 * ⚠ **验收判据不是「步骤条渲染出来了」，是「步骤态真正驱动结果分段」**（WO 原文）：
 * **点第 N 步 ⇒ 屏上的数只显示到第 N 步为止。** 所以本文件每页的核心断言形态一律是
 * 「切步前**这个具体的数**在 → 切步后它**不在** → 切回末步它**回来**」，
 * ⛔ 不许只咬「组件在不在」——那咬不出装饰件与真闸的区别。
 *
 * ⚠ **变异反证**（WO 硬要求）：把 `views/sim/SolverStepBar.tsx` 里 `useSolverStep` 的
 * `upto` 改成恒真（`upto: () => true`），本文件用例**必须红**，且红在
 * 「切到第 N 步后那个数**还在**」，**不是**红在「步骤条不见了」。实测原文见交单报告。
 */

/** 断言一组「具体的数」此刻**不在屏上**（按 testid 前缀取，避免咬到别处同名文字）。 */
function expectNoneByPrefix(prefix: RegExp): void {
  expect(screen.queryAllByTestId(prefix)).toHaveLength(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// what-if（假设推演）：步骤 = WI_GRAPH 四层（设定假设 → 两条推演路 → 读数 → 逐行明细）
// ══════════════════════════════════════════════════════════════════════════════

/** 选类型 → 选第一个真对象 → 选属性 → 填假设值（本页无提交闸，填完即重演·判据 U1）。 */
async function fillHypothesis(propKey: string, value: string): Promise<void> {
  fireEvent.change(await screen.findByTestId("wi-type-select"), { target: { value: "Base" } });
  const objSelect = await screen.findByTestId("wi-object-select");
  await waitFor(() => {
    const opts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
    expect(opts.length).toBeGreaterThan(0);
  });
  const realOpts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
  fireEvent.change(objSelect, { target: { value: realOpts[0]!.value } });
  fireEvent.change(screen.getByTestId("wi-prop-select"), { target: { value: propKey } });
  fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value } });
}

describe("WO-U2-STEPWISE-2 · what-if：步骤态真正驱动结果分段", () => {
  it("U2-WI-1 · 四步齐 + 当前步能看到 数据·求解器·规则；默认末步 = 完整结果（改前屏面）", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    await screen.findByTestId("wi-result");

    // 步骤条四步（= 图的四层，不是业务流程步骤）。
    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`wi-steps-step-${n}`)).toBeInTheDocument();

    // 末步口径行三要素齐全（缺一 U2 不成立）——逐字来自 WI_GRAPH 的 `deltas` 节点。
    expect(screen.getByTestId("wi-steps-meta-data")).toHaveTextContent("rows[]");
    expect(screen.getByTestId("wi-steps-meta-solver")).toHaveTextContent("generic_inference");
    expect(screen.getByTestId("wi-steps-meta-rule")).toHaveTextContent("量纲");

    // 默认末步 = 完整结果：影响面计数 2/2 + 逐行 after 真值 200 / 1100 全在。
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId(/^wi-after-/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1100").length).toBeGreaterThan(0);

    // 切第 2 步 → 口径行跟着换成**并列层**的三要素（如实写「本层 2 个并列环」，不挑一个冒充全层）。
    fireEvent.click(screen.getByTestId("wi-steps-step-2"));
    expect(screen.getByTestId("wi-steps-meta-solver")).toHaveTextContent("∥");
    expect(screen.getByTestId("wi-steps-meta-rule")).toHaveTextContent("并列环");
  });

  it("U2-WI-2 · 切步 ⇒ 数真的不在了：第 3 步没有逐行 1100、第 2 步连影响面 2 都没有；切回末步全回来", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    await screen.findByTestId("wi-result");
    expect(screen.getAllByText("1100").length).toBeGreaterThan(0);

    // ── 第 3 步「读数」：影响面计数在，逐行明细（第 4 步）退场 ──
    // ⚠ **这一条刻意排在最前**：变异反证（`upto` 改恒真）要求红在「那个数还在」，
    //   而不是红在「某个组件还在」。所以第一条断言咬的就是**屏上那个具体的数 1100**。
    fireEvent.click(screen.getByTestId("wi-steps-step-3"));
    await waitFor(() => expect(screen.queryAllByText("1100")).toHaveLength(0)); // ← 具体的数不在了
    expect(screen.queryByTestId("wi-deltas")).toBeNull();
    expectNoneByPrefix(/^wi-after-/);
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");

    // ── 第 2 步「两条推演路」：连影响面读数也退场，只剩求解基准回执 ──
    fireEvent.click(screen.getByTestId("wi-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("wi-affected-count")).toBeNull());
    expect(screen.queryByTestId("wi-impact-panel")).toBeNull();
    expect(screen.getByTestId("wi-step-solve")).toHaveTextContent("generic_inference");

    // ── 第 1 步「设定假设」：连求解基准都退场，只剩入参回执（假设本身） ──
    fireEvent.click(screen.getByTestId("wi-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("wi-step-solve")).toBeNull());
    expect(screen.getByTestId("wi-step-inputs")).toHaveTextContent("util");

    // ── 切回末步：全部回来（步骤态双向，不是一次性藏掉） ──
    fireEvent.click(screen.getByTestId("wi-steps-step-4"));
    await screen.findByTestId("wi-deltas");
    expect(screen.getAllByText("1100").length).toBeGreaterThan(0);
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// global-sim（全局项目推演）：步骤 = GS_GRAPH 四层
//   入参与杠杆 → 联合求解 → 解的三个面（获排∥被挤∥台账）→ 读数与结论
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U2-STEPWISE-2 · global-sim：步骤态真正驱动结果分段", () => {
  it("U2-GS-1 · 四步齐 + 末步口径行三要素；默认末步 = 完整结果（占用矩阵/读数/台账全在）", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-ledger");

    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`gs-steps-step-${n}`)).toBeInTheDocument();
    // 末步（读数与结论）是**并列层**（按期率 ∥ 占用矩阵 ∥ 客户级影响）⇒ 如实写「本层 3 个并列环」。
    expect(screen.getByTestId("gs-steps-meta-data")).toHaveTextContent("objectiveValues.ontime");
    expect(screen.getByTestId("gs-steps-meta-solver")).toHaveTextContent("portfolio");
    expect(screen.getByTestId("gs-steps-meta-rule")).toHaveTextContent("并列环");

    // 默认末步 = 完整结果。
    expect(screen.getByTestId("global-sim-readout")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^global-sim-heat-/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/^global-sim-ledger-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("global-sim-verdict")).toHaveTextContent("守恒");

    // 第 2 步「联合求解」的口径行 = 单节点三要素（status/feasible/optimal · portfolio）。
    fireEvent.click(screen.getByTestId("gs-steps-step-2"));
    expect(screen.getByTestId("gs-steps-meta-data")).toHaveTextContent("feasible");
    expect(screen.getByTestId("gs-steps-meta-solver")).toHaveTextContent("portfolio");
  });

  it("U2-GS-2 · 切步 ⇒ 数真的不在了：第 3 步没有占用率格与按期率、第 2 步连守恒台账也没有；切回末步全回来", async () => {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-ledger");

    // 末步先记下两个**具体的数**：占用率格数 与 守恒台账行数。
    const heatCount = screen.getAllByTestId(/^global-sim-heat-/).length;
    const ledgerCount = screen.getAllByTestId(/^global-sim-ledger-/).length;
    expect(heatCount).toBeGreaterThan(0);
    expect(ledgerCount).toBeGreaterThan(0);

    // ── 第 3 步「解的三个面」：台账/分配还在，读数与占用矩阵退场 ──
    fireEvent.click(screen.getByTestId("gs-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-readout")).toBeNull());
    expectNoneByPrefix(/^global-sim-heat-/); // ← 占用率的数全不在了（变异时它们还在 ⇒ 本条红）
    expect(screen.queryByTestId("global-sim-results")).toBeNull();
    expect(screen.getAllByTestId(/^global-sim-ledger-/)).toHaveLength(ledgerCount);
    expect(screen.getByTestId("global-sim-verdict")).toBeInTheDocument();

    // ── 第 2 步「联合求解」：三个面全退场，只剩判定（可行/最优/守恒） ──
    fireEvent.click(screen.getByTestId("gs-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-ledger")).toBeNull());
    expectNoneByPrefix(/^global-sim-ledger-/);
    expect(screen.queryByTestId("global-sim-alloc")).toBeNull();
    expect(screen.getByTestId("global-sim-verdict")).toHaveTextContent("守恒");

    // ── 第 1 步「入参与杠杆」：判定也退场，只剩这次求解读进去的那组入参 ──
    fireEvent.click(screen.getByTestId("gs-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("global-sim-verdict")).toBeNull());
    expect(screen.queryByTestId("global-sim-feasible")).toBeNull();
    expect(screen.getByTestId("gs-step-inputs")).toHaveTextContent("max_ontime");

    // ── 切回末步：全部回来，且**数量逐个对得上**（不是渲了个空壳） ──
    fireEvent.click(screen.getByTestId("gs-steps-step-4"));
    await screen.findByTestId("global-sim-readout");
    expect(screen.getAllByTestId(/^global-sim-heat-/)).toHaveLength(heatCount);
    expect(screen.getAllByTestId(/^global-sim-ledger-/)).toHaveLength(ledgerCount);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cleanroom-attr（净室归因）：三档三个求解器 ⇒ **三条步骤契约**，各投影自本档的图
// ══════════════════════════════════════════════════════════════════════════════

/** 确定性对象类型集（与 `cleanroom-attr.test.tsx` 同源：覆盖三求解器所需结构）。 */
const CR_TYPES = [
  { key: "Furnace", displayName: "化成柜", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "furnaceId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Job", displayName: "在制任务", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "jobId", dataType: "string", isPrimaryKey: true }, { propKey: "furnaceRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Furnace" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "priority", dataType: "number", isPrimaryKey: false }] },
  { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] },
  { key: "Order", displayName: "订单", domain: "product", status: "ACTIVE", properties: [{ propKey: "orderId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
  { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }] },
  { key: "Product", displayName: "产品", domain: "product", status: "ACTIVE", properties: [{ propKey: "prodId", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "laborCost", dataType: "number", isPrimaryKey: false }] },
];

function renderCleanroom(): void {
  loginAs("planner");
  server.use(
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(CR_TYPES)),
    http.post("*/a/v1/solvers/shared_bottleneck/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: Record<string, string> };
      const rt = args.resourceType;
      return HttpResponse.json({
        data: {
          bottlenecks: [{ resourceType: rt, resourceId: `${rt}-01`, capacity: 100, demand: 138, sharerCount: 3 }],
          contention: [{ resourceId: `${rt}-01`, sharers: ["a", "b", "c"] }],
          downgraded: [{ resourceId: `${rt}-01`, sharedByType: args.sharedByType, objectId: "c", reason: "优先级最低" }],
          summary: `1 个共享瓶颈,3 张单争用,1 张被降级 · ${rt}`,
        },
        snapshotVersion: "ov-cr",
      });
    }),
    http.post("*/a/v1/solvers/concentration_risk/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: { startType: string; path: { toType: string }[] } };
      const rootType = args.path[args.path.length - 1]!.toType;
      const top = { rootType, rootId: `${rootType}-hub`, dependents: ["c1", "c2", "c3"], count: 3 };
      return HttpResponse.json({
        data: { concentrations: [top], topExposure: top, summary: `1 个隐性集中单点（${rootType}）,最大敞口 ${top.count} 个依赖方` },
        snapshotVersion: "ov-cr",
      });
    }),
    http.post("*/a/v1/solvers/margin_attribution/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: { targetType: string; costFields: { field: string; label?: string }[] } };
      const driver = args.costFields[0]!.label ?? args.costFields[0]!.field;
      return HttpResponse.json({
        data: {
          inverted: [{ id: `${args.targetType}-9`, revenue: 100, totalCost: 128, margin: -28, marginRate: -0.28, topDriver: { label: driver, value: 80, share: 0.625 }, attribution: [{ label: driver, value: 80, share: 0.625 }] }],
          rootDrivers: [{ label: driver, invertedCount: 1, totalValue: 80 }],
          invertedCount: 1,
          summary: `1 个目标毛利倒挂；根因主驱动 ${driver}（拉穿 1 个）`,
        },
        snapshotVersion: "ov-cr",
      });
    }),
  );
  renderApp("/v/cleanroom-attr");
}

describe("WO-U2-STEPWISE-2 · cleanroom-attr：三档各自的步骤态真正驱动结果分段", () => {
  it("U2-CR-1 · 共享瓶颈档：第 3 步没有降级结论、第 2 步连需求 138 都没有；切回末步全回来", async () => {
    renderCleanroom();
    const res = await screen.findByTestId("cr-bn-result");

    // 默认末步 = 完整结果（改前屏面）：瓶颈行真值 138/100 + 降级结论都在。
    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`cr-bn-steps-step-${n}`)).toBeInTheDocument();
    expect(within(res).getByTestId("cr-bn-row-Furnace-01")).toHaveTextContent("138");
    expect(within(res).getByTestId("cr-bn-downgraded-Furnace-01")).toHaveTextContent("优先级最低");
    // 末步口径行三要素（逐字来自图上 `downgraded` 节点）。
    expect(screen.getByTestId("cr-bn-steps-meta-data")).toHaveTextContent("downgraded[]");
    expect(screen.getByTestId("cr-bn-steps-meta-solver")).toHaveTextContent("shared_bottleneck");
    expect(screen.getByTestId("cr-bn-steps-meta-rule")).toHaveTextContent("优先级");

    // ── 第 3 步「瓶颈与争用」：瓶颈的数还在，降级结论退场 ──
    // ⚠ 第一条咬**屏上那句具体的结论文字**（变异反证要红在这里，不是红在「组件还在」）。
    fireEvent.click(screen.getByTestId("cr-bn-steps-step-3"));
    await waitFor(() => expect(screen.queryAllByText(/优先级最低/)).toHaveLength(0));
    expect(screen.queryByTestId("cr-bn-downgraded-Furnace-01")).toBeNull();
    expect(screen.getByTestId("cr-bn-row-Furnace-01")).toHaveTextContent("138");

    // ── 第 2 步「共享瓶颈求解」：连需求 138 也退场，只剩求解回执 ──
    fireEvent.click(screen.getByTestId("cr-bn-steps-step-2"));
    await waitFor(() => expect(screen.queryAllByText("138")).toHaveLength(0)); // ← 具体的数不在了
    expect(screen.queryByTestId("cr-bn-row-Furnace-01")).toBeNull();
    expect(screen.getByTestId("cr-bn-summary")).toHaveTextContent("1 个共享瓶颈");

    // ── 第 1 步「参数倒推」：回执也退场，只剩这次真正用的那组倒推参数 ──
    fireEvent.click(screen.getByTestId("cr-bn-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("cr-bn-summary")).toBeNull());
    expect(screen.getByTestId("cr-bn-step-inputs")).toHaveTextContent("Furnace");

    // ── 切回末步：全部回来 ──
    fireEvent.click(screen.getByTestId("cr-bn-steps-step-4"));
    await screen.findByTestId("cr-bn-row-Furnace-01");
    expect(screen.getByTestId("cr-bn-row-Furnace-01")).toHaveTextContent("138");
    expect(screen.getByTestId("cr-bn-downgraded-Furnace-01")).toBeInTheDocument();
  });

  it("U2-CR-2 · 隐性集中度档（三步）：第 2 步没有最大敞口 3；切回末步它回来", async () => {
    renderCleanroom();
    fireEvent.click(await screen.findByTestId("cr-tab-concentration"));
    await screen.findByTestId("cr-cc-result");

    for (let n = 1; n <= 3; n++) expect(screen.getByTestId(`cr-cc-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("cr-cc-top-count")).toHaveTextContent("3");
    expect(screen.getByTestId("cr-cc-steps-meta-solver")).toHaveTextContent("concentration_risk");

    // 第 2 步「多跳反向聚合」：敞口读数（第 3 步）退场。
    fireEvent.click(screen.getByTestId("cr-cc-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("cr-cc-top-count")).toBeNull());
    expect(screen.queryByTestId("cr-cc-top")).toBeNull();
    expect(screen.getByTestId("cr-cc-summary")).toHaveTextContent("最大敞口");

    // 第 1 步「依赖链倒推」：求解回执退场，只剩这次走的那条链。
    fireEvent.click(screen.getByTestId("cr-cc-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("cr-cc-summary")).toBeNull());
    expect(screen.getByTestId("cr-cc-step-inputs")).toHaveTextContent("supplierRef");

    fireEvent.click(screen.getByTestId("cr-cc-steps-step-3"));
    await screen.findByTestId("cr-cc-top-count");
    expect(screen.getByTestId("cr-cc-top-count")).toHaveTextContent("3");
  });

  it("U2-CR-3 · 毛利倒挂档：第 3 步没有根因表与成本拆项、第 2 步连毛利 -28 都没有；切回末步全回来", async () => {
    renderCleanroom();
    fireEvent.click(await screen.findByTestId("cr-tab-margin"));
    const res = await screen.findByTestId("cr-ma-result");

    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`cr-ma-steps-step-${n}`)).toBeInTheDocument();
    expect(within(res).getByTestId("cr-ma-inv-Product-9")).toHaveTextContent("-28");
    expect(within(res).getByTestId("cr-ma-driver-count-rawCost")).toHaveTextContent("1");

    // ── 第 3 步「倒挂判定」：倒挂目标的数还在，根因聚合与成本拆项退场 ──
    fireEvent.click(screen.getByTestId("cr-ma-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("cr-ma-drivers")).toBeNull());
    expect(screen.queryByTestId("cr-ma-driver-count-rawCost")).toBeNull();
    expect(screen.queryByTestId("cr-ma-attr-Product-9")).toBeNull();
    expect(screen.getByTestId("cr-ma-inv-Product-9")).toHaveTextContent("-28");

    // ── 第 2 步「逐目标拆成本」：连毛利 -28 也退场 ──
    fireEvent.click(screen.getByTestId("cr-ma-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("cr-ma-inv-Product-9")).toBeNull());
    expect(screen.getByTestId("cr-ma-summary")).toHaveTextContent("毛利倒挂");

    // ── 第 1 步「参数倒推」：只剩营收/成本项字段名 ──
    fireEvent.click(screen.getByTestId("cr-ma-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("cr-ma-summary")).toBeNull());
    expect(screen.getByTestId("cr-ma-step-inputs")).toHaveTextContent("rawCost");

    fireEvent.click(screen.getByTestId("cr-ma-steps-step-4"));
    await screen.findByTestId("cr-ma-drivers");
    expect(screen.getByTestId("cr-ma-inv-Product-9")).toHaveTextContent("-28");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// decision-play（决策推演）：步骤 = 图的五层
//   越线指标 → 根因 → 候选方案 → 推荐组合 → 触发规则
// ⚠ 这是**推演过程**分几步算，不是「事情分几步做」——判据 U2 显式排除后者。
// ══════════════════════════════════════════════════════════════════════════════

const DP_OPTIONS = [
  { optionId: "opt-backup-cert", factorId: "cf-upstream-cut", label: "缩短备份供应商认证周期", sourceKind: "solver",
    closesGap: 3.2, cost: 248, cycleDays: 112, risk: 0.25, exposure: 0.23, reversibility: 0.8,
    provenance: { kind: "求解器", basis: "BackupSupplierPool.certWeeks", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillValue: 16 } },
  { optionId: "opt-lta-clause", factorId: "cf-upstream-cut", label: "长协加价格联动条款", sourceKind: "agent",
    closesGap: 4.1, cost: 90, cycleDays: 30, risk: 0.2, exposure: 0.075, reversibility: 0.9,
    provenance: { kind: "策略推理", basis: "LongTermAgreement.priceLinked", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 0 } },
];
const DP_PAYLOAD = {
  rootCause: { factorId: "cf-upstream-cut", label: "上游减供", metricKey: "seg_attain_ess", gap: 27.8, unit: "%" },
  options: DP_OPTIONS,
  matrix: DP_OPTIONS.map((o) => ({
    optionId: o.optionId, label: o.label,
    dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility },
  })),
  triggers: [
    { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", signalValue: 14.29, op: ">", threshold: 12, fired: true, action: "启动备份供应商认证", thresholdSource: "trigger.default" },
  ],
  recommendedPlan: {
    planId: "plan-cf-upstream-cut", optionIds: ["opt-lta-clause", "opt-backup-cert"],
    steps: [
      { phase: "即刻", action: "长协加价格联动条款", optionRef: "opt-lta-clause" },
      { phase: "本季", action: "缩短备份供应商认证周期", optionRef: "opt-backup-cert" },
    ],
    totalClosesGap: 6.1, totalCost: 338,
  },
  sandboxNarrowing: { beforeGap: 27.8, afterGap: 21.7, narrowedPct: 21.94, ticks: 0 },
  // ⚠ 摘要刻意**不复述收窄百分比**：本用例要咬的「具体的数」是 21.94%，
  //   若摘要里也印一份，它在根因区（第 2 步）里存活 ⇒ 全屏文本断言会把闸咬成假红，
  //   看着像「闸没生效」，其实是同一个数在屏上有两个出处。固定量只留一处。
  summary: "根因「上游减供」→ 2 方案比对·推荐组合 2 项补 6.1%",
};

describe("WO-U2-STEPWISE-2 · decision-play：步骤态真正驱动结果分段", () => {
  it("U2-DP-1 · 五步逐层收：第 4 步没有触发规则行、第 3 步没有收窄 21.94%、第 2 步没有方案 3.2%、第 1 步连根因都没有", async () => {
    loginAs("planner");
    server.use(http.post("*/a/v1/solvers/decision_play/invoke", () => HttpResponse.json({ data: DP_PAYLOAD, snapshotVersion: "ov-dp" })));
    renderApp("/v/decision-play");
    await screen.findByTestId("dp-root-cause");

    // 默认末步 = 完整结果（改前屏面）：五层的数全在。
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`dp-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("dp-root-gap")).toHaveTextContent("27.8%");
    expect(screen.getByTestId("dp-matrix-opt-backup-cert-closesGap")).toHaveTextContent("3.2%");
    expect(screen.getByTestId("dp-narrowed-pct")).toHaveTextContent("21.94%");
    expect(screen.getByTestId("dp-action-opt-backup-cert")).toBeInTheDocument();

    // ── 第 4 步「推荐组合」：收窄读数还在，逐条触发规则退场 ──
    fireEvent.click(screen.getByTestId("dp-steps-step-4"));
    await waitFor(() => expect(screen.queryByTestId("dp-action-opt-backup-cert")).toBeNull());
    expect(screen.getByTestId("dp-narrowed-pct")).toHaveTextContent("21.94%");

    // ── 第 3 步「候选方案」：连收窄 21.94% 也退场，方案六维还在 ──
    // ⚠ 第一条咬**那个具体的数 21.94%**（变异反证要红在这里）。
    fireEvent.click(screen.getByTestId("dp-steps-step-3"));
    await waitFor(() => expect(screen.queryAllByText(/21\.94/)).toHaveLength(0)); // ← 具体的数不在了
    expect(screen.queryByTestId("dp-narrowed-pct")).toBeNull();
    expect(screen.getByTestId("dp-matrix-opt-backup-cert-closesGap")).toHaveTextContent("3.2%");

    // ── 第 2 步「根因」：方案的数退场，根因还在 ──
    fireEvent.click(screen.getByTestId("dp-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("dp-matrix")).toBeNull());
    expect(screen.queryByTestId("dp-options")).toBeNull();
    expect(screen.getByTestId("dp-root-gap")).toHaveTextContent("27.8%");

    // ── 第 1 步「越线指标」：连根因都退场，只剩这条链的起点（哪个指标越线、缺口多少） ──
    fireEvent.click(screen.getByTestId("dp-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("dp-root-cause")).toBeNull());
    // 承载根因结论的两个元素（缺口读数 + 摘要）都不在了。
    // ⚠ 这里**不做全屏文本断言**：推演过程图（判据 U3）一直挂着，它的节点标签本就写着
    //   「根因 上游减供 / 缺口 27.8%」——那是**这条链的地图**，不是这一步的读数。
    //   分段闸管的是「读数」，不是「地图」；拿地图上的字去咬闸会得出「闸没生效」的假红。
    expect(screen.queryByTestId("dp-root-gap")).toBeNull();
    expect(screen.queryByTestId("dp-summary")).toBeNull();
    expect(screen.queryAllByText(/2 方案比对/)).toHaveLength(0);
    expect(screen.getByTestId("dp-step-inputs-gap")).toHaveTextContent("27.8%");

    // ── 切回末步：全部回来 ──
    fireEvent.click(screen.getByTestId("dp-steps-step-5"));
    await screen.findByTestId("dp-action-opt-backup-cert");
    expect(screen.getByTestId("dp-narrowed-pct")).toHaveTextContent("21.94%");
    expect(screen.getByTestId("dp-matrix-opt-backup-cert-closesGap")).toHaveTextContent("3.2%");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// sop-balance（月度规划）：步骤 = SOP_GRAPH 五层
//   ①② 评审输入 → ③ 供应评审 → ④ 财务整合 → ⑤ 决议回灌 → 顶栏结论读数
//
// ⚠ 本页是上一单（WO-U2-STEPWISE-1）评估后**暂缓**的那一格，理由是「五步按钮 = 业务流程」。
//   那个理由对**按钮**成立，但不度量本页有没有推演过程 —— `SOP_GRAPH`（WO-U3-DAG-REST 落地，
//   边逐条取自 `apps/datacore/src/sop.ts` 实测）证明推演链是真的。本用例逐条咬三条分水岭：
//   ① 步骤条把 ①② 合成一格（业务流程里它们是两个按钮）；
//   ② 多一层业务流程没有的「顶栏结论读数」；
//   ③ 切步只改**读数**，五步法按钮一个不动、照常可点。
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U2-STEPWISE-2 · sop-balance：步骤态真正驱动结果分段（且不是那五个业务按钮）", () => {
  it("U2-SOP-1 · 五步逐层收：第 4 步没有顶栏六卡、第 1 步连可供给都没有；五步法按钮全程不受影响", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");

    // 建版本 → 跑 ① ② ③（让 s2/s3 有真值）。
    await user.click(await screen.findByTestId("sop-create"));
    await screen.findByTestId("sop-kpi-bar");
    await user.click(screen.getByTestId("sop-run-1"));
    await screen.findByTestId("sop-s1-table");
    await user.click(screen.getByTestId("sop-step-chip-2"));
    await user.click(await screen.findByTestId("sop-run-2"));
    await screen.findByTestId("sop-s2-table");
    await user.click(screen.getByTestId("sop-step-chip-3"));
    await user.click(await screen.findByTestId("sop-run-3"));
    await screen.findByTestId("sop-gap");

    // ── 分水岭①：步骤条 5 步，且第 1 步一格盖住业务流程的 ① 与 ② 两个按钮 ──
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`sop-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("sop-steps-step-1")).toHaveTextContent("①②");
    // ── 分水岭②：末步是「顶栏结论读数」——业务流程里没有这一步 ──
    expect(screen.getByTestId("sop-steps-step-5")).toHaveTextContent("读数");
    expect(screen.getByTestId("sop-steps-meta-solver")).toHaveTextContent("S&OP");

    // 默认末步 = 完整结果：顶栏六卡在，链上读数也在。
    expect(screen.getByTestId("sop-kpi-bar")).toBeInTheDocument();
    expect(screen.getByTestId("sop-kpi-gap")).toBeInTheDocument();
    expect(screen.getByTestId("sop-chain-s3")).toHaveTextContent("22.7");

    // ── 第 4 步「⑤ 决议回灌」：顶栏那六个结论数字整块退场 ──
    // ⚠ 这里咬**承载那个数的元素**而不是全屏文本：同一个供给/缺口数在下方 ③ 面板的
    //   `sop-gap` 里也印着一份（那是③自己的读数，不归顶栏这一层管）。
    //   拿全屏文本去咬会把「另一处合法的同名数」读成「闸没生效」——假红。
    fireEvent.click(screen.getByTestId("sop-steps-step-4"));
    await waitFor(() => expect(screen.queryByTestId("sop-kpi-bar")).toBeNull());
    expect(screen.queryByTestId("sop-kpi-gap")).toBeNull();
    expect(screen.queryByTestId("sop-kpi-demand")).toBeNull();
    expect(screen.getByTestId("sop-chain-s5")).toBeInTheDocument();

    // ── 第 3 步「④ 财务整合」：⑤ 的终版供给退场 ──
    fireEvent.click(screen.getByTestId("sop-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("sop-chain-s5")).toBeNull());
    expect(screen.getByTestId("sop-chain-s4")).toBeInTheDocument();

    // ── 第 2 步「③ 供应评审」：④ 的现金垫退场，可供给还在 ──
    fireEvent.click(screen.getByTestId("sop-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("sop-chain-s4")).toBeNull());
    expect(screen.getByTestId("sop-chain-s3")).toHaveTextContent("22.7");

    // ── 第 1 步「①② 评审输入」：连可供给 22.7 也退场，只剩需求 P50 ──
    fireEvent.click(screen.getByTestId("sop-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("sop-chain-s3")).toBeNull());
    expect(screen.getByTestId("sop-chain-s2")).toBeInTheDocument();

    // ── 分水岭③：切步全程，五步法业务按钮一个没少、还能点 ──
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`sop-step-chip-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("sop-step3")).toBeInTheDocument();

    // ── 切回末步：顶栏六卡回来 ──
    fireEvent.click(screen.getByTestId("sop-steps-step-5"));
    await screen.findByTestId("sop-kpi-bar");
    expect(screen.getByTestId("sop-kpi-gap")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// disruption-radius（影响半径）：步骤 = 链路倒推 → 逐层扇出 → 半径与敞口 → 逐层明细
// ══════════════════════════════════════════════════════════════════════════════

/** 本体：Supplier ← Material(supplierRef) ← Order(materialRef) ← Customer(orderRef)。 */
const DR_TYPES = [
  { key: "Supplier", displayName: "供应商", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }] },
  { key: "Material", displayName: "物料", status: "ACTIVE", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }] },
  { key: "Order", displayName: "销售订单", status: "ACTIVE", properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" }] },
  { key: "Customer", displayName: "客户", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", refToTypeKey: "Order" }] },
];
const DR_OBJECTS: Record<string, { id: string; type: string; props: Record<string, unknown> }[]> = {
  Supplier: [{ id: "sup_1", type: "Supplier", props: { supplierId: "华东电解液", name: "华东电解液" } }],
  Material: [
    { id: "m1", type: "Material", props: { matId: "正极A", supplierRef: "华东电解液" } },
    { id: "m2", type: "Material", props: { matId: "电解液B", supplierRef: "华东电解液" } },
  ],
  Order: [
    { id: "o1", type: "Order", props: { soId: "SO1", materialRef: "正极A" } },
    { id: "o2", type: "Order", props: { soId: "SO2", materialRef: "电解液B" } },
  ],
  Customer: [{ id: "c1", type: "Customer", props: { custId: "CUST1", orderRef: "SO1" } }],
};
const DR_PK: Record<string, string> = { Supplier: "supplierId", Material: "matId", Order: "soId", Customer: "custId" };

/** 忠实迷你引擎（与 `disruption-radius.test.tsx` 同口径：按 args 现算，不按 rootId 写死）。 */
function drSolve(args: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] }) {
  let frontier = new Set<string>([args.rootId]);
  const result: { type: string; viaField: string; count: number; ids: string[] }[] = [];
  let radius = 0;
  for (const layer of args.layers) {
    const objs = DR_OBJECTS[layer.type] ?? [];
    const pk = DR_PK[layer.type];
    const hit = objs.filter((o) => frontier.has(String(o.props[layer.viaField] ?? "")));
    const ids = hit.map((o) => String((pk ? o.props[pk] : undefined) ?? o.id)).sort();
    result.push({ type: layer.type, viaField: layer.viaField, count: ids.length, ids });
    if (ids.length > 0) radius += 1;
    frontier = new Set(ids);
    if (ids.length === 0) break;
  }
  const leaf = result[result.length - 1];
  const totalAffected = result.reduce((s, l) => s + l.count, 0);
  return {
    rootType: args.rootType, rootId: args.rootId, layers: result, radius, totalAffected,
    leafType: leaf?.type ?? null, leafCount: leaf?.count ?? 0,
    summary: `断供「${args.rootId}」影响半径 ${radius} 层、波及 ${totalAffected} 个对象；叶层 ${leaf?.type ?? "—"} ${leaf?.count ?? 0} 个`,
  };
}

describe("WO-U2-STEPWISE-2 · disruption-radius：步骤态真正驱动结果分段", () => {
  it("U2-DR-1 · 四步逐层收：第 3 步没有逐层明细、第 2 步没有半径 3 层、第 1 步连扇出图都没有", async () => {
    loginAs("planner");
    server.use(
      http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(DR_TYPES)),
      http.get("*/a/v1/objects", ({ request }) => {
        const type = new URL(request.url).searchParams.get("type") ?? "";
        const items = DR_OBJECTS[type] ?? [];
        return HttpResponse.json({ items, total: items.length });
      }),
      http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { args?: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] } };
        return HttpResponse.json({ data: drSolve(body.args!), snapshotVersion: "ov-dr" });
      }),
    );
    renderApp("/v/disruption-radius");
    await screen.findByTestId("dr-layers");

    // 默认末步 = 完整结果（改前屏面）。
    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`dr-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("dr-steps-meta-data")).toHaveTextContent("layers[].ids");
    expect(screen.getByTestId("dr-steps-meta-solver")).toHaveTextContent("supplier_disruption_radius");
    expect(screen.getByTestId("dr-radius")).toHaveTextContent("3 层");
    expect(screen.getByTestId("dr-total")).toHaveTextContent("5");
    expect(screen.getByTestId("dr-layer-count-0")).toHaveTextContent("2 个");

    // ── 第 3 步「半径与敞口」：半径/波及还在，逐层明细退场 ──
    fireEvent.click(screen.getByTestId("dr-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("dr-layers")).toBeNull());
    expect(screen.queryByTestId("dr-layer-count-0")).toBeNull();
    expect(screen.getByTestId("dr-radius")).toHaveTextContent("3 层");

    // ── 第 2 步「逐层扇出」：半径 3 层与波及 5 个都退场，扇出图还在 ──
    // ⚠ 第一条咬**那句带数的结论「波及 5 个对象」**（变异反证要红在这里）。
    fireEvent.click(screen.getByTestId("dr-steps-step-2"));
    await waitFor(() => expect(screen.queryAllByText(/波及 5 个对象/)).toHaveLength(0)); // ← 具体的数不在了
    expect(screen.queryByTestId("dr-radius")).toBeNull();
    expect(screen.queryByTestId("dr-total")).toBeNull();
    expect(screen.getByTestId("dr-fanout")).toBeInTheDocument();

    // ── 第 1 步「链路倒推」：扇出图也退场，只剩上方那条倒推出来的链 ──
    fireEvent.click(screen.getByTestId("dr-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("dr-dag")).toBeNull());
    expect(screen.queryByTestId("dr-fanout")).toBeNull();
    expect(screen.getByTestId("dr-chain")).toHaveTextContent("supplierRef");

    // ── 切回末步：全部回来 ──
    fireEvent.click(screen.getByTestId("dr-steps-step-4"));
    await screen.findByTestId("dr-layers");
    expect(screen.getByTestId("dr-radius")).toHaveTextContent("3 层");
    expect(screen.getByTestId("dr-layer-count-0")).toHaveTextContent("2 个");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// order-chain（订单全链）：步骤 = 筛选与取数 → 一次求解(三个并列产物) → 经营估算
//
// ⚠ 只有三步是**实测逼出来的**：`affected_orders` 的输出白名单
//   （`apps/datacore/src/solvers/service.ts:516`）里 rows / summary / problems 同出一次求解、
//   互不为输入 ⇒ 它们是**并列产物**，摊成三步就是画一条不存在的因果链。
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U2-STEPWISE-2 · order-chain：步骤态真正驱动结果分段", () => {
  it("U2-OC-1 · 三步逐层收：第 2 步没有经营看板、第 1 步连 8 单汇总与明细表都没有；切回末步全回来", async () => {
    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("oc-econ-table");

    // 默认末步 = 完整结果（改前屏面）。
    for (let n = 1; n <= 3; n++) expect(screen.getByTestId(`oc-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("oc-steps-meta-solver")).toHaveTextContent("前端投影");
    expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8");
    expect(screen.getByTestId("oc-detail-table")).toBeInTheDocument();
    expect(screen.getByTestId("oc-problems")).toBeInTheDocument();

    // 第 2 步口径行：如实写「3 个并列产物」，不挑一个冒充全层。
    fireEvent.click(screen.getByTestId("oc-steps-step-2"));
    expect(screen.getByTestId("oc-steps-meta-solver")).toHaveTextContent("affected_orders");
    expect(screen.getByTestId("oc-steps-meta-rule")).toHaveTextContent("互不为输入");

    // ── 第 2 步：求解产物都在，经营估算（第 3 步）退场 ──
    await waitFor(() => expect(screen.queryByTestId("oc-econ-table")).toBeNull());
    expect(screen.queryByTestId("oc-econ-footnote")).toBeNull();
    expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8");

    // ── 第 1 步「筛选与取数」：连 8 单汇总、明细表、问题卡全退场，只剩筛选器 ──
    fireEvent.click(screen.getByTestId("oc-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("oc-sum-orders")).toBeNull());
    expect(screen.queryByTestId("oc-detail-table")).toBeNull();
    expect(screen.queryByTestId("oc-problems")).toBeNull();
    expect(screen.queryAllByTestId(/^oc-row-/)).toHaveLength(0); // ← 逐单的数一条不剩
    expect(screen.getByTestId("oc-base-filter")).toBeInTheDocument();

    // ── 切回末步：全部回来 ──
    fireEvent.click(screen.getByTestId("oc-steps-step-3"));
    await screen.findByTestId("oc-econ-table");
    expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8");
    expect(screen.getAllByTestId(/^oc-row-/).length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// risk-board（产能推演）：步骤 = 窗口与入参 → 逐日张力推演 → 越线判定 → 影响面与排序 → 处置计划
// 逐步字段取自 `RiskTimelineOutputSchema` / `RiskCardSchema`（contracts 契约，非白话）。
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U2-STEPWISE-2 · risk-board：步骤态真正驱动结果分段", () => {
  it("U2-RK-1 · 五步逐层收：第 4 步没有处置表、第 3 步没有影响面、第 2 步没有越线日、第 1 步连卡都没有", async () => {
    loginAs("planner");
    renderApp("/v/risk");
    const cards = await screen.findAllByTestId(/^risk-card-/, {}, { timeout: 15_000 });
    const base = (cards[0]!.getAttribute("data-testid") ?? "").replace("risk-card-", "");

    // 默认末步 = 完整结果（改前屏面）。
    for (let n = 1; n <= 5; n++) expect(screen.getByTestId(`rk-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("rk-steps-meta-data")).toHaveTextContent("planRows[]");
    expect(screen.getByTestId("rk-steps-meta-solver")).toHaveTextContent("risk_timeline");
    expect(screen.getByTestId("risk-kpi-bases")).toBeInTheDocument();
    expect(screen.getByTestId("risk-kpi-earliest")).toBeInTheDocument();
    expect(screen.getByTestId("risk-kpi-orders")).toBeInTheDocument();
    expect(screen.getByTestId(`risk-peak-${base}`)).toBeInTheDocument();
    const peakText = screen.getByTestId(`risk-peak-${base}`).textContent ?? "";
    expect(peakText.length).toBeGreaterThan(0);

    // ── 第 4 步「影响面与排序」：处置计划表退场 ──
    fireEvent.click(screen.getByTestId("rk-steps-step-4"));
    await waitFor(() => expect(screen.queryByTestId("risk-plan-panel")).toBeNull());
    expect(screen.getByTestId("risk-kpi-orders")).toBeInTheDocument();

    // ── 第 3 步「越线判定」：影响面两个 KPI 退场，越线日还在 ──
    fireEvent.click(screen.getByTestId("rk-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("risk-kpi-orders")).toBeNull());
    expect(screen.queryByTestId("risk-kpi-custs")).toBeNull();
    expect(screen.getByTestId("risk-kpi-earliest")).toBeInTheDocument();
    expect(screen.getByTestId(`risk-peak-${base}`)).toBeInTheDocument();

    // ── 第 2 步「逐日张力推演」：连卡面那个峰值/越线日的数也退场，卡还在 ──
    fireEvent.click(screen.getByTestId("rk-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId(`risk-peak-${base}`)).toBeNull());
    expect(screen.queryByTestId("risk-kpi-earliest")).toBeNull();
    expect(screen.queryAllByText(peakText)).toHaveLength(0); // ← 那个具体的数不在了
    expect(screen.getByTestId(`risk-card-${base}`)).toBeInTheDocument();
    expect(screen.getByTestId("risk-kpi-bases")).toBeInTheDocument();

    // ── 第 1 步「窗口与入参」：卡整批退场，只剩窗口 chip ──
    fireEvent.click(screen.getByTestId("rk-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId(`risk-card-${base}`)).toBeNull());
    expect(screen.queryAllByTestId(/^risk-card-/)).toHaveLength(0);
    expect(screen.queryByTestId("risk-kpi-bases")).toBeNull();
    expect(screen.getByTestId("risk-window-30")).toBeInTheDocument();

    // ── 切回末步：全部回来 ──
    fireEvent.click(screen.getByTestId("rk-steps-step-5"));
    await screen.findByTestId(`risk-card-${base}`);
    expect(screen.getByTestId(`risk-peak-${base}`)).toHaveTextContent(peakText);
    expect(screen.getByTestId("risk-kpi-orders")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// sim-sandbox（推演沙盘）：步骤 = 会话与配置 → 施加扰动 → 世界传播 → 影响带读数
//
// 走**真 endpoints + MSW 拦真 URL**（与 `sandbox-perturbation.seam.test.tsx` 同一套：
// 世界态改写直接调契约里的 `applyPerturbationToState` —— 桩不自己写一套「大概是这样改」）。
// ══════════════════════════════════════════════════════════════════════════════

const SB_CFG: SandboxViewConfig = {
  tenantId: "tenant-u2",
  nodeTypes: ["TypeA", "TypeB"],
  nodeObjectIds: { TypeA: ["obj_a1"], TypeB: ["obj_b1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load", "risk"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function installSbHandlers(): void {
  let world: TickState = {};
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      world = JSON.parse(JSON.stringify(body.baseSnapshot ?? {})) as TickState;
      return HttpResponse.json(
        { id: "sims_u2", tenantId: "demo", baseSnapshot: world, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-10T00:00:00.000Z" },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions/:id/world", () => HttpResponse.json({ tick: 0, state: world })),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [] })),
    http.post("*/a/v1/sim/sessions/:id/perturbations", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const p = {
        id: "simpert_u2", tenantId: "demo", sessionId: "sims_u2",
        kind: body.kind, targetObjectId: body.targetObjectId, targetStateVar: body.targetStateVar,
        startTick: 0, durationTicks: (body.durationTicks ?? null) as number | null,
        magnitude: Number(body.magnitude), mode: (body.mode ?? "set") as "set" | "delta" | "scale",
        label: String(body.label), createdAt: "2026-08-10T00:00:00.000Z",
      } as unknown as Perturbation;
      world = applyPerturbationToState(world, p);
      return HttpResponse.json({ perturbation: p, curTick: 0, state: world }, { status: 201 });
    }),
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "off", requestId: "r" } }, { status: 404 }),
    ),
  );
}

describe("WO-U2-STEPWISE-2 · sim-sandbox：步骤态真正驱动结果分段", () => {
  it("U2-SB-1 · 四步逐层收：第 3 步没有影响带、第 2 步没有全局态读数、第 1 步连扰动前后值都没有", async () => {
    const user = userEvent.setup();
    installSbHandlers();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxView injectedConfig={SB_CFG} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");

    // 施加一条真扰动（真 endpoints + 真 URL），让第 2/3 步各自有真值可看。
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "obj_a1");
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-statevar"), "load");
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-mode"), "delta");
    const mag = screen.getByTestId("sandbox-perturbation-magnitude");
    await user.clear(mag);
    await user.type(mag, "40");
    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    await screen.findByTestId("sandbox-perturbation-last");

    // 默认末步 = 完整结果（改前屏面）。
    for (let n = 1; n <= 4; n++) expect(screen.getByTestId(`sb-steps-step-${n}`)).toBeInTheDocument();
    expect(screen.getByTestId("sb-steps-meta-solver")).toHaveTextContent("impact-analysis");
    const kpiText = screen.getByTestId("sandbox-kpi-global-val").textContent ?? "";
    const deltaText = screen.getByTestId("sandbox-perturbation-last-delta").textContent ?? "";
    expect(kpiText.length).toBeGreaterThan(0);
    expect(deltaText).toContain("→");
    expect(screen.getByTestId("sandbox-impact-band")).toBeInTheDocument();

    // ── 第 3 步「世界传播」：影响带退场，全局态读数还在 ──
    fireEvent.click(screen.getByTestId("sb-steps-step-3"));
    await waitFor(() => expect(screen.queryByTestId("sandbox-impact-band")).toBeNull());
    expect(screen.getByTestId("sandbox-kpi-global-val")).toHaveTextContent(kpiText);

    // ── 第 2 步「施加扰动」：连全局态那个数也退场，扰动前后值还在 ──
    fireEvent.click(screen.getByTestId("sb-steps-step-2"));
    await waitFor(() => expect(screen.queryByTestId("sandbox-kpi-global-val")).toBeNull());
    expect(screen.queryByTestId("sandbox-kpis")).toBeNull();
    expect(screen.queryByTestId("sandbox-kpi-origin")).toBeNull();
    expect(screen.getByTestId("sandbox-perturbation-last-delta")).toHaveTextContent(deltaText);

    // ── 第 1 步「会话与配置」：扰动前后值也退场，左区输入控件**照常可用**（闸的是数不是控件） ──
    fireEvent.click(screen.getByTestId("sb-steps-step-1"));
    await waitFor(() => expect(screen.queryByTestId("sandbox-perturbation-last")).toBeNull());
    expect(screen.queryByTestId("sandbox-perturbation-last-delta")).toBeNull();
    expect(screen.getByTestId("sandbox-perturbation-object")).toBeInTheDocument();
    expect(screen.getByTestId("sandbox-perturbation-apply-btn")).toBeInTheDocument();

    // ── 切回末步：全部回来 ──
    fireEvent.click(screen.getByTestId("sb-steps-step-4"));
    await screen.findByTestId("sandbox-impact-band");
    expect(screen.getByTestId("sandbox-kpi-global-val")).toHaveTextContent(kpiText);
    expect(screen.getByTestId("sandbox-perturbation-last-delta")).toHaveTextContent(deltaText);
  });
});
