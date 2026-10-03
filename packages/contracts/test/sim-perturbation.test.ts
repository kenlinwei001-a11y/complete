import { describe, expect, it } from "vitest";
import {
  PerturbationKindSchema,
  PerturbationSchema,
  applyPerturbationToState,
  isPerturbationActiveAt,
  type TickState,
} from "../src/sim.js";

/**
 * WO-P0 · 扰动一等公民（PRD-UPGRADE-decision-sandbox-v2 §3.1.2 / §3.1.3）。
 *
 * 本文件守**契约层**的两条单源判据（`isPerturbationActiveAt` / `applyPerturbationToState`）——
 * 它们被 `apps/datacore/src/app.ts` 的 `/act` 与 `POST /perturbations` **两条生产路径**共用
 * （不是只有 test 引用的"已排练"函数），WO-P2 的 `propagateTick` 也将用同一份，
 * 避免"两个 dev 各发明一套判据"那类接缝事故。
 */
describe("WO-P0 契约 · Perturbation", () => {
  it("五类语义扰动冻结（kind 决定前端分类展示，不进传导规则·PRD §3.1.2 判据 3）", () => {
    expect(PerturbationKindSchema.options).toEqual([
      "demand_shift",
      "supply_disruption",
      "capacity_loss",
      "cost_shock",
      "quality_event",
    ]);
  });

  it("时序三字段（REQ060）：durationTicks 缺省为 null=永久 · mode 缺省为 set · durationTicks 最小 1", () => {
    const p = PerturbationSchema.parse({
      id: "p1", tenantId: "demo", sessionId: "s1", kind: "capacity_loss",
      targetObjectId: "line-a", targetStateVar: "utilPressure",
      startTick: 3, magnitude: 0, label: "常州 A 线停机",
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    expect(p.durationTicks).toBeNull(); // null = 永久 = 今天 /act 的行为（additive 可回退）
    expect(p.mode).toBe("set");
    // durationTicks: 0 无意义（"持续 0 个 tick"= 没发生），契约层挡住
    expect(() => PerturbationSchema.parse({ ...p, durationTicks: 0 })).toThrow();
    expect(() => PerturbationSchema.parse({ ...p, startTick: -1 })).toThrow();
  });

  it("active(p,t) 单源判据：起点含、终点开——durationTicks=72 起于 3 则 tick 74 仍在、tick 75 已回退", () => {
    const p = { startTick: 3, durationTicks: 72 };
    expect(isPerturbationActiveAt(p, 2)).toBe(false); // 未到起点
    expect(isPerturbationActiveAt(p, 3)).toBe(true); // 起点当 tick 即生效
    expect(isPerturbationActiveAt(p, 74)).toBe(true); // 3 + 72 - 1
    expect(isPerturbationActiveAt(p, 75)).toBe(false); // 到期回退（WO-P2 在这一 tick 反向施加）
    // null = 永久：任何 t >= startTick 都生效
    expect(isPerturbationActiveAt({ startTick: 3, durationTicks: null }, 10_000)).toBe(true);
    expect(isPerturbationActiveAt({ startTick: 3, durationTicks: null }, 0)).toBe(false);
  });

  it("三种幅度模式各算各的（PRD §3.1.2 判据 2：只给 set 会逼前端自己算 = 第二套真相源）", () => {
    const state: TickState = { o1: { v: 200 } };
    expect(applyPerturbationToState(state, { targetObjectId: "o1", targetStateVar: "v", magnitude: 0, mode: "set" }).o1?.v).toBe(0);
    expect(applyPerturbationToState(state, { targetObjectId: "o1", targetStateVar: "v", magnitude: 200, mode: "delta" }).o1?.v).toBe(400);
    expect(applyPerturbationToState(state, { targetObjectId: "o1", targetStateVar: "v", magnitude: 1.15, mode: "scale" }).o1?.v).toBeCloseTo(230, 10);
  });

  it("纯函数（R6）：不改入参 · 缺位视为 0 · 同输入同输出字节级一致", () => {
    const state: TickState = { o1: { v: 200 } };
    const frozen = JSON.stringify(state);
    const a = applyPerturbationToState(state, { targetObjectId: "o2", targetStateVar: "risk", magnitude: 3, mode: "delta" });
    expect(JSON.stringify(state)).toBe(frozen); // 入参未被就地改
    expect(a.o2?.risk).toBe(3); // 缺位视为 0 → 0 + 3
    const b = applyPerturbationToState(state, { targetObjectId: "o2", targetStateVar: "risk", magnitude: 3, mode: "delta" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
