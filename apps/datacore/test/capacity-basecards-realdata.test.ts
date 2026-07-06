import { describe, expect, it } from "vitest";
import { riskTimeline } from "../src/solvers/risk.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext } from "../src/solvers/types.js";

/**
 * CAPACITY-BASECARDS-REALDATA 牙齿（P1 回归·用户亲报+亲定 2026-07-06）：产能推演 risk_timeline「每基地一卡」。
 * 症：KILL-MOCK-RED 去假后自动扫描把每基地真瓶颈（越线因子）全排除、非越线真因子又不出卡 → "每基地卡全没了"（0 卡）。
 * 治：每基地取**真张力最高的有真源因子**为代表出 LIVE 真值卡（值来自真设备时序·非 hash·改源即变）；
 *     某基地任何因子都无真源 → actionable 诚实空态卡（hasData=false·noDataReason·深链），**非静默跳过·非 hash 假红**。
 *
 * 真值非写死证据：设备 OEE 真快照（oee_current·由 ts_points 7d 加权聚合物化·走正门）→ liveTightness 派生张力
 * value = round(oeeBase + (1−avg)×oeeK)。改 oee_current → value 随之变（下方两 case 值不同即证）；移除设备源 → 卡回空态。
 */

const LIVE = BATTERY_SOLVER_PARAMS.bottleneck.live; // { oeeBase:30, oeeK:220, ... }

function mkObj(props: Record<string, unknown>): { id: string; props: Record<string, unknown> } {
  return { id: `obj-${String(props.baseId ?? props.equipId ?? "x")}`, props };
}

/** 最小 SolverContext：1 基地 + 可选设备（oee_current 真快照）；无产线/工序/需求预测（隔离出 设备OEE 唯一真源）。 */
function makeCtx(equipment: { oee_current: number }[]): SolverContext {
  return {
    tenantId: "t",
    params: BATTERY_SOLVER_PARAMS,
    bases: [mkObj({ baseId: "b1", name: "测试基地", util: 0.85 })],
    lines: [],
    processes: [],
    equipment: equipment.map((e, i) => mkObj({ equipId: `E${i}`, baseId: "b1", oee_current: e.oee_current })),
    maintPlans: [],
    models: [],
    orders: [],
    shipments: [],
    segments: [],
    dataHealth: [],
    certByModel: new Map(),
    demandSegments: [],
    sopVersions: [],
  } as unknown as SolverContext;
}

type Card = {
  base: string;
  factor: string;
  dataMode?: string;
  hasData?: boolean;
  noDataReason?: string;
  deeplink?: { to: string; label: string };
  currentTightness?: { value: number | null; live: boolean };
  peak: number | null;
  crossDay: number | null;
};

function run(equipment: { oee_current: number }[]): Card[] {
  return (riskTimeline(makeCtx(equipment), {}) as { cards: Card[] }).cards;
}

describe("CAPACITY-BASECARDS-REALDATA · 每基地一卡（真值驱动·诚实空态）", () => {
  it("齿①：有真设备时序（oee_current）→ 每基地一 LIVE 真值卡（非 null·hasData=true·值由真源派生）", () => {
    const cards = run([{ oee_current: 0.7 }]); // avg OEE 0.7
    expect(cards.length).toBe(1); // 每基地一卡（不再 0 卡）
    const c = cards[0]!;
    expect(c.base).toBe("测试基地");
    expect(c.factor).toBe("设备OEE"); // 唯一真源因子即代表
    expect(c.dataMode).toBe("LIVE");
    expect(c.hasData).toBe(true);
    expect(c.currentTightness?.live).toBe(true);
    // 真值非写死：value = round(oeeBase + (1−0.7)×oeeK)（来自真 oee_current·非哈希常数）。
    const expected = Math.round(LIVE.oeeBase + (1 - 0.7) * LIVE.oeeK);
    expect(c.currentTightness?.value).toBe(expected); // 96
    expect(c.peak).toBe(expected); // 平坦真基线（无事件）→ 峰值=基线
    expect(c.crossDay).toBe(1); // 96 ≥ 阈值 85 → 越线（真数据出真红·C6）
  });

  it("齿②：改真源 oee_current → 卡值随之变（证真数据驱动·非写死常数）", () => {
    const v70 = run([{ oee_current: 0.7 }])[0]!.currentTightness?.value;
    const v85 = run([{ oee_current: 0.85 }])[0]!.currentTightness?.value;
    expect(v70).toBe(Math.round(LIVE.oeeBase + (1 - 0.7) * LIVE.oeeK)); // 96
    expect(v85).toBe(Math.round(LIVE.oeeBase + (1 - 0.85) * LIVE.oeeK)); // 63
    expect(v70).not.toBe(v85); // 改真源即改值 → 非写死
    // 高 OEE（低张力 63 < 85）仍如实出卡（每基地一卡·非"非越线即丢卡"），只是不越线。
    const low = run([{ oee_current: 0.85 }])[0]!;
    expect(low.hasData).toBe(true);
    expect(low.crossDay).toBeNull();
  });

  it("齿③：无任何真源（revert 时序种子）→ 诚实空态卡（hasData=false·noDataReason·深链）·非静默跳过·非假红", () => {
    const cards = run([]); // 无设备·无产线/工序/需求预测 → 所有因子无真源
    expect(cards.length).toBe(1); // 关键：基地未被静默丢弃（旧口径这里 0 卡）
    const c = cards[0]!;
    expect(c.hasData).toBe(false);
    expect(c.dataMode).toBe("MOCK");
    expect(c.currentTightness?.value).toBeNull(); // 不伪造张力
    expect(c.peak).toBeNull(); // 不伪造峰值
    expect(c.crossDay).toBeNull(); // 不伪造越线（非假红）
    expect(c.noDataReason).toBeTruthy();
    expect(c.deeplink?.to).toBe("/admin/connections"); // actionable 深链去数据接入
    expect(c.deeplink?.label).toBeTruthy();
  });
});
