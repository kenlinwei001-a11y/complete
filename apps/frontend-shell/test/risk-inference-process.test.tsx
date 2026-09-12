import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CAPACITY-INFER-PROCESS · 产能/风险看板「推演过程」可见（可信=过程可见·KILL-MOCK·断在接缝不在模块）。
 * CI-a 基地根因推演树（gap_attribution 真求解器投影到本基地·<ProvenanceDag> 复用）+
 * CI-b 方案比对推演链（mitigation_select 真求解器：对症根因 / score 跨方案比对矩阵 / 预期堵口）+
 * 诚实灰（缺源不伪造）+ C5 采纳仍走 adopt_mitigation 草稿（门不绕）。
 * 齿：数字全部来自 mock 求解器输出（改 mock → 渲染变），非前端写死常数。
 */

// 风险卡：基地「常州」· 主因素「物料齐套」（可对齐 gap_attribution 根因树 + mitigation 方案库）。
function riskTimelineMock() {
  return http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
    HttpResponse.json({
      data: {
        horizon: 30, threshold: 85,
        cards: [{
          base: "常州", baseId: "cz", factor: "物料齐套", peak: 96, crossDay: 5,
          series: Array.from({ length: 30 }, (_, i) => Math.min(96, 50 + i * 2)),
          events: [], provenanceSynthetic: false, affectedOrders: [],
        }],
        planRows: [],
      },
      snapshotVersion: "ov-infer",
    }),
  );
}

// gap_attribution：全局储能达成率越线 → 结构反向分摊（基地常州 → 设备OEE/物料短缺/订单叶·带 path 归属）→
// 物料短缺挂 caused_by 因果链（上游减供→认证周期长 root）。每叶下钻真对象字段（R13）。
function gapAttributionMock(base = "常州") {
  return http.post("*/a/v1/solvers/gap_attribution/invoke", () =>
    HttpResponse.json({
      data: {
        rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
        totalGap: 27.8,
        levels: [
          { depth: 1, label: "基地", residual: 2.1, nodes: [{ id: `base:${base}`, factor: `基地 ${base}`, contribution: 9.2, unit: "%", share: 0.33 }] },
          {
            depth: 2, label: "订单/瓶颈", residual: 1.0, nodes: [
              { id: `equip:${base}`, factor: `${base} 设备瓶颈（OEE 缺口）`, contribution: 4.1, unit: "%", share: 0.5, path: ["m1", `base:${base}`, `equip:${base}`], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } },
              { id: "material:cathode", factor: "正极物料短缺", contribution: 3.0, unit: "%", share: 0.3, path: ["m1", `base:${base}`, "material:cathode"], provenance: { drillType: "MaterialBalance", drillField: "gapTon", drillValue: 1820 } },
              { id: "order:SO-9", factor: "订单 SO-9（宁德）", contribution: 2.1, unit: "%", share: 0.2, path: ["m1", `base:${base}`, "order:SO-9"], provenance: { drillType: "Order", drillField: "value", drillValue: 435 } },
            ],
          },
          {
            depth: 3, label: "因果链（caused_by）", residual: 0.7, nodes: [
              { id: "cf:cf-upstream-cut", factor: "上游减供", contribution: 2.4, unit: "%", share: 0.6, provenance: { drillType: "Supplier", drillField: "actualSupplyTon", drillValue: 820 } },
              { id: "cf:cf-cert-cycle", factor: "认证周期长(root)", contribution: 0.4, unit: "%", share: 0.4, provenance: { drillType: "BackupSupplierPool", drillField: "certWeeks", drillValue: 16 } },
            ],
          },
        ],
        causalEdges: [
          { from: "cf-cathode-shortage", to: "cf-upstream-cut", viaLinkKey: "caused_by" },
          { from: "cf-upstream-cut", to: "cf-cert-cycle", viaLinkKey: "caused_by" },
        ],
        atomicLeaves: [], reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%",
      },
      snapshotVersion: "ov-infer",
    }),
  );
}

// mitigation_select：三方案，评分/见效各异（推荐 = 综合分最高 early_stock）。eff 参数化以做 KILL-MOCK 红咬。
function mitigationMock(earlyEff: number, earlyScore: number) {
  return http.post("*/a/v1/solvers/mitigation_select/invoke", () =>
    HttpResponse.json({
      data: {
        factor: "物料齐套", baseName: "常州", urgency: 0.87, recommended: "early_stock",
        plans: [
          { key: "early_stock", name: "提前备料", eff: earlyEff, tn: 2, cost: "中", risk: "低", score: earlyScore },
          { key: "air_freight", name: "空运补料", eff: 15, tn: 1, cost: "极高", risk: "低", score: 1.5 },
          { key: "alt_supplier", name: "备选供应商切换", eff: 9, tn: 5, cost: "高", risk: "中", score: 0.4 },
        ],
        draftPayload: { base: "常州", factor: "物料齐套", planKey: "early_stock" },
      },
      snapshotVersion: "ov-infer",
    }),
  );
}

async function openCard() {
  loginAs("planner");
  renderApp("/v/risk");
  const card = await screen.findByTestId("risk-card-常州");
  fireEvent.click(card);
}

