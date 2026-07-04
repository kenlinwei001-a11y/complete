import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery } from "./helpers.js";
import { applyOrderOverride, caseSeverityFromData, CASE_SEVERITY_DEFAULT, orderFinanceImpactWan } from "../src/solvers/risk.js";
import { deriveCaseSeverities } from "../src/livedin/engine.js";
import { deriveExtendedArgs, extendedDataMode } from "../src/solvers/extended.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext } from "../src/solvers/types.js";

/**
 * RISK-TRAJECTORY-DEFAKE 牙齿簇（audit §2 簇B + §簇G）——真数据算或诚实空 / 无假源归因 / 无 hash 冒充真测量 /
 * 阈值系数入 SolverParam。回退到旧造假口径即红。
 */
describe("RISK-TRAJECTORY-DEFAKE · 治本牙齿", () => {
  // B8：severity 阈值入 params.risk.caseSeverity（可校准·非内联魔数）。改 param → 判据随之变。
  it("B8：caseSeverityFromData 阈值来自 param（默认=CASE_SEVERITY_DEFAULT）·改 param 即改判据", () => {
    const p = (BATTERY_SOLVER_PARAMS as { risk: { caseSeverity: typeof CASE_SEVERITY_DEFAULT } }).risk;
    // battery 默认与命名常量单源一致
    expect(p.caseSeverity).toEqual({ ...CASE_SEVERITY_DEFAULT });
    // 默认口径：util 80 + 主瓶颈加成 12 = 92 → HIGH
    expect(caseSeverityFromData(80, true, false)).toBe("HIGH");
    // 传自定义阈值（校准）→ 判据随参数移动：highScore 提到 95 → 92 分降为 MEDIUM
    const strict = { highScore: 95, medScore: 78, primaryBonus: 12 };
    expect(caseSeverityFromData(80, true, false, strict)).toBe("MEDIUM");
    // primaryBonus 归零 → 无主瓶颈加成
    expect(caseSeverityFromData(80, true, false, { highScore: 92, medScore: 78, primaryBonus: 0 })).toBe("MEDIUM");
  });

  // HARDCODE-BIZ-ENTITY 残项①（通电·牙齿）：livedin 引擎 case severity 由 params.risk.caseSeverity 真闭环驱动。
  // 此前 engine.ts 只 3 参调用 → 参数无运行时读取点（改参不改果）；现 deriveCaseSeverities 传第 4 参。
  // 改 param → 判据随之变；回退（引擎不透传参数/helper 忽略入参）→ strict 全 LOW 断言红。
  it("残项①：deriveCaseSeverities 由 params.risk.caseSeverity 驱动（默认字节一致·改 param 改判据）", () => {
    const def = deriveCaseSeverities(CASE_SEVERITY_DEFAULT);
    // 默认阈值下真数据派生出非 LOW 判据（xiamen 85 等）——证明默认参数真驱动引擎案例 severity。
    const nonCrisis = [1, 2, 3, 4, 5, 6, 8, 9, 10];
    expect(nonCrisis.some((n) => def.get(n) !== "LOW")).toBe(true);
    // 危机案例 CASE-007（n=7）恒 HIGH（结构性到货断供·crisis 短路，与阈值无关）。
    expect(def.get(7)).toBe("HIGH");
    // 抬到不可达阈值（校准）→ 非危机案例全 LOW（危机仍 HIGH）；参数真移动判据（回退即红）。
    const strict = deriveCaseSeverities({ highScore: 999, medScore: 999, primaryBonus: 0 });
    expect(nonCrisis.every((n) => strict.get(n) === "LOW")).toBe(true);
    expect(strict.get(7)).toBe("HIGH");
  });

  // HARDCODE-BIZ-ENTITY 残项②（通电·牙齿）：problems[] financeImpact 兜底单价入 params.risk.fallbackUnitPrice。
  // 此前 risk.ts 内联字面量 600；现 orderFinanceImpactWan 读参。默认 600 字节一致·改 param 改果·回退即红。
  it("残项②：orderFinanceImpactWan 缺 unitPrice 兜底取 params.risk.fallbackUnitPrice（默认 600·改 param 改果）", () => {
    // battery 默认兜底单价 = 600（R6 字节一致·非内联魔数）。
    expect((BATTERY_SOLVER_PARAMS as { risk: { fallbackUnitPrice: number } }).risk.fallbackUnitPrice).toBe(600);
    const rows = [{ so: "SO-A", qty: 1 }]; // 1 万套
    const withPrice = [{ props: { so: "SO-A", unitPrice: 800 } }];
    const noPrice = [{ props: { so: "SO-A" } }];
    // 订单有真单价 → 用真值 800（1×10000×800÷1e8 = 0.08）·与兜底无关。
    expect(orderFinanceImpactWan(rows, withPrice, 600)).toBe(0.08);
    // 缺单价 → 默认兜底 600（=0.06）。
    expect(orderFinanceImpactWan(rows, noPrice, 600)).toBe(0.06);
    // 改兜底 param → 结果随之变（1200 → 0.12）；回退到内联字面量 600 则此断言红。
    expect(orderFinanceImpactWan(rows, noPrice, 1200)).toBe(0.12);
  });

  // B9/B6：需求张力映射系数 + 工时系数入 params（存在且为命名字段·非匿名内联）。
  it("B9/B6：demandTension / deliveryLaborPerWan 入 SolverParam", () => {
    const r = (BATTERY_SOLVER_PARAMS as { risk: Record<string, unknown> }).risk;
    // HARDCODE-SOLVER-PARAMS（ε1 残留闭合）：upsideGain(原内联 0.5)/tensionCap(原内联 98) 入同一 demandTension 组（命名字段·非匿名内联）。
    expect(r.demandTension).toEqual({ base: 62, loadGain: 70, shareBase: 0.6, shareGain: 0.8, utilPivot: 0.8, utilGain: 40, upsideGain: 0.5, tensionCap: 98 });
    expect(r.deliveryLaborPerWan).toBe(1.6);
    // 旧 targetLift / rampDen（hash 爬坡目标）已删——不得再存在于参数
    expect((r as Record<string, unknown>).targetLift).toBeUndefined();
    expect((r as Record<string, unknown>).rampDen).toBeUndefined();
  });

  // B5：信用占用比不再 hash 编造——applyOrderOverride 接受 null（无真信用数据）→ 不伪造占用比。
  it("B5：applyOrderOverride 真比透传 / null 不伪造 / override 真越限标记（无 hash）", () => {
    // 真实客户占用比透传（无 override）
    expect(applyOrderOverride(0.83, 15).creditRatio).toBe(0.83);
    // 无真信用数据 → null（诚实·不编造触发信用阻断的占用比）
    expect(applyOrderOverride(null, 15).creditRatio).toBeNull();
    // override 信用越限（已知真实敞口·why 载真值）→ 越限标记；无真比记 1.05，有真比取 max
    expect(applyOrderOverride(null, 15, { credit: true }).creditRatio).toBe(1.05);
    expect(applyOrderOverride(1.2, 15, { credit: true }).creditRatio).toBe(1.2);
    // 旧 battery affected.problems 的 creditBase/creditMod（hash 信用种子）已删
    const prob = (BATTERY_SOLVER_PARAMS as { affected: { problems: Record<string, unknown>; jitterMod?: unknown } }).affected;
    expect(prob.problems.creditBase).toBeUndefined();
    expect(prob.problems.creditMod).toBeUndefined();
    expect((prob as Record<string, unknown>).jitterMod).toBeUndefined(); // B7：延误抖动种子已删
  });

  // B5 真数据算：直接构造带真 Customer 的 context → 信用占用比 = (应收+在制未开票)÷信用额度（真算·非 hash）。
  it("B5：真 Customer 数据在场 → 信用判定用真实占用比（=(应收+在制未开票)÷信用额度）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "affected_orders", { horizon: 90 })).json()).data as {
      problems: { category: string; rootChains: { layers: { kind: string; label: string }[] }[] }[];
    };
    const credit = out.problems.find((p) => p.category === "credit");
    if (credit) {
      for (const ch of credit.rootChains) {
        const jud = ch.layers.find((l) => l.kind === "judgement")!.label;
        // 无 hash 编造的精确占用比小数（如 1.07/0.93）冒充真测量；越限用真实敞口叙述或真算比。
        // 断言：不出现 `信用占用比 <非1.0 的两位小数>`（旧 hash 口径 creditBase+hash%mod/100）
        const m = jud.match(/信用占用比\s+([0-9.]+)/);
        if (m) {
          // 若出现占用比数字，必须标注「真实客户数据」来源（真算），不得是 hash 派生
          expect(jud).toMatch(/真实客户数据/);
        }
      }
    }
  });

  // B2/B3/B4：风险事件不得携带假源 src；无实测量化不得谎称真实系统源。
  it("B2/B3/B4：risk_timeline 事件无假源归因 + 无 hash 具体值冒充真测量", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "risk_timeline", { horizon: 90 })).json()).data as {
      cards: { events: { src?: string; desc?: string }[] }[];
    };
    const events = out.cards.flatMap((c) => c.events);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.src).toBeUndefined(); // 删 EVENT_SRC 假源归因
      // 旧 hash 造的具体量化短语（齐套率 X%、OEE 下调 Xpt、停机 X 天）不得出现为"实测"口径
      const desc = e.desc ?? "";
      if (/物料齐套率\s*\d+%|OEE 由基线下调\s*\d+|计划停机\s*\d+\s*天/.test(desc)) {
        throw new Error(`event desc reintroduced hash-fabricated measurement: ${desc}`);
      }
    }
  });

  // G3：yield_diagnosis 合成默认序列断点不得标 source:"MES"（假源）；改标 SYNTHETIC + synthetic:true。
  it("G3：yield_diagnosis 默认合成序列断点标 SYNTHETIC（非 MES 假源）", () => {
    const ctx = { orders: [], materials: [] } as unknown as SolverContext;
    const args = deriveExtendedArgs(ctx, "yield_diagnosis", {}) as {
      synthetic?: boolean; events: { source: string; synthetic?: boolean }[];
    };
    expect(args.synthetic).toBe(true);
    expect(args.events[0]!.source).toBe("SYNTHETIC");
    expect(args.events[0]!.source).not.toBe("MES");
    expect(args.events[0]!.synthetic).toBe(true);
  });

  // G2：outsourcing_split 缺省 gap（totalDemand×0.15 估算）→ dataMode 由 LIVE 降为 PARTIAL（诚实标估算）。
  it("G2：outsourcing_split 缺省 gap 估算 → dataMode=PARTIAL（非 LIVE 冒充真缺口）", () => {
    const ctx = { orders: [{ props: { qty: 100 } }] } as unknown as SolverContext;
    // 显式传 gap → LIVE
    expect(extendedDataMode(ctx, "outsourcing_split", { gap: 20 })).toBe("LIVE");
    // 仅真订单、gap 由默认分数估算 → PARTIAL
    expect(extendedDataMode(ctx, "outsourcing_split", {})).toBe("PARTIAL");
    // 无订单 → MOCK
    expect(extendedDataMode({ orders: [] } as unknown as SolverContext, "outsourcing_split", {})).toBe("MOCK");
  });
});
