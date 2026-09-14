import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BASE_REGISTRY } from "@platform/contracts";
import { ScheduleTable } from "@/views/sim/ScheduleTable";
// ── 真 datacore 引擎（非 MSW·非 mock HTTP）：直接驱动 globalSimOptimize + 真 battery 合成距离/供芯图 ──
import { globalSimOptimize, type PortfolioInput } from "../../datacore/src/solvers/portfolio.js";
import { InProcOptimizerClient } from "../../datacore/src/solvers/inproc-optimizer.js";
import { baseDistanceKm, cellSourceMap, BATTERY_SOLVER_PARAMS } from "../../datacore/src/synthetic/battery.js";
import { round } from "../../datacore/src/prng.js";

/**
 * WO-SURFACE-7DIM · SEAM-GATE（引擎→前端渲染接缝·非 MSW·非各半绿）。
 *
 * 头号判据不是「引擎半绿 + 前端半绿」——本门驱动**合流态**：把 WO-DATA 真 `cellSourceMap`/`baseDistanceKm`
 * （service.ts 接真 wiring 同式）喂进**真** `globalSimOptimize`（不 mock HTTP·不走 MSW），拿真 `schedule[]`
 * 直接渲染真组件 `ScheduleTable`，断言**上屏**的在途天来自 `schedule[].transitDays` 真值：
 *   ① 改 DATA 距离/供芯（近供芯 hefei 587km vs 远供芯 changzhou 735km）→ 上屏在途**真变**（1 天 → 2 天）；
 *   ② 上屏 transitDays **≠ 3**（3 = solver 内 `coeff("mockTransitDays",3)` mock 回退值·非真距离派生）；
 *   ③ cell-pack 的「WO-DATA 未落」诚实 mock 注记 → **清空**（证 solver 内 mock 回退**未被走到**·接缝真闭）。
 *
 * 镜像引擎 oracle apps/datacore/test/gsim-integrate.test.ts:89-90,99-100——但那门断在引擎输出，此门断在
 * **渲染上屏**（engine→render 接缝）。断言的是**只有 GlobalSimResponse 才有**的字段 `schedule[].transitDays`
 * （mockPortfolio 无 schedule[]·无从伪造）→ 门有意义（非「断在 mock 自己造的值」的假绿）。
 */

const inproc = new InProcOptimizerClient();
const solve = (req: Parameters<NonNullable<InProcOptimizerClient["solvePortfolio"]>>[0]) => inproc.solvePortfolio!(req);
const FORECAST_START = "2026-06-10";
const baseNameById = new Map(BASE_REGISTRY.map((b) => [b.baseId, b.name]));

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

/** 邯郸(PACK-only) 派单·必须调芯（twoStage:true）→ 供芯基地由 cellCapableBases 距离决定（改基地集 → 距离真变）。 */
function buildInput(
  bases: { baseId: string; name: string; factory_type: string; util: number }[],
  lines: { baseId: string; lineId: string; capacityDaily: number }[],
  cellCapableBases: string[],
): PortfolioInput {
  const maps = geoMaps(bases);
  return {
    forecastStart: FORECAST_START,
    orders: [{ so: "SO-GAC", cust: "广汽集团", model: "方形-LFP", qty: 300, due: "2026-07-08", pri: "高", status: "OPEN" }],
    workOrders: [],
    demandSegments: [],
    bases,
    lines,
    changeover: [],
    modelBaseMap: { "方形-LFP": ["handan"] }, // 派邯郸（PACK-only）→ 必须调芯
    seed: 42,
    coeff: (k: string, d: number) => (k === "windowDays" ? 7 : d),
    twoStage: true,
    packOnlyBases: ["handan"],
    cellCapableBases,
    cellSourceMap: maps.cellSourceMap,
    transitDaysMap: maps.transitDaysMap,
    freightCostMap: maps.freightCostMap,
    scenarios: ["max_ontime"],
  };
}

// 近供芯（hefei 587km）：cellSourceMap 就近选 hefei → transit=1。
const NEAR = buildInput(
  [
    { baseId: "handan", name: "邯郸", factory_type: "PACK", util: 0 },
    { baseId: "hefei", name: "合肥", factory_type: "CELL", util: 0 },
    { baseId: "changzhou", name: "常州", factory_type: "CELL+PACK", util: 0 },
  ],
  [
    { baseId: "handan", lineId: "hd-l1", capacityDaily: 500 },
    { baseId: "hefei", lineId: "hf-l1", capacityDaily: 500 },
  ],
  ["hefei", "changzhou"],
);
// 远供芯（只留 changzhou 735km 作供芯）→ 邯郸只能从常州调芯 → transit=2（真的更大·改数据→引擎→上屏真变）。
const FAR = buildInput(
  [
    { baseId: "handan", name: "邯郸", factory_type: "PACK", util: 0 },
    { baseId: "changzhou", name: "常州", factory_type: "CELL+PACK", util: 0 },
  ],
  [
    { baseId: "handan", lineId: "hd-l1", capacityDaily: 500 },
    { baseId: "changzhou", lineId: "cz-l1", capacityDaily: 500 },
  ],
  ["changzhou"],
);

