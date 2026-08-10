import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  captureEnterpriseState,
  diffEnterpriseStates,
  ENTERPRISE_STATE_REAL_WORLD_ID,
  enterpriseStateId,
  EnterpriseStateSchema,
  type EnterpriseState,
} from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, debugUser, type TestApp } from "./helpers.js";

/**
 * WO-ENTERPRISE-STATE · `EnterpriseState` 企业状态快照 —— **接缝驱动**，不是各半 unit。
 *
 * ── 本文件咬的接缝（一处断即红）────────────────────────────────────────────────
 *  ① **对象库 × 捕获核 × 仓储 × 路由**：真跑合成种子 → POST 捕获 → 读回来的 doc 里的数字
 *     必须能在对象库里被**独立数一遍数出同一个值**（测试自己数，不复用被测代码的聚合）。
 *     只测 `captureEnterpriseState` 这个纯函数是"排练"，证明不了链路（本仓 G-SKILL-REFGRAPH-DEAD-EXTRACTOR 形态）。
 *  ② **逻辑时钟 × 快照**：推进 A8 模拟时钟 → 同一世界的下一份快照 tick 必须跟着变，
 *     且**两份快照共存**（不是后一份把前一份挤掉）。反证：doc 里出现任何 wall-clock 即红。
 *  ③ **两世界物理隔离**（PRD §4.1）：fork 出仿真世界那一行之后，真实世界那一行必须**逐字节不变**。
 *  ④ **R9 双实现不漂**：pg.ts 里写的表名与 030 migration 里 `CREATE TABLE` 的名字必须逐字相同 ——
 *     memory 默认的单测**证明不了 pg 那一行**（写错只在 pg 模式运行时炸），所以这条单独咬。
 *
 * ── 为什么有一条"测试自己数一遍"的用例 ──────────────────────────────────────
 * 如果断言写成 `expect(state.metrics.find(...)).toBeDefined()`，那它对"数字是不是真的"一无所知：
 * 捕获核返回一堆 0 也照样绿。所以关键几条改成**独立预言机**：测试直接从 `t.repos.objects`
 * 把 `Order` 数一遍、把 `qty` 加一遍，再与快照里的数比。这样"引擎改口径而快照没跟上"会当场红。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = ENTERPRISE_STATE_REAL_WORLD_ID;
const OTHER_TENANT = debugUser("acme", "admin", "admin");

async function capture(t: TestApp, worldId?: string, headers = ADMIN) {
  return t.app.inject({
    method: "POST",
    url: "/a/v1/twin/enterprise-states",
    headers,
    payload: worldId ? { worldId } : {},
  });
}

async function newSimSession(t: TestApp): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/sim/sessions",
    headers: ADMIN,
    payload: { baseSnapshot: { probe: { v: 1 } } },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const metric = (s: EnterpriseState, key: string) => s.metrics.find((m) => m.key === key);

describe("WO-ENTERPRISE-STATE · 企业状态快照（接缝：对象库→捕获→仓储→路由）", () => {
  it("①a 捕获真数据：快照里的数字与测试自己从对象库数出来的**逐一相等**（不是「有这个字段」）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const res = await capture(t);
    expect(res.statusCode).toBe(201);
    const state = EnterpriseStateSchema.parse(res.json());

    // 独立预言机：测试自己数一遍（不复用被测的聚合实现）。
    const orders = (await t.repos.objects.listByType("demo", "Order")).filter((o) => !o.mergedInto);
    expect(orders.length).toBeGreaterThan(0); // 金丝雀：种子真的种进来了，否则下面的"相等"是 0===0 的空胜
    const qtySum = orders.reduce((a, o) => a + (typeof o.props.qty === "number" ? o.props.qty : 0), 0);

    expect(metric(state, "count:Order")?.value).toBe(orders.length);
    expect(metric(state, "sum:Order.qty")?.value).toBe(Math.round(qtySum * 1e6) / 1e6);
    expect(metric(state, "sum:Order.qty")?.source.sampleCount).toBe(orders.length);

    // 世界/隔离位
    expect(state.worldId).toBe(REAL);
    expect(state.isSimulated).toBe(false);
    expect(state.forkedFromStateId).toBeNull();
    expect(state.provenance.mode).toBe("CAPTURE");
    // 溯源可核对：读了 Order 类型几行，必须与真实行数一致。
    expect(state.provenance.inputs.find((i) => i.ref === "Order")?.count).toBe(orders.length);
  });

  it("①a2 覆盖面可核对：指标条数 == 本体推得的应有条数（少一条 = 某个类型/属性被悄悄漏掉）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const state = EnterpriseStateSchema.parse((await capture(t)).json());

    // 独立推一遍"应该有多少条"：每个 ACTIVE 类型 1 条对象数 + 每个数值属性 1 条合计 + 每条 SPINE 指标 1 条。
    // 数值属性 = properties(dataType==="number") ∪ derivedProperties（与服务里的口径同一句话，此处独立复述一遍
    // —— 若服务偷偷收窄了口径（例如"只取有数据的属性"），这条会红。
    const types = (await t.repos.ontologyTypes.list("demo")).filter((x) => x.status !== "RETIRED");
    let expected = 0;
    for (const ty of types) {
      const keys = new Set<string>();
      for (const p of ty.properties ?? []) if (p.dataType === "number") keys.add(p.propKey);
      for (const d of ty.derivedProperties ?? []) keys.add(d.propKey);
      expected += 1 + keys.size;
    }
    expected += (await t.repos.objects.listByType("demo", "Metric")).filter((o) => !o.mergedInto).length;
    expect(state.metrics).toHaveLength(expected);
    expect(expected).toBeGreaterThan(50); // 金丝雀：真世界确实是"几十上百条"，不是空壳
    // key 唯一（重复 key 会让前端按 key 取数时随机命中其中一条）。
    expect(new Set(state.metrics.map((m) => m.key)).size).toBe(state.metrics.length);
  });

  it("①b 分组键来自**租户本体的 domain**，不是代码枚举（R14 零业务常数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const state = EnterpriseStateSchema.parse((await capture(t)).json());

    const types = await t.repos.ontologyTypes.list("demo");
    const orderType = types.find((x) => x.key === "Order");
    expect(orderType).toBeDefined();
    // 快照里 Order 那组的 group 必须逐字等于本体里写的 domain —— 改本体的域，快照分组跟着变。
    expect(metric(state, "count:Order")?.group).toBe(orderType?.domain);
    // 至少要有多于一个分组（否则"按域分组"这句话没被证明）。
    expect(new Set(state.metrics.map((m) => m.group)).size).toBeGreaterThan(1);
  });

  it("①c 诚实空：数不出来的指标是 value:null + reason，**不是 0**（0 = 真数出来是 0）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const state = EnterpriseStateSchema.parse((await capture(t)).json());

    const empties = state.metrics.filter((m) => m.value === null);
    // 每一条空值都必须给出原因，且 sampleCount 为 0（诚实位不许自相矛盾）。
    for (const m of empties) {
      expect(m.reason, `${m.key} 是空值却没说原因`).toBeTruthy();
      expect(m.source.sampleCount).toBe(0);
    }
    // 反向：有值的一律不带 reason（免得"有数还在解释为什么没有"）。
    for (const m of state.metrics.filter((x) => x.value !== null)) expect(m.reason).toBeNull();
    // 金丝雀：真实种子世界里**确实存在**数不出来的属性（若为 0 条，则上面那圈断言什么都没验）。
    expect(empties.length).toBeGreaterThan(0);
  });

  it("②a R6 确定性：同 (tenant, world, 逻辑时刻) 重复捕获 → **逐字节一致** 且只有一行", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const a = (await capture(t)).json() as EnterpriseState;
    const b = (await capture(t)).json() as EnterpriseState;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // 字节级
    expect(b.id).toBe(a.id);
    expect(b.id).toBe(enterpriseStateId("demo", REAL, a.capturedAt.tick));

    // 幂等覆盖同一行，不是堆两行（否则"字节级一致"这句话无从验证）。
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/twin/enterprise-states", headers: ADMIN })).json() as {
      items: EnterpriseState[];
    };
    expect(list.items.filter((s) => s.worldId === REAL)).toHaveLength(1);
    expect(JSON.stringify(list.items[0])).toBe(JSON.stringify(a)); // 读回来的与写进去的同一份
  });

  it("②b capturedAt 是**逻辑时钟**：doc 里零 wall-clock；推进模拟时钟 → 新快照新 tick，两份共存", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const clock0 = (await t.app.inject({ method: "GET", url: "/a/v1/synthetic/clock", headers: ADMIN })).json() as {
      currentTick: number;
      simulatedDate: string;
      t0: string;
    };
    const s0 = (await capture(t)).json() as EnterpriseState;
    expect(s0.capturedAt.tick).toBe(clock0.currentTick);
    expect(s0.capturedAt.simulatedDate).toBe(clock0.simulatedDate);
    expect(s0.capturedAt.t0).toBe(clock0.t0.slice(0, 10));

    // 反证（本单头号纪律）：整份 doc 里不许出现带时分秒的时间串 —— 那就是 wall-clock 溜进来了。
    // 金丝雀：同一条正则拿一个已知必中的样例先跑，不中说明是正则坏了不是"doc 干净"。
    const WALLCLOCK = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
    expect(WALLCLOCK.test(`{"createdAt":"${new Date().toISOString()}"}`)).toBe(true); // 金丝雀命中
    expect(WALLCLOCK.test(JSON.stringify(s0))).toBe(false);

    // 推进逻辑时钟 → 下一份快照落在新 tick 上，且旧那份还在（时间线，不是覆盖）。
    await t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/tick", headers: ADMIN, payload: { advance: "1d" } });
    const s1 = (await capture(t)).json() as EnterpriseState;
    expect(s1.capturedAt.tick).toBe(clock0.currentTick + 1);
    expect(s1.id).not.toBe(s0.id);
    expect(s1.capturedAt.simulatedDate).not.toBe(s0.capturedAt.simulatedDate);

    const list = (await t.app.inject({ method: "GET", url: `/a/v1/twin/enterprise-states?worldId=${REAL}`, headers: ADMIN })).json() as {
      items: EnterpriseState[];
    };
    expect(list.items.map((s) => s.capturedAt.tick)).toEqual([clock0.currentTick, clock0.currentTick + 1]); // 按 tick 定序
  });

  it("②c 没有逻辑时钟就 409 明说，**绝不 fallback 到 wall-clock**", async () => {
    const t = await makeApp(); // 只 seedDemo，不跑合成 ⇒ 无 SimulationClockRecord
    expect(await t.repos.simulationClocks.get("demo", "demo")).toBeUndefined(); // 前提成立
    const res = await capture(t);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string; message: string } }).error.code).toBe("INVALID_STATE");
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/wall-clock/);
  });

  it("③a 世界隔离反证：fork 进仿真世界后，真实世界那一行**逐字节不变**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const real = (await capture(t)).json() as EnterpriseState;
    const realBefore = JSON.stringify(real);

    const sid = await newSimSession(t);
    const forkRes = await t.app.inject({
      method: "POST",
      url: `/a/v1/twin/enterprise-states/${real.id}/fork`,
      headers: ADMIN,
      payload: { worldId: sid },
    });
    expect(forkRes.statusCode).toBe(201);
    const sim = EnterpriseStateSchema.parse(forkRes.json());

    expect(sim.id).not.toBe(real.id); // fork 产生**新行**
    expect(sim.worldId).toBe(sid);
    expect(sim.isSimulated).toBe(true);
    expect(sim.forkedFromStateId).toBe(real.id);
    expect(sim.provenance.mode).toBe("FORK");
    // 出处必须翻成 FORKED：仿真那份数**没有重算**，不许自称"从对象库现场数出来的"。
    expect(new Set(sim.metrics.map((m) => m.source.kind))).toEqual(new Set(["FORKED"]));

    // 真实世界那一行一个字节都不许动。
    const realAfter = await t.app.inject({ method: "GET", url: `/a/v1/twin/enterprise-states/${real.id}`, headers: ADMIN });
    expect(JSON.stringify(realAfter.json())).toBe(realBefore);

    // 两个世界各自列各自的（互不串）。
    const realList = (await t.app.inject({ method: "GET", url: `/a/v1/twin/enterprise-states?worldId=${REAL}`, headers: ADMIN })).json() as { items: EnterpriseState[] };
    const simList = (await t.app.inject({ method: "GET", url: `/a/v1/twin/enterprise-states?worldId=${sid}`, headers: ADMIN })).json() as { items: EnterpriseState[] };
    expect(realList.items.map((s) => s.id)).toEqual([real.id]);
    expect(simList.items.map((s) => s.id)).toEqual([sim.id]);
  });

  it("③b fork 回真实世界被拒（400）· fork 进不存在的世界 404 · 捕获到不存在的世界 404", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const real = (await capture(t)).json() as EnterpriseState;

    const toReal = await t.app.inject({
      method: "POST",
      url: `/a/v1/twin/enterprise-states/${real.id}/fork`,
      headers: ADMIN,
      payload: { worldId: REAL },
    });
    expect(toReal.statusCode).toBe(400); // 仿真数字不许冒充真值（R4）

    const ghost = await t.app.inject({
      method: "POST",
      url: `/a/v1/twin/enterprise-states/${real.id}/fork`,
      headers: ADMIN,
      payload: { worldId: "sims_does_not_exist" },
    });
    expect(ghost.statusCode).toBe(404); // worldId 不是自由字符串

    expect((await capture(t, "sims_does_not_exist")).statusCode).toBe(404);
  });

  it("③c 仿真世界现场捕获（非 fork）也落在自己那一行，真实世界不受影响", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const real = (await capture(t)).json() as EnterpriseState;
    const sid = await newSimSession(t);

    const sim = EnterpriseStateSchema.parse((await capture(t, sid)).json());
    expect(sim.isSimulated).toBe(true);
    expect(sim.worldId).toBe(sid);
    expect(sim.forkedFromStateId).toBeNull(); // 现场捕获不是 fork
    expect(sim.id).toBe(enterpriseStateId("demo", sid, sim.capturedAt.tick));
    // 同一逻辑时刻、同一份对象库 ⇒ 两个世界的指标值相同，但**行不同**（隔离靠 id/worldId，不靠数值差异）。
    expect(JSON.stringify(sim.metrics)).toBe(JSON.stringify(real.metrics));
    expect(sim.id).not.toBe(real.id);
  });

  it("④ R2 跨租户：另一个租户读不到（404），也不会在自己的列表里看到", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const real = (await capture(t)).json() as EnterpriseState;

    const cross = await t.app.inject({ method: "GET", url: `/a/v1/twin/enterprise-states/${real.id}`, headers: OTHER_TENANT });
    expect(cross.statusCode).toBe(404);
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/twin/enterprise-states", headers: OTHER_TENANT })).json() as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it("⑤ latest 诚实空：没快照时返回 state:null + reason，**不偷偷现场捕获一份**", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const empty = (await t.app.inject({ method: "GET", url: "/a/v1/twin/enterprise-states/latest", headers: ADMIN })).json() as {
      state: EnterpriseState | null;
      reason?: string;
    };
    expect(empty.state).toBeNull();
    expect(empty.reason).toBeTruthy();
    // 只读请求不许有写副作用。
    expect(await t.repos.enterpriseStates.list("demo")).toHaveLength(0);

    const captured = (await capture(t)).json() as EnterpriseState;
    const latest = (await t.app.inject({ method: "GET", url: "/a/v1/twin/enterprise-states/latest", headers: ADMIN })).json() as {
      state: EnterpriseState;
    };
    expect(latest.state.id).toBe(captured.id);
  });

  it("⑥ diff 口径单源：`/diff` 与契约纯函数 `diffEnterpriseStates` 逐字节同结果（StateDelta 将来复用同一份）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s0 = (await capture(t)).json() as EnterpriseState;
    await t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/tick", headers: ADMIN, payload: { advance: "7d" } });
    const s1 = (await capture(t)).json() as EnterpriseState;

    const res = await t.app.inject({
      method: "GET",
      url: `/a/v1/twin/enterprise-states/${s1.id}/diff?against=${s0.id}`,
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { before: string; after: string; changes: unknown[] };
    expect(body.before).toBe(s0.id);
    expect(body.after).toBe(s1.id);
    expect(JSON.stringify(body.changes)).toBe(JSON.stringify(diffEnterpriseStates(s0, s1)));
    // 推进 7 个模拟日之后世界不可能一成不变；若为 0 条，是快照没在反映世界（哑快照）。
    expect(body.changes.length).toBeGreaterThan(0);
  });

  it("⑦ D-29 事件：捕获发 `enterprise_state.snapshotted`，fork 发 `enterprise_state.forked`", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const real = (await capture(t)).json() as EnterpriseState;
    const sid = await newSimSession(t);
    await t.app.inject({
      method: "POST",
      url: `/a/v1/twin/enterprise-states/${real.id}/fork`,
      headers: ADMIN,
      payload: { worldId: sid },
    });

    const events = await t.repos.outboxEvents.list("demo");
    const snap = events.filter((e) => e.event === "enterprise_state.snapshotted");
    expect(snap).toHaveLength(1);
    expect((snap[0]?.payload as { stateId: string; worldId: string }).stateId).toBe(real.id);
    expect((snap[0]?.payload as { worldId: string }).worldId).toBe(REAL);
    expect(events.filter((e) => e.event === "enterprise_state.forked")).toHaveLength(1);
  });

  it("⑧ R9 双实现不漂：pg.ts 的表名与 030 migration 的 CREATE TABLE 逐字相同（memory 单测证明不了这一行）", () => {
    const sql = readFileSync(join(HERE, "../migrations/030_enterprise_states.sql"), "utf8");
    const m = sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(/);
    expect(m, "030 migration 里找不到 CREATE TABLE —— 那是抽取正则坏了，不是「migration 没建表」").toBeTruthy();
    const table = m?.[1] as string;
    expect(table).toBe("enterprise_states"); // 金丝雀：抽出来的确实是我们要的那张表

    const pgSrc = readFileSync(join(HERE, "../src/repo/pg.ts"), "utf8");
    expect(pgSrc).toContain(`enterpriseStates: new PgStore(pool, "${table}")`);
    // memory 侧也必须登记（漏一处即漂：接口有、pg 有、memory 无 ⇒ 测试全绿而默认实现根本没这张表）
    const memSrc = readFileSync(join(HERE, "../src/repo/memory.ts"), "utf8");
    expect(memSrc).toMatch(/enterpriseStates:\s*new MemStore\(\)/);
    const repoSrc = readFileSync(join(HERE, "../src/repo/repo.ts"), "utf8");
    expect(repoSrc).toMatch(/enterpriseStates:\s*Store<EnterpriseState>/);
  });

  it("⑨ 捕获核是纯函数：同输入两次调用逐字节一致，且不读时钟（R6 的结构性保证）", () => {
    const input = {
      tenantId: "demo",
      worldId: REAL,
      isSimulated: false,
      forkedFromStateId: null,
      clock: { tick: 3, simulatedDate: "2026-06-15", t0: "2026-06-12" },
      kpis: [{ metricKey: "m1", label: "指标一", unit: "亿", category: "profit", actual: 1.23456789, target: 2 }],
      types: [
        {
          typeKey: "T",
          displayName: "类型 T",
          domain: "capacity",
          numericProps: [{ propKey: "cap", unit: "套/日" }, { propKey: "ghost", unit: "" }],
          rows: [{ cap: 1.1 }, { cap: 2.2 }, { cap: "3.3" }, { cap: null }],
        },
      ],
    };
    const a = captureEnterpriseState(input);
    const b = captureEnterpriseState(input);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // 字符串数字照样计入（对象库里 props 类型不齐是常态）；不可解析的一律跳过并如实报 sampleCount。
    expect(a.metrics.find((m) => m.key === "sum:T.cap")?.value).toBe(6.6);
    expect(a.metrics.find((m) => m.key === "sum:T.cap")?.source.sampleCount).toBe(3);
    // 声明了但一行数据都没有的属性：null + reason，不是 0。
    expect(a.metrics.find((m) => m.key === "sum:T.ghost")?.value).toBeNull();
    expect(a.metrics.find((m) => m.key === "sum:T.ghost")?.reason).toBeTruthy();
    // KPI 六位定点（否则浮点尾差会把"字节级一致"打红）。
    expect(a.metrics.find((m) => m.key === "kpi:m1")?.value).toBe(1.234568);
    // 全序排序：metrics 必须按 key 升序（跨运行稳定）。
    expect(a.metrics.map((m) => m.key)).toEqual([...a.metrics.map((m) => m.key)].sort());
  });
});
