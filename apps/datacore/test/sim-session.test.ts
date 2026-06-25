import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser, seedBattery } from "./helpers.js";

/**
 * 推演沙盘增量 1 · 会话状态机（SPEC-sandbox-propagation-and-session §2/§5）。
 * 行业无关：state 为抽象 objectId→stateVar→number（零业务常数 R14）。
 * 暗发 entitlement（R3）· 确定性（R6）· R2 跨租户隔离 · 可回退。
 */
const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>, tenant = "demo") =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true } },
  });
const BASE = { o1: { risk: 0.5 }, o2: { risk: 0.2 } };

describe("推演沙盘增量1 · 会话状态机", () => {
  it("暗发 entitlement（R3）：未播种租户 sim.* defaultOn:false → /a/v1/sim/* 返 404 FEATURE_NOT_FOUND（先于 authz）", async () => {
    // 用未经 battery 模板播种的纯净租户——battery 给 demo 开了全部 feature（showcase），
    // 暗发默认须在干净租户上验：无 feature 配置 → 落 defaultOn:false → 沙盘不存在（404）。
    const t = await makeApp();
    const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: debugUser("freshco", "admin", "admin"), payload: { baseSnapshot: BASE } });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("init→tick×2→act→checkpoint→tick→rollback→branch→compare 全跑通（CLI 同序）", async () => {
    const t = await makeApp();
    await enableSim(t);
    // init
    const init = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } });
    expect(init.statusCode).toBe(201);
    const sid = init.json().id as string;
    expect(init.json().status).toBe("READY");
    // tick×2（增量1 恒等桩：状态原样进位）
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 } });
    expect(tick.json().curTick).toBe(2);
    expect(tick.json().state.o1.risk).toBe(0.5);
    // act（模拟态，改当前 tick）
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: ADMIN, payload: { objectId: "o1", stateVar: "risk", value: 0.9 } });
    const world = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN });
    expect(world.json().state.o1.risk).toBe(0.9);
    // checkpoint @tick2
    const cp = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "cpA" } });
    const cpId = cp.json().id as string;
    expect(cp.json().tick).toBe(2);
    // tick → curTick3, then rollback to cp(tick2)
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    const rb = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/rollback`, headers: ADMIN, payload: { checkpointId: cpId } });
    expect(rb.json().curTick).toBe(2);
    // branch（以 cp 态为 base 开新会话）
    const br = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN, payload: { checkpointId: cpId } });
    expect(br.statusCode).toBe(201);
    expect(br.json().parentCheckpointId).toBe(cpId);
    expect(br.json().baseSnapshot.o1.risk).toBe(0.9); // 继承 act 后的态
    const bid = br.json().id as string;
    // compare（两会话 KPI 序列）
    const cmp = await t.app.inject({ method: "GET", url: `/a/v1/sim/compare?a=${sid}&b=${bid}`, headers: ADMIN });
    expect(cmp.json().a.length).toBeGreaterThan(0);
    expect(cmp.json().b.length).toBeGreaterThan(0);
  });

  it("确定性 R6：同 base+操作序列两个会话 → tick 态字节一致", async () => {
    const t = await makeApp();
    await enableSim(t);
    const run = async () => {
      const s = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } })).json().id;
      await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s}/tick`, headers: ADMIN, payload: { n: 3 } });
      await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${s}/act`, headers: ADMIN, payload: { objectId: "o2", stateVar: "risk", value: 0.7 } });
      return (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${s}/world`, headers: ADMIN })).json();
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it("R2 隔离：他租户读不到本租户会话（404）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await enableSim(t, "other");
    const sid = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } })).json().id;
    const other = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: debugUser("other", "admin", "admin") });
    expect(other.statusCode).toBe(404);
  });

  it("传导规则 CRUD（系数可编辑·一等类型）：发布即列出", async () => {
    const t = await makeApp();
    await enableSim(t);
    const create = await t.app.inject({ method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: { key: "r_demo", sourceTypeKey: "TypeA", sourceStateVar: "risk", viaLinkKey: "FEEDS", targetTypeKey: "TypeB", targetStateVar: "risk", coefficient: 0.85, delayTicks: 1, status: "PUBLISHED" } });
    expect(create.statusCode).toBe(201);
    const list = await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN });
    expect((list.json().items as { key: string }[]).some((r) => r.key === "r_demo")).toBe(true);
  });

  it("增量4 view-config 由本体派生（配置驱动·零业务常数）：节点类型来自租户本体、状态变量来自传导规则", async () => {
    const t = await makeApp();
    await seedBattery(t); // 本体有对象类型/链路
    await enableSim(t);
    await t.app.inject({ method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: { key: "r_v", sourceTypeKey: "Line", sourceStateVar: "util", viaLinkKey: "FEEDS", targetTypeKey: "Base", targetStateVar: "risk", coefficient: 0.5, delayTicks: 0, status: "PUBLISHED" } });
    const cfg = await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN });
    expect(cfg.statusCode).toBe(200);
    const j = cfg.json() as { nodeTypes: string[]; stateVars: string[]; propagationCount: number; radarDims: unknown[] };
    expect(j.nodeTypes.length).toBeGreaterThan(0); // 派生自本体对象类型（任意行业）
    expect(j.stateVars).toEqual(["risk", "util"]); // 派生自传导规则 source/target stateVar
    expect(j.propagationCount).toBe(1);
    expect(j.radarDims.length).toBe(3);
  });
});