async function renderSchedule(input: PortfolioInput) {
  const r = await globalSimOptimize(input, solve);
  const utils = render(
    <ScheduleTable
      allocation={r.allocation ?? []}
      schedule={r.schedule}
      transfers={[]}
      windowDays={7}
      forecastStart={FORECAST_START}
      baseNameById={baseNameById}
    />,
  );
  const transitText = () => within(screen.getByTestId("global-sim-sched-SO-GAC")).getByTestId("global-sim-sched-transit-SO-GAC").textContent ?? "";
  return { r, transitText, unmount: utils.unmount };
}

describe("WO-SURFACE-7DIM · SEAM-GATE（真求解器 schedule[].transitDays 渲染上屏·engine→render 接缝·非 MSW）", () => {
  it("真 globalSimOptimize schedule[].transitDays 上屏 → 改距离真变(1→2天)·非 mock 3·cell-pack mockNotes 清空", async () => {
    const expectedNear = Math.max(1, Math.ceil(baseDistanceKm("hefei", "handan") / 600));
    const expectedFar = Math.max(1, Math.ceil(baseDistanceKm("changzhou", "handan") / 600));
    // 前置：近/远距离派生的在途桶必须相异（否则「上屏真变」无从谈起）且都 ≠ mock 3。
    expect(expectedNear).not.toBe(3);
    expect(expectedFar).not.toBe(3);
    expect(expectedFar).not.toBe(expectedNear);

    // ── 近供芯（hefei）：真引擎产 schedule[] → 渲染 ScheduleTable → 上屏在途 = 距离派生真值 ──
    const near = await renderSchedule(NEAR);
    const rowNear = near.r.schedule.find((s) => s.orderId === "SO-GAC")!;
    expect(rowNear.batches[0]?.cellBase).toBe("hefei"); // 就近供芯 = 合肥（DATA oracle·非机械回退）
    expect(rowNear.transitDays).toBe(expectedNear); // 引擎输出 = 距离派生（非 solver mock 的 3）
    expect(rowNear.transitDays).not.toBe(3);
    const nearText = near.transitText();
    expect(nearText).toContain(`在途 ${expectedNear} 天`); // ★上屏值来自 schedule[].transitDays（只有 GlobalSimResponse 有此字段）
    expect(nearText).not.toContain("在途 3 天"); // 非 solver mock 回退
    // ★接缝真闭（命门）：无 cell-pack「WO-DATA 未落」诚实 mock 注记 → 证 solver 内 mock 回退**未被走到**。
    const cellPackMockNear = (near.r.mockNotes ?? []).filter((n) => /两阶段|供芯|transitDays|freightCost/.test(n) && /未落|mock/.test(n));
    expect(cellPackMockNear).toEqual([]);
    expect(near.r.schedule.find((s) => s.orderId === "SO-GAC")!.freightCost).toBeGreaterThan(0);
    near.unmount();

    // ── 改 DATA 距离（远供芯 changzhou）：同一渲染路径 → 上屏在途**真变**（engine→render 接缝驱动·非常量） ──
    const far = await renderSchedule(FAR);
    const rowFar = far.r.schedule.find((s) => s.orderId === "SO-GAC")!;
    expect(rowFar.batches[0]?.cellBase).toBe("changzhou"); // 唯一供芯 = 常州
    expect(rowFar.transitDays).toBe(expectedFar);
    expect(rowFar.transitDays).not.toBe(3);
    const farText = far.transitText();
    expect(farText).toContain(`在途 ${expectedFar} 天`);
    expect(farText).not.toBe(nearText); // ★上屏值 TRULY 改变（改距离 → 引擎 transit 真变 → 渲染真变）
    const cellPackMockFar = (far.r.mockNotes ?? []).filter((n) => /两阶段|供芯|transitDays|freightCost/.test(n) && /未落|mock/.test(n));
    expect(cellPackMockFar).toEqual([]);
    far.unmount();
  });
});
