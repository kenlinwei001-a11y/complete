import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-U3-DAG-SPLIT · 判据 **U3**（过程图 + 点节点看凭什么）两张有图页的接线测试。
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U3）：
 *   「页内有推演过程图，**且**节点点击真接到一个面板，面板里同时有 **来源** 与 **规则**」
 *
 * 分诊（8 页逐页判，file:line 见交单报告）：8 页里只有 **risk**（ProvenanceDag 根因推演树）
 * 与 **plan-generate**（KsfGraph 三层有向图）两页有图，本单接线这两页；其余 6 页无图，
 * 不在本单做（差什么 + 怎么与 U2 合并设计，见交单报告「没做的格」）。
 *
 * 两页的病不同，测试也分开咬：
 *  · risk：图有、hover 溯源也有，但**没有 click**（NodeProv 是 onMouseEnter），且节点上
 *    根本没有「规则」这一层（DagNode 契约只有 basis）⇒ 点了看不到「凭什么这么判」。
 *  · plan-generate：KsfGraph 点击有反应（高亮+联动时序），但**没有面板**——反应 ≠ 看得
 *    到来源与规则（「点了有反应就算」恰是判据点名的假绿）。
 *
 * ⚠ 规则性质分档是判据的诚实位（徽章必须分得出来）：
 *  · risk 基地层 = 真规则键 `gap_attribution_coeffs`（PUBLISHED RuleEntry.params·规则库里查得到）；
 *  · 其余节点（越线/分摊/溯因/下钻）与 KSF 图全档 = 确定性投影规则（规则库里**没有**，
 *    标成「规则键」会把用户支去找一个不存在的东西）。
 */

/** risk 页确定性归因树（KILL-MOCK：节点 id/占比/下钻值全是显式桩·逐字咬）。 */
function riskGapAttrHandlers() {
  return [
    http.post("*/a/v1/solvers/gap_attribution/invoke", async () =>
      HttpResponse.json({
        data: {
          rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
          totalGap: 27.8,
          scope: { baseId: "changzhou", availableFactors: [] },
          levels: [
            { depth: 1, label: "基地", residual: 2.1, nodes: [{ id: "base:常州", factor: "基地 常州", contribution: 9.2, unit: "%", share: 0.33 }] },
            {
              depth: 2, label: "订单/瓶颈", residual: 1.0, nodes: [
                { id: "equip:常州", factor: "常州 设备瓶颈", contribution: 4.1, unit: "%", share: 0.5, path: ["m1", "base:常州", "equip:常州"], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } },
                { id: "material:cathode", factor: "正极物料短缺", contribution: 3.0, unit: "%", share: 0.3, path: ["m1", "base:常州", "material:cathode"], provenance: { drillType: "MaterialBalance", drillField: "gapTon", drillValue: 1820 } },
              ],
            },
            {
              depth: 3, label: "因果链", residual: 0, nodes: [
                { id: "cf:cathode-price", factor: "正极原料涨价", contribution: 2.2, unit: "%", share: 0.7, provenance: { drillType: "CommodityPriceTrend", drillField: "pctChange", drillValue: 12.4 } },
                { id: "cf:geo-chile", factor: "智利矿地缘扰动", contribution: 1.5, unit: "%", share: 0.6, provenance: { kind: "外部信号", provenanceSynthetic: true } },
              ],
            },
          ],
          causalEdges: [
            { from: "seed", to: "cathode-price" },
            { from: "cathode-price", to: "geo-chile" },
          ],
          atomicLeaves: [], reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%",
        },
        snapshotVersion: "ov-u3",
      }),
    ),
  ];
}

async function openRiskDetail(): Promise<void> {
  loginAs("planner");
  renderApp("/v/risk");
  fireEvent.click(await screen.findByTestId("risk-card-常州"));
  await screen.findByTestId("risk-detail-常州");
  await screen.findByTestId("rootcause-panel-常州");
}

