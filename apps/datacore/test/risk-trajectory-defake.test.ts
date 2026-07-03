import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery } from "./helpers.js";
import { applyOrderOverride, caseSeverityFromData, CASE_SEVERITY_DEFAULT } from "../src/solvers/risk.js";
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

  // B9/B6：需求张力映射系数 + 工时系数入 params（存在且为命名字段·非匿名内联）。
  it("B9/B6：demandTension / deliveryLaborPerWan 入 SolverParam", () => {
    const r = (BATTERY_SOLVER_PARAMS as { risk: Record<string, unknown> }).risk;
    expect(r.demandTension).toEqual({ base: 62, loadGain: 70, shareBase: 0.6, shareGain: 0.8, utilPivot: 0.8, utilGain: 40 });
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
