import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN } from "./helpers.js";
import { demandCapacityTightness, liveTightness, riskTimeline } from "../src/solvers/risk.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext } from "../src/solvers/types.js";

/**
 * WO-CAP-01-REALDEMAND（P0·假推演根治·闭 G-SIM-FAKE）：风险张力需求驱动因素绑真供需 demandCapacityTightness。
 * 暗发 feature `qos.risk_realdemand`（defaultOn:false）——ON=需求驱动瓶颈因素取真供需（红对真需求敏感），
 * OFF=现行合成扁平产线利用率分支（回退演练）。合成源卡 dataMode 继承 SYNTHETIC 不自报 LIVE、不决策级染红。
 * 真值非写死：张力 == demandCapacityTightness 端点值；改 DemandSegment.p50 → 张力真变（非合成常数）。
 */

const ON = new Set(["view.risk-board", "qos.risk_realdemand"]);
const OFF = new Set(["view.risk-board"]);
const cz = (c: SolverContext) => String(c.bases.find((b) => b.props.name === "常州")?.props.baseId);

describe("WO-CAP-01-REALDEMAND · 风险张力绑真供需（闭 G-SIM-FAKE）", () => {
  it("C1: ON → 需求驱动瓶颈因素张力逐值 == demandCapacityTightness（真供需·常州 ~65<85 不决策级）；OFF → 合成扁平利用率（回退·恒红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = await t.services.solvers.loadContext("demo");
    const baseId = cz(c);

    // ON：瓶颈工序/物料齐套/人力工时 三个需求驱动因素张力都 == 真供需 demandCapacityTightness（绑定生效·逐值对照）。
    c.features = ON;
    const dctOn = demandCapacityTightness(c, baseId);
    expect(dctOn.live).toBe(true);
    for (const f of ["瓶颈工序", "物料齐套", "人力工时"]) {
      const lt = liveTightness(c, baseId, f);
      expect(lt.live).toBe(true);
      expect(lt.source).toBe("LIVE");
      expect(lt.value).toBe(dctOn.value); // 逐值：卡张力 == 端点 demandCapacityTightness 值
    }
    expect(dctOn.value).toBeLessThan(85); // 常州真供需张力 ~65 < 阈值 85 → 需求因子不决策级染红

    // OFF（回退演练）：瓶颈工序 回落合成扁平产线利用率（源 LIVE·恒红·现行行为不变），值 ≠ 真供需。
    c.features = OFF;
    const ltOff = liveTightness(c, baseId, "瓶颈工序");
    expect(ltOff.live).toBe(true);
    expect(ltOff.source).toBe("LIVE");
    expect(ltOff.value).toBeGreaterThanOrEqual(85); // 合成扁平 util ~92 ≥ 阈值 → OFF 恒红
    expect(ltOff.value).not.toBe(dctOn.value); // 证 ON(真供需)≠OFF(合成扁平)：绑定确实改变了口径
  });

  it("C2: 改基地 DemandSegment.p50 真需求 → 该基地需求因子张力真变（证非合成常数）；大幅升 → 可过阈决策级染红（红对真需求敏感）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const load = async () => {
      const c = await t.services.solvers.loadContext("demo");
      c.features = ON;
      return c;
    };
    const c0 = await load();
    const baseId = cz(c0);
    const before = demandCapacityTightness(c0, baseId).value;

    // 抬高真需求预测 p50/p90（×5）→ 真供需缺口扩大 → 张力上升（非哈希恒定）。
    const dsegs = await t.repos.objects.listByType("demo", "DemandSegment");
    expect(dsegs.length).toBeGreaterThan(0);
    for (const d of dsegs) {
      d.props.p50 = (d.props.p50 as number) * 5;
      d.props.p90 = (d.props.p90 as number) * 5;
      await t.repos.objects.put(d);
    }
    const after = demandCapacityTightness(await load(), baseId).value;
    expect(after).toBeGreaterThan(before); // 需求升 → 张力严格上升（demand-sensitive·非常数）
    expect(after).toBeGreaterThanOrEqual(85); // 真需求足够高时决策级染红由真供需驱动（非合成扁平）
  });

  it("C3: 合成源卡（无真供需/无 OEE/仅合成扁平产线利用率）ON → source=SYNTHETIC·卡 dataMode 继承 SYNTHETIC·不进决策级染红竞选·不进处置计划表；OFF → 现行 LIVE 恒红", () => {
    const mk = (props: Record<string, unknown>) => ({ id: `o-${String(props.baseId ?? props.lineId)}`, props });
    const build = (features: Set<string>): SolverContext =>
      ({
        tenantId: "t",
        params: BATTERY_SOLVER_PARAMS,
        bases: [mk({ baseId: "b1", name: "合成基地", util: 0.9 })],
        lines: [mk({ baseId: "b1", lineId: "L1", utilization: 95 })], // 合成扁平产线利用率（G-SIM-FAKE 源）
        processes: [], equipment: [], maintPlans: [], models: [], orders: [], shipments: [],
        segments: [], dataHealth: [], certByModel: new Map(),
        demandSegments: [], sopVersions: [], // 无真供需预测
        features,
      }) as unknown as SolverContext;

    // ON：无真供需 → 瓶颈工序 回落合成扁平利用率兜底但标 SYNTHETIC（不冒充 LIVE）。
    const on = build(ON);
    const ltOn = liveTightness(on, "b1", "瓶颈工序");
    expect(ltOn.live).toBe(true);
    expect(ltOn.source).toBe("SYNTHETIC");
    const outOn = riskTimeline(on, {}) as { cards: { baseId: string; dataMode?: string; peak: number | null }[]; planRows: { act: string }[] };
    const cardOn = outOn.cards.find((c) => c.baseId === "b1")!;
    expect(cardOn.dataMode).toBe("SYNTHETIC"); // 诚实位下沉：卡继承 SYNTHETIC 而非自报 LIVE
    expect(outOn.planRows.every((r) => !String(r.act).includes("合成基地"))).toBe(true); // 合成源不进决策级处置计划表

    // OFF（回退演练）：现行行为——合成扁平利用率上线为决策级 LIVE 恒红。
    const off = build(OFF);
    const ltOff = liveTightness(off, "b1", "瓶颈工序");
    expect(ltOff.source).toBe("LIVE");
    const outOff = riskTimeline(off, {}) as { cards: { baseId: string; dataMode?: string }[] };
    expect(outOff.cards.find((c) => c.baseId === "b1")!.dataMode).toBe("LIVE");
  });

  it("C4/真跑HTTP: OFF 关闸 → 自动看板每基地代表因子=瓶颈工序·合成扁平 ~90 全红（回退演练）；ON → 合成扁平 util 不再当决策级代表", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const auto = async () =>
      (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
        data: { cards: { base: string; factor: string; currentTightness?: { value: number }; dataMode?: string }[] };
      };

    // demo battery 模板默认全开 → ON。合成扁平 util（瓶颈工序 ~90）不再是任何基地的决策级代表因子。
    const on = (await auto()).data;
    const onFlatUtilCards = on.cards.filter((c) => c.factor === "瓶颈工序" && (c.currentTightness?.value ?? 0) >= 90);
    expect(onFlatUtilCards.length).toBe(0); // ON：无一基地由合成扁平 util ~90 决策级代表

    // 关闸（租户 override）→ 回退演练：每基地代表因子回到合成扁平 util（瓶颈工序）·恒红。
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "qos.risk_realdemand": false } } });
    const off = (await auto()).data;
    expect(off.cards.length).toBeGreaterThan(0);
    for (const c of off.cards) {
      expect(c.factor).toBe("瓶颈工序"); // OFF：合成扁平利用率重新当代表
      expect(c.currentTightness?.value ?? 0).toBeGreaterThanOrEqual(85); // 恒红
    }
    expect(off.cards.length).toBeGreaterThan(on.cards.filter((c) => (c.currentTightness?.value ?? 0) >= 85).length - 1);
  });

  it("C5/R6: 同 seed 同输入两跑字节一致（ON·确定性无时钟/随机）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = async () => JSON.stringify((await invokeSolver(t, "risk_timeline", { base: "常州", factor: "瓶颈工序", horizon: 30 })).json());
    expect(await run()).toBe(await run());
  });
});
