import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp } from "./helpers.js";
import { EXTENDED_SOLVERS } from "../src/solvers/extended.js";

/**
 * 20 场景目录 §2 — 13 新增求解器（E6a）。确定性、args 驱动；这里用可手算的输入断言公式正确，
 * 并验证经 /a/v1/solvers/:key/invoke 端点真实出结果。
 */

describe("E6a · 13 求解器算法（确定性、手算可验）", () => {
  it("mitigation_select：按 score=eff×urgency/(costRank×t) 降序 + 推荐首位 + 草稿 payload", () => {
    const r = EXTENDED_SOLVERS.mitigation_select!({ baseName: "常州", factor: "物料齐套", tightness: 100 }) as {
      urgency: number; plans: { key: string; score: number }[]; recommended: string; draftPayload: { planKey: string };
    };
    expect(r.urgency).toBe(1); // (100-70)/30
    // early_stock: 12×1/(2×2)=3 ; alt_supplier: 9/(3×5)=0.6 ; air_freight: 15/(4×1)=3.75 → 推荐 air_freight
    expect(r.recommended).toBe("air_freight");
    expect(r.plans[0]!.score).toBeCloseTo(3.75, 4);
    expect(r.draftPayload.planKey).toBe("air_freight");
  });

  it("outsourcing_split：三渠道按单位成本升序贪心，外协受 C08 20% 上限", () => {
    const r = EXTENDED_SOLVERS.outsourcing_split!({ gap: 100, totalDemand: 100 }) as {
      allocation: { channel: string; qty: number }[]; totalCost: number; savedVsAllDelay: number;
    };
    // 加班 cap=40, 外协 cap=20, 余 40 延期
    expect(r.allocation.find((a) => a.channel === "overtime")!.qty).toBe(40);
    expect(r.allocation.find((a) => a.channel === "outsource")!.qty).toBe(20);
    expect(r.allocation.find((a) => a.channel === "delay")!.qty).toBe(40);
    expect(r.totalCost).toBeCloseTo(40 * 1 + 20 * 1.4 + 40 * 2.5, 4); // 168
    expect(r.savedVsAllDelay).toBeCloseTo(250 - 168, 4);
  });

  it("quote_margin：BOM=Σ单耗×现价×(1+加工费率)，毛利率与底线判定", () => {
    const r = EXTENDED_SOLVERS.quote_margin!({ price: 100, bom: [{ unit: 1, spotPrice: 40, processRate: 0.25 }], mfgRate: 0.1, logistics: 5, segmentFloor: 0.1 }) as {
      margin: number; verdict: string; breakdown: { bomCost: number };
    };
    expect(r.breakdown.bomCost).toBeCloseTo(50, 4); // 40×1.25
    expect(r.margin).toBeCloseTo((100 - 50 - 10 - 5) / 100, 4); // 0.35
    expect(r.verdict).toBe("过线");
  });

  it("credit_exposure：逾期>30 → 冻结优先于额度判断（C32）", () => {
    const ok = EXTENDED_SOLVERS.credit_exposure!({ creditLimit: 100, receivables: 30, wipUnbilled: 20, newOrderAmount: 40, overdue: [] }) as { available: number; newOrderVerdict: string };
    expect(ok.available).toBe(50);
    expect(ok.newOrderVerdict).toBe("可接"); // 40 ≤ 50
    const frozen = EXTENDED_SOLVERS.credit_exposure!({ creditLimit: 100, receivables: 10, wipUnbilled: 0, newOrderAmount: 1, overdue: [{ invoiceId: "x", overdueDays: 38, amount: 5 }] }) as { newOrderVerdict: string };
    expect(frozen.newOrderVerdict).toContain("冻结");
  });

  it("carbon_footprint：物料+能耗两段，超阈值判超标 + 最大杠杆", () => {
    const r = EXTENDED_SOLVERS.carbon_footprint!({ modelId: "4680-NCM", baseName: "成都", materials: [{ material: "正极", unit: 1, factor: 50 }], processes: [{ process: "涂布", energy: 2, gridFactor: 15 }], euThreshold: 70 }) as { total: number; verdict: string; maxLever: string };
    expect(r.total).toBeCloseTo(50 + 30, 4); // 80
    expect(r.verdict).toBe("超标");
    expect(r.maxLever).toBe("物料:正极"); // 50 > 30
  });

  it("kit_readiness：在途按 ETA≤开工日才计入，齐套率取物料最小", () => {
    const r = EXTENDED_SOLVERS.kit_readiness!({
      orders: [{ orderId: "O1", qty: 10, startDay: 5, materials: [{ material: "M1", onHand: 5, inTransit: [{ qty: 10, etaDay: 3 }], bomUnit: 1 }, { material: "M2", onHand: 2, inTransit: [{ qty: 100, etaDay: 9 }], bomUnit: 1 }] }] },
    ) as { rows: { kitRatio: number; advice: string }[] };
    // M1: (5+10)/10=1.5 ; M2: (2+0[eta>start])/10=0.2 → kitRatio 0.2
    expect(r.rows[0]!.kitRatio).toBeCloseTo(0.2, 4);
    expect(r.rows[0]!.advice).not.toBe("齐套");
  });

  it("yield_diagnosis：2σ 突变检测 + 根因候选按时间贴近度", () => {
    const series = [];
    for (let d = 1; d <= 40; d++) series.push({ day: d, yield: d <= 33 ? 0.95 : 0.85 }); // 第34天起跌
    const r = EXTENDED_SOLVERS.yield_diagnosis!({ series, events: [{ day: 33, kind: "换批", source: "MES" }, { day: 20, kind: "检修", source: "EAM" }] }) as { breakpoint?: { day: number }; candidates: { kind: string }[] };
    expect(r.breakpoint).toBeDefined();
    expect(r.candidates[0]!.kind).toBe("换批"); // 距突变最近
  });

  it("changeover_sequence：最近邻贪心最小化换型时长", () => {
    const r = EXTENDED_SOLVERS.changeover_sequence!({
      lineId: "L1", current: "A",
      orders: [{ orderId: "o1", modelId: "B" }, { orderId: "o2", modelId: "A" }, { orderId: "o3", modelId: "C" }],
      matrix: { A: { B: 30, C: 90 }, B: { A: 30, C: 60 }, C: { A: 90, B: 60 } },
    }) as { totalChangeoverMin: number; sequence: { modelId: string }[] };
    // A→A(o2,0)→B(30)→C(60) = 90
    expect(r.totalChangeoverMin).toBe(90);
    expect(r.sequence[0]!.modelId).toBe("A");
  });
});

