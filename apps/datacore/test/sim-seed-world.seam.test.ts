import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  DEMO_SIM_WORLD_PERTURB_START_TICK,
  DEMO_SIM_WORLD_SESSION_ID,
  DEMO_SIM_WORLD_TICKS,
  seedDemoSimWorld,
} from "../src/sim/seed-world.js";
import type { Perturbation, SimMetricSeriesResponse, SimSession, SimSessionListItem, TickState } from "@platform/contracts";

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

/**
 * ⚠ 回包类型是 `SimSessionListItem`（**不含 `baseSnapshot`**·WO-SIM-SESSIONS-PROJECTION）。
 * 原来这里写的是 `as SimSession[]` —— 一个 `as` 让类型系统对这件事**一个字都说不出来**
 * （铁律 0.6 第 4 条那个形态：旧名以「数据键」形态存在，`typecheck` 全绿）。
 * 改成投影类型之后，任何再从列表里读世界内容的写法都会**编译当场红**。
 */
const listSessions = async (t: TestApp): Promise<SimSessionListItem[]> => {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return r.json().items as SimSessionListItem[];
};

/** 单条会话的完整读（含 `baseSnapshot`）—— 列表投影之后，世界内容只从这条路来。 */
const getSession = async (t: TestApp, id: string): Promise<SimSession> => {
  const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${id}`, headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return r.json() as SimSession;
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
    // WO-SIM-SESSIONS-PROJECTION：列表**不再带世界内容**，「世界非空」改由规模摘要作证；
    // 完整的那一份从 `GET …/:id` 取（两处必须逐值对得上，见下）。
    expect(s.baseSnapshotScale.cells, "规模摘要说这个世界非空").toBeGreaterThan(0);
    const full = await getSession(t, s.id);
    expect(cellCount(full.baseSnapshot), "baseSnapshot 非空").toBeGreaterThan(0);
    expect(s.baseSnapshotScale.cells, "列表摘要与单取的世界必须是同一个数").toBe(cellCount(full.baseSnapshot));
    expect(s.baseSnapshotScale.objects).toBe(Object.keys(full.baseSnapshot).length);

    // 出处记号随列表原样下发（判据 3：这批读数说得出出处，且分项是**现测**的）。
    const origin = (s.scope as { baseSnapshotOrigin?: Record<string, unknown> }).baseSnapshotOrigin;
    expect(origin?.kind).toBe("DERIVED");
    expect(origin?.cells).toBe(cellCount(full.baseSnapshot));
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
    const anyObjectId = Object.keys(full.baseSnapshot)[0]!;
    const objs = await t.repos.objects.listByType("demo", (await t.repos.objects.get("demo", anyObjectId))!.type);
    expect(objs.some((o) => o.id === anyObjectId), "世界的键 = 真物化对象 id（不是 `${type}#0` 占位）").toBe(true);

    // ── ③ 幂等：重复播种一条都不多，也不会把已有世界又推 3 拍 ────────────────────
    const again = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(again.created).toBe(false);
    const after = await listSessions(t);
    expect(after).toHaveLength(1);
    expect(after[0]!.curTick).toBe(DEMO_SIM_WORLD_TICKS);
  });

  /**
   * ══ WO-SIM-SEED-PERTURB · 扰动接缝 ═══════════════════════════════════════════════
   *
   * **X（改之前·真服务实测）**：`sims_demo_seed_world` 的 `GET …/perturbations` 回 `{"items":[]}`，
   * `GET …/metric-series` 3494 条指标里「`baseline ≠ actual`」的**条数 = 0** ——
   * 样例 `obj_arinvoice_arinvoice_0_0.overduePressure`
   * `baseline=[15,15,36.6,83.8]` / `actual=[15,15,36.6,83.8]` 逐值全等。
   * 推演沙盘首页两列一模一样，一整片"无事发生"。
   *
   * **Y（应该）**：种子世界带一条说得出出处的扰动，两条线真分叉，且**下游真的被带动**。
   *
   * ── 咬的是链路，不是"有没有那条记录" ─────────────────────────────────────────────
   * ⛔ 只断言「扰动记录存在」**不算数** —— 那正是判据 2 点名的静默错答：
   *    扰动写到一个 `propagateTick` 取不到的键上（`Type#0` 这种占位），记录明明在、
   *    `state[sourceId]` 却永远取不到 ⇒ 屏上那一格变了、下游一动不动，而测试全绿。
   * 所以本门断的是整条链：
   *    播种 → 扰动入库 → **引擎在 tick1 施加** → `GET …/metric-series` 两条线分叉
   *    → **动的对象不止落点自身**（下游真的被带动）。
   */
  it("⑤ 扰动接缝：播种 ⇒ 会话有扰动 ⇒ metric-series 两条线分叉 ⇒ 且被带动的对象不止落点自身", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);

    const report = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(report.created, `种子世界没建起来：${report.reason ?? ""}`).toBe(true);

    // ── ⑤a 扰动真在库里，且**落点是真物化对象上真存在的那一格**（判据 2 的前半）──────
    const pr = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${DEMO_SIM_WORLD_SESSION_ID}/perturbations`, headers: ADMIN,
    });
    expect(pr.statusCode).toBe(200);
    const perturbations = pr.json().items as Perturbation[];
    // 一条（判据 3：只播一条 ⇒ `delta`/`scale` 不可交换的顺序问题在结构上不存在）。
    expect(perturbations, `没播扰动：${report.perturbationReason ?? ""}`).toHaveLength(1);
    const p = perturbations[0]!;
    expect(p.startTick, "startTick 必须 ≥1：取 0 会被路由写进 tick0 行，而两条线共用同一份 tick0 种子 ⇒ 又变回逐值全等")
      .toBe(DEMO_SIM_WORLD_PERTURB_START_TICK);
    expect(p.startTick).toBeGreaterThanOrEqual(1);
    // 落点必须是真物化对象（不是 `${type}#0` 占位），且该状态变量在它 tick0 的态里真的有。
    const landing = await t.repos.objects.get("demo", p.targetObjectId);
    expect(landing, `落点 ${p.targetObjectId} 必须是真物化对象`).not.toBeNull();
    const tick0 = await t.repos.sim.getTickState("demo", DEMO_SIM_WORLD_SESSION_ID, 0);
    expect(typeof tick0!.state[p.targetObjectId]?.[p.targetStateVar], "落点那一格必须在世界态里真存在").toBe("number");
    // 幅度有出处：全距 = 该状态变量在本世界的观测 max−min，且**必须非零**（`delta 0` = 什么都没发生）。
    expect(report.choice!.magnitude).toBe(report.choice!.varMax - report.choice!.varMin);
    expect(p.magnitude).toBe(report.choice!.magnitude);
    expect(p.magnitude).not.toBe(0);

    // ── ⑤b 两条线真分叉（判据 7 的核心：`baseline ≠ actual` 的条数 > 0）─────────────
    const ms = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${DEMO_SIM_WORLD_SESSION_ID}/metric-series`, headers: ADMIN,
    });
    expect(ms.statusCode).toBe(200);
    const series = ms.json() as SimMetricSeriesResponse;
    const moved = series.metrics.filter((m) => JSON.stringify(m.baseline) !== JSON.stringify(m.actual));
    expect(moved.length, "两条线逐值全等 = 扰动没进传导核（本单要消灭的那个 X）").toBeGreaterThan(0);

    // ── ⑤c **下游真的被带动**（判据 2 的后半 · 本门最要害的一条）───────────────────
    // 只有落点自己动 = 扰动被就地写进了那一格、没沿链路走 —— 记录在、屏上也变了、下游一动不动。
    const movedObjects = new Set(moved.map((m) => m.objectId));
    const downstream = [...movedObjects].filter((id) => id !== p.targetObjectId);
    expect(downstream.length, "只有落点自身动过 ⇒ 扰动没沿链路传导（静默错答的老形态）").toBeGreaterThan(0);
    // 落点自己当然也得动 —— 它不动说明扰动压根没落地。
    expect(movedObjects.has(p.targetObjectId), "落点自己必须动").toBe(true);

    // ── ⑤d 金丝雀：先自证这个比较器真能分辨「相同」与「不同」（铁律 0.6）────────────
    // 它若把什么都判成"动了"，⑤b/⑤c 就是两条恒真的断言，度量不到任何东西。
    // 已知必**不**中：tick0 是两条线共用的种子 ⇒ 第 0 格必须逐值相等，分叉不许提前到 t0。
    expect(series.ticks[0]).toBe(0);
    for (const m of moved) {
      expect(m.baseline[0], `${m.key} 在 t0 就分叉了 ⇒ 扰动被烙进了基线自己的起点`).toBe(m.actual[0]);
    }
    // 已知必中：随便挑一条动了的，它至少有一格真的不等（不是 JSON 序列化的假象）。
    const sample = moved[0]!;
    expect(sample.baseline.some((v, i) => v !== sample.actual[i]), "金丝雀：比较器认得出真差值").toBe(true);
    // 反向金丝雀：没动的那些，逐格必须真相等。
    const still = series.metrics.filter((m) => JSON.stringify(m.baseline) === JSON.stringify(m.actual));
    expect(still.length, "全世界都动了 ⇒ 这个世界里没有「没被带动」的对照，⑤b 就不成其为证据").toBeGreaterThan(0);
    expect(still[0]!.baseline).toEqual(still[0]!.actual);

    // ── ⑤e 可达面口径不是装饰：结构估的下游格数 == 真跑动了的下游格数 ────────────────
    // 这一条是给排序键做的"金丝雀"：`reachCells` 若与真跑对不上，那它就不度量它声称度量的东西
    // （本单实测过一次：第一跳开销算错 ⇒ 估 37 / 真 94，正是靠这条对账抖出来的）。
    const movedCellsDownstream = moved.filter((m) => m.objectId !== p.targetObjectId || m.stateVar !== p.targetStateVar);
    expect(movedCellsDownstream.length, "结构可达面与真跑对不上 ⇒ 排序键度量的不是传导").toBe(report.choice!.reachCells);

    // ── ⑤f **落库的世界**与**屏上的曲线**必须是同一个世界 ──────────────────────────
    // 为什么必须单独咬这一条（变异反证逼出来的，不是想出来的）：
    // `metric-series` **从 tick0 现场重算两条线**，它压根不读 `sim_tick_state` 的落盘行。
    // ⇒ 只要扰动记录在库里，哪怕它是在 tick **之后**才建的（那时逐格世界态早已算完、
    //   `POST …/perturbations` 只把落点那一格就地改了、下游一格没动），
    //   ⑤b/⑤c 依旧全绿 —— 曲线是对的，而**落盘的世界是错的**。
    //   沙盘取「当前世界」走的正是那批落盘行（`GET …/:id/world`），于是屏上两处对不上账。
    // 判据：逐格比对「落盘的当前 tick 态」与「曲线 actual 的最后一格」，必须逐值相同。
    const last = await t.repos.sim.getTickState("demo", DEMO_SIM_WORLD_SESSION_ID, series.toTick);
    expect(last, `tick${series.toTick} 行必须落盘`).not.toBeNull();
    for (const m of moved) {
      expect(
        last!.state[m.objectId]?.[m.stateVar],
        `${m.key}：落盘世界与曲线 actual 对不上 ⇒ 扰动没进那条真跑的传导（多半是建扰动排到了 tick 之后）`,
      ).toBe(m.actual[m.actual.length - 1]);
    }
  });

  it("⑥ 确定性（R6）：同一份世界重播一遍，选出来的落点与幅度**逐字节一致**", async () => {
    // 判据 5 要的是"同一份种子重跑字节级一致"。两个互不相干的 app 各播一次再逐字段比 ——
    // 比"把纯函数调用两次"强：它连**读库顺序**引入的漂移也一起咬住（`listByType` / `links.list`
    // 若哪天回来的顺序不稳，选点就会跟着漂，而纯函数那种比法看不见）。
    const seedOnce = async (): Promise<Perturbation | null> => {
      const t = await makeApp();
      await enableSim(t);
      await seedBattery(t);
      await seedDemoPropagationRules(t.repos);
      const r = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
      expect(r.created).toBe(true);
      return r.perturbation ?? null;
    };
    const a = await seedOnce();
    const b = await seedOnce();
    expect(a, "第一次就没播出扰动，这条断言便无从谈起").not.toBeNull();
    // 含 `id` 与 `createdAt`：两者都固定（不取时钟、不取 randomBytes）⇒ 逐字节相同。
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
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
