import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-RC2-DEFAULT-FEED（co-closes WO-CAP-09-SANDBOX-TICK-LIVE）· green→red 真牙齿（KILL-MOCK-RED）。
 *
 * 两个缺口的收口验证：
 *  Gap A — 接地按会话 opt-in（body.grounding=true）与租户 certification 档解耦：demo 租户 sim.temporal_grounding
 *          恒关（battery-all-on 排除），但显式 grounding 会话仍冻结 feeds + tick 注入 → 沙盘真动。
 *  Gap B — 真源字段映射诚实：PurchaseOrder 真声明 etaDay（相对 forecastStart 的到货日·日粒 sim 时钟=tick），
 *          resolver 读真字段解出到达序列（非合成）。无逐日/覆盖声明的 DemandSegment 仍据实报 EMPTY_DATA 缺口。
 *
 * 齿①: grounded 会话 → purchase_order_eta feed 从真 PO 源解出**非空**序列（真到达）。
 * 齿②: grounded 会话 tick 前进 → 目标格 stateVar **逐 tick 变化**（真 PO 驱动·非静止/非零轨迹）。
 * 齿③: 仅聚合 p50 的 DemandSegment → demand_segment feed **不生成**·诚实 EMPTY_DATA 缺口（绝不合成伪日曲线）。
 * 齿④: grounding OFF（不传 grounding·租户档恒关）→ feeds 空·tick = v1.1 恒等（R6）。同 feedSpecs 仅 grounding 差异 → 冻结/不冻结分明。
 */

// enable sim.* 但**刻意不开** sim.temporal_grounding —— 证明接地由会话级 grounding 决定（decouple）。
const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/demo/features`, headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true } },
  });

// PO 到货注入目标（抽象格·delta 来自真 PO qty；base 含目标对象以便逐 tick 观测其变化）。
const PO_TARGET = { objectType: "Inventory", objectIds: ["inv1"], stateVar: "level" } as const;
const PO_FEEDSPEC = { feedKey: "po_arrivals", target: PO_TARGET, source: { kind: "purchase_order_eta" } };

const createSession = (t: TestApp, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload });

describe("WO-RC2-DEFAULT-FEED · grounded demo sandbox 真动（CAP-09 tick-live 收口）", () => {
  it("齿① grounded 会话从真 PurchaseOrder(etaDay) 源解出非空到达序列（真源·非合成）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 真 demo 电池数据集：含 PurchaseOrder 对象（etaDay+qty 真声明）
    await enableSim(t);
    const res = await createSession(t, { baseSnapshot: { inv1: { level: 0 } }, feedSpecs: [PO_FEEDSPEC], horizonTicks: 30, grounding: true });
    expect(res.statusCode).toBe(201);
    const s = res.json() as { feeds: { feedKey: string; live: boolean; series: { tick: number; delta: number }[]; coverageTicks: number }[] };
    const feed = s.feeds.find((f) => f.feedKey === "po_arrivals");
    expect(feed, "po_arrivals feed 应被冻结（真源存在）").toBeTruthy();
    expect(feed!.live).toBe(true);
    expect(feed!.series.length).toBeGreaterThan(0); // 真到达点·非空
    // 每个到达点是真 PO qty（正数·非 0·非合成常量）：至少一个 delta>0。
    expect(feed!.series.some((p) => p.delta > 0)).toBe(true);
    // 到达落在 horizon 内（真 etaDay∈[0,30)）。
    expect(feed!.series.every((p) => p.tick >= 0 && p.tick < 30)).toBe(true);
  });

  it("齿② grounded 会话 tick 前进 → 目标 stateVar 逐 tick 真变化（非静止·真 PO 驱动）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t);
    const sid = (await createSession(t, { baseSnapshot: { inv1: { level: 0 } }, feedSpecs: [PO_FEEDSPEC], horizonTicks: 30, grounding: true })).json().id as string;

    // 逐 tick 走 30 步，记录目标格轨迹。
    const traj: number[] = [];
    for (let i = 0; i < 30; i++) {
      const tk = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
      traj.push(Number(tk.json().state.inv1?.level ?? 0));
    }
    // 非静止：轨迹存在真实增长（相邻 tick 至少一处 delta>0），且末值 > 首值（真到货累计入库）。
    const moved = traj.some((v, i) => i > 0 && v !== traj[i - 1]);
    expect(moved, `轨迹应随真 PO 到货变化，实测 traj=${JSON.stringify(traj)}`).toBe(true);
    expect(traj[traj.length - 1]).toBeGreaterThan(traj[0]); // 累计入库 → 末>首
    expect(traj[traj.length - 1]).toBeGreaterThan(0); // 非零轨迹
  });

  it("齿③ KILL-MOCK-RED：仅聚合 p50 的 DemandSegment → feed 不生成·诚实 EMPTY_DATA（绝不合成伪日曲线）", async () => {
    const t = await makeApp();
    await seedBattery(t); // demo DemandSegment 只有聚合 p50（无 dailyP50/coverageDays）
    await enableSim(t);
    const spec = { feedKey: "demand", target: { objectType: "Inventory", objectIds: ["inv1"], stateVar: "level" }, source: { kind: "demand_segment", segmentKeys: ["dseg-1"] } };
    const res = await createSession(t, { baseSnapshot: { inv1: { level: 0 } }, feedSpecs: [spec], horizonTicks: 30, grounding: true });
    expect(res.statusCode).toBe(201);
    const s = res.json() as { feeds: { feedKey: string }[]; feedGaps?: { feedKey: string; gapCode: string; detail: string }[] };
    expect(s.feeds.find((f) => f.feedKey === "demand"), "无逐日/覆盖声明 → 不得合成 demand feed").toBeFalsy();
    const gap = s.feedGaps?.find((g) => g.feedKey === "demand");
    expect(gap, "应回带诚实 EMPTY_DATA 缺口卡").toBeTruthy();
    expect(gap!.gapCode).toBe("EMPTY_DATA");
    expect(gap!.detail).toMatch(/无逐日预测率|不铺伪日曲线|未找到/);
  });

  it("齿④ 回归/关闸：grounding OFF（租户档恒关）→ feeds 空·tick=v1.1 恒等；同 feedSpecs 仅 grounding 差异 → 冻结分明", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t);
    // 关闸会话：传了 feedSpecs 但**不传 grounding**（租户 sim.temporal_grounding 恒关）→ feeds 不冻结。
    const off = await createSession(t, { baseSnapshot: { inv1: { level: 0 } }, feedSpecs: [PO_FEEDSPEC], horizonTicks: 30 });
    expect(off.json().feeds).toEqual([]); // 未接地 → 空 feeds（v1.1 字节一致前提）
    // 开闸会话：同 feedSpecs + grounding:true → feeds 冻结（对照·证 grounding 是唯一开关）。
    const on = await createSession(t, { baseSnapshot: { inv1: { level: 0 } }, feedSpecs: [PO_FEEDSPEC], horizonTicks: 30, grounding: true });
    expect((on.json().feeds as unknown[]).length).toBeGreaterThan(0);

    // 关闸 tick = 恒等桩（无 PUBLISHED 传导规则 + 无 feeds → 状态原样进位·R6）。
    const offSid = off.json().id as string;
    const t1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${offSid}/tick`, headers: ADMIN, payload: { n: 5 } });
    expect(t1.json().curTick).toBe(5);
    expect(Number(t1.json().state.inv1.level)).toBe(0); // 无 feed 注入 → 恒等（未动）
  });
});
