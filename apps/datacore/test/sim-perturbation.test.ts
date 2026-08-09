import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

/**
 * WO-P0 · 扰动升格为一等公民（PRD-UPGRADE-decision-sandbox-v2 §3.1 · 关闭 #150/#151/REQ060）。
 *
 * 本文件是 PRD §7.2「时序维专项断言」的落地，四条会红的断言逐条对应：
 *  ① `durationTicks: null` 与今天 `/act` **逐字节同结果**（additive 可回退的证明）
 *  ② `tick → act → tick` 后 `pending` **未丢**（直接咬 #151；没有这条，修了也会退化）
 *  ③ 同扰动同种子重跑**字节级一致**（R6 确定性）
 *  ④ 扰动列表能列出「这个世界受过哪些扰动」（此前做不到——扰动不是实体，只是一次副作用）
 */
const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>, tenant = "demo") =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true } },
  });

const BASE = { o1: { risk: 0.5 }, o2: { risk: 0.2 } };

/** 建一条 delayTicks=1 的传导规则 + 真对象 + 真 link ⇒ 跑一次 tick 后 `pending` 必然非空。 */
const seedDelayedPropagation = async (t: Awaited<ReturnType<typeof makeApp>>, headers = ADMIN, tenant = "demo") => {
  const org = { type: "SYNTHETIC" as const, jobId: "wo-p0" };
  for (const k of ["TypeA", "TypeB"]) {
    await t.repos.ontologyTypes.put({ id: `otype_${k}`, tenantId: tenant, key: k, displayName: k, properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE" });
  }
  await t.repos.objects.put({ id: "o1", tenantId: tenant, type: "TypeA", props: {}, origin: org });
  await t.repos.objects.put({ id: "o2", tenantId: tenant, type: "TypeB", props: {}, origin: org });
  await t.repos.links.put({ id: "lnk1", tenantId: tenant, type: "FEEDS", fromId: "o1", toId: "o2", origin: org });
  // 与生产种子 `seed.ts` 的 `demo_line_util_to_base_load` 同形：delayTicks: 1 ⇒ 贡献在下一 tick 才到。
  await t.app.inject({
    method: "POST", url: "/a/v1/sim/propagation-rules", headers,
    payload: { key: "r_delay", sourceTypeKey: "TypeA", sourceStateVar: "risk", viaLinkKey: "FEEDS", targetTypeKey: "TypeB", targetStateVar: "risk", coefficient: 0.5, delayTicks: 1, status: "PUBLISHED" },
  });
};

const newSession = async (t: Awaited<ReturnType<typeof makeApp>>, baseSnapshot: unknown, headers = ADMIN) =>
  (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers, payload: { baseSnapshot } })).json().id as string;