describe("E6a · 端点真实出结果 + 注册完整", () => {
  it("/a/v1/solvers/:key/invoke 对新增 key 全部返回结果（确定性同输入同输出）", async () => {
    const t = await makeApp();
    const keys = Object.keys(EXTENDED_SOLVERS);
    expect(keys).toHaveLength(14); // 13 + Phase6B countermeasure_combo
    for (const key of keys) {
      const r1 = await invokeSolver(t, key, key === "mitigation_select" ? { factor: "物料齐套", tightness: 90 } : {});
      expect(r1.statusCode).toBe(200);
      const a = r1.json();
      const r2 = await invokeSolver(t, key, key === "mitigation_select" ? { factor: "物料齐套", tightness: 90 } : {});
      expect(r2.json()).toEqual(a); // 确定性
    }
  });

  it("Phase6B countermeasure_combo 跨求解器编排：贪心最小成本闭合缺口 + 来源求解器留痕", () => {
    const r = EXTENDED_SOLVERS.countermeasure_combo!({ gap: 100 }) as {
      combo: { solver: string; release: number; cost: number }[];
      residualGap: number;
      totalCost: number;
      feasible: boolean;
    };
    expect(r.combo.length).toBeGreaterThan(0);
    expect(r.combo.every((c) => typeof c.solver === "string")).toBe(true); // 每段标注来源求解器
    const released = r.combo.reduce((s, c) => s + c.release, 0);
    expect(released).toBeCloseTo(100 - r.residualGap, 4);
    expect(r.feasible).toBe(true); // 默认杠杆可覆盖
  });

  it("catalog discover 列出全部 39 求解器（22 业务场景 + WO-TIER2 语义发现扩面 + portfolio·WO-PORTFOLIO-OPTIMAL + base_capacity_outlook·WO-B·双占 reconcile + chain_loss_attribution·WO-SANDBOX-E1）", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers", headers: ADMIN });
    const items = (res.json() as { items: { key: string }[] }).items;
    expect(items.length).toBe(39); // 36 base + portfolio(WO-PORTFOLIO) + base_capacity_outlook(WO-B)·双占 reconcile + chain_loss_attribution(WO-SANDBOX-E1·当时漏更金值，本批补)
    expect(items.map((i) => i.key)).toContain("base_capacity_outlook");
    expect(items.map((i) => i.key)).toContain("countermeasure_combo");
    expect(items.map((i) => i.key)).toContain("portfolio");
  });
});