describe("WO-CAPACITY-INFER-PROCESS · 推演过程可见", () => {
  it("CI-a 根因推演树：从 gap_attribution 真投影渲染结构+因果树·节点/下钻值源自 mock（非写死）", async () => {
    server.use(riskTimelineMock(), gapAttributionMock("常州"), mitigationMock(12, 2.0));
    await openCard();

    // 根因树面板 + ProvenanceDag（复用 cockpit 渲染器）。
    expect(await screen.findByTestId("rootcause-panel-常州")).toBeInTheDocument();
    expect(await screen.findByTestId("provenance-dag")).toBeInTheDocument();
    // 结构层：基地 KSF → 设备瓶颈 / 物料短缺 / 订单叶（结构反向归因）。
    expect(screen.getByTestId("dag-node-base:常州").getAttribute("data-kind")).toBe("ksf");
    expect(screen.getByTestId("dag-node-equip:常州").getAttribute("data-kind")).toBe("factor");
    expect(screen.getByTestId("dag-node-material:cathode").getAttribute("data-kind")).toBe("factor");
    // 因果层：物料短缺 → caused_by 溯终点根因（认证周期长）。
    expect(screen.getByTestId("dag-node-cf:cf-upstream-cut").getAttribute("data-kind")).toBe("factor");
    expect(screen.getByTestId("dag-node-cf:cf-cert-cycle").getAttribute("data-kind")).toBe("factor");
    // R13 下钻真对象值——全部源自 mock（改 mock 即变·非常数）。
    expect(screen.getByTestId("dag-node-equip:常州:ev")).toHaveTextContent("Equipment.oee_current");
    expect(screen.getByTestId("dag-node-equip:常州:ev")).toHaveTextContent("0.78");
    expect(screen.getByTestId("dag-node-material:cathode:ev")).toHaveTextContent("1820");
    expect(screen.getByTestId("dag-node-cf:cf-upstream-cut:ev")).toHaveTextContent("Supplier.actualSupplyTon");
    expect(screen.getByTestId("dag-node-cf:cf-upstream-cut:ev")).toHaveTextContent("820");
    // 诚实标注：按基地聚合、未按因子细分（据实披露·不伪装完备）。
    expect(screen.getByTestId("rootcause-scope-note")).toHaveTextContent("未");
  });

  it("CI-b 方案比对推演链：对症根因 + 跨方案 score 矩阵 + 预期堵口，值追溯到 mitigation_select mock", async () => {
    server.use(riskTimelineMock(), gapAttributionMock("常州"), mitigationMock(12, 2.0));
    await openCard();

    // ② 跨方案比对矩阵（非单一数字）：见效/评分单元格 = mock 值。
    const matrix = await screen.findByTestId("mitigation-matrix");
    expect(matrix).toBeInTheDocument();
    expect(screen.getByTestId("mitigation-eff-early_stock")).toHaveTextContent("12");
    expect(screen.getByTestId("mitigation-score-early_stock")).toHaveTextContent("2");
    expect(screen.getByTestId("mitigation-eff-air_freight")).toHaveTextContent("15");
    // ① 对症根因：对齐 CI-a 根因树结构节点「正极物料短缺」（真链·非编造）。
    expect(screen.getByTestId("mitigation-target-early_stock")).toHaveTextContent("正极物料短缺");
    // ③ 预期堵口：峰值 96 − 见效 12pp → 84（< 阈值 85 → 消解越线）。值随 mock eff 算出。
    expect(screen.getByTestId("mitigation-block-early_stock")).toHaveTextContent("84");
    // ④ 门不绕提示：采纳走 adopt_mitigation 草稿。
    expect(screen.getByTestId("mitigation-gate-note")).toHaveTextContent("adopt_mitigation");
  });

  it("CI-b KILL-MOCK 红咬：改 mock 见效/评分 → 矩阵与预期堵口随之变（非写死）", async () => {
    // 见效 12→30、评分 2.0→9.9：若前端硬编码 84/12/2，本例红。
    server.use(riskTimelineMock(), gapAttributionMock("常州"), mitigationMock(30, 9.9));
    await openCard();

    expect(await screen.findByTestId("mitigation-eff-early_stock")).toHaveTextContent("30");
    expect(screen.getByTestId("mitigation-score-early_stock")).toHaveTextContent("9.9");
    // 峰值 96 − 30 → 66（仍越线·需叠加）。
    expect(screen.getByTestId("mitigation-block-early_stock")).toHaveTextContent("66");
    expect(screen.getByTestId("mitigation-block-early_stock")).not.toHaveTextContent("84");
  });

  it("C6 诚实灰：gap_attribution 无该基地结构节点 → 诚实灰列出后端缺口，不伪造根因树", async () => {
    // 归因里只有别的基地 → gapAttributionToBaseRootCause 返回 undefined。
    server.use(riskTimelineMock(), gapAttributionMock("南京"), mitigationMock(12, 2.0));
    await openCard();

    expect(await screen.findByTestId("rootcause-gap-常州")).toBeInTheDocument();
    expect(screen.getByTestId("rootcause-gap-常州")).toHaveTextContent("诚实灰");
    // 绝不伪造：无 ProvenanceDag 树。
    expect(screen.queryByTestId("provenance-dag")).toBeNull();
  });

  it("C5 门不绕：采纳点击 → 创建 adopt_mitigation 草稿（非直接执行）", async () => {
    let captured: { actionTypeKey?: string; payload?: Record<string, unknown> } | null = null;
    server.use(
      riskTimelineMock(), gapAttributionMock("常州"), mitigationMock(12, 2.0),
      http.post("*/a/v1/action-drafts", async ({ request }) => {
        captured = (await request.json()) as { actionTypeKey?: string; payload?: Record<string, unknown> };
        return HttpResponse.json({ draftId: "act-1", status: "PENDING_APPROVAL" }, { status: 201 });
      }),
    );
    await openCard();

    const adoptBtn = await screen.findByTestId("mitigation-adopt-early_stock");
    fireEvent.click(adoptBtn);

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.actionTypeKey).toBe("adopt_mitigation"); // 走审批 ActionType·非 EXECUTED
    expect(captured!.payload).toMatchObject({ base: "常州", factor: "物料齐套", planKey: "early_stock" });
  });
});
