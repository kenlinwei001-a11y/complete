import { describe, expect, it } from "vitest";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import { globalSimOptimize, type PortfolioInput } from "../src/solvers/portfolio.js";
import { baseDistanceKm, cellSourceMap, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import { round } from "../src/prng.js";

/**
 * WO-GSIM 接真收口 · integration門（SEAM-GATE·电芯-Pack 两段「数据×引擎」全接缝·闭 G-CELL-PACK-2STAGE）。
 *
 * 头号判据不是「各半绿」——SOLVER(引擎半)与 DATA(数据半)各自已隔离 PASS。本门驱动**合流态**：
 * 把 WO-DATA 的真 `cellSourceMap`/`baseDistanceKm`（service.ts 接真 wiring 同式）喂进 `globalSimOptimize`，
 * 断言引擎输出用的是 DATA 已独立验过的 oracle 值——**且 cell-pack 的诚实 mock 注记清空**（证 solver 内
 * mock 回退**未被走到**·接缝真闭）。这正是「绿测试≠能用·断在接缝」要堵的地方：改 DATA 距离/供芯 → 引擎
 * routing/transit 真变；mock 回退一旦被走到，`mockNotes` 非空即红。
 */
const inproc = new InProcOptimizerClient();
const solve = (req: Parameters<NonNullable<InProcOptimizerClient["solvePortfolio"]>>[0]) => inproc.solvePortfolio!(req);
const FORECAST_START = "2026-06-10";

/** service.ts 接真 wiring 的**同式**（真数据×引擎接缝口径单一来源）：真供芯图 + 距离派生在途 + 运费。 */
function geoMaps(bases: { baseId: string; factory_type: string }[]) {
  const ib = BATTERY_SOLVER_PARAMS.interbase as { dailyTruckKm: number; minTransitDays: number; tonKmRate: number; qtyToTon: number };
  const csm = cellSourceMap(bases);
  const cellSourceMapOut: Record<string, string> = {};
  const transitDaysMap: Record<string, number> = {};
  const freightCostMap: Record<string, number> = {};
  for (const [pack, cells] of Object.entries(csm)) {
    const cell = cells[0];
    if (!cell) continue;
    cellSourceMapOut[pack] = cell;
    const km = baseDistanceKm(cell, pack);
    const key = `${cell}->${pack}`;
    transitDaysMap[key] = Math.max(ib.minTransitDays, Math.ceil(km / ib.dailyTruckKm));
    freightCostMap[key] = round(km * ib.tonKmRate * ib.qtyToTon, 2);
  }
  return { cellSourceMap: cellSourceMapOut, transitDaysMap, freightCostMap };
}

describe("WO-GSIM 接真收口 · integration門（DATA×引擎全接缝·非 mock）", () => {
  it("真 cellSourceMap/baseDistanceKm 驱动 → 邯郸(PACK)单就近供芯 + geo 在途(非mock) + freight>0 + cell-pack mock 注记清空", async () => {
    // 真基地：真 factory_type + BASE_REGISTRY 真坐标（DATA 从这派生 供芯图/距离）。
    const bases = [
      { baseId: "handan", name: "邯郸", factory_type: "PACK", util: 0 },
      { baseId: "hefei", name: "合肥", factory_type: "CELL", util: 0 },
      { baseId: "changzhou", name: "常州", factory_type: "CELL+PACK", util: 0 },
    ];

    // ── DATA oracle 探针（独立验过·非硬编码顺序）：邯郸就近供芯 = 合肥（hefei→handan 距离 < changzhou→handan）。
    const csmProbe = cellSourceMap(bases);
    expect(csmProbe.handan?.[0]).toBe("hefei");
    expect(baseDistanceKm("hefei", "handan")).toBeLessThan(baseDistanceKm("changzhou", "handan"));

    // ── 接真 wiring（service 同式）→ 真 map（**不注入 mock 常量**）。
    const maps = geoMaps(bases);
    const expectedTransit = Math.max(1, Math.ceil(baseDistanceKm("hefei", "handan") / 600));

    const input: PortfolioInput = {
      forecastStart: FORECAST_START,
      orders: [{ so: "SO-GAC", cust: "广汽集团", model: "方形-LFP", qty: 300, due: "2026-07-08", pri: "高", status: "OPEN" }],
      workOrders: [],
      demandSegments: [],
      bases,
      lines: [
        { baseId: "handan", lineId: "hd-l1", capacityDaily: 500 },
        { baseId: "hefei", lineId: "hf-l1", capacityDaily: 500 },
      ],
      changeover: [],
      modelBaseMap: { "方形-LFP": ["handan"] }, // 派邯郸（PACK-only）→ 必须调芯
      seed: 42,
      coeff: (k: string, d: number) => (k === "windowDays" ? 7 : d),
      twoStage: true,
      packOnlyBases: ["handan"],
      cellCapableBases: ["hefei", "changzhou"],
      cellSourceMap: maps.cellSourceMap, // ★DATA 真派生·非 solver mock
      transitDaysMap: maps.transitDaysMap,
      freightCostMap: maps.freightCostMap,
      scenarios: ["max_ontime"],
    };

    const r = await globalSimOptimize(input, solve);
    const row = r.schedule.find((s) => s.orderId === "SO-GAC");
    expect(row).toBeTruthy();

    // ① 就近供芯 = 合肥（DATA oracle·非 solver「cellCapableBases 首个」的机械回退）。
    expect(row!.packBase).toBe("handan");
    expect(row!.batches[0]?.cellBase).toBe("hefei");

    // ② 在途 = 距离派生 geo 值（= ceil(baseDistanceKm/600)）·**非 solver mock 的 3**。
    expect(row!.transitDays).toBe(expectedTransit);
    expect(row!.transitDays).not.toBe(3);

    // ③ 运费真算 > 0（solver 再 ×qty）。
    expect(row!.freightCost).toBeGreaterThan(0);

    // ④ 交付日真含在途。
    expect(row!.deliverDay).toBeGreaterThanOrEqual(row!.transitDays);

    // ★接缝真闭（命门）：无 cell-pack 的「WO-DATA 未落」诚实 mock 注记 → 证 solver 内 mock 回退**未被走到**。
    const cellPackMock = (r.mockNotes ?? []).filter((n) => /两阶段|供芯|transitDays|freightCost/.test(n) && /未落|mock/.test(n));
    expect(cellPackMock).toEqual([]);
  });

  it("改 DATA 距离（换更远供芯基地）→ 引擎 transit 真变（接缝驱动·非常量）", async () => {
    // 只留 常州 作供芯（735km·比合肥 587km 远）→ 邯郸只能从常州调芯 → transit 真的更大。
    const basesFar = [
      { baseId: "handan", name: "邯郸", factory_type: "PACK", util: 0 },
      { baseId: "changzhou", name: "常州", factory_type: "CELL+PACK", util: 0 },
    ];
    const csmFar = cellSourceMap(basesFar);
    expect(csmFar.handan?.[0]).toBe("changzhou"); // 唯一供芯
    const mapsFar = geoMaps(basesFar);
    const input: PortfolioInput = {
      forecastStart: FORECAST_START,
      orders: [{ so: "SO-GAC", cust: "广汽集团", model: "方形-LFP", qty: 300, due: "2026-07-08", pri: "高", status: "OPEN" }],
      workOrders: [], demandSegments: [],
      bases: basesFar,
      lines: [{ baseId: "handan", lineId: "hd-l1", capacityDaily: 500 }, { baseId: "changzhou", lineId: "cz-l1", capacityDaily: 500 }],
      changeover: [], modelBaseMap: { "方形-LFP": ["handan"] }, seed: 42,
      coeff: (k: string, d: number) => (k === "windowDays" ? 7 : d),
      twoStage: true, packOnlyBases: ["handan"], cellCapableBases: ["changzhou"],
      cellSourceMap: mapsFar.cellSourceMap, transitDaysMap: mapsFar.transitDaysMap, freightCostMap: mapsFar.freightCostMap,
      scenarios: ["max_ontime"],
    };
    const r = await globalSimOptimize(input, solve);
    const row = r.schedule.find((s) => s.orderId === "SO-GAC")!;
    expect(row.batches[0]?.cellBase).toBe("changzhou");
    // 常州(735km) transit ≥ 合肥(587km) transit——距离真的进了在途（改数据→引擎真变）。
    const transitFar = Math.max(1, Math.ceil(baseDistanceKm("changzhou", "handan") / 600));
    const transitNear = Math.max(1, Math.ceil(baseDistanceKm("hefei", "handan") / 600));
    expect(row.transitDays).toBe(transitFar);
    expect(transitFar).toBeGreaterThanOrEqual(transitNear);
  });
});