describe("WO-U3-DAG-SPLIT · risk：根因推演树点节点 → 面板带来源+规则", () => {
  it("U3-D1 · 点越线根（kpi）→ 面板出来源（gap_attribution）+ 规则（越线判定·确定性投影）+ 缺口推导式", async () => {
    server.use(...riskGapAttrHandlers());
    await openRiskDetail();
    await screen.findByTestId("dag-node-kpi:seg_attain_ess");
    expect(screen.queryByTestId("dag-node-inspector")).toBeNull();

    fireEvent.click(screen.getByTestId("dag-node-kpi:seg_attain_ess"));

    const panel = await screen.findByTestId("dag-node-inspector");
    // 来源：求解器与作用域（这次请求本身）。
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("gap_attribution");
    // 规则：节点级判定逻辑（越线 = actual < floorVal）——能定位「哪一环判错了」。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("越线判定");
    // 推导式：缺口 = 目标 − 实际（桩真值逐字）。
    expect(within(panel).getByTestId("dag-node-inspector-formula")).toHaveTextContent("缺口 = 目标 100 − 实际 72.2");
    // 诚实位：节点级判定是确定性投影，不是规则库键。
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "projection");
  });

  it("U3-D2 · 点基地层（ksf）→ 规则那栏是**真规则键** gap_attribution_coeffs（规则库里查得到·徽章=规则键）", async () => {
    server.use(...riskGapAttrHandlers());
    await openRiskDetail();
    await screen.findByTestId("dag-node-base:常州");

    fireEvent.click(screen.getByTestId("dag-node-base:常州"));

    const panel = await screen.findByTestId("dag-node-inspector");
    // ⚠ 这是本页唯一一档 ruleKey：结构分摊系数是一等 RuleEntry.params（改系数即改归因）。
    // 咬的是键名本身——哪天面板改成不写这个键，本条红。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("gap_attribution_coeffs.structuralExplained");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "ruleKey");
    expect(within(panel).getByTestId("dag-node-inspector-rule-kind")).toHaveTextContent("规则键");
    // 分摊口径（确定性投影部分）在推导式里，不混进规则键一栏。
    expect(within(panel).getByTestId("dag-node-inspector-formula")).toHaveTextContent("结构反向分摊");
  });

  it("U3-D3 · 点因果叶（caused_by 链）→ 规则=逐跳溯源口径（投影）；点证据叶 → 来源=下钻 DB 对象字段", async () => {
    server.use(...riskGapAttrHandlers());
    await openRiskDetail();
    await screen.findByTestId("dag-node-cf:geo-chile");

    // 因果叶：规则是 caused_by 逐跳溯源（占比分摊·不再切 gap）。
    fireEvent.click(screen.getByTestId("dag-node-cf:geo-chile"));
    let panel = await screen.findByTestId("dag-node-inspector");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("caused_by");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "projection");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("dag-node-inspector")).toBeNull());

    // 证据叶：来源是下钻对象字段真值（MaterialBalance.gapTon=1820·桩真值逐字）。
    fireEvent.click(screen.getByTestId("dag-node-material:cathode:ev"));
    panel = await screen.findByTestId("dag-node-inspector");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("MaterialBalance");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("gapTon");
    expect(within(panel).getByTestId("dag-node-inspector-verdict")).toHaveTextContent("1820");

    // 反向断言：关闭后面板真的消失（防「面板一直在 DOM 里」把上面各条骗绿）。
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("dag-node-inspector")).toBeNull());
  });
});

describe("WO-U3-DAG-SPLIT · plan-generate：KSF 图点节点 → 面板带来源+规则", () => {
  it("U3-D4 · 点问题节点 → 面板出来源（ksf_graph 越线 Metric）+ 规则（severity 判定·确定性投影），且带该节点真值输入", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");
    const graphs = await screen.findAllByTestId("gen-ksf-graph");
    expect(screen.queryByTestId("dag-node-inspector")).toBeNull();

    fireEvent.click(within(graphs[0]!).getByTestId("ksf-problem-prob:kpi-margin"));

    const panel = await screen.findByTestId("dag-node-inspector");
    // 来源：求解器 + 越线判定依据。
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("ksf_graph");
    // 规则：severity 怎么判的（H/M/S + 保图非空口径）——能定位「这个 H 是哪来的」。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("floorVal");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("gap≥2 → H");
    // ⚠ ksf_graph 无业务规则库——徽章必须是「确定性投影规则」，不许冒充规则键。
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "projection");
    expect(within(panel).getByTestId("dag-node-inspector-rule-kind")).toHaveTextContent("确定性投影规则");
    // 该节点真值输入（桩真值逐字：severity H · gap 3.0）。
    expect(within(panel).getByTestId("dag-node-inspector-verdict")).toHaveTextContent("严重度 H");
    expect(within(panel).getByTestId("dag-node-inspector-inputs")).toHaveTextContent("gap");
    expect(within(panel).getByTestId("dag-node-inspector-inputs")).toHaveTextContent("3");
  });

  it("U3-D5 · 点 KSF 层与财务指标层节点 → 各自规则（传导投影 / 状态三态），且关闭后面板消失", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");
    await screen.findByTestId("gen-result");
    const graphs = await screen.findAllByTestId("gen-ksf-graph");

    // KSF 层：规则 = 威胁边/支撑边怎么连的（按 Metric.ksfRef）。
    fireEvent.click(within(graphs[0]!).getByTestId("ksf-node-k_dem"));
    let panel = await screen.findByTestId("dag-node-inspector");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("KSF 一等对象");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("ksfRef");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "projection");

    // 财务指标层：规则 = 状态三态（RED/AMBER/GREEN 怎么判），带该节点真值（13/16%·RED）。
    fireEvent.click(within(graphs[0]!).getByTestId("ksf-fin-fin:kpi-margin"));
    panel = await screen.findByTestId("dag-node-inspector");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("actual < floorVal → RED");
    expect(within(panel).getByTestId("dag-node-inspector-verdict")).toHaveTextContent("13/16%");
    expect(within(panel).getByTestId("dag-node-inspector-verdict")).toHaveTextContent("RED");

    // 反向断言：关闭后面板真的消失。
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("dag-node-inspector")).toBeNull());
  });
});
