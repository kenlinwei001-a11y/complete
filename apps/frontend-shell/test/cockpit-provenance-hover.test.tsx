import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvenanceDag, gapAttributionToDag, type GapAttrOutput } from "@/components/ProvenanceDag";

/**
 * WO-B · 推演溯源悬浮 PROVENANCE-HOVER（L2·信任·R13 三态诚实·KILL-MOCK）。
 * 因果树每个数字 hover → 溯源弹窗，全部字段从节点真 provenance 读（零写死叙事串）。三态：
 *   ① 下钻值（evidence 叶·实测）→ 数据源 drillType.drillId.drillField + 当前值 drillValue（DB 对象真值）。
 *   ② 合成源（provenanceSynthetic）→ 标灰「合成·未接实测」，绝不冒充 DB 实测。
 *   ③ 派生/贡献值（factor/kpi）→「派生·非 DB 原值」+ 输入链（drillValue→占比→贡献），绝不说"来自数据库"。
 *
 * 铁律 C2（KILL-MOCK 亲验）：改真对象值（provenance.drillValue）→ 弹窗当前值随之变（非写死）。
 */

// 三态齐全的因果链归因产物：实测(上游减供·Supplier) / 合成(矿价·CommodityPriceTrend) / 派生+basis(认证周期·BackupSupplierPool)。
function makeGA(upstreamSupplyTon = 820): GapAttrOutput {
  return {
    rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
    levels: [
      {
        depth: 3,
        label: "因果链（caused_by）",
        nodes: [
          { id: "cf:cf-upstream-cut", factor: "上游减供", contribution: 2.4, unit: "%", share: 0.44,
            provenance: { kind: "实测", drillType: "Supplier", drillId: "sup-1", drillField: "actualSupplyTon", drillValue: upstreamSupplyTon } },
          { id: "cf:cf-ore-price", factor: "矿价上涨", contribution: 0.9, unit: "%", share: 0.16,
            provenance: { kind: "外部信号", drillType: "CommodityPriceTrend", drillId: "trend-li", drillField: "pctChange", drillValue: 7.5, provenanceSynthetic: true } },
          { id: "cf:cf-cert-cycle", factor: "认证周期长(root)", contribution: 0.4, unit: "%", share: 0.07,
            provenance: { kind: "求解器", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillField: "certWeeks", drillValue: 16, basis: "BackupSupplierPool.certWeeks" } },
        ],
      },
    ],
    causalEdges: [
      { from: "cf-cathode-shortage", to: "cf-upstream-cut" },
      { from: "cf-upstream-cut", to: "cf-ore-price" },
      { from: "cf-upstream-cut", to: "cf-cert-cycle" },
    ],
    atomicLeaves: [],
  };
}

