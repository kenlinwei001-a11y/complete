import { describe, expect, it } from "vitest";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import { globalSimOptimize, type PortfolioInput } from "../src/solvers/portfolio.js";
import { generateBattery, MODEL_BASE_MAP, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { PortfolioRequest } from "../src/solvers/optimizer-client.js";
import type { GlobalSimResponse, GlobalSimBusinessTypeSummary } from "@platform/contracts";

/**
 * WO-W5 · SEAM 门（头号判据 = 勾选真驱动分型·非各半绿·跨数据(种子差异化)+引擎(分型/作用域收窄) 两半）。
 *
 * 用**真** battery 合成种子（generateBattery·非 toy 世界）喂**真** globalSimOptimize（in-proc solve·R6），
 * 逐条红咬三类差异化经营场景 + 勾选筛选真重算：
 *   储能 → 占用率≈95% 稳；乘用车 → 产能不足(>1)+预测虚高缺口(预测>>订单)+提前交付；商用车 → 空闲(<0.6)+订单波动；
 *   改勾选 → portfolio 真在收窄世界重解 → capacityLedger(矩阵)/分配/KPI 真变（前端假过滤此门抓）。
 */

const FORECAST_START = BATTERY_SOLVER_PARAMS.forecastStart as string;
const inproc = new InProcOptimizerClient();
const solve = (req: PortfolioRequest) => inproc.solvePortfolio!(req);

function baseInput(over: Partial<PortfolioInput> = {}): PortfolioInput {
  const g = generateBattery(42, "S");
  return {
    forecastStart: FORECAST_START,
    orders: g.orders, workOrders: g.workOrders, demandSegments: g.demandSegments,
    bases: g.bases, lines: g.lines, changeover: [],
    modelBaseMap: MODEL_BASE_MAP, seed: 42, coeff: (_k: string, d: number) => d,
    businessTypeRegime: BATTERY_SOLVER_PARAMS.businessTypeRegime as PortfolioInput["businessTypeRegime"],
    operatingDaysPerYear: BATTERY_SOLVER_PARAMS.operatingDaysPerYear as number,
    twoStage: true, scenarios: ["max_ontime", "min_cost"],
    ...over,
  };
}
const btOf = (r: GlobalSimResponse, t: string): GlobalSimBusinessTypeSummary =>
  r.businessTypeSummary!.find((s) => s.businessType === t)!;

describe("WO-W5 · 全局推演业务类型（乘/商/储）差异化 + 勾选筛选 SEAM", () => {
  it("三类差异化经营场景（真种子·真求解）：储能≈95%稳 / 乘用车产能不足+预测虚高+提前交付 / 商用车空闲+波动", async () => {
    const r = await globalSimOptimize(baseInput(), solve);
    expect(r.businessTypeSummary).toBeDefined();
    expect(r.businessTypeSummary!.length).toBe(3);
    const pas = btOf(r, "passenger");
    const com = btOf(r, "commercial");
    const sto = btOf(r, "storage");

    // ── 储能：产能占用率 ≈95% 稳 ──
    expect(sto.capacityUtil).toBeGreaterThan(0.85);
    expect(sto.capacityUtil).toBeLessThan(1.0);

    // ── 乘用车：产能不足（>1）+ 预测虚高（预测量 >> 订单量·缺口最大）+ 提前交付订单 ──
    expect(pas.capacityUtil).toBeGreaterThan(1.0); // 产能不足
    expect(pas.forecastQty).toBeGreaterThan(pas.orderQty * 3); // 预测远大于实际订单（虚高）
    expect(pas.forecastGap).toBeGreaterThan(sto.forecastGap); // 乘用车预测缺口最大
    expect(pas.forecastGap).toBeGreaterThan(com.forecastGap);
    expect(pas.earlyDeliveryCount).toBeGreaterThan(0); // 部分客户需提前交付
    expect(com.earlyDeliveryCount).toBe(0); // 商用/储能无提前交付
    expect(sto.earlyDeliveryCount).toBe(0);

    // ── 商用车：产能空闲（<0.6）+ 订单波动大（cv 最高·相对储能平稳/乘用规整） ──
    expect(com.capacityUtil).toBeLessThan(0.6); // 产能空闲
    expect(com.orderQtyCv).toBeGreaterThan(sto.orderQtyCv); // 商用波动 > 储能平稳
    expect(com.orderQtyCv).toBeGreaterThan(pas.orderQtyCv);

    // 三档占用率真分层（乘用 > 储能 > 商用·非贴标签）。
    expect(pas.capacityUtil).toBeGreaterThan(sto.capacityUtil);
    expect(sto.capacityUtil).toBeGreaterThan(com.capacityUtil);
  });

  it("勾选筛选 → portfolio 真在收窄世界重解 → capacityLedger(矩阵)/分配/KPI 真变（后端真重算·非前端假过滤）", async () => {
    const rStorage = await globalSimOptimize(baseInput({ businessTypes: ["storage"] }), solve);
    const rPassenger = await globalSimOptimize(baseInput({ businessTypes: ["passenger"] }), solve);

    const basesOf = (r: GlobalSimResponse) => new Set((r.capacityLedger ?? []).map((c) => c.baseId));
    const stoBases = basesOf(rStorage);
    const pasBases = basesOf(rPassenger);
    // 产能作用域真收窄到各类订单可产基地 → 矩阵基地集不同（前端假过滤则基地集恒同·此断言红咬）。
    expect(stoBases.size).toBeGreaterThan(0);
    expect(pasBases.size).toBeGreaterThan(0);
    expect([...stoBases].sort().join(",")).not.toBe([...pasBases].sort().join(","));

    // 决策集只留勾选类 → 分配台账里被排订单全属该类（真重算·非展示层过滤）。
    const allocOrderIds = (r: GlobalSimResponse) => (r.allocation ?? []).filter((a) => a.kind === "order" && !a.committed).map((a) => a.item);
    const g = generateBattery(42, "S");
    const typeOfSo = new Map(g.orders.map((o) => [String(o.so), String(o.businessType)]));
    for (const id of allocOrderIds(rStorage)) expect(typeOfSo.get(id)).toBe("storage");
    for (const id of allocOrderIds(rPassenger)) expect(typeOfSo.get(id)).toBe("passenger");

    // KPI 真变：勾选储能 vs 乘用车 → 总代价不同（不同决策集+不同产能 → 求解器真出不同解）。
    expect(rStorage.cost!.total).not.toBe(rPassenger.cost!.total);
    // 分口径占用真反映勾选态：勾选类 allocated>0，未勾选类 allocated=0（真重算·非全量展示）。
    expect(btOf(rStorage, "storage").allocatedQty).toBeGreaterThan(0);
    expect(btOf(rStorage, "passenger").allocatedQty).toBe(0);
    expect(btOf(rPassenger, "passenger").allocatedQty).toBeGreaterThan(0);
    expect(btOf(rPassenger, "storage").allocatedQty).toBe(0);

    // 对照全量：全量态两类 allocated 均 > 0（证「勾选真收窄」而非恒空）。
    const rAll = await globalSimOptimize(baseInput(), solve);
    expect(btOf(rAll, "storage").allocatedQty).toBeGreaterThan(0);
    expect(btOf(rAll, "passenger").allocatedQty).toBeGreaterThan(0);
  });

  it("R6：勾选筛选态同输入两跑 GlobalSimResponse 字节一致（禁 Date.now/random·forecastStart 锚）", async () => {
    const a = await globalSimOptimize(baseInput({ businessTypes: ["commercial"] }), solve);
    const b = await globalSimOptimize(baseInput({ businessTypes: ["commercial"] }), solve);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
