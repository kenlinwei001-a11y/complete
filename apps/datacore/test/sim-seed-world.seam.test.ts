import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  DEMO_SIM_WORLD_PERTURB_START_TICK,
  DEMO_SIM_WORLD_SESSION_ID,
  DEMO_SIM_WORLD_TICKS,
  seedDemoSimWorld,
} from "../src/sim/seed-world.js";
import type { Perturbation, SimMetricSeriesResponse, SimSession, TickState } from "@platform/contracts";

/**
 * WO-SIM-SEED-WORLD · **接缝门**：种子跑完 ⇒ 列表里有 RUNNING 会话，且 tick 态存在、非空、真动过。
 *
 * ══ 咬的是链路，不是函数 ═════════════════════════════════════════════════════
 *
 * 本门刻意**不**断言 `seedDemoSimWorld()` 返回了什么 —— 那只能证明一个函数会返回东西
 * （本仓假绿第 9 形态：实现有、测试有、且是绿的，而链路是断的）。
 * 它断言的是四页真正走的那条路：
 *
 *   播种（数据半：物化对象 + PUBLISHED 传导规则）
 *     → `services.sim` 建会话 + **真 tick**（引擎半：propagateTick 逐格落盘）
 *     → `GET /a/v1/sim/sessions`（**四页的会话钩子 `useConsoleSession` 打的就是这条**）
 *     → 列表里挑得出 `status==="RUNNING" && curTick>=1` 的那条
 *     → 该会话的 tick 态在库里、非空、且与 tick0 不同（= 真跑过传导核）。
 *
 * 任一半漏掉即红：数据半没播 ⇒ 无格子可铺（③ 诚实缺席那条会与①冲突）；
 * 引擎半没真跑 ⇒ curTick 不进位 / tick 态与 tick0 逐字节相同 / trace 恒 null。
 *
 * ⚠ **手写一个 `status:"RUNNING"` 塞进仓储能不能骗过本门**：骗不过 ——
 * ②③ 咬的是「tick 态行存在 + 与 tick0 不同 + trace 非空」，那是只有真 tick 才写得出来的东西。
 * 这三条正是本单派单里点名禁止的那种假 RUNNING 的**反面判据**。
 */

const enableSim = (t: TestApp, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 世界态格子数（objectId × stateVar），断言"非空"时用它——`Object.keys(state).length` 只数到对象。 */
const cellCount = (state: TickState): number =>
  Object.values(state).reduce((n, row) => n + Object.keys(row).length, 0);

const listSessions = async (t: TestApp): Promise<SimSession[]> => {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return r.json().items as SimSession[];
};

describe("WO-SIM-SEED-WORLD · 种子世界接缝", () => {
  it("① 播种 → GET /a/v1/sim/sessions 里有一条 RUNNING(curTick≥1)、baseSnapshot 非空；② tick 态落盘且真动过；③ 幂等", async () => {
    const t = await makeApp();
    await enableSim(t);

    // ── 金丝雀：播种之前列表是空的 ────────────────────────────────────────────────
    // 没有这一步，下面的"有一条 RUNNING"就可能是**别处早就有的**会话，
    // 那样这门度量的就不是本单（"我用 X 当作 Y 的证据，而 X 并不度量 Y"）。
    expect(await listSessions(t), "播种前不该有任何沙盘会话").toEqual([]);

    // 数据半：物化本体对象 + 播 PUBLISHED 传导规则（生产 SEED_DEMO 序列的同两步）。
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);

    const report = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(report.created, `种子世界没建起来：${report.reason ?? ""}`).toBe(true);

    // ── ① 四页真正走的那条路：列表里挑得出 RUNNING ──────────────────────────────
    const items = await listSessions(t);
    expect(items).toHaveLength(1); // 没被 `snapshotKind` 过滤掉（那个键会让会话从沙盘列表里消失）
    const s = items[0]!;
    expect(s.id).toBe(DEMO_SIM_WORLD_SESSION_ID);
    expect(s.status).toBe("RUNNING");
    expect(s.curTick).toBe(DEMO_SIM_WORLD_TICKS);
    expect(s.curTick).toBeGreaterThanOrEqual(1);
    expect(cellCount(s.baseSnapshot), "baseSnapshot 非空").toBeGreaterThan(0);

    // 出处记号随列表原样下发（判据 3：这批读数说得出出处，且分项是**现测**的）。
    const origin = (s.scope as { baseSnapshotOrigin?: Record<string, unknown> }).baseSnapshotOrigin;
    expect(origin?.kind).toBe("DERIVED");
    expect(origin?.cells).toBe(cellCount(s.baseSnapshot));
    expect((origin?.measuredCells as number) + (origin?.derivedCells as number)).toBe(origin?.cells);

    // ── ② tick 态：存在 + 非空 + 与 tick0 不同 + trace 非空（= 真的过了传导核）────
    const tick0 = await t.repos.sim.getTickState("demo", s.id, 0);
    const last = await t.repos.sim.getTickState("demo", s.id, s.curTick);
    expect(tick0, "tick0 行必须落盘").not.toBeNull();
    expect(last, `tick${s.curTick} 行必须落盘`).not.toBeNull();
    expect(cellCount(last!.state), "当前 tick 态非空").toBeGreaterThan(0);
    expect(last!.state, "世界真动过（恒等桩会逐字节相同）").not.toEqual(tick0!.state);
    expect(last!.trace, "真 tick 会记 trace；假 RUNNING 记不出来").not.toBeNull();
    expect(last!.trace!.length).toBeGreaterThan(0);

    // 世界态是从**真物化对象**上铺的：随便取一格，它的 objectId 必须是本租户真对象。
    const anyObjectId = Object.keys(s.baseSnapshot)[0]!;
    const objs = await t.repos.objects.listByType("demo", (await t.repos.objects.get("demo", anyObjectId))!.type);
    expect(objs.some((o) => o.id === anyObjectId), "世界的键 = 真物化对象 id（不是 `${type}#0` 占位）").toBe(true);

    // ── ③ 幂等：重复播种一条都不多，也不会把已有世界又推 3 拍 ────────────────────
    const again = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(again.created).toBe(false);
    const after = await listSessions(t);
    expect(after).toHaveLength(1);
    expect(after[0]!.curTick).toBe(DEMO_SIM_WORLD_TICKS);
  });

  it("④ 诚实缺席：零传导规则/零物化对象的租户**不建空世界**（空 baseSnapshot 的 RUNNING = 另一种占位）", async () => {
    const t = await makeApp();
    const report = await seedDemoSimWorld(t.repos, t.services.sim, {
      tenantId: "freshco",
      userId: "usr_freshco_admin",
      roles: ["admin"],
      attributes: {},
    });
    expect(report.created).toBe(false);
    expect(report.sessionId).toBeNull();
    expect(report.reason, "不建就必须说为什么（诚实缺席，不是静默返回空回执）").toContain("零可铺格子");
    // 断言落在**仓储**上而不是 REST 上：`freshco` 是个连 `sim.sandbox` 都没开的干净租户，
    // 走 REST 拿到的会是 404 FEATURE_NOT_FOUND（entitlement 先于 authz），
    // 那证明的是"功能没开"，**不是**"没建世界"——两件事，别拿一个当另一个的证据。
    expect(await t.repos.sim.listSessions("freshco")).toEqual([]);
  });
});
