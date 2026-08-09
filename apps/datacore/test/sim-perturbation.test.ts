import { describe, expect, it } from "vitest";
import { PerturbationSchema, PropagationRuleSchema, type Perturbation, type PropagationRule, type TickState } from "@platform/contracts";
import { propagateTick, type PerturbationInTick, type PropagationGraph } from "../src/sim/propagation.js";
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

// ═══════════════════════════════════════════════════════════════════════════════
// WO-P2 · propagateTick 接扰动（到期回退 + 溯源）· PRD-UPGRADE-decision-sandbox-v2 §3.1.3
// ═══════════════════════════════════════════════════════════════════════════════

/** 建一条扰动（引擎单测用；走契约 parse，字段默认值与路由那条路同一支）。 */
const pert = (over: Partial<Perturbation> & Pick<Perturbation, "targetObjectId" | "targetStateVar" | "magnitude">): Perturbation =>
  PerturbationSchema.parse({
    id: over.id ?? "sp1", tenantId: "t1", sessionId: "s1",
    kind: over.kind ?? "capacity_loss", startTick: over.startTick ?? 0,
    label: over.label ?? "engine-unit", createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

/** 空图 —— 引擎单测只验扰动相位时用（零传导边，世界态只被扰动改）。 */
const NOGRAPH: PropagationGraph = { objects: [], links: [] };

/**
 * 取一条世界线（tick 0..upto 的 state/pending/trace 全量），用于逐字节比对。
 *
 * 扰动 id 是 `randomBytes`（`ids.ts:7`）—— **I/O 元数据，不是算法输出**（同 WO-P0 断言③ 的口径），
 * 跨运行必然不同，直接比就是在比随机数。这里按**首次出现次序**编号替换，而不是一律替成同一个占位符：
 * 后者会把「两条扰动的先后顺序变了」这种真差异一并抹平 —— 而顺序恰恰是本单的语义（delta/scale 不可交换）。
 */
const worldline = async (t: Awaited<ReturnType<typeof makeApp>>, sid: string, upto: number, tenant = "demo") => {
  const rows = [];
  for (let k = 0; k <= upto; k++) {
    const r = await t.repos.sim.getTickState(tenant, sid, k);
    rows.push(r ? { tick: r.tick, state: r.state, pending: r.pending, trace: r.trace } : null);
  }
  const seen = new Map<string, string>();
  return JSON.stringify(rows).replace(/simpert_[0-9a-z]+/g, (id) => {
    if (!seen.has(id)) seen.set(id, `<pert#${seen.size}>`);
    return seen.get(id)!;
  });
};

const tickN = (t: Awaited<ReturnType<typeof makeApp>>, sid: string, n: number) =>
  t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });

const mkPert = (t: Awaited<ReturnType<typeof makeApp>>, sid: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload });

const worldOf = async (t: Awaited<ReturnType<typeof makeApp>>, sid: string) =>
  (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).json() as { tick: number; state: TickState };