describe("WO-B · 推演溯源悬浮（三态诚实·KILL-MOCK）", () => {
  it("C1+C3实测：hover 下钻证据叶 → 弹「数据源=drillType.drillId.drillField · 当前值=drillValue」(DB 对象真值)", async () => {
    render(<ProvenanceDag data={gapAttributionToDag(makeGA())} />);
    const u = userEvent.setup();
    const hover = screen.getByTestId("prov-hover-cf:cf-upstream-cut:ev");
    // 三态标注：实测（下钻值来自 DB 对象）
    expect(hover).toHaveAttribute("data-prov-state", "measured");
    await u.hover(hover);
    const tip = await screen.findByTestId("prov-tip-cf:cf-upstream-cut:ev");
    expect(tip).toHaveTextContent("数据源");
    // 数据源全从真字段拼（drillType.drillId.drillField·非写死）
    expect(within(tip).getByTestId("prov-src-cf:cf-upstream-cut:ev")).toHaveTextContent("Supplier.sup-1.actualSupplyTon");
    // 当前值 = 真 drillValue
    expect(within(tip).getByTestId("prov-val-cf:cf-upstream-cut:ev")).toHaveTextContent("820");
    // 徽章反映求解器真 provKind
    expect(within(tip).getByTestId("prov-state-cf:cf-upstream-cut:ev")).toHaveTextContent("实测");
  });

  it("C3合成：provenanceSynthetic 叶标灰「合成·未接实测」——绝不冒充 DB 实测", async () => {
    render(<ProvenanceDag data={gapAttributionToDag(makeGA())} />);
    const u = userEvent.setup();
    const hover = screen.getByTestId("prov-hover-cf:cf-ore-price:ev");
    // 三态标注：合成（诚实灰·区别于实测）
    expect(hover).toHaveAttribute("data-prov-state", "synthetic");
    await u.hover(hover);
    const tip = await screen.findByTestId("prov-tip-cf:cf-ore-price:ev");
    expect(within(tip).getByTestId("prov-state-cf:cf-ore-price:ev")).toHaveTextContent("合成");
    expect(tip).toHaveTextContent("未接实测");
    // 合成叶仍展示真 drillValue（可展示·不假装无数据），但状态诚实标合成
    expect(within(tip).getByTestId("prov-val-cf:cf-ore-price:ev")).toHaveTextContent("7.5");
  });

  it("C3派生 + KILL-MOCK：hover 贡献数 → 弹「派生·非 DB 原值」+ 输入链(drillValue→占比→贡献)，绝不标「数据源」", async () => {
    render(<ProvenanceDag data={gapAttributionToDag(makeGA())} />);
    const u = userEvent.setup();
    const hover = screen.getByTestId("prov-hover-cf:cf-upstream-cut");
    // 三态标注：派生（算出来的贡献值·非 DB 原值）
    expect(hover).toHaveAttribute("data-prov-state", "derived");
    await u.hover(hover);
    const tip = await screen.findByTestId("prov-tip-cf:cf-upstream-cut");
    expect(within(tip).getByTestId("prov-state-cf:cf-upstream-cut")).toHaveTextContent("派生");
    expect(tip).toHaveTextContent("非数据库原值");
    // 输入链读真值链：下钻真值 820 → 占比 44% → 贡献 2.4%
    const chain = within(tip).getByTestId("prov-chain-cf:cf-upstream-cut");
    expect(chain).toHaveTextContent("820");
    expect(chain).toHaveTextContent("44%");
    expect(chain).toHaveTextContent("贡献 2.4%");
    // KILL-MOCK 铁律：算出来的贡献值绝不说成"来自数据库"（"数据源"只属下钻原值弹窗）
    expect(tip).not.toHaveTextContent("数据源");
  });

  it("KPI 缺口 hover → 派生推导公式「缺口 = 目标 − 实际」全读真 actual/target(非写死)", async () => {
    render(<ProvenanceDag data={gapAttributionToDag(makeGA())} />);
    const u = userEvent.setup();
    await u.hover(screen.getByTestId("prov-hover-kpi:seg_attain_ess"));
    const tip = await screen.findByTestId("prov-tip-kpi:seg_attain_ess");
    const formula = within(tip).getByTestId("prov-formula-kpi:seg_attain_ess");
    expect(formula).toHaveTextContent("目标 100%");
    expect(formula).toHaveTextContent("实际 72.2%");
    expect(formula).toHaveTextContent("27.8%");
  });

  it("C2 亲验（KILL-MOCK）：改真对象值 drillValue 820→3680 → 弹窗当前值随之变（非写死叙事）", async () => {
    render(<ProvenanceDag data={gapAttributionToDag(makeGA(3680))} />);
    const u = userEvent.setup();
    await u.hover(screen.getByTestId("prov-hover-cf:cf-upstream-cut:ev"));
    const tip = await screen.findByTestId("prov-tip-cf:cf-upstream-cut:ev");
    expect(within(tip).getByTestId("prov-val-cf:cf-upstream-cut:ev")).toHaveTextContent("3680");
    // 旧值不再出现——证明弹窗读节点真值而非硬编码
    expect(tip).not.toHaveTextContent("820");
  });

  it("basis 字段有则展示「依据」（求解器带 basis 的因果节点·真出处）", async () => {
    render(<ProvenanceDag data={gapAttributionToDag(makeGA())} />);
    const u = userEvent.setup();
    await u.hover(screen.getByTestId("prov-hover-cf:cf-cert-cycle:ev"));
    const tip = await screen.findByTestId("prov-tip-cf:cf-cert-cycle:ev");
    expect(within(tip).getByTestId("prov-basis-cf:cf-cert-cycle:ev")).toHaveTextContent("BackupSupplierPool.certWeeks");
  });
});