describe("WO-P0 · 扰动一等公民", () => {
  it("暗发 entitlement（R3 先于 authz）：未播种租户 → 扰动三路由全 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    const H = debugUser("freshco", "admin", "admin");
    for (const [method, url] of [
      ["POST", "/a/v1/sim/sessions/whatever/perturbations"],
      ["GET", "/a/v1/sim/sessions/whatever/perturbations"],
      ["DELETE", "/a/v1/sim/sessions/whatever/perturbations/p1"],
    ] as const) {
      const r = await t.app.inject({ method, url, headers: H, payload: {} });
      expect(r.statusCode).toBe(404);
      expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
    }
  });

  // ── 断言① · PRD §7.2「durationTicks: null 与今天 /act 逐字节同结果」──────────────────
  it("断言①：durationTicks=null 的扰动与今天 /act **逐字节同结果**（additive 可回退的证明）", async () => {
    const t = await makeApp();
    await enableSim(t);

    // 路 A —— 今天的 /act（裸标量写入，无 id/无时序）
    const sidAct = await newSession(t, BASE);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sidAct}/tick`, headers: ADMIN, payload: { n: 2 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sidAct}/act`, headers: ADMIN, payload: { objectId: "o1", stateVar: "risk", value: 0.9 } });
    const worldAct = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sidAct}/world`, headers: ADMIN })).json();

    // 路 B —— 一条 durationTicks:null / mode:set 的扰动（PRD §3.1.2 判据 1：null = 永久 = /act 的行为）
    const sidPert = await newSession(t, BASE);
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sidPert}/tick`, headers: ADMIN, payload: { n: 2 } });
    const created = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sidPert}/perturbations`, headers: ADMIN,
      payload: { kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk", magnitude: 0.9, durationTicks: null, mode: "set", label: "常州 A 线停机" },
    });
    expect(created.statusCode).toBe(201);
    const worldPert = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sidPert}/world`, headers: ADMIN })).json();

    // 逐字节：world 的完整 JSON（tick + state）必须一模一样。
    expect(JSON.stringify(worldPert)).toBe(JSON.stringify(worldAct));
    // ⚠ 上面这一条**单独拿出来是同义反复** —— 两条路走同一个 `applyPerturbationToState`，
    // 相等是结构上保证的。它证明的是"不会漂移"，不是"算得对"。
    // 故必须再钉一个**字面量**：施加器本身算错时（比如把 set 写成 delta），上面那条照样绿，这条会红。
    expect(worldAct).toEqual({ tick: 2, state: { o1: { risk: 0.9 }, o2: { risk: 0.2 } } });
    // …而扰动这条路**多留下了一个实体**（这正是升格的全部意义：/act 做完什么都不剩）。
    expect(created.json().perturbation).toMatchObject({ kind: "capacity_loss", startTick: 2, durationTicks: null, mode: "set", label: "常州 A 线停机" });
  });

  // ── 断言② · PRD §7.2「tick → act → tick 后 pending 未丢」= 欠账 #151 ─────────────────
  it("断言②（#151）：tick → act → tick 后在途延迟传导**未丢** —— /act 不再清空 pending", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);

    const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    // tick#1（t=0）：规则 delayTicks=1 ⇒ 0.5×10=5 排进 pending，arriveTick=1，本 tick 世界态不动。
    const tick1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick1.json().curTick).toBe(1);
    expect(tick1.json().state.o2.risk).toBe(0); // 还在路上
    const afterTick1 = await t.repos.sim.getTickState("demo", sid, 1);
    expect(afterTick1?.pending).toHaveLength(1); // ← 前置事实：pending 真的非空（否则本断言测了个寂寞）
    expect(afterTick1?.pending[0]).toMatchObject({ arriveTick: 1, targetObjectId: "o2", targetStateVar: "risk", amount: 5 });

    // act —— 修复前这一行无条件写 `pending: []`，队列在此静默蒸发。
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: ADMIN, payload: { objectId: "o1", stateVar: "risk", value: 0 } });
    const afterAct = await t.repos.sim.getTickState("demo", sid, 1);
    expect(afterAct?.pending).toHaveLength(1); // 🔴 直接咬 #151：队列必须原样还在
    expect(afterAct?.state.o1?.risk).toBe(0); // 而 state 该改的照改（act 的本职）

    // tick#2（t=1）：pending 结算 ⇒ o2.risk = 0 + 5。修复前这里恒为 0（在途贡献已被 act 抹掉）。
    const tick2 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick2.json().state.o2.risk).toBe(5);
  });

  it("断言②补 · 同一条 #151 从**扰动路由**进来也不丢（新入口不许把老坑重挖一遍）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);

    const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk", magnitude: 0, label: "停机" },
    });
    expect((await t.repos.sim.getTickState("demo", sid, 1))?.pending).toHaveLength(1);
    const tick2 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick2.json().state.o2.risk).toBe(5);
  });

  it("既有传导不受影响：无扰动时 tick→tick 的世界态与本单引入前逐字节同结果（可回退）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);
    const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    const a = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 } });
    // t=0 排 5 到 arriveTick=1；t=1 结算 ⇒ o2=5，且 o1 仍持续产出 ⇒ 再排一笔到 arriveTick=2。
    expect(a.json().state).toEqual({ o1: { risk: 10 }, o2: { risk: 5 } });
    expect((await t.repos.sim.getTickState("demo", sid, 2))?.pending).toHaveLength(1);
  });

  // ── 断言③ · PRD §7.2「同扰动同种子重跑字节级一致」= R6 ────────────────────────────
  it("断言③（R6）：同扰动序列同基态重跑 → 世界态与扰动清单**字节级一致**", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);

    const PERTS = [
      { kind: "demand_shift", targetObjectId: "o1", targetStateVar: "risk", magnitude: 2, mode: "delta", startTick: 0, label: "追加订单" },
      { kind: "cost_shock", targetObjectId: "o1", targetStateVar: "risk", magnitude: 1.5, mode: "scale", startTick: 0, label: "原料涨价 50%" },
      { kind: "capacity_loss", targetObjectId: "o2", targetStateVar: "risk", magnitude: 0, mode: "set", startTick: 5, label: "第 5 天起停机" },
    ] as const;

    const run = async () => {
      const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
      for (const p of PERTS) {
        await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload: p });
      }
      await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 3 } });
      const world = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).json();
      const list = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN })).json();
      // id 是 randomBytes、createdAt 是墙钟 —— 二者是 I/O 元数据不是算法输出（同 check-sim.mjs §5 的口径），
      // 投影掉后剩下的**业务内容与顺序**必须字节级一致。
      const projected = (list.items as Record<string, unknown>[]).map(({ id: _id, sessionId: _s, createdAt: _c, ...rest }) => rest);
      return JSON.stringify({ world, projected });
    };
    const a = await run();
    const b = await run();
    expect(a).toBe(b);
    // 并且这不是"两边都空"的假一致：真有内容才算数。
    expect(JSON.parse(a).projected).toHaveLength(3);
    expect(JSON.parse(a).world.state.o1.risk).toBe(18); // (10 + 2) × 1.5 —— delta 与 scale 按建单顺序施加
  });

  // ── 断言④ · 「这个世界受过哪些扰动」——今天做不到 ────────────────────────────────
  it("断言④：扰动可列举 / 可溯源 / 可删（此前扰动不是实体，只是一次副作用）", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await newSession(t, BASE);

    const mk = (payload: Record<string, unknown>) =>
      t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload });
    const later = await mk({ kind: "supply_disruption", targetObjectId: "o2", targetStateVar: "risk", magnitude: 0.4, startTick: 9, durationTicks: 3, label: "供应商断供 3 天" });
    const now = await mk({ kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk", magnitude: 0, startTick: 0, label: "停机" });
    expect(later.statusCode).toBe(201);
    expect(now.statusCode).toBe(201);

    const list = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN })).json();
    expect(list.items).toHaveLength(2);
    // 排序确定（startTick 升序），与建单先后无关 —— 前端按时间轴排布靠的就是这个。
    expect((list.items as { startTick: number }[]).map((p) => p.startTick)).toEqual([0, 9]);
    // 每条都能回答「发生了什么/落在谁身上/什么时候/多久/多大」——North Star「断点」维的溯源承载物。
    expect(list.items[1]).toMatchObject({
      kind: "supply_disruption", targetObjectId: "o2", targetStateVar: "risk",
      startTick: 9, durationTicks: 3, magnitude: 0.4, mode: "set", label: "供应商断供 3 天",
    });

    // 未来的扰动只入库、不改当前世界态（施加是 WO-P2 在 propagateTick 里按 startTick 做的事）。
    const world = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).json();
    expect(world.state.o2.risk).toBe(0.2); // 起于 tick 9 的那条没生效
    expect(world.state.o1.risk).toBe(0); // 起于 tick 0 的那条生效了

    // 删：记录消失，但世界态不回滚（回滚走 checkpoint/rollback，不在这里再造一个撤销口）。
    const pid = (list.items as { id: string }[])[0]!.id;
    const del = await t.app.inject({ method: "DELETE", url: `/a/v1/sim/sessions/${sid}/perturbations/${pid}`, headers: ADMIN });
    expect(del.statusCode).toBe(200);
    const after = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN })).json();
    expect(after.items).toHaveLength(1);
    expect((await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).json().state.o1.risk).toBe(0);
    // 删第二次 → 404（不是静默 true）
    expect((await t.app.inject({ method: "DELETE", url: `/a/v1/sim/sessions/${sid}/perturbations/${pid}`, headers: ADMIN })).statusCode).toBe(404);
  });

  it("R2 隔离：他租户读不到 / 删不掉本租户的扰动", async () => {
    const t = await makeApp();
    await enableSim(t);
    await enableSim(t, "other");
    const sid = await newSession(t, BASE);
    const pid = (await (await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "quality_event", targetObjectId: "o1", targetStateVar: "risk", magnitude: 1, label: "批次不良" },
    })).json()).perturbation.id as string;
    const OTHER = debugUser("other", "admin", "admin");
    // 会话本身就跨不过去（404），扰动自然也够不到。
    expect((await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: OTHER })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/a/v1/sim/sessions/${sid}/perturbations/${pid}`, headers: OTHER })).statusCode).toBe(404);
    // 仓储层同样隔离（不靠路由那一层兜底·R9 两实现须同语义）。
    expect(await t.repos.sim.getPerturbation("other", pid)).toBeNull();
    expect(await t.repos.sim.deletePerturbation("other", sid, pid)).toBe(false);
    expect(await t.repos.sim.getPerturbation("demo", pid)).not.toBeNull();
  });

  it("契约校验落到路由：kind 非法 / durationTicks=0 → 400，不落库", async () => {
    const t = await makeApp();
    await enableSim(t);
    const sid = await newSession(t, BASE);
    const bad = async (payload: Record<string, unknown>) =>
      (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload })).statusCode;
    expect(await bad({ kind: "meteor_strike", targetObjectId: "o1", targetStateVar: "risk", magnitude: 1, label: "x" })).toBe(400);
    expect(await bad({ kind: "cost_shock", targetObjectId: "o1", targetStateVar: "risk", magnitude: 1, durationTicks: 0, label: "x" })).toBe(400);
    expect(await bad({ kind: "cost_shock", targetObjectId: "o1", targetStateVar: "risk", magnitude: 1, label: "x".repeat(201) })).toBe(400);
    expect((await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN })).json()).items).toHaveLength(0);
  });
});