describe("WO-P2 · propagateTick 接扰动（到期回退 + 溯源）", () => {
  // ── 断言 1 · 到期真回退（不是永久生效）· 本单唯一需要状态记忆的地方 ─────────────────
  it("断言1（到期回退）：durationTicks=72 的停机在 tick 72 **回退**，tick 75 世界已恢复；durationTicks=null 则永久", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t); // r_delay: TypeA.risk --FEEDS(×0.5, delay 1)--> TypeB.risk

    /** 同一份世界 + 同一条停机扰动，只有 durationTicks 不同。 */
    const run = async (durationTicks: number | null) => {
      const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
      const created = await mkPert(t, sid, {
        kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk",
        magnitude: 0, mode: "set", startTick: 0, durationTicks, label: "常州 A 线停机 72h",
      });
      expect(created.statusCode).toBe(201);
      // 建单当 tick 即生效（路由施加·WO-P0）：源头被摁到 0。
      expect((await worldOf(t, sid)).state.o1!.risk).toBe(0);
      const res = await tickN(t, sid, 75);
      return { sid, res: res.json() as { curTick: number; state: TickState; appliedPerturbations?: string[] } };
    };

    // ① 有限期：tick 72 到期 ⇒ o1.risk 还原为「若无此扰动本应有的值」= 10（baseSnapshot）。
    const limited = await run(72);
    expect(limited.res.curTick).toBe(75);
    expect(limited.res.state.o1!.risk).toBe(10);
    // 🔴 接缝：回退后**下游必须重新被喂到**（回退不是只改一个数字，是让传导重新跑起来）。
    // tick72 回退 → 当 tick 就排出 0.5×10=5（delayTicks=1）→ 73/74/75 各结算一笔 ⇒ 0+5+5+5 = 15。
    expect(limited.res.state.o2!.risk).toBe(15);
    // 到期那一格的 trace 必须有回退行，且 before/after 成对（溯源：这个数是被谁改回去的）。
    const t72 = await t.repos.sim.getTickState("demo", limited.sid, 72);
    const revertRows = (t72?.trace ?? []).filter((r) => r.ruleKey.startsWith("perturbation-revert:"));
    expect(revertRows).toHaveLength(2);
    expect(revertRows.map((r) => [r.fromObjectId, r.amount, r.viaLinkKey])).toEqual([
      ["(perturbation.after)", 10, "risk"],
      ["(perturbation.before)", 0, "risk"],
    ]);
    // 生效期内 appliedPerturbations 有它，到期后没有（溯源随生效期收放）。
    expect((await t.repos.sim.getTickState("demo", limited.sid, 71))!.state.o1!.risk).toBe(0);
    expect(limited.res.appliedPerturbations).toEqual([]);

    // ② 永久：同样 75 tick，世界**从未**恢复 —— 这条是断言1 的反证，缺了它「回退」可能只是巧合。
    const forever = await run(null);
    expect(forever.res.state.o1!.risk).toBe(0);
    expect(forever.res.state.o2!.risk).toBe(0); // 源头恒 0 ⇒ 下游一直吃不到东西
    expect(forever.res.appliedPerturbations).toHaveLength(1);
  });

  // ── 断言 2 · durationTicks=null 与「接扰动之前」逐字节相同（additive 可回退） ─────────
  it("断言2（可回退）：durationTicks=null 的扰动世界线与 `/act`（不产生扰动实体 ⇒ 引擎走老路）**逐字节相同**", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);

    // 路 A —— `/act`：不留扰动实体 ⇒ 每个 tick 引擎拿到的 perturbations 恒为空 = 本单引入前的那条路。
    const sidAct = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sidAct}/act`, headers: ADMIN, payload: { objectId: "o1", stateVar: "risk", value: 7 } });
    await tickN(t, sidAct, 5);

    // 路 B —— durationTicks:null 的扰动：引擎每个 tick 都拿到一条非空清单，但既不 enter 也不 exit。
    const sidPert = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    await mkPert(t, sidPert, { kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk", magnitude: 7, mode: "set", startTick: 0, durationTicks: null, label: "永久" });
    await tickN(t, sidPert, 5);

    // 比的是**整条世界线**（每 tick 的 state + pending + trace），不是终点一个数 ——
    // 只比终点的话，中间某个 tick 被多算一次又被抵消回来是看不出来的。
    expect(await worldline(t, sidPert, 5)).toBe(await worldline(t, sidAct, 5));
    // 且这不是"两边都空"的假一致：世界线上真的有传导在跑。
    expect((await worldOf(t, sidAct)).state).toEqual({ o1: { risk: 7 }, o2: { risk: 14 } });
  });

  // ── 断言 3 · delta 在 startTick 那一 tick 不重复施加 ───────────────────────────────
  it("断言3（不重复施加）：建单当 tick 已由路由施加的 delta，tick 后是 +2 **不是 +4**，且之后不逐 tick 复利", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);

    const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    await mkPert(t, sid, { kind: "demand_shift", targetObjectId: "o1", targetStateVar: "risk", magnitude: 2, mode: "delta", startTick: 0, label: "追加订单 +2" });
    expect((await worldOf(t, sid)).state.o1!.risk).toBe(12); // 路由已施加一次

    expect(((await tickN(t, sid, 1)).json() as { state: TickState }).state.o1!.risk).toBe(12); // ← +2 不是 +4
    // 再推 3 tick：若引擎每 tick 重新施加一次，这里会是 14 / 16 / 18（复利），必须仍是 12。
    expect(((await tickN(t, sid, 3)).json() as { state: TickState }).state.o1!.risk).toBe(12);

    // 反面一半：**未来才起效**的 delta 必须在它的 startTick 真落地一次（躲重复施加不许连该施加的也躲掉）。
    const sid2 = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
    await mkPert(t, sid2, { kind: "demand_shift", targetObjectId: "o1", targetStateVar: "risk", magnitude: 2, mode: "delta", startTick: 3, label: "第 3 天追单 +2" });
    expect((await worldOf(t, sid2)).state.o1!.risk).toBe(10); // 未生效，路由没碰
    expect(((await tickN(t, sid2, 2)).json() as { state: TickState }).state.o1!.risk).toBe(10); // tick 1/2 仍未到
    expect(((await tickN(t, sid2, 1)).json() as { state: TickState }).state.o1!.risk).toBe(12); // tick 3 落地，恰一次
    expect(((await tickN(t, sid2, 3)).json() as { state: TickState }).state.o1!.risk).toBe(12); // 之后不再加
  });

  // ── 断言 4 · 同扰动同种子重跑字节级一致（R6） ─────────────────────────────────────
  it("断言4（R6）：含到期回退 / 未来起效 / delta / scale 的一整套扰动，重跑**世界线字节级一致**", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedDelayedPropagation(t);

    const PERTS = [
      { kind: "demand_shift", targetObjectId: "o1", targetStateVar: "risk", magnitude: 2, mode: "delta", startTick: 0, durationTicks: 4, label: "追单 +2 持续 4" },
      { kind: "cost_shock", targetObjectId: "o1", targetStateVar: "risk", magnitude: 1.5, mode: "scale", startTick: 0, durationTicks: 6, label: "涨价 ×1.5 持续 6" },
      { kind: "capacity_loss", targetObjectId: "o2", targetStateVar: "risk", magnitude: 0, mode: "set", startTick: 3, durationTicks: 2, label: "第 3 天起停机 2 tick" },
      { kind: "supply_disruption", targetObjectId: "o1", targetStateVar: "risk", magnitude: 0.5, mode: "scale", startTick: 5, durationTicks: null, label: "第 5 天起断供（永久）" },
    ] as const;

    const run = async () => {
      const sid = await newSession(t, { o1: { risk: 10 }, o2: { risk: 0 } });
      for (const p of PERTS) expect((await mkPert(t, sid, p)).statusCode).toBe(201);
      await tickN(t, sid, 9);
      return await worldline(t, sid, 9);
    };
    const a = await run();
    expect(a).toBe(await run());
    // 不是"两边都空"：世界线上真的发生过落地与回退（否则这条 R6 测了个寂寞）。
    const rows = JSON.parse(a) as { trace: { ruleKey: string }[] | null }[];
    const keys = rows.flatMap((r) => (r.trace ?? []).map((x) => x.ruleKey));
    expect(keys.some((k) => k.startsWith("perturbation:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("perturbation-revert:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("perturbation-revert-unresolved:"))).toBe(false); // 回退值全都算得出来
  });

  // ── 引擎单测：三种 mode 的回退语义各自可红 ────────────────────────────────────────
  it("引擎 · delta/scale 的回退是**解析求逆**（减/除），不靠记忆，也不抹掉中间演化", () => {
    const base: TickState = { o1: { v: 10 } };
    const d = pert({ id: "pd", targetObjectId: "o1", targetStateVar: "v", magnitude: 2, mode: "delta", startTick: 1, durationTicks: 1 });
    // producedTick=1 落地 ⇒ 12
    const landed = propagateTick(NOGRAPH, base, [], [], 0, {}, {}, [d]);
    expect(landed.next.o1!.v).toBe(12);
    expect(landed.appliedPerturbations).toEqual(["pd"]);
    // 中间世界自己动了一下（模拟传导把它推到 20），producedTick=2 到期 ⇒ 20-2=18（不是回到 10）
    const moved: TickState = { o1: { v: 20 } };
    const reverted = propagateTick(NOGRAPH, moved, [], [], 1, {}, {}, [d]);
    expect(reverted.next.o1!.v).toBe(18);
    expect(reverted.appliedPerturbations).toEqual([]);

    const s = pert({ id: "ps", targetObjectId: "o1", targetStateVar: "v", magnitude: 1.5, mode: "scale", startTick: 1, durationTicks: 1 });
    expect(propagateTick(NOGRAPH, base, [], [], 0, {}, {}, [s]).next.o1!.v).toBe(15);
    expect(propagateTick(NOGRAPH, { o1: { v: 30 } }, [], [], 1, {}, {}, [s]).next.o1!.v).toBe(20); // 30/1.5
  });

  it("引擎 · set 的回退必须拿到 preValue；拿不到就**诚实报缺**（不静默留成永久生效）", () => {
    const p = pert({ id: "pset", targetObjectId: "o1", targetStateVar: "v", magnitude: 0, mode: "set", startTick: 1, durationTicks: 1 });
    const held: TickState = { o1: { v: 0 } };
    // 有 preValue ⇒ 还原
    const ok = propagateTick(NOGRAPH, held, [], [], 1, {}, {}, [{ ...p, preValue: 10 } satisfies PerturbationInTick]);
    expect(ok.next.o1!.v).toBe(10);
    // 没 preValue ⇒ 值不动，但缺口必须亮在 trace 里（诚实缺席，不是"看起来正常"）
    const missing = propagateTick(NOGRAPH, held, [], [], 1, {}, {}, [p]);
    expect(missing.next.o1!.v).toBe(0);
    expect(missing.trace.map((r) => r.ruleKey)).toEqual(["perturbation-revert-unresolved:pset"]);
  });

  it("引擎 · 同 tick 多条扰动：落地按清单序（不可交换），到期按逆序解开", () => {
    const base: TickState = { o1: { v: 10 } };
    const add = pert({ id: "p_add", targetObjectId: "o1", targetStateVar: "v", magnitude: 2, mode: "delta", startTick: 1, durationTicks: 1 });
    const mul = pert({ id: "p_mul", targetObjectId: "o1", targetStateVar: "v", magnitude: 1.5, mode: "scale", startTick: 1, durationTicks: 1 });
    // 落地：(10+2)×1.5 = 18（清单序）；反过来是 10×1.5+2 = 17 —— 顺序即语义。
    const landed = propagateTick(NOGRAPH, base, [], [], 0, {}, {}, [add, mul]);
    expect(landed.next.o1!.v).toBe(18);
    expect(propagateTick(NOGRAPH, base, [], [], 0, {}, {}, [mul, add]).next.o1!.v).toBe(17);
    // 到期：逆序解开 ⇒ 18/1.5 − 2 = 10（回到原点）；顺序做反就是 (18−2)/1.5 = 10.666…
    expect(propagateTick(NOGRAPH, landed.next, [], [], 1, {}, {}, [add, mul]).next.o1!.v).toBe(10);
  });

  it("引擎 · 落地当 tick 就往下游传（不白等一个 tick），且传导规则照常吃到扰动后的源态", () => {
    const graph: PropagationGraph = {
      objects: [{ id: "a", typeKey: "TypeA" }, { id: "b", typeKey: "TypeB" }],
      links: [{ fromId: "a", toId: "b", linkKey: "FEEDS" }],
    };
    const r: PropagationRule = PropagationRuleSchema.parse({
      id: "pr1", tenantId: "t1", key: "PR", sourceTypeKey: "TypeA", sourceStateVar: "risk",
      viaLinkKey: "FEEDS", targetTypeKey: "TypeB", targetStateVar: "risk",
      coefficient: 0.5, delayTicks: 0, status: "PUBLISHED",
    });
    const base: TickState = { a: { risk: 0 }, b: { risk: 0 } };
    // 无扰动：源 0 ⇒ 下游 0。
    expect(propagateTick(graph, base, [r], [], 0).next.b!.risk).toBe(0);
    // 有扰动（producedTick=1 落地 a.risk=10）：**当 tick** 就应喂到 b = 5。
    const p = pert({ id: "pp", targetObjectId: "a", targetStateVar: "risk", magnitude: 10, mode: "set", startTick: 1, kind: "demand_shift" });
    const out = propagateTick(graph, base, [r], [], 0, {}, {}, [p]);
    expect(out.next.a!.risk).toBe(10);
    expect(out.next.b!.risk).toBe(5);
  });

  it("引擎 · 入参 state **不被改**（R6 纯函数）：扰动相位只作用在副本上", () => {
    const base: TickState = { o1: { v: 10 } };
    const snapshot = JSON.stringify(base);
    const p = pert({ id: "px", targetObjectId: "o1", targetStateVar: "v", magnitude: 99, mode: "set", startTick: 1 });
    propagateTick(NOGRAPH, base, [], [], 0, {}, {}, [p]);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("没有 PUBLISHED 传导规则的世界，扰动一样会到期回退（不许悄悄变永久）", async () => {
    const t = await makeApp();
    await enableSim(t); // ← 注意：**不**播传导规则
    const sid = await newSession(t, { o1: { risk: 10 } });
    await mkPert(t, sid, { kind: "capacity_loss", targetObjectId: "o1", targetStateVar: "risk", magnitude: 0, mode: "set", startTick: 0, durationTicks: 2, label: "停机 2 tick" });
    expect((await worldOf(t, sid)).state.o1!.risk).toBe(0);
    expect(((await tickN(t, sid, 1)).json() as { state: TickState }).state.o1!.risk).toBe(0); // tick1 仍在生效期
    expect(((await tickN(t, sid, 1)).json() as { state: TickState }).state.o1!.risk).toBe(10); // tick2 到期 ⇒ 还原
  });
});
